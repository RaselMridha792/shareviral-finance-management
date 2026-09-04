import { Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  createTransactionSchema,
  expenseOverviewQuerySchema,
  expenseSummaryQuerySchema,
  listTransactionsQuerySchema,
  recordCashInSchema,
  registerQuerySchema,
  transactionFilterSchema,
  transferSchema,
  updateTransactionSchema,
  voidTransactionSchema,
  type CreateTransactionInput,
  type ExpenseOverviewQuery,
  type ExpenseSummaryQuery,
  type ListTransactionsQuery,
  type RecordCashInInput,
  type RegisterQuery,
  type TransactionFilter,
  type TransferInput,
  type UpdateTransactionInput,
  type VoidTransactionInput,
  paginationQuerySchema,
  type PaginationQuery,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { TransactionsService } from "./transactions.service";

const uuidSchema = z.string().uuid("Not a valid id");

/*
 * Declared here rather than in packages/shared: one screen reads it, and that
 * package is consumed as built dist/ by twenty others.
 */
const paySubscriptionSchema = z.object({
  txnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it was charged"),
  /** Blank means the plan's own price. */
  amount: z.string().trim().optional(),
  /** Blank means the card on the plan. */
  accountId: z.string().uuid().optional(),
  /*
   * Required, because the ledger requires it.
   *
   * `createTransactionSchema` will not write an expense without a category and
   * is right not to: an uncategorised entry does not appear on any Expenses
   * screen, which is the very complaint this feature exists to answer. A
   * subscription's own category — `ai_tool`, `hosting` — is the register's
   * vocabulary rather than the company's expense headings, so there is nothing
   * to derive it from and it is asked for.
   */
  /*
   * Optional now, and worked out when it is absent.
   *
   * It was required because the ledger refuses an uncategorised expense, and
   * that is still true — but the answer was always the same one, so asking put
   * a picker on two drawers for a question nobody had to think about.
   * `subscriptionCategoryId()` resolves it, and refuses loudly if the company
   * has no such heading rather than filing the charge nowhere.
   */
  categoryId: z.string().uuid().optional(),
  note: z.string().trim().max(200).nullish(),
  /** Roll the renewal on a cycle. Off for a payment being recorded late. */
  advanceRenewal: z.boolean().optional(),
  /**
   * The rate this payment is read back at.
   *
   * Every entry carries one now — *"puro application a joto dhoroner
   * transaction a hok na keno manually prottekbar rate bosate hobe"*. Optional
   * HERE and only here, because a plan already states the rate its price was
   * struck at and the dialog offers that as the figure: absent, the plan's own
   * rate is used, and the row still ends up carrying one.
   */
  usdRate: z
    .string()
    .trim()
    .regex(/^\d{1,5}(\.\d{1,6})?$/, "Enter a rate like 122.77")
    .optional(),
});
type PaySubscriptionInput = z.infer<typeof paySubscriptionSchema>;

@Controller()
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get("transactions")
  @RequirePermission("transactions.read")
  list(@ZodQuery(listTransactionsQuerySchema) query: ListTransactionsQuery) {
    return this.transactions.list(query);
  }

  /**
   * The transfers, one row per pair. Declared above "transactions/:id" —
   * routes match in order, and the word "transfers" must not be read as an
   * id.
   */
  @Get("transactions/transfers")
  @RequirePermission("transactions.read")
  listTransfers(@ZodQuery(paginationQuerySchema) query: PaginationQuery) {
    return this.transactions.listTransfers(query);
  }

  /** The in / out / net figures shown above the table. */
  @Get("transactions/summary")
  @RequirePermission("transactions.read")
  summary(@ZodQuery(transactionFilterSchema) filter: TransactionFilter) {
    return this.transactions.summary(filter);
  }

  /**
   * The overview's four slices, plus the month before, plus the tax held.
   *
   * Declared ABOVE `expenses/summary` only for readability — neither is a
   * `:param` route, so order does not decide this one. It would if somebody
   * added `expenses/:slug` beneath them, which is exactly how a literal route
   * has gone missing on this codebase before.
   */
  @Get("expenses/overview")
  @RequirePermission("transactions.read")
  expenseOverview(
    @ZodQuery(expenseOverviewQuerySchema) query: ExpenseOverviewQuery,
  ) {
    /* The month before, worked out here rather than asked for: a caller that
       can name its own comparison month can name the wrong one. */
    const start = new Date(`${query.from}T00:00:00Z`);
    const prevEnd = new Date(start);
    prevEnd.setUTCDate(0);
    const prevStart = new Date(
      Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), 1),
    );
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    return this.transactions.expenseOverview({
      from: query.from,
      to: query.to,
      previousFrom: iso(prevStart),
      previousTo: iso(prevEnd),
      previousLabel: prevStart.toLocaleString("en-GB", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    });
  }

  /** Spend per heading, or per sub-category when `categorySlug` is given. */
  @Get("expenses/summary")
  @RequirePermission("transactions.read")
  expenseSummary(
    @ZodQuery(expenseSummaryQuerySchema) query: ExpenseSummaryQuery,
  ) {
    return this.transactions.expenseSummary(query);
  }

  /** Date-ordered rows for one account with a running balance. */
  @Get("accounts/:id/register")
  @RequirePermission("accounts.read")
  register(
    @Param("id") id: string,
    @ZodQuery(registerQuerySchema) query: RegisterQuery,
  ) {
    return this.transactions.register(uuidSchema.parse(id), query);
  }

  @Get("transactions/:id")
  @RequirePermission("transactions.read")
  findOne(@Param("id") id: string) {
    return this.transactions.findOne(uuidSchema.parse(id));
  }

  @Post("transactions")
  @RequirePermission("transactions.write")
  create(
    @ZodBody(createTransactionSchema) body: CreateTransactionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.transactions.create(body, actor);
  }

  /**
   * Money in from abroad, off a remittance advice.
   *
   * Its own route only so the advice's shape can be asked for exactly — the
   * sender's bank, and the day's dollar rate as a requirement rather than a
   * hope. It creates an ordinary money-in row through the same service call as
   * `POST /transactions`, and needs the same permission for the same reason.
   */
  @Post("transactions/cash-in")
  @RequirePermission("transactions.write")
  recordCashIn(
    @ZodBody(recordCashInSchema) body: RecordCashInInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.transactions.recordCashIn(body, actor);
  }

  /**
   * Pay a subscription: a real ledger entry against the plan's card.
   *
   * On this controller rather than the vendors one because that is where the
   * service lives — TransactionsModule already imports VendorsModule, and the
   * other way round is a cycle Nest refuses to start with.
   */
  @Post("subscriptions/:id/pay")
  @RequirePermission("transactions.write")
  paySubscription(
    @Param("id") id: string,
    @ZodBody(paySubscriptionSchema) body: PaySubscriptionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.transactions.payForSubscription(id, body, actor);
  }

  @Post("transactions/transfer")
  @RequirePermission("transactions.write")
  transfer(
    @ZodBody(transferSchema) body: TransferInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.transactions.transfer(body, actor);
  }

  @Patch("transactions/:id")
  @RequirePermission("transactions.write")
  update(
    @Param("id") id: string,
    @ZodBody(updateTransactionSchema) body: UpdateTransactionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.transactions.update(uuidSchema.parse(id), body, actor);
  }

  @Post("transactions/:id/void")
  @HttpCode(200)
  @RequirePermission("transactions.void")
  void(
    @Param("id") id: string,
    @ZodBody(voidTransactionSchema) body: VoidTransactionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.transactions.void(uuidSchema.parse(id), body, actor);
  }
}
