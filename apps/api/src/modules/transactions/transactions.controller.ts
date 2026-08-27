import { Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  createTransactionSchema,
  expenseSummaryQuerySchema,
  listTransactionsQuerySchema,
  recordCashInSchema,
  registerQuerySchema,
  transactionFilterSchema,
  transferSchema,
  updateTransactionSchema,
  voidTransactionSchema,
  type CreateTransactionInput,
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
