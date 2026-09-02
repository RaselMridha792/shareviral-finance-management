import { createHash } from "node:crypto";

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  addMonths,
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
  payableBdt,
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
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { isToolSpend } from "../vendors/tool-spend";
import {
  overviewSelect,
  overviewWhere,
  type ExpenseOverview,
} from "./expense-overview";
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
  /** Attached invoices, and everything else attached, counted apart. */
  invoiceCount: number;
  recordCount: number;
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
  invoiceCount: number;
  recordCount: number;
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
    private readonly subscriptionsService: SubscriptionsService,
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

        /*
         * The same three, in the dollars the ROWS carry.
         *
         * The owner: "aigula kono fx rate theke hobena. prottekta transaction
         * er usd amount o save hoy oitai jog hobe." Added up, never divided out
         * of taka — a figure produced by division moves on its own the moment
         * somebody edits a rate, which is what #8 took out of this app.
         *
         * A row with no dollar figure contributes nothing, which makes these a
         * FLOOR rather than a wrong number. `usdExact` says which, and the
         * screen marks it with a tilde — the same contract `ownBalanceExact`
         * uses on an account, so the two cannot disagree about what a tilde
         * means.
         */
        moneyInUsd: sql<string>`coalesce(sum(${transactions.originalAmount}) filter (
          where ${transactions.direction} = 'in'
            and ${transactions.originalCurrency} = 'USD'
            and ${transactions.originalAmount} is not null
        ), 0)::text`,
        moneyOutUsd: sql<string>`coalesce(sum(${transactions.originalAmount}) filter (
          where ${transactions.direction} = 'out'
            and ${transactions.originalCurrency} = 'USD'
            and ${transactions.originalAmount} is not null
        ), 0)::text`,

        /* How many rows carry one at all. Zero means this filter has no dollar
           view — which is a different answer from "$0.00", and the screen shows
           nothing rather than a figure nobody established. */
        withUsd: sql<number>`count(*) filter (
          where ${transactions.originalCurrency} = 'USD'
            and ${transactions.originalAmount} is not null
        )::int`,

        entries: count(),
      })
      .from(transactions)
      .where(where);

    const withUsd = Number(row.withUsd);
    const inUsd = Number(row.moneyInUsd);
    const outUsd = Number(row.moneyOutUsd);

    return {
      moneyIn: row.moneyIn,
      moneyOut: row.moneyOut,
      net: row.net,
      entries: Number(row.entries),
      usd:
        withUsd === 0
          ? null
          : {
              moneyIn: inUsd.toFixed(2),
              moneyOut: outUsd.toFixed(2),
              /* Derived from the two above rather than summed again, so
                 in - out reads as a sentence that adds up. */
              net: (inUsd - outUsd).toFixed(2),
              /* Every row carried one, or only some did. */
              exact: withUsd === Number(row.entries),
            },
    };
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
  /**
   * The Expenses overview: four slices that add up, and the tax held apart.
   *
   * See `expense-overview.ts` for why the slices are defined by exclusion. The
   * previous month comes back with them so the page can say "vs August" without
   * a second round trip, and so both months are measured by exactly the same
   * predicate — two calls written a fortnight apart is how a comparison starts
   * comparing two different questions.
   */
  async expenseOverview(range: {
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    previousLabel: string;
  }): Promise<ExpenseOverview> {
    const slice = async (from: string, to: string) => {
      const [row] = await this.db.client
        .select(overviewSelect())
        .from(transactions)
        /* Both LEFT, because `isToolSpend()` reads a vendor's type and an
           account's currency and a row can carry neither. That predicate is
           written to be definitely-true-or-false through a LEFT JOIN; see the
           long note on it. */
        .leftJoin(accounts, eq(transactions.accountId, accounts.id))
        .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
        .where(overviewWhere(from, to));
      return row;
    };

    const [now, before] = await Promise.all([
      slice(range.from, range.to),
      slice(range.previousFrom, range.previousTo),
    ]);

    const withUsd = Number(now.withUsd);
    return {
      from: range.from,
      to: range.to,
      usd:
        withUsd === 0
          ? null
          : {
              salary: now.salaryUsd,
              tooling: now.toolingUsd,
              operational: now.operationalUsd,
              uncategorised: now.uncategorisedUsd,
              total: now.totalUsd,
              /* Every row carried one, or only some did. */
              exact: withUsd === Number(now.rows),
            },
      salary: now.salary,
      tooling: now.tooling,
      operational: now.operational,
      uncategorised: now.uncategorised,
      total: now.total,
      withheld: now.withheld,
      previous: {
        label: range.previousLabel,
        salary: before.salary,
        tooling: before.tooling,
        operational: before.operational,
        uncategorised: before.uncategorised,
        total: before.total,
      },
    };
  }

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
      /*
       * Which plan this expense paid for, when it paid for one.
       *
       * Deliberately NOT on the public contract. It decides whether the row
       * counts as tooling on the dashboard and the Expenses overview, so it is
       * something the app states about a payment it wrote itself — not
       * something a caller can claim about any expense it likes.
       */
      subscriptionId?: string;
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
              subscriptionId: input.subscriptionId ?? null,
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
   * Record a payment for a subscription.
   *
   * The gap the owner found: *"ekhane kichu kinle eta taka katena bank theke
   * kono history thakena"*. He was right, and it was structural rather than a
   * bug — a subscription is a PLAN (cycle, amount, account, next renewal) and
   * nothing about adding or renewing one ever wrote a transaction. The "paid
   * this period" figure was summing entries somebody had separately recorded
   * and remembered to tag with the vendor.
   *
   * So a plan and a payment are two different things, and the app only had the
   * first. This is the second.
   *
   * **It lives HERE, on the transactions side, and goes through `create` rather
   * than its own INSERT.** Two reasons, and the second was found the hard way:
   * writing the row anywhere else would mean writing the period lock, the
   * overdraft rule, the audit entry, the reference number and the category
   * resolution a second time — five rules already right once. And putting it on
   * VendorsService meant injecting TransactionsService into it, which is a
   * circular module dependency: TransactionsModule already imports
   * VendorsModule, and Nest simply refused to start. That
   * is the whole design decision. Writing the row here would mean writing the
   * period lock, the overdraft rule, the audit entry, the reference number and
   * the category resolution a second time — five rules that are already right
   * once, and would be right in four of five places by next month. Everything
   * that follows comes free: the balance moves because it is an ordinary
   * expense, the history IS the ledger, the trash and the audit log work, and
   * "paid this period" stops being a guess.
   *
   * **Never automatic.** No scheduler creates these. Money leaving a bank has
   * to be somebody's act on a date they chose — an app that quietly wrote
   * expenses would put figures in the books nobody typed, and the first time a
   * card was declined the app and the bank would disagree with nothing to say
   * which was right.
   */
  async payForSubscription(
    id: string,
    input: {
      txnDate: string;
      amount?: string;
      accountId?: string;
      /* Optional, and resolved when absent — the drawers stopped asking for it
         because it was the same answer every time. */
      categoryId?: string;
      note?: string | null;
      advanceRenewal?: boolean;
    },
    actor: AuthenticatedUser,
  ) {
    /*
     * `subscriptionsService`, not `vendorsService`.
     *
     * This asked `VendorsService.billingPlan` and therefore looked the id up
     * in the `vendors` table — while the ids on the AI tools and subscriptions
     * screen come from `subscriptions`. Every "Record a payment" answered 404,
     * on a feature shipped precisely because nothing was moving money. Both
     * tables carry a billing cycle and a renewal date, which is what made the
     * mistake possible and why the lookup now has one home.
     */
    const plan = await this.subscriptionsService.billingPlan(id);
    if (!plan) throw new NotFoundException("That subscription is not here");

    const accountId = input.accountId ?? plan.accountId;
    if (!accountId) {
      throw new BadRequestException(
        "This plan has no card or account on it — choose one, or set one on the plan first",
      );
    }

    /*
     * The taka price PLUS the card's charge, because that is what leaves the
     * account. The ledger is in taka; `costBdt` is what the screen derives and
     * stores beside the dollar price, and `chargeBdt` is what the bank adds on
     * top of it. A plan with only a dollar price and no rate has no taka
     * figure this could invent, and says so instead of guessing one.
     *
     * A typed amount still wins over both — that is the whole reason the box
     * exists, and a card that charged something else is the usual reason to
     * use it.
     */
    const amount = input.amount ?? payableBdt(plan);
    if (!amount || Number(amount) <= 0) {
      throw new BadRequestException(
        "This plan has no taka price on it — type what was charged",
      );
    }

    /*
     * The heading is WORKED OUT, not asked for.
     *
     * The owner: "ekhane alada kore field rakhar dorkar nai expense heading er
     * jonne. eta by default Ai tools and subscriptions er under a jabe." He is
     * right — every payment through this door is a subscription payment, so a
     * picker on the drawer asked a question whose answer was already known, and
     * asked it twice: once when the plan was added and again on every renewal.
     *
     * A caller may still name one, and the AI intake does. Only when nothing is
     * given does this resolve.
     */
    const categoryId =
      input.categoryId ?? (await this.subscriptionCategoryId());

    /*
     * The category is asked for, not guessed.
     *
     * `createTransactionSchema` requires one and is right to: an uncategorised
     * expense is invisible on every Expenses screen, which is the opposite of
     * "kono history thakena" being fixed. A subscription's own category is
     * `ai_tool` / `hosting` and so on — the register's own words, not the
     * company's expense headings — so there is nothing here to map from.
     *
     * No `vendorId`. That column has a foreign key to `vendors`, and a
     * `subscriptions` id in it is an insert that fails outright. The plan is
     * named in the description instead.
     */
    /**
     * The dollars, and the rate — without which a USD card's balance does not
     * move at all.
     *
     * The owner: *"payment record add korle account theke taka kattechena."*
     * He was right, and the taka side was never the problem: the ledger's taka
     * balance moved every time. A foreign account's balance on screen is its
     * OWN currency, and `AccountsService.ownCurrencyBalance` builds that from
     * `original_amount` where the row carries one, or from the row's rate
     * where it does not — and a row with neither contributes **zero**. This
     * path wrote neither, so a $100 plan paid from a dollar card took $0 out
     * of it, and the figure was marked an estimate into the bargain.
     *
     * Only where the price was not typed over. A hand-typed amount is a figure
     * whose dollars nobody stated — the card may have charged something else
     * entirely — so it carries the plan's rate and no dollar claim, which
     * makes the balance an approximation the screen already knows how to mark
     * rather than a number this invented.
     *
     * `originalAmount` is the VENDOR's price, not the price plus the charge.
     * The bank's charge is levied here in taka; the dollar side of the card is
     * debited by what the vendor billed, and the two figures are different on
     * purpose.
     */
    const statedDollars =
      input.amount === undefined && plan.usdRate && Number(plan.usdRate) > 0
        ? { originalAmount: plan.costUsd, fxRate: plan.usdRate }
        : null;

    const created = await this.create(
      {
        direction: "out",
        txnDate: input.txnDate,
        accountId,
        amount,
        categoryId,
        ...(statedDollars
          ? {
              originalAmount: statedDollars.originalAmount,
              originalCurrency: "USD",
              fxRate: statedDollars.fxRate,
            }
          : {}),
        // The rate stands even where the dollars do not, so a typed amount is
        // still translatable rather than silently worth nothing.
        ...(plan.usdRate && Number(plan.usdRate) > 0
          ? { usdRate: plan.usdRate }
          : {}),
        /* The fact that makes this tooling, rather than the guess about which
           card it was on. */
        subscriptionId: plan.id,
        description: input.note?.trim()
          ? `${plan.toolName} — ${input.note.trim()}`
          : `${plan.toolName} subscription`,
        paymentMethod: "card",
      },
      actor,
    );

    /*
     * Roll the renewal forward only if asked. A payment is not always the
     * month's renewal — somebody may be recording one they forgot in March —
     * and moving the date on a back-dated entry would tell the reminder it has
     * a month it does not.
     */
    if (input.advanceRenewal && plan.nextRenewalOn) {
      const next = advanceCycle(plan.nextRenewalOn, plan.billingCycle);
      if (next) await this.subscriptionsService.setNextRenewal(id, next, actor);
    }

    return created;
  }

  /**
   * Which expense heading a subscription payment belongs under.
   *
   * Resolved rather than configured, because a setting for it would be a second
   * place to keep something the category tree already says. Preference order,
   * and each step is a narrower guess than the one before:
   *
   *   1. the slug `ai-tools`, which is what the seed creates
   *   2. a name that reads like AI tools, subscriptions or software — installs
   *      rename their headings, and this company's live one is called
   *      "Ai Tools and Subscriptions"
   *
   * If neither matches it REFUSES, with a sentence naming what to do. Writing
   * the expense uncategorised instead would put it on no Expenses screen at
   * all, which is the complaint this whole feature exists to answer — a silent
   * wrong answer is worse than a loud refusal.
   */
  private async subscriptionCategoryId(): Promise<string> {
    const bySlug = await this.db.client
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          isNull(categories.deletedAt),
          eq(categories.kind, "out"),
          eq(categories.slug, "ai-tools"),
        ),
      )
      .limit(1);
    if (bySlug[0]) return bySlug[0].id;

    const byName = await this.db.client
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          isNull(categories.deletedAt),
          eq(categories.kind, "out"),
          sql`(${categories.name} ilike '%ai tool%'
               or ${categories.name} ilike '%subscription%'
               or ${categories.name} ilike '%software%')`,
        ),
      )
      .orderBy(asc(categories.name))
      .limit(1);
    if (byName[0]) return byName[0].id;

    throw new BadRequestException(
      "There is no expense heading for tools and subscriptions yet. " +
        "Add one under Settings → Categories — call it AI tools — and this will " +
        "find it.",
    );
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

    /*
     * No period check here, on the owner's explicit decision (31 Aug 2026).
     *
     * The inconsistency he was shown: the trash would move an entry out of a
     * CLOSED month while `void` refused the same act on the same row. Asked
     * which way to resolve it, he chose to open `void` rather than close the
     * trash. Recorded as his in SESSIONS.md, along with what he was told at the
     * time — that after this, locking a month stops preventing anything and
     * becomes a label rather than a lock.
     *
     * What still holds, and is what makes this survivable: a void does not
     * erase. The row stays, struck through, out of every total, with who
     * voided it and why, in the audit log. A closed month can now be corrected;
     * it cannot be quietly rewritten.
     *
     * Creating and EDITING an entry in a closed month are still refused —
     * `create` and `update` keep their `assertPeriodOpen`. The lock still stops
     * new money appearing in a filed month; it no longer stops a mistake in it
     * being marked as one.
     */

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
          /* Split the same way, for the same reason: the Invoice and Reference
             columns on the transfers table open different drawers. */
          invoiceCount: documentCountOf(["invoice"]),
          recordCount: documentCountOf(["bank_statement", "receipt", "other"]),
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

/**
 * The same count, split the way the two columns are.
 *
 * Invoice and Reference each open their OWN kind, so a row that knows only how
 * many files it has in total cannot say which of the two buttons is worth
 * offering. Offering both on a total is how a click lands in an empty drawer —
 * the exact complaint that took the amber triangle off this table in #27.
 *
 * `invoice` is its own kind. Everything else a person attaches to an entry —
 * the bank's slip, a receipt, a photo of something — is the record BEHIND the
 * movement, which is what the Reference column opens, so the three are counted
 * together rather than split into buttons nobody asked for.
 */
function documentCountOf(kinds: readonly string[]) {
  return sql<number>`(
    select count(*)::int
      from files df
     where df.transaction_id = transactions.id
       and df.deleted_at is null
       and df.kind in (${sql.join(
         kinds.map((k) => sql`${k}`),
         sql`, `,
       )})
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
  /* Per kind, because Invoice and Reference open different drawers. */
  invoiceCount: documentCountOf(["invoice"]),
  recordCount: documentCountOf(["bank_statement", "receipt", "other"]),
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
  /* In the projection as well as the schema. Forgetting this is how a column
     stores perfectly and every screen reads N/A — it has bitten three times. */
  subscriptionId: transactions.subscriptionId,
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

/**
 * The next renewal, one cycle on.
 *
 * Returns null for a cycle that has no length — "none", or anything unknown —
 * rather than guessing a month, because a date invented here would be shown to
 * somebody as the day their card is charged.
 */
function advanceCycle(from: string, cycle: string): string | null {
  const months =
    cycle === "monthly"
      ? 1
      : cycle === "quarterly"
        ? 3
        : cycle === "half_yearly"
          ? 6
          : cycle === "yearly"
            ? 12
            : null;
  if (months === null) return null;
  return addMonths(from, months);
}
