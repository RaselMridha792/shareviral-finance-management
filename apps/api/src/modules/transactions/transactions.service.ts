import { createHash } from "node:crypto";

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  formatMoney,
  type CreateTransactionInput,
  type ListTransactionsQuery,
  type Paginated,
  type PaginationQuery,
  type RecordCashInInput,
  type TransactionFilter,
  type TransferInput,
  type UpdateTransactionInput,
  type VoidTransactionInput,
} from "@finance/shared";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import type { DbTransaction } from "../../db";
import { DbService } from "../../db/db.service";
import { accounts, categories, transactions, vendors } from "../../db/schema";
import { SettingsService } from "../settings/settings.service";
import { VendorsService } from "../vendors/vendors.service";
import { isToolSpend } from "../vendors/tool-spend";
import { notATransfer } from "./own-money";
import { overdraftWatch } from "../../common/money/overdraft";
import { nextRefNo } from "./ref-no";

/**
 * The dedupe fingerprint. Computed here rather than by Postgres because a
 * date-to-text cast is not IMMUTABLE and generated columns require that.
 */
export function dedupeKey(input: {
  accountId: string;
  txnDate: string;
  amount: string;
  direction: string;
  description: string;
}): string {
  return createHash("md5")
    .update(
      [
        input.accountId,
        input.txnDate,
        Number(input.amount).toFixed(2),
        input.direction,
        input.description.trim().toLowerCase(),
      ].join("|"),
    )
    .digest("hex");
}

export type TransactionDto = {
  id: string;
  refNo: string;
  txnDate: string;
  direction: "in" | "out";
  amount: string;
  signedAmount: string;
  currency: string;
  description: string;
  notes: string | null;
  paymentMethod: string;
  reference: string | null;
  invoiceNo: string | null;
  /**
   * How many documents are attached. Zero is the interesting value.
   *
   * The Cash In and expense screens insist on an invoice and a statement, but a
   * file needs a row to attach to, so the entry is saved a moment before its
   * documents are. Somebody who closes the drawer in that moment leaves a
   * recorded entry with nothing attached, and without this the gap is
   * invisible — the form's insistence would be theatre.
   */
  documentCount: number;
  receiptUrl: string | null;
  billAmount: string | null;
  withheldTaxAmount: string;
  originalAmount: string | null;
  originalCurrency: string | null;
  fxRate: string | null;
  /** What a dollar was worth on the day, for reading the figure in USD. */
  usdRate: string | null;
  createdVia: string;
  transferGroupId: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  accountId: string;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  vendorId: string | null;
  vendorName: string | null;
  counterparty: string | null;
  /** The sending side of an incoming wire. Null on everything that isn't one. */
  senderBankName: string | null;
  senderAccountName: string | null;
  senderAccountNumber: string | null;
  senderSwiftCode: string | null;
  createdAt: Date;
};

/** One transfer, read as the single event it is. */
export type TransferRow = {
  outId: string;
  inId: string;
  groupId: string | null;
  refNo: string;
  invoiceNo: string | null;
  usdAmount: string | null;
  usdRate: string | null;
  documentCount: number;
  txnDate: string;
  amount: string;
  description: string;
  reference: string | null;
  paymentMethod: string | null;
  voidedAt: Date | null;
  fromAccountId: string;
  fromAccountName: string;
  toAccountId: string;
  toAccountName: string;
  createdAt: Date;
};

@Injectable()
export class TransactionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly vendorsService: VendorsService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /*  Reading                                                               */
  /* ---------------------------------------------------------------------- */

  private async buildFilters(filter: TransactionFilter): Promise<SQL[]> {
    const clauses: SQL[] = [];

    /*
     * Deleted rows never come back, whatever is asked for.
     *
     * `includeVoided` is a real choice — a voided entry stays on the ledger
     * struck through, and somebody reconciling wants to see it. A deleted one
     * is different: it is in the trash, waiting to be restored or purged, and
     * showing it here would put a row on the screen that no total counts and no
     * action on this page can reach. So this clause is unconditional where the
     * one below it is not.
     */
    clauses.push(isNull(transactions.deletedAt));
    if (!filter.includeVoided) clauses.push(isNull(transactions.voidedAt));
    // The same predicate the AI tools screen counts *with*, negated — so
    // "other expenses" is exactly the complement of "tooling" rather than an
    // approximation of it.
    if (filter.excludeToolSpend) clauses.push(not(isToolSpend()));
    // Money moved between our own accounts is not money spent — see
    // `own-money.ts` for where this must and must not be applied.
    if (filter.excludeTransfers) clauses.push(notATransfer());
    if (filter.from) clauses.push(gte(transactions.txnDate, filter.from));
    if (filter.to) clauses.push(lte(transactions.txnDate, filter.to));
    if (filter.accountId)
      clauses.push(eq(transactions.accountId, filter.accountId));
    if (filter.direction)
      clauses.push(eq(transactions.direction, filter.direction));
    if (filter.vendorId)
      clauses.push(eq(transactions.vendorId, filter.vendorId));
    if (filter.paymentMethod)
      clauses.push(eq(transactions.paymentMethod, filter.paymentMethod));
    if (filter.createdVia)
      clauses.push(eq(transactions.createdVia, filter.createdVia));
    if (filter.minAmount)
      clauses.push(gte(transactions.amount, filter.minAmount));
    if (filter.maxAmount)
      clauses.push(lte(transactions.amount, filter.maxAmount));
    if (filter.hasReceipt !== undefined) {
      clauses.push(
        filter.hasReceipt
          ? isNotNull(transactions.receiptUrl)
          : isNull(transactions.receiptUrl),
      );
    }
    if (filter.categoryId)
      clauses.push(eq(transactions.categoryId, filter.categoryId));

    // A heading's slug includes everything filed under its sub-categories —
    // otherwise "Office & premises" would show nothing, since payments are
    // filed against the leaves.
    if (filter.subCategorySlug) {
      const ids = await this.categoryIdsForSlug(
        filter.subCategorySlug,
        filter.categorySlug,
      );
      clauses.push(
        ids.length ? inArray(transactions.categoryId, ids) : sql`false`,
      );
    } else if (filter.categorySlug) {
      const ids = await this.categoryIdsForSlug(filter.categorySlug, undefined);
      clauses.push(
        ids.length ? inArray(transactions.categoryId, ids) : sql`false`,
      );
    }

    if (filter.q) {
      const term = `%${filter.q}%`;
      const match = or(
        ilike(transactions.description, term),
        ilike(transactions.reference, term),
        ilike(transactions.counterparty, term),
        ilike(transactions.refNo, term),
        ilike(transactions.notes, term),
      );
      if (match) clauses.push(match);
    }

    return clauses;
  }

  /** A heading's id plus its children's, or a single sub-category's id. */
  private async categoryIdsForSlug(
    slug: string,
    parentSlug: string | undefined,
  ): Promise<string[]> {
    if (parentSlug) {
      const [parent] = await this.db.client
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.slug, parentSlug),
            isNull(categories.parentId),
            isNull(categories.deletedAt),
          ),
        )
        .limit(1);
      if (!parent) return [];

      const [child] = await this.db.client
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.slug, slug),
            eq(categories.parentId, parent.id),
            isNull(categories.deletedAt),
          ),
        )
        .limit(1);
      return child ? [child.id] : [];
    }

    const [heading] = await this.db.client
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.slug, slug),
          isNull(categories.parentId),
          isNull(categories.deletedAt),
        ),
      )
      .limit(1);
    if (!heading) return [];

    const children = await this.db.client
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.parentId, heading.id), isNull(categories.deletedAt)),
      );

    return [heading.id, ...children.map((c) => c.id)];
  }

  async list(query: ListTransactionsQuery): Promise<Paginated<TransactionDto>> {
    const clauses = await this.buildFilters(query);
    const where = clauses.length ? and(...clauses) : undefined;

    const column = {
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      description: transactions.description,
      createdAt: transactions.createdAt,
    }[query.sort];

    const direction = query.order === "asc" ? asc : desc;
    const offset = (query.page - 1) * query.pageSize;

    const [items, [{ total }]] = await Promise.all([
      this.db.client
        .select(projection)
        .from(transactions)
        .leftJoin(accounts, eq(transactions.accountId, accounts.id))
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
        .where(where)
        // id breaks ties so pagination is stable across pages.
        .orderBy(direction(column), desc(transactions.id))
        .limit(query.pageSize)
        .offset(offset),
      // The same joins as the page above: `excludeToolSpend` reads
      // `accounts.currency` and `vendors.type`, and a count that does not join
      // them would fail on that filter — and, worse, silently disagree with
      // the rows beside it if it ever stopped.
      this.db.client
        .select({ total: count() })
        .from(transactions)
        .leftJoin(accounts, eq(transactions.accountId, accounts.id))
        .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
        .where(where),
    ]);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  /** The three figures above the table: in, out, and net for this filter. */
  async summary(filter: TransactionFilter) {
    const clauses = await this.buildFilters(filter);
    const where = clauses.length ? and(...clauses) : undefined;

    const [row] = await this.db.client
      .select({
        moneyIn: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.direction} = 'in'), 0)::text`,
        moneyOut: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.direction} = 'out'), 0)::text`,
        net: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
        entries: count(),
      })
      .from(transactions)
      .where(where);

    return { ...row, entries: Number(row.entries) };
  }

  /**
   * One account's rows in date order with a running balance.
   *
   * The balance starts at the account's opening balance and accumulates
   * `signed_amount` — a single window function rather than a loop, so a page of
   * 500 rows costs one query.
   */
  async register(
    accountId: string,
    range: { from?: string; to?: string; includeVoided?: boolean },
  ) {
    const [account] = await this.db.client
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        bankName: accounts.bankName,
        accountNumber: accounts.accountNumber,
        currency: accounts.currency,
        openingBalance: accounts.openingBalance,
        openingBalanceOn: accounts.openingBalanceOn,
      })
      .from(accounts)
      .where(eq(accounts.id, accountId))
      .limit(1);

    if (!account) throw new NotFoundException("No such account");

    /**
     * Everything dated before the window is folded into the opening figure.
     *
     * Only when there IS a window: with no `from` the condition would drop out
     * of the `and()` and this would sum every row in the account — which then
     * gets added a second time as the period's own movement, doubling the
     * closing balance.
     */
    let carriedForward = "0";
    if (range.from) {
      const [carried] = await this.db.client
        .select({
          total: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.accountId, accountId),
            isNull(transactions.voidedAt),
            sql`${transactions.txnDate} < ${range.from}`,
          ),
        );
      carriedForward = carried.total;
    }

    const openingBalance = (
      Number(account.openingBalance) + Number(carriedForward)
    ).toFixed(2);

    const clauses: SQL[] = [
      eq(transactions.accountId, accountId),
      // Unconditional, for the reason given in `buildFilters`: the register can
      // be asked to show voided rows, and must never show deleted ones.
      isNull(transactions.deletedAt),
    ];
    // A voided row stays visible and struck through, but it is not money.
    if (!range.includeVoided) clauses.push(isNull(transactions.voidedAt));
    if (range.from) clauses.push(gte(transactions.txnDate, range.from));
    if (range.to) clauses.push(lte(transactions.txnDate, range.to));

    const rows = await this.db.client
      .select({
        ...projection,
        /**
         * The running balance skips voided rows even when they are shown.
         *
         * This summed `signed_amount` outright, which was safe only because
         * voided rows were filtered out of the query entirely — and that is
         * why the register showed nothing at all after a void, contradicting
         * the rule the rest of the app follows. Now that they can appear, the
         * window has to ignore them explicitly: a voided row must leave the
         * balance exactly where the row above it left it.
         */
        runningBalance: sql<string>`(${openingBalance}::numeric + sum(case when ${transactions.voidedAt} is null then ${transactions.signedAmount} else 0 end) over (order by ${transactions.txnDate}, ${transactions.createdAt}, ${transactions.id}))::text`,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
      .where(and(...clauses))
      .orderBy(
        asc(transactions.txnDate),
        asc(transactions.createdAt),
        asc(transactions.id),
      );

    // Voided rows are listed but never counted — the same rule the running
    // balance above follows.
    const live = rows.filter((r) => !r.voidedAt);
    const totalIn = live
      .filter((r) => r.direction === "in")
      .reduce((sum, r) => sum + Number(r.amount), 0);
    const totalOut = live
      .filter((r) => r.direction === "out")
      .reduce((sum, r) => sum + Number(r.amount), 0);

    return {
      account,
      openingBalance,
      totalIn: totalIn.toFixed(2),
      totalOut: totalOut.toFixed(2),
      closingBalance: (Number(openingBalance) + totalIn - totalOut).toFixed(2),
      rows,
    };
  }

  /** Spend per heading, or per sub-category when a heading is named. */
  async expenseSummary(query: {
    from?: string;
    to?: string;
    categorySlug?: string;
  }) {
    const clauses: SQL[] = [
      isNull(transactions.voidedAt),
      eq(transactions.direction, "out"),
    ];
    if (query.from) clauses.push(gte(transactions.txnDate, query.from));
    if (query.to) clauses.push(lte(transactions.txnDate, query.to));

    if (query.categorySlug) {
      const ids = await this.categoryIdsForSlug(query.categorySlug, undefined);
      if (!ids.length) return { groups: [], total: "0.00" };
      clauses.push(inArray(transactions.categoryId, ids));

      const rows = await this.db.client
        .select({
          id: categories.id,
          name: categories.name,
          slug: categories.slug,
          color: categories.color,
          total: sql<string>`sum(${transactions.amount})::text`,
          entries: count(),
        })
        .from(transactions)
        .innerJoin(categories, eq(transactions.categoryId, categories.id))
        .where(and(...clauses))
        .groupBy(
          categories.id,
          categories.name,
          categories.slug,
          categories.color,
        )
        .orderBy(desc(sql`sum(${transactions.amount})`));

      return {
        groups: rows.map((r) => ({ ...r, entries: Number(r.entries) })),
        total: rows.reduce((sum, r) => sum + Number(r.total), 0).toFixed(2),
      };
    }

    // Roll every sub-category up into its heading.
    const parent = sql`coalesce(${categories.parentId}, ${categories.id})`;
    const rows = await this.db.client
      .select({
        id: sql<string>`${parent}::text`,
        total: sql<string>`sum(${transactions.amount})::text`,
        entries: count(),
      })
      .from(transactions)
      .innerJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(...clauses))
      .groupBy(parent);

    if (!rows.length) return { groups: [], total: "0.00" };

    const headings = await this.db.client
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        color: categories.color,
      })
      .from(categories)
      .where(
        inArray(
          categories.id,
          rows.map((r) => r.id),
        ),
      );

    const byId = new Map(headings.map((h) => [h.id, h]));

    const groups = rows
      .map((r) => ({
        ...(byId.get(r.id) ?? {
          id: r.id,
          name: "Uncategorised",
          slug: "",
          color: "#5b6472",
        }),
        total: r.total,
        entries: Number(r.entries),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total));

    return {
      groups,
      total: groups.reduce((sum, g) => sum + Number(g.total), 0).toFixed(2),
    };
  }

  async findOne(id: string): Promise<TransactionDto> {
    const [row] = await this.db.client
      .select(projection)
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
      .where(eq(transactions.id, id))
      .limit(1);

    if (!row) throw new NotFoundException("No such transaction");
    return row;
  }

  /* ---------------------------------------------------------------------- */
  /*  Writing                                                               */
  /* ---------------------------------------------------------------------- */

  /** TXN-2026-000412. See ref-no.ts for why this is not count(*) + 1. */
  private nextRefNo(tx: DbTransaction, year: number): Promise<string> {
    return nextRefNo(tx, year);
  }

  async create(
    /*
     * `categoryId` optional here and required in the public schema, on
     * purpose: POST /transactions still refuses an uncategorised entry, but
     * the cash-in door hands over no category at all — a wire arriving is
     * not an expense heading's business. This signature is the one internal
     * seam where that difference lives.
     */
    input: Omit<CreateTransactionInput, "categoryId"> & {
      categoryId?: string;
    },
    actor: AuthenticatedUser,
  ) {
    await this.settings.assertPeriodOpen(input.txnDate);
    await this.assertAccountExists(input.accountId);
    if (input.categoryId) {
      await this.assertCategoryMatchesDirection(
        input.categoryId,
        input.direction,
      );
    }

    const year = Number(input.txnDate.slice(0, 4));
    // The rule of the house: an account can never go below zero. Checked
    // after the insert, inside the same transaction, so a refusal undoes it.
    const watch = await overdraftWatch(this.db.client, [input.accountId]);

    return this.audit
      .mutate({
        action: "create",
        entityTable: "transactions",
        summary: `${input.direction === "in" ? "Received" : "Paid"} ${formatMoney(
          input.amount,
        )} — ${input.description}`,
        module: "transactions",
        read: () => Promise.resolve(undefined),
        run: async (tx) => {
          // By id, and only by id. Creating a vendor from free text as a
          // side effect of writing a transaction wrote master data with no
          // audit row and under the wrong permission.
          const vendorId = input.vendorId ?? null;

          const [created] = await tx
            .insert(transactions)
            .values({
              refNo: await this.nextRefNo(tx, year),
              accountId: input.accountId,
              direction: input.direction,
              txnDate: input.txnDate,
              amount: input.amount,
              categoryId: input.categoryId,
              vendorId,
              counterparty: input.counterparty,
              paymentMethod: input.paymentMethod,
              reference: input.reference,
              invoiceNo: input.invoiceNo,
              description: input.description,
              notes: input.notes,
              receiptUrl: input.receiptUrl,
              billAmount: input.billAmount,
              withheldTaxAmount: input.withheldTaxAmount ?? "0",
              originalAmount: input.originalAmount,
              originalCurrency: input.originalCurrency,
              fxRate: input.fxRate,
              fxRateSource: input.fxRate ? "manual" : null,
              usdRate: input.usdRate,
              senderBankName: input.senderBankName,
              senderAccountName: input.senderAccountName,
              senderAccountNumber: input.senderAccountNumber,
              senderSwiftCode: input.senderSwiftCode,
              // Typed by hand unless the caller said otherwise, and the schema
              // only lets it say "ai_intake" — a row cannot claim to have come
              // from payroll or a tax payment.
              createdVia: input.createdVia ?? "manual",
              dedupeHash: dedupeKey({
                accountId: input.accountId,
                txnDate: input.txnDate,
                amount: input.amount,
                direction: input.direction,
                description: input.description,
              }),
              createdBy: actor.id,
              updatedBy: actor.id,
            })
            .returning({ id: transactions.id, refNo: transactions.refNo });

          await watch.assert(tx);
          return created;
        },
      })
      .then((created) => this.findOne(created.id));
  }

  /**
   * Money arriving from abroad, recorded off the remittance advice.
   *
   * This is a form, not a second way into the ledger: it fills in the parts an
   * advice already decides — the direction is "in", the sender's details come
   * off the paper — and hands the result to `create` above. Same validation,
   * same ref number, same audit row, same place in the register. A cash-in that
   * wrote its own row would be the first entry in this system that a reconciler
   * could not treat like every other.
   */
  recordCashIn(input: RecordCashInInput, actor: AuthenticatedUser) {
    return this.create(
      {
        direction: "in",
        txnDate: input.txnDate,
        accountId: input.accountId,
        amount: input.amount,
        paymentMethod: input.paymentMethod,
        reference: input.reference,
        invoiceNo: input.invoiceNo,
        description: input.description,
        notes: input.notes,
        receiptUrl: input.receiptUrl,
        // The rate that governs the month. It goes in `usdRate` — the reference
        // rate a taka figure is read back in — and not in `fxRate`, which means
        // "the bank actually converted at this". Only a recorded conversion,
        // with the foreign amount beside it, may claim that one.
        usdRate: input.usdRate,
        // Which is exactly what "USD sent" supplies. With the dollars on the
        // form the conversion is a recorded fact rather than a reference, so
        // the three real conversion columns are filled: what was sent, in what
        // currency, at what rate. Without it they stay null and the row behaves
        // as it always has.
        //
        // `fxRate` takes the same figure as `usdRate` here, and that is not a
        // duplicate: one says "a dollar was worth this in August", the other
        // says "this transfer converted at it". They are only equal because the
        // person filling in the advice knows one number. Both go in because the
        // create schema requires a rate beside any foreign amount.
        ...(input.usdSent
          ? {
              originalAmount: input.usdSent,
              originalCurrency: "USD",
              fxRate: input.usdRate,
            }
          : {}),
        senderBankName: input.senderBankName,
        senderAccountName: input.senderAccountName,
        senderAccountNumber: input.senderAccountNumber,
        senderSwiftCode: input.senderSwiftCode,
        createdVia: "manual",
      },
      actor,
    );
  }

  async update(
    id: string,
    input: UpdateTransactionInput,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.findOne(id);

    if (existing.voidedAt) {
      throw new BadRequestException(
        "This entry was voided. Void entries cannot be edited — add a new one instead.",
      );
    }

    // Both the date it currently sits on and the date it would move to.
    await this.settings.assertPeriodOpen(existing.txnDate);
    if (input.txnDate) await this.settings.assertPeriodOpen(input.txnDate);

    if (input.categoryId) {
      await this.assertCategoryMatchesDirection(
        input.categoryId,
        existing.direction,
      );
    }

    // An amount or date change can overdraw the account just as a new entry
    // can; same rule, same rollback.
    const watch = await overdraftWatch(this.db.client, [existing.accountId]);

    await this.audit.mutate({
      action: "update",
      entityTable: "transactions",
      entityId: id,
      summary: describeUpdate(existing, input),
      module: "transactions",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        const vendorId = input.vendorId;

        const nextDate = input.txnDate ?? existing.txnDate;
        const nextAmount = input.amount ?? existing.amount;
        const nextDescription = input.description ?? existing.description;

        await tx
          .update(transactions)
          .set({
            ...(input.txnDate ? { txnDate: input.txnDate } : {}),
            ...(input.amount ? { amount: input.amount } : {}),
            ...(input.categoryId ? { categoryId: input.categoryId } : {}),
            ...(vendorId !== undefined ? { vendorId } : {}),
            ...(input.counterparty !== undefined
              ? { counterparty: input.counterparty }
              : {}),
            ...(input.paymentMethod
              ? { paymentMethod: input.paymentMethod }
              : {}),
            ...(input.reference !== undefined
              ? { reference: input.reference }
              : {}),
            ...(input.invoiceNo !== undefined
              ? { invoiceNo: input.invoiceNo }
              : {}),
            ...(input.description ? { description: input.description } : {}),
            // Cash in is recorded and corrected through the same form now, and
            // the sender is one of the fields that form exists to ask for —
            // so it has to be one an edit can reach. Listed explicitly, like
            // every other field here.
            ...(input.senderAccountName !== undefined
              ? { senderAccountName: input.senderAccountName }
              : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.receiptUrl !== undefined
              ? { receiptUrl: input.receiptUrl }
              : {}),
            ...(input.billAmount !== undefined
              ? { billAmount: input.billAmount }
              : {}),
            ...(input.withheldTaxAmount !== undefined
              ? { withheldTaxAmount: input.withheldTaxAmount }
              : {}),
            // Listed explicitly like every other field here. Left out, an edit
            // silently keeps the old rate while the amount and date change
            // around it — which is a wrong dollar figure that nothing flags.
            ...(input.usdRate !== undefined ? { usdRate: input.usdRate } : {}),
            dedupeHash: dedupeKey({
              accountId: existing.accountId,
              txnDate: nextDate,
              amount: nextAmount,
              direction: existing.direction,
              description: nextDescription,
            }),
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(eq(transactions.id, id));
        await watch.assert(tx);
      },
    });

    return this.findOne(id);
  }

  /**
   * Voids an entry. It stays visible, struck through, and out of every total.
   * Deleting would remove the answer to a question someone asks later.
   */
  async void(
    id: string,
    input: VoidTransactionInput,
    actor: AuthenticatedUser,
  ) {
    const existing = await this.findOne(id);

    if (existing.voidedAt) {
      throw new BadRequestException("This entry is already voided");
    }
    await this.settings.assertPeriodOpen(existing.txnDate);

    // A transfer is one movement recorded twice; voiding half would leave the
    // two accounts disagreeing.
    const ids = existing.transferGroupId
      ? (
          await this.db.client
            .select({ id: transactions.id })
            .from(transactions)
            .where(eq(transactions.transferGroupId, existing.transferGroupId))
        ).map((r) => r.id)
      : [id];

    /*
     * Voiding an "in" row removes money the account thought it had, which can
     * leave later spending under water — the same overdraft as typing an
     * expense too large, reached from the other side. A transfer group spans
     * two accounts, so both are watched.
     */
    const accountIds = (
      await this.db.client
        .select({ accountId: transactions.accountId })
        .from(transactions)
        .where(inArray(transactions.id, ids))
    ).map((r) => r.accountId);
    const watch = await overdraftWatch(this.db.client, accountIds);

    await this.audit.mutate({
      action: "void",
      entityTable: "transactions",
      entityId: id,
      summary:
        `Voided ${existing.refNo} (${formatMoney(existing.amount)} — ${existing.description})` +
        (ids.length > 1 ? " and its matching transfer row" : "") +
        `: ${input.reason}`,
      module: "transactions",
      read: async (tx) => {
        const [row] = await tx
          .select()
          .from(transactions)
          .where(eq(transactions.id, id))
          .limit(1);
        return row;
      },
      run: async (tx) => {
        await tx
          .update(transactions)
          .set({
            voidedAt: new Date(),
            voidedBy: actor.id,
            voidReason: input.reason,
            updatedAt: new Date(),
            updatedBy: actor.id,
          })
          .where(inArray(transactions.id, ids));
        await watch.assert(tx);
      },
    });

    return this.findOne(id);
  }

  /**
   * The transfers, one row per pair.
   *
   * A transfer is stored as two transactions sharing a `transferGroupId`, and
   * every screen that reads the ledger sees both halves — which is right for
   * an account's register and wrong for a page about transfers, where "moved
   * ৳50,000 from the bank to petty cash" is one event, not two. The out half
   * anchors the row (it is where the money left), and its twin is joined on
   * for where the money arrived.
   *
   * Voided pairs are listed struck through, the same rule as every ledger
   * screen; deleted ones are in the trash and not here.
   */
  async listTransfers(query: PaginationQuery): Promise<Paginated<TransferRow>> {
    const inRow = alias(transactions, "in_row");
    const fromAccount = alias(accounts, "from_account");
    const toAccount = alias(accounts, "to_account");

    const pairFilter = and(
      isNotNull(transactions.transferGroupId),
      eq(transactions.direction, "out"),
      isNull(transactions.deletedAt),
      isNull(inRow.deletedAt),
    );
    const joinedIn = and(
      eq(inRow.transferGroupId, transactions.transferGroupId),
      eq(inRow.direction, "in"),
    );

    const [items, [{ total }]] = await Promise.all([
      this.db.client
        .select({
          outId: transactions.id,
          inId: inRow.id,
          groupId: transactions.transferGroupId,
          refNo: transactions.refNo,
          invoiceNo: transactions.invoiceNo,
          usdAmount: transactions.originalAmount,
          usdRate: transactions.usdRate,
          txnDate: transactions.txnDate,
          amount: transactions.amount,
          description: transactions.description,
          reference: transactions.reference,
          paymentMethod: transactions.paymentMethod,
          voidedAt: transactions.voidedAt,
          /*
           * Files hang on the out half — the side the dialog anchors to.
           * Written with the table's own name, not an embedded column: the
           * bare-name lesson from the payroll picker, applied before it bites
           * a second time.
           */
          documentCount: sql<number>`(
            select count(*)::int from files df
             where df.transaction_id = transactions.id
               and df.deleted_at is null
          )`,
          fromAccountId: fromAccount.id,
          fromAccountName: fromAccount.name,
          toAccountId: toAccount.id,
          toAccountName: toAccount.name,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .innerJoin(inRow, joinedIn)
        .innerJoin(fromAccount, eq(fromAccount.id, transactions.accountId))
        .innerJoin(toAccount, eq(toAccount.id, inRow.accountId))
        .where(pairFilter)
        .orderBy(
          desc(transactions.txnDate),
          desc(transactions.createdAt),
          desc(transactions.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      // Counted over the same joins and filter — a pair that lost a half to a
      // bug would drop out of both queries together rather than skewing one.
      this.db.client
        .select({ total: count() })
        .from(transactions)
        .innerJoin(inRow, joinedIn)
        .where(pairFilter),
    ]);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  /** Moving money between our own accounts: one out row and one in row. */
  async transfer(input: TransferInput, actor: AuthenticatedUser) {
    await this.settings.assertPeriodOpen(input.txnDate);
    // Both sides, before either row is written.
    await this.assertAccountExists(input.fromAccountId);
    await this.assertAccountExists(input.toAccountId);

    const year = Number(input.txnDate.slice(0, 4));
    const groupId = crypto.randomUUID();
    // Only the paying side can go under; the receiving side only gains.
    const watch = await overdraftWatch(this.db.client, [input.fromAccountId]);

    const created = await this.audit.mutate({
      action: "create",
      entityTable: "transactions",
      summary: `Transferred ${formatMoney(input.amount)} between accounts — ${input.description}`,
      module: "transactions",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const outRef = await this.nextRefNo(tx, year);
        const [outRow] = await tx
          .insert(transactions)
          .values({
            refNo: outRef,
            invoiceNo: input.invoiceNo,
            // When the movement was stated in dollars, both halves record it:
            // what moved, in what currency, at what rate. The taka in
            // `amount` stays what every total counts.
            ...(input.usdAmount && input.usdRate
              ? {
                  originalAmount: input.usdAmount,
                  originalCurrency: "USD",
                  fxRate: input.usdRate,
                  usdRate: input.usdRate,
                }
              : {}),
            accountId: input.fromAccountId,
            direction: "out",
            txnDate: input.txnDate,
            amount: input.amount,
            description: input.description,
            reference: input.reference,
            paymentMethod: input.paymentMethod,
            transferGroupId: groupId,
            createdVia: "manual",
            createdBy: actor.id,
            updatedBy: actor.id,
          })
          .returning({ id: transactions.id });

        const inRef = await this.nextRefNo(tx, year);
        await tx.insert(transactions).values({
          refNo: inRef,
          invoiceNo: input.invoiceNo,
          ...(input.usdAmount && input.usdRate
            ? {
                originalAmount: input.usdAmount,
                originalCurrency: "USD",
                fxRate: input.usdRate,
                usdRate: input.usdRate,
              }
            : {}),
          accountId: input.toAccountId,
          direction: "in",
          txnDate: input.txnDate,
          amount: input.amount,
          description: input.description,
          reference: input.reference,
          paymentMethod: input.paymentMethod,
          transferGroupId: groupId,
          createdVia: "manual",
          createdBy: actor.id,
          updatedBy: actor.id,
        });

        await watch.assert(tx);
        return outRow;
      },
    });

    return this.findOne(created.id);
  }

  /**
   * An account that does not exist is a bad request, not a server fault.
   *
   * Without this the id went straight to the insert and Postgres refused it
   * with a foreign-key violation, which escaped as a **500** — an error page
   * where the form wanted a field message, and the whole failing statement in
   * the log. `categoryId` has been guarded like this all along; `accountId`
   * simply never was.
   */
  private async assertAccountExists(accountId: string) {
    const [account] = await this.db.client
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
      .limit(1);

    if (!account) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { accountId: ["No such account"] },
      });
    }
  }

  /**
   * A money-out entry filed under a money-in heading would make every total
   * wrong, so it is refused rather than silently accepted.
   */
  private async assertCategoryMatchesDirection(
    categoryId: string,
    direction: "in" | "out",
  ) {
    /*
     * Validating the category an entry is being filed under. A deleted one
     * reads as no such category, which is the message somebody needs — not a
     * silent posting into a heading that no screen will ever show them again.
     */
    const [category] = await this.db.client
      .select({ kind: categories.kind, name: categories.name })
      .from(categories)
      .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)))
      .limit(1);

    if (!category) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { categoryId: ["No such category"] },
      });
    }

    if (category.kind !== "both" && category.kind !== direction) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: {
          categoryId: [
            `"${category.name}" is a ${category.kind === "in" ? "money in" : "money out"} category`,
          ],
        },
      });
    }
  }
}

/**
 * How many live documents hang on the row.
 *
 * A subquery rather than a join, because a join would return the transaction
 * once per attached file and quietly double every figure on the page the first
 * time somebody uploaded two.
 *
 * Written with no interpolated column objects, and that is the whole trick.
 * Inside a `sql` template drizzle renders a column as its bare name, so
 * `${transactions.id}` becomes `"id"` — and inside `from files` that `"id"` is
 * the *file's* own. The team-member photograph was broken exactly this way and
 * the comment there records it: the condition asked whether a file's owner is
 * its own id, which is never true, and NULL is a perfectly good answer to
 * "which photo", so nothing errored and every avatar fell back to initials.
 *
 * So both sides are literal text. `df` aliases files so nothing is ambiguous,
 * and `transactions.id` resolves against the outer query — which holds as long
 * as the outer query does not alias that table. It does not, in any of the four
 * places this projection is used.
 */
function documentCount() {
  return sql<number>`(
    select count(*)::int
      from files df
     where df.transaction_id = transactions.id
       and df.deleted_at is null
  )`;
}

const projection = {
  id: transactions.id,
  refNo: transactions.refNo,
  txnDate: transactions.txnDate,
  direction: transactions.direction,
  amount: transactions.amount,
  signedAmount: transactions.signedAmount,
  currency: transactions.currency,
  description: transactions.description,
  notes: transactions.notes,
  paymentMethod: transactions.paymentMethod,
  reference: transactions.reference,
  invoiceNo: transactions.invoiceNo,
  documentCount: documentCount(),
  receiptUrl: transactions.receiptUrl,
  billAmount: transactions.billAmount,
  withheldTaxAmount: transactions.withheldTaxAmount,
  originalAmount: transactions.originalAmount,
  originalCurrency: transactions.originalCurrency,
  fxRate: transactions.fxRate,
  usdRate: transactions.usdRate,
  createdVia: transactions.createdVia,
  transferGroupId: transactions.transferGroupId,
  voidedAt: transactions.voidedAt,
  voidReason: transactions.voidReason,
  accountId: transactions.accountId,
  accountName: accounts.name,
  categoryId: transactions.categoryId,
  categoryName: categories.name,
  categoryColor: categories.color,
  vendorId: transactions.vendorId,
  vendorName: vendors.name,
  counterparty: transactions.counterparty,
  senderBankName: transactions.senderBankName,
  senderAccountName: transactions.senderAccountName,
  senderAccountNumber: transactions.senderAccountNumber,
  senderSwiftCode: transactions.senderSwiftCode,
  createdAt: transactions.createdAt,
};

function describeUpdate(
  existing: TransactionDto,
  input: UpdateTransactionInput,
): string {
  const parts: string[] = [];
  if (input.amount && input.amount !== existing.amount) {
    parts.push(
      `amount ${formatMoney(existing.amount)} → ${formatMoney(input.amount)}`,
    );
  }
  if (input.txnDate && input.txnDate !== existing.txnDate) {
    parts.push(`date ${existing.txnDate} → ${input.txnDate}`);
  }
  if (input.description && input.description !== existing.description) {
    parts.push(`description changed`);
  }
  if (input.categoryId && input.categoryId !== existing.categoryId) {
    parts.push("recategorised");
  }
  const detail = parts.length ? parts.join(", ") : "details updated";
  return `${existing.refNo}: ${detail}`;
}
