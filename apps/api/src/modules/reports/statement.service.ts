import { Injectable } from "@nestjs/common";
import {
  currentFiscalYear,
  formatMoney,
  periodsInFiscalYear,
  todayInDhaka,
  type AccountLedger,
  type CashComposition,
  type ExecutiveSummary,
  type FinancialStatement,
  type Money2,
  type NumberFormat,
  type OutflowShare,
  type PeriodRange,
  type SaveStatementInput,
  type StatementLine,
  type StatementQuery,
  type WaterfallStep,
} from "@finance/shared";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import {
  accounts,
  categories,
  payrollLines,
  statements,
  tdsDeposits,
  transactions,
  type Statement,
} from "../../db/schema";
import { FxService } from "../fx/fx.service";
import { SettingsService } from "../settings/settings.service";
import { TransactionsService } from "../transactions/transactions.service";

/** Never count a voided row. It stays visible; it is not money. */
const LIVE = isNull(transactions.voidedAt);

/**
 * How many bars the waterfall may carry between the two pillars.
 *
 * A waterfall with a bar per category is a bar chart with extra steps — it
 * stops showing the shape of the month. Everything past this collapses into a
 * single "Tax & other" step, so the chart stays readable and the last bar is
 * still the closing balance.
 */
const MAX_MOVEMENT_STEPS = 5;

/** Where a bank name is missing, say what kind of account it is. */
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  bank: "Bank account",
  cash: "Cash in hand",
  mobile_wallet: "Mobile wallet",
};

type Register = Awaited<ReturnType<TransactionsService["register"]>>;
type RegisterRow = Register["rows"][number];

type CategoryGroup = { id: string; name: string; color: string | null };

/** How many payslips sit behind a period's payroll rows, and their tax. */
type PayrollDetail = { people: number; tds: string };

/** One live movement, with everything the document needs hung off it. */
type Entry = {
  row: RegisterRow;
  accountId: string;
  /** False for the prepaid card — the card is not the bank. */
  isBank: boolean;
  group: CategoryGroup;
  /** This entry in both currencies, at its own rate wherever it has one. */
  money: Money2;
};

/**
 * The financial statement — the document this company produced by hand.
 *
 * A statement is a *position*, not a report: every figure has to tie back to a
 * closing balance. So nothing here is stored and read back. It is assembled
 * from one set of rows — the very rows the account register screen shows,
 * fetched through `TransactionsService.register` rather than a third
 * running-balance query — and every total on the page is the sum of those
 * rows. The `statements` table holds only what a ledger cannot know: the
 * prose, the signatures, and which receipts are already spoken for.
 */
@Injectable()
export class StatementService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
    private readonly transactionsService: TransactionsService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /*  Building the document                                                  */
  /* ---------------------------------------------------------------------- */

  async build(query: StatementQuery): Promise<FinancialStatement> {
    const settings = await this.settings.get();
    const mode = settings.fiscalYearMode;
    const fiscalYear = query.fiscalYear ?? currentFiscalYear(mode);
    const base = settings.baseCurrency;
    const format: NumberFormat = settings.numberFormat;

    const all = periodsInFiscalYear(fiscalYear, mode, query.granularity);

    // Asked for nothing in particular, a statement means the period we are in.
    // Defaulting to the first would open August's close on July's page.
    const today = todayInDhaka();
    const index = query.index
      ? Math.min(query.index, all.length) - 1
      : Math.max(
          all.findIndex((p) => p.start <= today && today <= p.end),
          0,
        );

    const range = all[index];
    const previous = index > 0 ? all[index - 1] : null;

    const [saved, fx, groups, accountIds, restrictedBdt, payrollDetail] =
      await Promise.all([
        this.savedFor(range),
        this.fx.contextFor(range),
        this.categoryGroups(),
        this.liveAccountIds(),
        this.taxOutstanding(),
        this.payrollDetail(range),
      ]);

    /**
     * The rate a figure falls back to when its own entry never captured one.
     *
     * Null rather than a guess when the period has no rate at all: a blank
     * dollar column is honest, a taka figure behind a dollar sign is not.
     */
    const periodRate = fx.unavailable ? null : fx.rate;

    // One register per account — the same call the account screen makes, so a
    // ledger page here and the register behind it cannot disagree.
    const registers = await Promise.all(
      accountIds.map((id) =>
        this.transactionsService.register(id, {
          from: range.start,
          to: range.end,
        }),
      ),
    );

    const entries: Entry[] = registers.flatMap((register) =>
      register.rows.map((row) => ({
        row,
        accountId: register.account.id,
        isBank: register.account.currency === base,
        group: groupOf(groups, row.categoryId),
        money: moneyForEntry(row, periodRate),
      })),
    );

    const ledgers = registers.map((register) =>
      ledgerFor(register, entries, periodRate, base, range),
    );

    const bankLedgers = ledgers.filter((ledger) => ledger.currency === base);
    const cardLedgers = ledgers.filter((ledger) => ledger.currency !== base);

    const openingBank = sumMoney(bankLedgers.map((ledger) => ledger.opening));
    const closingBank = sumMoney(bankLedgers.map((ledger) => ledger.closing));
    const closingCard = cardLedgers.length
      ? sumMoney(cardLedgers.map((ledger) => ledger.closing))
      : null;

    const counterparty = soleCounterparty(entries);

    const committed = committedForwardEntries(entries, saved);

    return {
      period: {
        label: range.label,
        start: range.start,
        end: range.end,
        granularity: query.granularity,
        ordinal: ordinalFor(range, query.granularity, index),
      },
      company: { name: settings.companyName, counterparty },
      cycle: saved?.cycle ?? index + 1,
      status: saved?.status === "reconciled" ? "reconciled" : "draft",
      audited: saved?.audited ?? false,
      lineItems: entries.length,
      summary: summaryFor({
        entries,
        closingBank,
        closingCard,
        counterparty,
        payroll: payrollDetail,
      }),
      composition: compositionFor({
        closingBank,
        restrictedBdt,
        periodRate,
        committed,
        format,
      }),
      waterfall: waterfallFor(entries, openingBank),
      outflow: outflowFor(entries),
      ledgers,
      notes: saved?.notes?.length
        ? saved.notes
        : draftNotes({
            entries,
            openingBank,
            previousLabel: previous?.label ?? null,
            fxCaption: fx.caption,
            fxUnavailable: fx.unavailable,
            restrictedBdt,
            counterparty,
            payroll: payrollDetail,
            format,
          }),
      signatories: saved?.signatories ?? [],
      generatedOn: new Date().toISOString(),
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Saving the parts a ledger cannot derive                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Upserts the notes, the status and the committed-forward marks for a period.
   *
   * The earmarked transfer ids live on this row rather than on the transaction:
   * "spoken for by next month" is a claim about *this* statement's position,
   * not a property of the money. The same transfer is committed-forward on
   * August's page and simply spent on September's, and a flag on the ledger row
   * could only ever say one of those.
   */
  async save(
    input: SaveStatementInput,
    actor: AuthenticatedUser,
  ): Promise<Statement> {
    const period = and(
      eq(statements.periodStart, input.periodStart),
      eq(statements.periodEnd, input.periodEnd),
    );

    // Only what the request actually sent. Spreading the whole input would
    // blank the notes every time somebody ticks "audited".
    const patch = {
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.audited !== undefined ? { audited: input.audited } : {}),
      ...(input.cycle !== undefined ? { cycle: input.cycle } : {}),
      ...(input.signatories !== undefined
        ? { signatories: input.signatories }
        : {}),
      ...(input.committedForwardTxnIds !== undefined
        ? { committedForwardTxnIds: input.committedForwardTxnIds }
        : {}),
    };

    return this.audit.mutate({
      action: "update",
      entityTable: "statements",
      module: "reports",
      summary: `Updated the financial statement for ${input.periodStart} – ${input.periodEnd}`,
      read: async (tx) => {
        const [row] = await tx.select().from(statements).where(period).limit(1);
        return row;
      },
      run: async (tx) => {
        const [created] = await tx
          .insert(statements)
          .values({
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            updatedBy: actor.id,
            ...patch,
          })
          .onConflictDoNothing()
          .returning();

        if (created) return created;

        // The period already has a row, so amend it. A plain update rather
        // than `onConflictDoUpdate` because the unique index is on a coalesced
        // expression, which cannot be named as a conflict target.
        const [updated] = await tx
          .update(statements)
          .set({ ...patch, updatedAt: new Date(), updatedBy: actor.id })
          .where(period)
          .returning();
        return updated;
      },
    });
  }

  /* ---------------------------------------------------------------------- */
  /*  Reads                                                                  */
  /* ---------------------------------------------------------------------- */

  private async savedFor(range: PeriodRange): Promise<Statement | undefined> {
    const [row] = await this.db.client
      .select()
      .from(statements)
      .where(
        and(
          eq(statements.periodStart, range.start),
          eq(statements.periodEnd, range.end),
        ),
      )
      .limit(1);
    return row;
  }

  private async liveAccountIds(): Promise<string[]> {
    const rows = await this.db.client
      .select({ id: accounts.id })
      .from(accounts)
      .where(isNull(accounts.deletedAt))
      .orderBy(accounts.sortOrder, accounts.name);
    return rows.map((row) => row.id);
  }

  /** Every category with the heading it rolls up to, resolved in one pass. */
  private async categoryGroups(): Promise<Map<string, CategoryGroup>> {
    const rows = await this.db.client
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
        parentId: categories.parentId,
      })
      .from(categories);

    const byId = new Map(rows.map((row) => [row.id, row]));
    const groups = new Map<string, CategoryGroup>();

    for (const row of rows) {
      const heading = (row.parentId ? byId.get(row.parentId) : null) ?? row;
      groups.set(row.id, {
        id: heading.id,
        name: heading.name,
        color: heading.color,
      });
    }

    return groups;
  }

  /**
   * Withheld and not yet handed to the treasury, all time.
   *
   * Deliberately not scoped to the period, and deliberately the same
   * arithmetic as the overview's `taxOutstanding`: an unpaid obligation from
   * March is still owed in August, and two screens quoting different figures
   * for one liability is worse than either being wrong on its own.
   */
  private async taxOutstanding(): Promise<string> {
    const [withheld] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.withheldTaxAmount}), 0)::text`,
      })
      .from(transactions)
      .where(and(LIVE, eq(transactions.direction, "out")));

    const [deposited] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${tdsDeposits.amount}), 0)::text`,
      })
      .from(tdsDeposits);

    const owed = Number(withheld.total) - Number(deposited.total);
    return (owed > 0 ? owed : 0).toFixed(2);
  }

  /**
   * The payslips behind this period's payroll rows.
   *
   * A ledger row knows what left the bank; only the run knows how many people
   * that was and how much tax was held back on the way.
   */
  private async payrollDetail(range: PeriodRange): Promise<PayrollDetail> {
    const runs = await this.db.client
      .selectDistinct({ id: transactions.payrollRunId })
      .from(transactions)
      .where(
        and(
          LIVE,
          eq(transactions.createdVia, "payroll"),
          gte(transactions.txnDate, range.start),
          lte(transactions.txnDate, range.end),
          sql`${transactions.payrollRunId} is not null`,
        ),
      );

    const runIds = runs
      .map((run) => run.id)
      .filter((id): id is string => id !== null);
    if (!runIds.length) return { people: 0, tds: "0.00" };

    const [row] = await this.db.client
      .select({
        people: sql<number>`count(*)::int`,
        tds: sql<string>`coalesce(sum(${payrollLines.tdsAmount}), 0)::text`,
      })
      .from(payrollLines)
      .where(inArray(payrollLines.payrollRunId, runIds));

    return {
      people: Number(row?.people ?? 0),
      tds: Number(row?.tds ?? 0).toFixed(2),
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Money — the rule that makes the document reconcile                         */
/* -------------------------------------------------------------------------- */

/**
 * A figure in both currencies.
 *
 * A null `rate` and a null `usd` mean no rate was available at all. The
 * document shows a blank there rather than a number produced from whatever
 * rate happened to be lying around.
 */
function money(
  bdt: string | number,
  rate: string | null,
  estimated: boolean,
): Money2 {
  const value = Number(bdt);
  const divisor = rate ? Number(rate) : 0;
  const usd = divisor > 0 ? (value / divisor).toFixed(2) : null;

  return {
    bdt: value.toFixed(2),
    usd,
    rate: divisor > 0 ? rate : null,
    ...(usd !== null && estimated ? { estimated: true } : {}),
  };
}

/**
 * A total, summed from its parts.
 *
 * `rate` is null because many rates went into it, and the dollars are the sum
 * of each part's dollars — never the total taka divided by one rate. Those two
 * differ the moment entries moved at different rates, and that difference is
 * exactly what makes a statement fail to reconcile. One part with no dollars
 * blanks the whole total, because a sum that quietly drops a line is worse
 * than no sum at all.
 */
function sumMoney(parts: Money2[]): Money2 {
  const bdt = parts.reduce((sum, part) => sum + Number(part.bdt), 0);
  const missing = parts.some((part) => part.usd === null);
  const usd = missing
    ? null
    : parts.reduce((sum, part) => sum + Number(part.usd ?? 0), 0).toFixed(2);
  const estimated = parts.some((part) => part.estimated === true);

  return {
    bdt: bdt.toFixed(2),
    usd,
    rate: null,
    ...(usd !== null && estimated ? { estimated: true } : {}),
  };
}

function negate(value: Money2): Money2 {
  return {
    ...value,
    bdt: (-Number(value.bdt)).toFixed(2),
    usd: value.usd === null ? null : (-Number(value.usd)).toFixed(2),
  };
}

/**
 * The rate an entry's dollars come from.
 *
 * `usd_rate` first: the reference rate captured on the day the entry was made,
 * which is the only moment the right answer is actually known. A remittance
 * also carries `fx_rate` — what the bank truly converted at, and the very
 * arithmetic that produced the taka now sitting in the account — so on those
 * rows it is a recorded fact rather than a translation, and it is used before
 * the period is asked. Everything else falls back to the period's rate and is
 * marked estimated so the page can say which is which.
 */
function moneyForEntry(row: RegisterRow, periodRate: string | null): Money2 {
  if (row.usdRate && Number(row.usdRate) > 0) {
    return money(row.amount, row.usdRate, false);
  }
  if (row.originalCurrency === "USD" && row.fxRate && Number(row.fxRate) > 0) {
    return money(row.amount, row.fxRate, false);
  }
  return money(row.amount, periodRate, true);
}

/* -------------------------------------------------------------------------- */
/*  01 — the four measures and where the period closed                         */
/* -------------------------------------------------------------------------- */

function summaryFor(input: {
  entries: Entry[];
  closingBank: Money2;
  closingCard: Money2 | null;
  counterparty: string | null;
  payroll: PayrollDetail;
}): ExecutiveSummary {
  const transfersIn = input.entries.filter(isTransferIn);
  const payroll = input.entries.filter(isPayroll);
  const operating = input.entries.filter(
    (entry) =>
      entry.row.direction === "out" && !isPayroll(entry) && entry.isBank,
  );
  const card = input.entries.filter(
    (entry) => entry.row.direction === "out" && !entry.isBank,
  );

  const cardTotal = sumMoney(card.map((entry) => entry.money));

  const lines: Array<StatementLine & { basis: "Inflow" | "Outflow" | "Card" }> =
    [
      {
        label: "Intercompany transfer received",
        detail: transfersIn.length
          ? `${transfersIn.length} ${plural(transfersIn.length, "transfer")}${
              input.counterparty ? ` from ${input.counterparty}` : " received"
            }`
          : "No transfer received this period",
        amount: sumMoney(transfersIn.map((entry) => entry.money)),
        basis: "Inflow",
      },
      {
        label: "Net payroll disbursed",
        detail: payroll.length
          ? `${
              input.payroll.people
                ? `${input.payroll.people} ${plural(input.payroll.people, "person", "people")} · `
                : ""
            }team salary · net of tax withheld`
          : "No payroll disbursed this period",
        amount: sumMoney(payroll.map((entry) => entry.money)),
        basis: "Outflow",
      },
      {
        label: "Facility & operating costs",
        detail: topGroupNames(operating),
        amount: sumMoney(operating.map((entry) => entry.money)),
        basis: "Outflow",
      },
      {
        label: "AI tooling & subscriptions",
        detail: card.length
          ? `${
              cardTotal.usd
                ? `USD ${formatMoney(cardTotal.usd, { format: "western", hideSymbol: true })}`
                : "Card spend"
            } on prepaid card`
          : "No prepaid card activity this period",
        amount: cardTotal,
        basis: "Card",
      },
    ];

  return {
    lines,
    closing: { bank: input.closingBank, card: input.closingCard },
  };
}

/* -------------------------------------------------------------------------- */
/*  02 — what the closing balance is actually made of                          */
/* -------------------------------------------------------------------------- */

function compositionFor(input: {
  closingBank: Money2;
  restrictedBdt: string;
  periodRate: string | null;
  committed: Entry[];
  format: NumberFormat;
}): CashComposition {
  const restricted = money(input.restrictedBdt, input.periodRate, true);

  // free + restricted is the closing balance by construction, rather than by a
  // second subtraction that could round the other way.
  const free = sumMoney([input.closingBank, negate(restricted)]);

  if (!input.committed.length) {
    return {
      free,
      restricted,
      committedForward: null,
      committedForwardNote: null,
      total: input.closingBank,
    };
  }

  const committedForward = sumMoney(
    input.committed.map((entry) => entry.money),
  );
  const refs = input.committed.map((entry) => entry.row.refNo).join(", ");

  return {
    free,
    restricted,
    committedForward,
    committedForwardNote: `${formatMoney(committedForward.bdt, {
      format: input.format,
    })} received this period (${refs}) is earmarked for the next one and is not this period's surplus.`,
    total: input.closingBank,
  };
}

/** The inflows this period's statement has marked as belonging to the next. */
function committedForwardEntries(
  entries: Entry[],
  saved: Statement | undefined,
): Entry[] {
  const ids = new Set(saved?.committedForwardTxnIds ?? []);
  if (!ids.size) return [];
  return entries.filter(
    (entry) => entry.row.direction === "in" && ids.has(entry.row.id),
  );
}

/* -------------------------------------------------------------------------- */
/*  03 — the waterfall and the outflow split                                   */
/* -------------------------------------------------------------------------- */

/**
 * Opening, each movement, closing — on the bank, which is what a waterfall is
 * a picture of. The prepaid card is its own account and its own line in 01.
 *
 * The running balance is carried as a sum of parts, so the closing pillar
 * lands on the closing balance exactly rather than nearly.
 */
function waterfallFor(entries: Entry[], openingBank: Money2): WaterfallStep[] {
  const bank = entries.filter((entry) => entry.isBank);

  const transfersIn = bank.filter(isTransferIn);
  const otherIn = bank.filter(
    (entry) => entry.row.direction === "in" && !isTransferIn(entry),
  );
  const payroll = bank.filter(isPayroll);
  const otherOut = bank.filter(
    (entry) => entry.row.direction === "out" && !isPayroll(entry),
  );

  const movements: Array<{
    label: string;
    kind: "in" | "out";
    parts: Entry[];
  }> = [];
  if (transfersIn.length)
    movements.push({ label: "Transfers in", kind: "in", parts: transfersIn });
  if (otherIn.length)
    movements.push({ label: "Other receipts", kind: "in", parts: otherIn });
  if (payroll.length)
    movements.push({ label: "Payroll", kind: "out", parts: payroll });

  // The rest of the spend, largest heading first. Whatever does not earn a bar
  // of its own falls into one catch-all, so nothing is dropped and the closing
  // pillar is still the closing balance.
  const ranked = [...groupBy(otherOut).values()].sort(
    (a, b) => totalOf(b.parts) - totalOf(a.parts),
  );

  const slots = Math.max(MAX_MOVEMENT_STEPS - movements.length, 1);
  const named = ranked.length > slots ? ranked.slice(0, slots - 1) : ranked;
  const rest = ranked.slice(named.length).flatMap((group) => group.parts);

  for (const group of named) {
    movements.push({
      label: group.group.name,
      kind: "out",
      parts: group.parts,
    });
  }
  if (rest.length) {
    movements.push({ label: "Tax & other", kind: "out", parts: rest });
  }

  const running: Money2[] = [openingBank];
  const steps: WaterfallStep[] = [
    {
      label: "Opening balance",
      delta: null,
      balance: openingBank,
      kind: "opening",
    },
  ];

  for (const movement of movements) {
    const total = sumMoney(movement.parts.map((entry) => entry.money));
    const delta = movement.kind === "in" ? total : negate(total);
    running.push(delta);
    steps.push({
      label: movement.label,
      delta,
      balance: sumMoney(running),
      kind: movement.kind,
    });
  }

  steps.push({
    label: "Closing balance",
    delta: null,
    balance: sumMoney(running),
    kind: "closing",
  });

  return steps;
}

/** Where the money went, by heading, across every account. */
function outflowFor(entries: Entry[]): {
  total: Money2;
  shares: OutflowShare[];
} {
  const out = entries.filter((entry) => entry.row.direction === "out");
  const total = sumMoney(out.map((entry) => entry.money));
  const totalBdt = Number(total.bdt);

  const shares: OutflowShare[] = [...groupBy(out).values()]
    .map((bucket) => {
      const amount = sumMoney(bucket.parts.map((entry) => entry.money));
      return {
        label: bucket.group.name,
        amount,
        share: totalBdt > 0 ? (Number(amount.bdt) / totalBdt) * 100 : 0,
        color: bucket.group.color,
      };
    })
    .sort((a, b) => Number(b.amount.bdt) - Number(a.amount.bdt));

  return { total, shares };
}

/* -------------------------------------------------------------------------- */
/*  04 and 05 — one ledger per account                                         */
/* -------------------------------------------------------------------------- */

function ledgerFor(
  register: Register,
  entries: Entry[],
  periodRate: string | null,
  base: string,
  range: PeriodRange,
): AccountLedger {
  const mine = entries.filter(
    (entry) => entry.accountId === register.account.id,
  );

  // An opening balance is a stock, not a movement: no entry carries its rate,
  // so it can only be read at the period's.
  const opening = money(register.openingBalance, periodRate, true);

  const running: Money2[] = [opening];
  const rows: AccountLedger["rows"] = [
    {
      id: null,
      label: "Opening balance carried forward",
      detail: `As at ${range.start}`,
      direction: Number(register.openingBalance) < 0 ? "out" : "in",
      amount: opening,
      balance: opening,
    },
  ];

  for (const entry of mine) {
    running.push(
      entry.row.direction === "in" ? entry.money : negate(entry.money),
    );
    rows.push({
      id: entry.row.id,
      label: entry.row.description,
      detail: detailFor(entry),
      direction: entry.row.direction,
      amount: entry.money,
      balance: sumMoney(running),
    });
  }

  // Only rates actually recorded against an entry. The period fallback is not
  // a rate this account "saw"; printing it as one would dress an estimate up
  // as an observation.
  const recorded = mine
    .filter((entry) => entry.money.estimated !== true && entry.money.rate)
    .map((entry) => Number(entry.money.rate));

  return {
    accountId: register.account.id,
    name: register.account.name,
    subtitle: subtitleFor(register.account, base),
    currency: register.account.currency,
    rateFrom: recorded.length ? Math.min(...recorded).toFixed(4) : null,
    rateTo: recorded.length ? Math.max(...recorded).toFixed(4) : null,
    opening,
    closing: rows[rows.length - 1].balance,
    rows,
  };
}

/* -------------------------------------------------------------------------- */
/*  Notes — a first draft, replaced the moment somebody writes their own        */
/* -------------------------------------------------------------------------- */

function draftNotes(input: {
  entries: Entry[];
  openingBank: Money2;
  previousLabel: string | null;
  fxCaption: string;
  fxUnavailable: boolean;
  restrictedBdt: string;
  counterparty: string | null;
  payroll: PayrollDetail;
  format: NumberFormat;
}): string[] {
  const fmt = (value: string) => formatMoney(value, { format: input.format });
  // Dollars are grouped the western way even when taka is not: $11,221.80 is
  // what a reader in the USA is expecting to see beside ৳11,22,180.00.
  const usd = (value: string) =>
    formatMoney(value, { format: "western", currency: "USD" });

  const notes = [
    `Opening bank balance of ${fmt(input.openingBank.bdt)} is carried forward from ${
      input.previousLabel ?? "the period before"
    }.`,
  ];

  const withOwnRate = input.entries.filter(
    (entry) => entry.money.estimated !== true && entry.money.rate,
  ).length;

  // When no rate exists at all the caption is already a whole sentence about
  // that ("no exchange rate on record… Add one in Settings."), so it is quoted
  // rather than folded into a clause that would end in two full stops.
  if (input.fxUnavailable) {
    notes.push(
      withOwnRate
        ? `${withOwnRate} of ${input.entries.length} entries carry the rate recorded against them on the day; there is no rate on record for this period, so every other dollar figure is left blank rather than guessed.`
        : `No entry carries a rate of its own and there is no rate on record for this period, so this statement is in taka only — add a rate in Settings.`,
    );
  } else {
    notes.push(
      withOwnRate
        ? `${withOwnRate} of ${input.entries.length} entries carry the rate recorded against them on the day; every other dollar figure is marked estimated and ${input.fxCaption}.`
        : `No entry carries a rate of its own, so every dollar figure on this statement is ${input.fxCaption}.`,
    );
  }

  const transfers = input.entries.filter(isTransferIn);
  if (transfers.length) {
    const total = sumMoney(transfers.map((entry) => entry.money));
    notes.push(
      `${transfers.length} intercompany ${plural(transfers.length, "transfer")} totalling ${fmt(total.bdt)}${
        total.usd ? ` (${usd(total.usd)})` : ""
      } landed${input.counterparty ? ` from ${input.counterparty}` : ""} in this period.`,
    );
  }

  const payroll = input.entries.filter(isPayroll);
  if (payroll.length) {
    const total = sumMoney(payroll.map((entry) => entry.money));
    const people = input.payroll.people
      ? ` to ${input.payroll.people} ${plural(input.payroll.people, "person", "people")}`
      : "";
    const tds =
      Number(input.payroll.tds) > 0
        ? `, after ${fmt(input.payroll.tds)} withheld at source`
        : "";
    notes.push(
      `Net payroll of ${fmt(total.bdt)} was disbursed${people}${tds}.`,
    );
  }

  if (Number(input.restrictedBdt) > 0) {
    notes.push(
      `${fmt(input.restrictedBdt)} of withholding tax has been deducted and not yet deposited to the treasury, so it sits inside the closing balance but is not the company's to spend.`,
    );
  }

  return notes;
}

/* -------------------------------------------------------------------------- */
/*  Small shared pieces                                                        */
/* -------------------------------------------------------------------------- */

const UNCATEGORISED: CategoryGroup = {
  id: "uncategorised",
  name: "Uncategorised",
  color: null,
};

/** Money in that arrived as a foreign remittance — the intercompany transfer. */
function isTransferIn(entry: Entry): boolean {
  return entry.row.direction === "in" && entry.row.originalCurrency !== null;
}

function isPayroll(entry: Entry): boolean {
  return entry.row.direction === "out" && entry.row.createdVia === "payroll";
}

function groupOf(
  groups: Map<string, CategoryGroup>,
  categoryId: string | null,
): CategoryGroup {
  if (!categoryId) return UNCATEGORISED;
  return groups.get(categoryId) ?? UNCATEGORISED;
}

/** Entries under their top-level heading — thirty rows answer nothing. */
function groupBy(entries: Entry[]) {
  const buckets = new Map<string, { group: CategoryGroup; parts: Entry[] }>();
  for (const entry of entries) {
    const bucket = buckets.get(entry.group.id) ?? {
      group: entry.group,
      parts: [],
    };
    bucket.parts.push(entry);
    buckets.set(entry.group.id, bucket);
  }
  return buckets;
}

function totalOf(parts: Entry[]): number {
  return parts.reduce((sum, entry) => sum + Number(entry.money.bdt), 0);
}

/** The grey line under a ledger row: reference, who, and which heading. */
function detailFor(entry: Entry): string | null {
  const who = entry.row.vendorName ?? entry.row.counterparty;
  const parts = [entry.row.refNo, who, entry.group.name].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** "Office & premises, Marketing and Technology" — the short list under 01. */
function topGroupNames(entries: Entry[]): string | null {
  if (!entries.length) return "Nothing else left the bank this period";

  const names = [...groupBy(entries).values()]
    .sort((a, b) => totalOf(b.parts) - totalOf(a.parts))
    .slice(0, 3)
    .map((bucket) => bucket.group.name);

  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The other side of the transfers, when there is only one of them.
 *
 * Two different senders in one period is not something a four-word summary
 * line can state, so it says nothing rather than naming the wrong one.
 */
function soleCounterparty(entries: Entry[]): string | null {
  const names = new Set(
    entries
      .filter(isTransferIn)
      .map((entry) => entry.row.counterparty ?? entry.row.vendorName)
      .filter((name): name is string => Boolean(name)),
  );

  return names.size === 1 ? [...names][0] : null;
}

function subtitleFor(
  account: Register["account"],
  base: string,
): string | null {
  if (account.currency !== base) return `Prepaid · ${account.currency}`;
  if (account.bankName) return account.bankName;
  return ACCOUNT_TYPE_LABELS[account.type] ?? null;
}

/** "07" for July, "Q1", "H1", "FY" — the big numeral on the page. */
function ordinalFor(
  range: PeriodRange,
  granularity: StatementQuery["granularity"],
  index: number,
): string {
  switch (granularity) {
    case "quarter":
      return `Q${index + 1}`;
    case "half":
      return `H${index + 1}`;
    case "year":
      return "FY";
    default:
      return range.start.slice(5, 7);
  }
}

function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}
