import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  AI_FIRST_PAYMENT_NOTE,
  AI_TARGET_LABELS,
  AI_TARGET_SHOWS_ON,
  createSubscriptionSchema,
  createTdsDepositSchema,
  createTeamMemberSchema,
  createTransactionSchema,
  createVendorSchema,
  formatMoney,
  transferSchema,
  type AiConfirmInput,
  type AiConfirmResult,
  type AiSaved,
  type AiTarget,
} from "@finance/shared";
import { z } from "zod";

import { throughTheAssistant } from "../../common/context/request-context";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { TdsService } from "../tds/tds.service";
import { TeamMembersService } from "../team-members/team-members.service";
import { paySubscriptionSchema } from "../transactions/pay-subscription.schema";
import { TransactionsService } from "../transactions/transactions.service";
import { VendorsService } from "../vendors/vendors.service";
import { AiChatsService } from "./ai-chats.service";
import { AiIntakeService } from "./ai-intake.service";

/**
 * Confirm in chat, then it saves (3 Oct 2026, piece A4).
 *
 * The owner's decision: the Assistant prepares the record and shows it; the
 * person presses Confirm and save in the chat, and it is saved through the
 * same endpoint, schema, permissions and audit trail as the form. It never
 * saves by itself — there is no path here that the model can reach.
 *
 * Until now the browser saved a card itself: it turned the names into ids
 * and posted to the record's endpoint. What it posted was whatever the page
 * held, checked by nobody since the draft was made, and the audit row read
 * exactly like the form's. So the save moved here:
 *
 *   1. Which record it is, and a table row's values, are read from the
 *      conversation, never from the request.
 *   2. Everything a turn checks is checked again (`readyToSave`): the
 *      person's role, the part of the map it belongs to, the record's own
 *      schema with every name found in the books.
 *   3. The result is parsed with the schema the record's endpoint validates
 *      with, as its `ZodBody` would, and handed to the very service method
 *      that endpoint calls, as the person who pressed the button.
 *   4. That service writes its own audit row, which says who saved it — and,
 *      because it runs `throughTheAssistant`, that it came through the
 *      Assistant. Every ledger row it writes, of every kind, has the origin
 *      "Added by the assistant" (`ORIGIN`, A4b).
 *   5. The conversation keeps what was saved, so the same draft cannot be
 *      saved twice, and a table reopened later shows which rows are in.
 *
 * Only creating is offered. Deleting, voiding, payroll, settings and
 * anybody's sign-in have no draft, so nothing here can reach them; the map
 * points to their screens instead.
 */

/** A malformed id is a 400, as the endpoints' own `:id` is. */
const planId = z.string().uuid("Say which plan this renewal is for.");

/**
 * The origin every ledger row saved here carries: "Added by the assistant"
 * (A4b). A payment's draft states it in its body; a transfer, a plan's
 * payment and a challan's payment are written by their own services, which
 * are told it here. Before A5 enters months of the boss's files, everything
 * the Assistant put in the books has to be findable by this, so a wrong batch
 * can be found and reversed as one.
 */
const ORIGIN = { createdVia: "ai_intake" } as const;

/** The figure, as a person reads it — or as it was written, if it will not parse. */
function money(value: unknown, currency: "BDT" | "USD" = "BDT"): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    return formatMoney(value, { currency });
  } catch {
    return value;
  }
}

/**
 * "Money going out" as the middle of a sentence: "money going out". Only the
 * first letter, and not an acronym's: "AI tools" stays as it is.
 */
function lower(label: string): string {
  return /^[A-Z](?![A-Z])/.test(label)
    ? label.charAt(0).toLowerCase() + label.slice(1)
    : label;
}

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * Why a save was refused, in its own words: a validation refusal's first
 * field message rather than "Validation failed".
 */
function reasonOf(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === "object") {
      const { message, errors } = response as {
        message?: unknown;
        errors?: Record<string, string[]>;
      };
      const detail = errors ? Object.values(errors).flat()[0] : undefined;
      if (detail) return detail;
      if (typeof message === "string" && message) return message;
    }
  }
  return error instanceof Error && error.message
    ? error.message
    : "it was refused";
}

/**
 * What was saved, and where it now shows, in one sentence for the chat.
 *
 * Read from the draft as the card showed it — names as the books spell them —
 * so the person can match the sentence against what they confirmed.
 */
export function savedLine(
  target: AiTarget,
  draft: Record<string, unknown>,
  refNo: string | null,
  warning: string | null = null,
): string {
  const what = ((): string => {
    switch (target) {
      case "transaction_out":
        return [
          `${money(draft.amount)} from ${text(draft.accountName)}`,
          text(draft.categoryName) && `under ${text(draft.categoryName)}`,
        ]
          .filter(Boolean)
          .join(", ");
      case "transaction_in":
        return `${money(draft.amount)} into ${text(draft.accountName)}`;
      case "transfer":
        return `${money(draft.amount)} from ${text(draft.fromAccountName)} to ${text(draft.toAccountName)}`;
      case "subscription":
        return [
          `${text(draft.toolName)}, ${text(draft.planName)}`,
          money(draft.costUsd, "USD"),
          refNo && `its first payment ${refNo}`,
        ]
          .filter(Boolean)
          .join(", ");
      case "subscription_payment":
        return [text(draft.subscriptionName), money(draft.usdAmount, "USD")]
          .filter(Boolean)
          .join(", ");
      case "vendor":
        return text(draft.name);
      case "team_member":
        return text(draft.fullName);
      case "tds_deposit":
        return `challan ${text(draft.challanNumber)}, ${money(draft.amount)}`;
    }
  })();

  // A plan's own number is its first payment's, said with the payment.
  const number = refNo && target !== "subscription" ? `, ${refNo}` : "";
  const shows = AI_TARGET_SHOWS_ON[target];
  const where =
    target === "tds_deposit"
      ? "Its payment shows under All transactions; the TDS screen lists no challans."
      : shows
        ? `It shows under ${shows.name}.`
        : "No screen lists vendors today.";

  return [
    `Saved — ${lower(AI_TARGET_LABELS[target])}${number}${what ? `: ${what}` : ""}.`,
    where,
    warning,
  ]
    .filter(Boolean)
    .join(" ");
}

@Injectable()
export class AiConfirmService {
  private readonly log = new Logger(AiConfirmService.name);

  /**
   * The drafts being saved right now, by conversation and row.
   *
   * A second press while the first is still saving must not be a second
   * record. The conversation's own mark (`saved`) answers a press that
   * comes after; this answers one that comes during. The API runs as one
   * process, so the set is the whole of it.
   */
  private readonly saving = new Set<string>();

  constructor(
    private readonly chats: AiChatsService,
    private readonly intake: AiIntakeService,
    private readonly transactions: TransactionsService,
    private readonly subscriptions: SubscriptionsService,
    private readonly vendors: VendorsService,
    private readonly team: TeamMembersService,
    private readonly tds: TdsService,
  ) {}

  async confirm(
    input: AiConfirmInput,
    actor: AuthenticatedUser,
  ): Promise<AiConfirmResult> {
    const key = `${input.chatId}:${input.row ?? "card"}`;
    if (this.saving.has(key)) {
      throw new ConflictException(
        "This one is being saved already. Wait for it to finish.",
      );
    }
    this.saving.add(key);
    try {
      return await this.confirmOnce(input, actor);
    } finally {
      this.saving.delete(key);
    }
  }

  private async confirmOnce(
    input: AiConfirmInput,
    actor: AuthenticatedUser,
  ): Promise<AiConfirmResult> {
    // Their own conversation, or a 404 — as every read of one is.
    const chat = await this.chats.get(input.chatId, actor);
    const reply = chat.reply;

    let target: AiTarget;
    let values: Record<string, unknown>;
    if (input.row !== undefined) {
      const batch = reply?.batch;
      const row = batch?.rows[input.row];
      if (!batch || !row) {
        throw new BadRequestException(
          "That row is not on this conversation's table any more.",
        );
      }
      const already = batch.saved?.[String(input.row)];
      if (already) {
        throw new ConflictException(
          `Row ${input.row + 1} is saved already${already.refNo ? ` — ${already.refNo}` : ""}.`,
        );
      }
      target = batch.target;
      values = row;
    } else {
      if (!reply?.target) {
        throw new BadRequestException(
          "Nothing on this conversation is waiting to be saved.",
        );
      }
      if (reply.saved) {
        throw new ConflictException(
          `This draft is saved already${reply.saved.refNo ? ` — ${reply.saved.refNo}` : ""}.`,
        );
      }
      target = reply.target;
      values = input.draft ?? {};
    }

    const { body, draft } = await this.intake.readyToSave(
      target,
      values,
      reply?.area ?? null,
      actor,
    );

    const created = await throughTheAssistant(() =>
      this.save(target, body, actor),
    );

    const saved: AiSaved = {
      id: created.id,
      refNo: created.refNo,
      at: new Date().toISOString(),
    };
    const said = savedLine(target, draft, created.refNo, created.warning);

    /*
     * Kept after the save and never in its way: the record is in the books
     * by now, and a conversation that could not be marked must not report it
     * as lost. A row's sentence is the table's, said once when it is done.
     */
    await this.chats
      .markSaved(
        input.chatId,
        actor,
        saved,
        input.row !== undefined ? { row: input.row } : { said },
      )
      .catch((error: unknown) => {
        this.log.warn(
          `Saved ${created.refNo ?? created.id}, but the conversation could not be marked: ${String(error)}`,
        );
      });

    // What they changed on the card before confirming is the lesson (A2b).
    if (input.row === undefined) {
      await this.intake
        .learn(input.chatId, target, values, actor)
        .catch(() => undefined);
    }

    return {
      ...saved,
      target,
      said,
      showsOn: AI_TARGET_SHOWS_ON[target],
      warning: created.warning,
    };
  }

  /**
   * The record's own endpoint, without the HTTP: its body schema, then the
   * service method its controller calls. `AI_TARGET_ENDPOINT` names the
   * route each one mirrors; ai-confirm.spec.ts holds the two together.
   */
  private async save(
    target: AiTarget,
    body: Record<string, unknown>,
    actor: AuthenticatedUser,
  ): Promise<{ id: string; refNo: string | null; warning: string | null }> {
    const parse = <T>(schema: z.ZodType<T>, value: unknown): T =>
      new ZodValidationPipe(schema).transform(value);
    const done = (row: { id: string; refNo?: string | null }) => ({
      id: row.id,
      refNo: row.refNo ?? null,
      warning: null,
    });

    switch (target) {
      case "transaction_out":
      case "transaction_in":
        // The draft's body says so already; said here too, so that no
        // other path to this save can leave it out.
        return done(
          await this.transactions.create(
            parse(createTransactionSchema, { ...body, ...ORIGIN }),
            actor,
          ),
        );

      case "transfer":
        return done(
          await this.transactions.transfer(
            parse(transferSchema, body),
            actor,
            ORIGIN,
          ),
        );

      case "subscription_payment": {
        // The plan is the address, as `/subscriptions/:id/pay` has it.
        const { subscriptionId, ...payment } = body;
        return done(
          await this.transactions.payForSubscription(
            planId.parse(subscriptionId),
            parse(paySubscriptionSchema, payment),
            actor,
            ORIGIN,
          ),
        );
      }

      case "subscription": {
        const plan = await this.subscriptions.create(
          parse(createSubscriptionSchema, body),
          actor,
        );
        /*
         * Its first payment, as the Add subscription form takes it: the same
         * second request, with the same note. The plan is saved by now; a
         * payment refused (a locked month, an account that does not hold it)
         * is said with the form's own way round it, and the plan is not
         * reported as lost.
         */
        try {
          const paid = await this.transactions.payForSubscription(
            plan.id,
            parse(paySubscriptionSchema, {
              txnDate: plan.startDate,
              note: AI_FIRST_PAYMENT_NOTE,
              // The renewal date is already the first one after today.
              advanceRenewal: false,
            }),
            actor,
            ORIGIN,
          );
          return { id: plan.id, refNo: paid.refNo ?? null, warning: null };
        } catch (error) {
          const reason = reasonOf(error).replace(/\.?$/, ".");
          return {
            id: plan.id,
            refNo: null,
            warning: `The plan is saved, but its first payment did not go through: ${reason} Use Renew on its row to take the money out.`,
          };
        }
      }

      case "vendor":
        return done(
          await this.vendors.create(parse(createVendorSchema, body), actor),
        );

      case "team_member":
        return done(
          await this.team.create(parse(createTeamMemberSchema, body), actor),
        );

      case "tds_deposit": {
        const deposit = await this.tds.createDeposit(
          parse(createTdsDepositSchema, body),
          actor,
          ORIGIN,
        );
        // Its number in the books is its payment's, the ledger row.
        const payment = deposit.transactionId
          ? await this.transactions.findOne(deposit.transactionId)
          : null;
        return { id: deposit.id, refNo: payment?.refNo ?? null, warning: null };
      }
    }
  }
}
