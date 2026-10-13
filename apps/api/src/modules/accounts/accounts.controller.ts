import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import {
  createAccountSchema,
  listAccountsQuerySchema,
  updateAccountSchema,
  type CreateAccountInput,
  type ListAccountsQuery,
  type UpdateAccountInput,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { AccountsService } from "./accounts.service";
import { BankStatusService } from "./bank-status.service";
import { CardPasswordService } from "./card-password.service";
import { CardSecretsService } from "./card-secrets.service";

const uuidSchema = z.string().uuid("Not a valid id");

/*
 * Declared here rather than in `packages/shared` for the reason the trash's
 * are: that package is consumed as built `dist/` by twenty screens, and a
 * shape only this controller reads does not need to be a dependency of any of
 * them.
 */
const cardPasswordSchema = z.object({
  /** Required only when one is already set — the service decides. */
  current: z.string().min(1).max(200).nullish(),
  next: z
    .string()
    .min(8, "A card password needs at least 8 characters")
    .max(200),
});

const revealSchema = z.object({
  cardPassword: z.string().min(1, "Type the card password").max(200),
});

/** A books month, as its first day. */
const firstOfMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-01$/, "A books month is the 1st of a month");

const bankStatusQuerySchema = z.object({ month: firstOfMonth });

const bankStatusNoteSchema = z.object({
  accountId: uuidSchema,
  month: firstOfMonth,
  /** Empty clears the note. */
  note: z.string().max(500, "A note is at most 500 characters"),
});

/** Check ticked by hand; false removes the tick (piece 4d). */
const bankStatusCheckSchema = z.object({
  accountId: uuidSchema,
  month: firstOfMonth,
  checked: z.boolean(),
});

type CardPasswordBody = z.infer<typeof cardPasswordSchema>;
type RevealBody = z.infer<typeof revealSchema>;
type BankStatusQuery = z.infer<typeof bankStatusQuerySchema>;
type BankStatusNoteBody = z.infer<typeof bankStatusNoteSchema>;
type BankStatusCheckBody = z.infer<typeof bankStatusCheckSchema>;

@Controller("accounts")
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly cardPassword: CardPasswordService,
    private readonly cardSecrets: CardSecretsService,
    private readonly bankStatus: BankStatusService,
  ) {}

  /**
   * Whether a card password is set, and when it was last changed.
   *
   * DECLARED ABOVE `@Get(":id")`. Below it, "card-password" arrives as an id
   * and answers "Not a valid id" for a route that exists — the same trap the
   * trash's bulk route documents.
   */
  @Get("card-password")
  @RequirePermission("accounts.read")
  cardPasswordStatus() {
    return this.cardPassword.status();
  }

  /**
   * Set it, or change it. `settings.write` — super_admin alone.
   *
   * Deliberately a narrower permission than reading a card: the people who may
   * USE the password are super_admin, admin and cfo; the person who may CHANGE
   * it for everybody is one.
   */
  @Post("card-password")
  @RequirePermission("settings.write")
  setCardPassword(
    @ZodBody(cardPasswordSchema) body: CardPasswordBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cardPassword.set(
      { current: body.current ?? null, next: body.next },
      actor,
    );
  }

  /**
   * Accounts ▸ Bank status for one books month. Above `@Get(":id")`, for the
   * reason `card-password` is.
   */
  @Get("bank-status")
  @RequirePermission("accounts.read")
  bankStatusFor(@ZodQuery(bankStatusQuerySchema) query: BankStatusQuery) {
    return this.bankStatus.month(query.month);
  }

  /** The Note column: typed by hand, empty clears it. */
  @Put("bank-status/note")
  @RequirePermission("accounts.write")
  saveBankStatusNote(
    @ZodBody(bankStatusNoteSchema) body: BankStatusNoteBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bankStatus.saveNote(body, actor);
  }

  /** The Check column, ticked by hand; unticking leaves a reconciled month Matched. */
  @Put("bank-status/check")
  @RequirePermission("accounts.write")
  saveBankStatusCheck(
    @ZodBody(bankStatusCheckSchema) body: BankStatusCheckBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.bankStatus.saveCheck(body, actor);
  }

  @Get()
  @RequirePermission("accounts.read")
  list(@ZodQuery(listAccountsQuerySchema) query: ListAccountsQuery) {
    return this.accounts.list(query);
  }

  @Get("balances")
  @RequirePermission("dashboard.money")
  balances() {
    return this.accounts.balances();
  }

  @Get(":id")
  @RequirePermission("accounts.read")
  findOne(@Param("id") id: string) {
    return this.accounts.findOne(uuidSchema.parse(id));
  }

  @Post()
  @RequirePermission("accounts.write")
  create(
    @ZodBody(createAccountSchema) body: CreateAccountInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.accounts.create(body, actor);
  }

  @Patch(":id")
  @RequirePermission("accounts.write")
  update(
    @Param("id") id: string,
    @ZodBody(updateAccountSchema) body: UpdateAccountInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.accounts.update(uuidSchema.parse(id), body, actor);
  }

  /** Archiving is reversible; without this the only way back was a console. */
  /**
   * The card number and CVC, once, for somebody who knows the card password.
   *
   * POST rather than GET, and the password in the body rather than the query,
   * because a query string is written to every access log it passes through.
   * `@HttpCode(200)` because nothing is created — this reads.
   */
  @Post(":id/card-secrets")
  @HttpCode(200)
  @RequirePermission("accounts.write")
  revealCard(
    @Param("id") id: string,
    @ZodBody(revealSchema) body: RevealBody,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.cardSecrets.reveal(
      uuidSchema.parse(id),
      body.cardPassword,
      actor,
    );
  }

  @Post(":id/restore")
  @HttpCode(200)
  @RequirePermission("accounts.write")
  restore(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.accounts.restore(uuidSchema.parse(id), actor);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @RequirePermission("accounts.write")
  archive(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.accounts.archive(uuidSchema.parse(id), actor);
  }

  /**
   * What is hanging off this account. Read before the confirmation is drawn,
   * so the warning can name figures rather than gesture at "related records".
   */
  @Get(":id/attachments")
  @RequirePermission("accounts.read")
  attachments(@Param("id") id: string) {
    return this.accounts.attachments(uuidSchema.parse(id));
  }

  /**
   * Only an archived account, and only one nothing points at. The service
   * explains at length why the other cases are refused rather than offered
   * behind a checkbox.
   */
  @Delete(":id")
  @HttpCode(200)
  @RequirePermission("accounts.write")
  remove(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.accounts.remove(uuidSchema.parse(id), actor);
  }
}
