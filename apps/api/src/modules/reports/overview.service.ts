import { Injectable } from "@nestjs/common";
import {
  currentFiscalYear,
  monthRange,
  periodsInFiscalYear,
  todayInDhaka,
  type AccountGroup,
  type CategoryLine,
  type MonthStat,
  type OverviewEntry,
  type OverviewQuery,
  type OverviewReport,
  type OverviewVendor,
  type PeriodRange,
  GOVERNING_RATE_LABELS,
} from "@finance/shared";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";

import { DbService } from "../../db/db.service";
import {
  accounts,
  categories,
  tdsDeposits,
  teamMembers,
  transactions,
  vendors,
} from "../../db/schema";
import { FxService } from "../fx/fx.service";
import { isToolSpend } from "../vendors/tool-spend";
import { SettingsService } from "../settings/settings.service";
import { TdsService } from "../tds/tds.service";

/** Never count a voided row. It stays visible; it is not money. */
const LIVE = isNull(transactions.voidedAt);

/** How many months of history the trend line shows. */
const TREND_MONTHS = 12;

/**
 * The overview screen, in one request.
 *
 * Every figure here is summed in SQL against the same columns the detail
 * screens use, so a total on the dashboard and the list it came from cannot
 * disagree. Where a number is period-bound it says so, and where it is not —
 * cash in hand, tax still owed — it is deliberately not, because pretending an
 * obligation belongs to a month is how one gets forgotten at the year end.
 */
@Injectable()
export class OverviewService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
    private readonly tds: TdsService,
  ) {}

  async build(query: OverviewQuery): Promise<OverviewReport> {
    const settings = await this.settings.get();
    const mode = settings.fiscalYearMode;
    const fiscalYear = query.fiscalYear ?? currentFiscalYear(mode);

    const all = periodsInFiscalYear(fiscalYear, mode, query.granularity);

    // Asked for nothing in particular, the overview means "now". Defaulting to
    // the first period of the year would open a dashboard on July every August.
    const today = todayInDhaka();
    const index = query.index
      ? Math.min(query.index, all.length) - 1
      : Math.max(
          all.findIndex((p) => p.start <= today && today <= p.end),
          0,
        );

    const range = all[index];
    const before = index > 0 ? all[index - 1] : null;

    const [
      totals,
      previousTotals,
      cashInHand,
      salaryPaid,
      previousSalary,
      funding,
      previousFunding,
      tax,
      outstanding,
      spend,
      income,
      topVendors,
      balances,
      recent,
      headcount,
      months,
      groups,
      toolsSpend,
    ] = await Promise.all([
      this.totalsFor(range),
      before ? this.totalsFor(before) : Promise.resolve(null),
      this.cashInHand(),
      this.salaryPaid(range),
      before ? this.salaryPaid(before) : Promise.resolve("0.00"),
      this.funding(range),
      before ? this.funding(before) : Promise.resolve("0.00"),
      this.taxMoved(range),
      this.taxOutstanding(),
      this.byCategory(range, "out"),
      this.byCategory(range, "in"),
      this.topVendors(range),
      this.balances(),
      this.recent(),
      this.headcount(),
      this.trend(range.end),
      this.accountGroups(range),
      this.toolsAndSubscriptions(range),
    ]);

    /**
     * Every figure now carries its dollars beside it rather than behind a
     * toggle, so the taka is never converted away — `convert` is a no-op and
     * the USD half is produced separately.
     *
     * The rate is the month's own: money that arrives from abroad arrives at a
     * known rate, and everything spent afterwards is spending that money. The
     * settings rate is reached only when nothing was funded in the period.
     */
    const tableFx = await this.fx.contextFor(range);
    // One resolver, not a rule reimplemented here: funded rate, then the rate
    // set in Settings, then the table. `FxService.governingRateFor` is the
    // only place that order is written down.
    const governing = await this.fx.governingRateFor(range);
    const usdRate = governing?.rate ?? null;

    /**
     * The context reported to the caller, describing the rate actually used.
     *
     * `contextFor` only knows what the rate *table* holds, so on a month
     * funded from abroad — or one falling back to the Settings rate — it can
     * come back `unavailable: true` with the caption "no exchange rate on
     * record for this period". Returned unchanged beside a populated `usdRate`
     * and a full set of dollar figures, that is a response arguing with
     * itself, and any screen rendering `fx.caption` would print "not
     * converted" over converted numbers.
     */
    const fx =
      governing && tableFx.unavailable
        ? {
            ...tableFx,
            rate: governing.rate,
            unavailable: false,
            caption: `translated at ${trimRate(governing.rate)} — ${GOVERNING_RATE_LABELS[governing.source]}`,
          }
        : tableFx;

    const currency = "BDT" as const;
    const convert = (value: string) => value;
    const convertLine = <T extends { total: string }>(line: T) => ({ ...line });
    /**
     * The approximate dollars beside a taka figure, or null with no rate.
     *
     * `unavailable: false` is not cosmetic. `fx` describes what the *rate
     * table* could answer, and `convert` refuses outright when that flag is
     * set. But a month funded from abroad has a rate whether or not anybody
     * ever filled in Settings — `fundingRateFor` found it on the transfer
     * itself. Spreading `fx` unchanged carried its "no rate" verdict into a
     * call that does have one, so every dollar figure came back null while the
     * heading above them read "dollars shown at 118.30 per USD".
     *
     * Rebuilt rather than spread through, so the two can no longer disagree:
     * if `usdRate` is set the conversion happens, and if it is not, nothing is
     * shown at all.
     */
    const usd = (value: string): string | null =>
      usdRate
        ? (FxService.convert(value, {
            ...fx,
            rate: usdRate,
            unavailable: false,
          }) ?? null)
        : null;

    return {
      period: {
        label: range.label,
        start: range.start,
        end: range.end,
        granularity: query.granularity,
      },
      currency,
      fx,
      usdRate,
      usdRateSource: governing?.source ?? null,
      totals: {
        moneyIn: convert(totals.moneyIn),
        moneyOut: convert(totals.moneyOut),
        net: convert(totals.net),
        entries: totals.entries,
        cashInHand: convert(cashInHand),
        salaryPaid: convert(salaryPaid),
        fundingReceived: convert(funding),
        taxWithheld: convert(tax.withheld),
        taxDeposited: convert(tax.deposited),
        taxOutstanding: convert(outstanding),
      },
      previous:
        previousTotals && before
          ? {
              label: before.label,
              moneyIn: convert(previousTotals.moneyIn),
              moneyOut: convert(previousTotals.moneyOut),
              net: convert(previousTotals.net),
              salaryPaid: convert(previousSalary),
              fundingReceived: convert(previousFunding),
            }
          : null,
      months: months.map((month) => ({
        ...month,
        moneyIn: convert(month.moneyIn),
        moneyOut: convert(month.moneyOut),
        net: convert(month.net),
        closingBalance: convert(month.closingBalance),
      })),
      spendByCategory: spend.map(convertLine),
      incomeByCategory: income.map(convertLine),
      topVendors: topVendors.map(convertLine),
      balances: balances.map((account) => ({
        ...account,
        balance: convert(account.balance),
      })),
      recent: recent.map((entry) => ({
        ...entry,
        amount: convert(entry.amount),
      })),
      groups: groups.map((group) => {
        const opening = usd(group.opening);
        const moneyIn = usd(group.moneyIn);
        const moneyOut = usd(group.moneyOut);

        return {
          ...group,
          usd: {
            opening,
            moneyIn,
            moneyOut,
            /**
             * Derived from the other three, not converted on its own.
             *
             * Each conversion rounds to the paisa independently, so four
             * separate divisions are not obliged to satisfy
             * `opening + in − out = closing` — and at some rates they do not:
             * 23,120.67 + 5,185.19 − 2,222.22 comes to 26,083.64 while
             * dividing the taka closing gives 26,083.63. One paisa, on the
             * four figures whose whole job is to read as a sentence that adds
             * up. The taka closing is exact and stays exact; only its dollar
             * translation is made to agree with the dollars above it.
             */
            closing:
              opening !== null && moneyIn !== null && moneyOut !== null
                ? (
                    Number(opening) +
                    Number(moneyIn) -
                    Number(moneyOut)
                  ).toFixed(2)
                : usd(group.closing),
          },
        };
      }),
      expense: {
        salaryPaid,
        toolsAndSubscriptions: toolsSpend,
        taxWithheld: tax.withheld,
        taxOutstanding: outstanding,
        usd: {
          salaryPaid: usd(salaryPaid),
          toolsAndSubscriptions: usd(toolsSpend),
          taxWithheld: usd(tax.withheld),
          taxOutstanding: usd(outstanding),
        },
      },
      headcount,
    };
  }

  /* ---------------------------------------------------------------------- */

  private async totalsFor(range: PeriodRange) {
    const [row] = await this.db.client
      .select({
        moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
        moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(inPeriod(range));

    return {
      moneyIn: row.moneyIn,
      moneyOut: row.moneyOut,
      net: (Number(row.moneyIn) - Number(row.moneyOut)).toFixed(2),
      entries: Number(row.entries),
    };
  }

  /**
   * What is actually in the accounts, today.
   *
   * Not period-bound and not a sum of the period's net: a balance is every
   * opening balance plus everything that has ever moved, which is the figure
   * somebody compares against a bank app.
   */
  private async cashInHand(): Promise<string> {
    const [opening] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${accounts.openingBalance}), 0)::text`,
      })
      .from(accounts)
      .where(isNull(accounts.deletedAt));

    const [moved] = await this.db.client
      .select({
        net: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
      })
      .from(transactions)
      .where(LIVE);

    return (Number(opening.total) + Number(moved.net)).toFixed(2);
  }

  /**
   * Salary that left the bank, taken from the ledger rather than the payroll
   * sheet.
   *
   * A finalised run is an intention; the ledger row is the money. Reading the
   * sheet would show pay as "spent" in the month it was calculated, which is
   * not the month the bank saw it.
   */
  private async salaryPaid(range: PeriodRange): Promise<string> {
    const [row] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          inPeriod(range),
          eq(transactions.direction, "out"),
          eq(transactions.createdVia, "payroll"),
        ),
      );

    return Number(row.total).toFixed(2);
  }

  /** BDT that landed from a foreign remittance — what the CEO sent, as received. */
  private async funding(range: PeriodRange): Promise<string> {
    const [row] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          inPeriod(range),
          eq(transactions.direction, "in"),
          sql`${transactions.originalCurrency} is not null`,
        ),
      );

    return Number(row.total).toFixed(2);
  }

  private async taxMoved(range: PeriodRange) {
    const [withheld] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.withheldTaxAmount}), 0)::text`,
      })
      .from(transactions)
      .where(and(inPeriod(range), eq(transactions.direction, "out")));

    const [deposited] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${tdsDeposits.amount}), 0)::text`,
      })
      .from(tdsDeposits)
      .where(
        and(
          gte(tdsDeposits.depositDate, range.start),
          lte(tdsDeposits.depositDate, range.end),
        ),
      );

    return {
      withheld: Number(withheld.total).toFixed(2),
      deposited: Number(deposited.total).toFixed(2),
    };
  }

  /**
   * Held back and not yet handed to the treasury, all time.
   *
   * Delegated to `TdsService`, which is where the TDS screen's own figure comes
   * from. This used to be a local copy that counted only vendor withholding
   * against every challan including the salary ones, so it reported 0.00 while
   * the TDS screen reported the real ৳10,800 — two screens disagreeing about
   * one obligation. There is one implementation now.
   */
  private taxOutstanding(): Promise<string> {
    return this.tds.outstandingAllTime();
  }

  /**
   * Every account, each with where it started, what moved, and where it stands.
   *
   * One block per account. It used to be two — every taka account summed into
   * "BD Bank overview", the dollar ones into "Card overview" — which put the
   * bank, the card and the petty cash tin behind a single set of four figures
   * with their names listed in grey beside it. The owner has two accounts and
   * saw one row: the question "what is on the card" had no answer on the
   * screen that exists to answer it.
   *
   * Opening is the account's own opening balance plus everything that moved
   * before the period, so `opening + in - out` lands exactly on `closing`. The
   * four tiles in a block have to tie together or they are four unrelated
   * numbers in a box.
   *
   * Soft-deleted accounts are out; archived ones are not. An account somebody
   * stopped using still holds whatever it held, and a dashboard that quietly
   * drops a balance is worse than one carrying a block nobody looks at.
   */
  private async accountGroups(
    range: PeriodRange,
  ): Promise<Array<Omit<AccountGroup, "usd">>> {
    const rows = await this.db.client
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        currency: accounts.currency,
        opening: accounts.openingBalance,
      })
      .from(accounts)
      .where(isNull(accounts.deletedAt))
      .orderBy(accounts.sortOrder, accounts.name);

    if (!rows.length) return [];

    const [movedBefore, inPeriodRows] = await Promise.all([
      this.db.client
        .select({
          accountId: transactions.accountId,
          net: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
        })
        .from(transactions)
        .where(and(sql`${transactions.txnDate} < ${range.start}`, LIVE))
        .groupBy(transactions.accountId),

      this.db.client
        .select({
          accountId: transactions.accountId,
          moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
          moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
        })
        .from(transactions)
        .where(inPeriod(range))
        .groupBy(transactions.accountId),
    ]);

    const before = new Map(
      movedBefore.map((r) => [r.accountId, Number(r.net)]),
    );
    const during = new Map(
      inPeriodRows.map((r) => [
        r.accountId,
        { in: Number(r.moneyIn), out: Number(r.moneyOut) },
      ]),
    );

    return rows.map((account) => {
      const opening = Number(account.opening) + (before.get(account.id) ?? 0);
      const movement = during.get(account.id);
      const moneyIn = movement?.in ?? 0;
      const moneyOut = movement?.out ?? 0;

      return {
        key: account.id,
        label: account.name,
        type: account.type,
        currency: account.currency,
        opening: opening.toFixed(2),
        moneyIn: moneyIn.toFixed(2),
        moneyOut: moneyOut.toFixed(2),
        closing: (opening + moneyIn - moneyOut).toFixed(2),
      };
    });
  }

  /**
   * What went on tooling: anything paid to a vendor that recurs, plus anything
   * settled on the card.
   *
   * One query with an OR rather than two summed together — a Vercel bill on
   * the card is both, and adding two counts would double it.
   *
   * The predicate is shared with the AI tools screen. Two hand-written copies
   * of "what counts as tooling" drift the first time somebody adds a vendor
   * type, and then the dashboard and the screen quietly disagree.
   */
  private async toolsAndSubscriptions(range: PeriodRange): Promise<string> {
    const [row] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,
      })
      .from(transactions)
      .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(
        and(inPeriod(range), eq(transactions.direction, "out"), isToolSpend()),
      );

    return Number(row.total).toFixed(2);
  }

  /** Grouped by the top-level category — thirty rows answer nothing. */
  private async byCategory(
    range: PeriodRange,
    direction: "in" | "out",
  ): Promise<CategoryLine[]> {
    const parent = sql`coalesce(${categories.parentId}, ${categories.id})`;

    const rows = await this.db.client
      .select({
        id: sql<string | null>`${parent}::text`,
        name: sql<string | null>`max(${categories.name})`,
        color: sql<string | null>`max(${categories.color})`,
        total: sql<string>`sum(${transactions.amount})::text`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(inPeriod(range), eq(transactions.direction, direction)))
      .groupBy(sql`1`);

    if (!rows.length) return [];

    // The heading's own name, not whichever sub-category sorted highest.
    const headings = await this.headingNames(
      rows.map((r) => r.id).filter((id): id is string => Boolean(id)),
    );

    const total = rows.reduce((sum, r) => sum + Number(r.total), 0);

    return rows
      .map((row) => {
        const heading = row.id ? headings.get(row.id) : undefined;
        return {
          id: row.id,
          name: heading?.name ?? row.name ?? "Uncategorised",
          color: heading?.color ?? row.color ?? null,
          total: Number(row.total).toFixed(2),
          share: total > 0 ? (Number(row.total) / total) * 100 : 0,
        };
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
  }

  private async headingNames(ids: string[]) {
    if (!ids.length)
      return new Map<string, { name: string; color: string | null }>();

    const rows = await this.db.client
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
      })
      .from(categories)
      .where(sql`${categories.id} in ${ids}`);

    return new Map(rows.map((r) => [r.id, { name: r.name, color: r.color }]));
  }

  /** Who took the most money out of the building this period. */
  private async topVendors(range: PeriodRange): Promise<OverviewVendor[]> {
    const rows = await this.db.client
      .select({
        name: vendors.name,
        total: sql<string>`sum(${transactions.amount})::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .innerJoin(vendors, eq(transactions.vendorId, vendors.id))
      .where(and(inPeriod(range), eq(transactions.direction, "out")))
      .groupBy(vendors.name)
      .orderBy(sql`sum(${transactions.amount}) desc`)
      .limit(6);

    return rows.map((row) => ({
      name: row.name,
      total: Number(row.total).toFixed(2),
      entries: Number(row.entries),
    }));
  }

  /**
   * Every account and what is in it.
   *
   * A left join and a group by, not a correlated subquery: written as a
   * subquery, both `account_id` and `id` resolve against the same table and
   * the condition is never true, which shows every account at its opening
   * balance and looks entirely plausible.
   */
  private async balances() {
    const rows = await this.db.client
      .select({
        id: accounts.id,
        name: accounts.name,
        type: accounts.type,
        currency: accounts.currency,
        opening: accounts.openingBalance,
        moved: sql<string>`coalesce(sum(${transactions.signedAmount}) filter (where ${transactions.voidedAt} is null), 0)::text`,
      })
      .from(accounts)
      .leftJoin(transactions, eq(transactions.accountId, accounts.id))
      .where(isNull(accounts.deletedAt))
      .groupBy(
        accounts.id,
        accounts.name,
        accounts.type,
        accounts.currency,
        accounts.openingBalance,
      )
      .orderBy(accounts.name);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      balance: (Number(row.opening) + Number(row.moved)).toFixed(2),
    }));
  }

  private async recent(): Promise<OverviewEntry[]> {
    const rows = await this.db.client
      .select({
        id: transactions.id,
        refNo: transactions.refNo,
        txnDate: transactions.txnDate,
        description: transactions.description,
        direction: transactions.direction,
        amount: transactions.amount,
        categoryName: categories.name,
        vendorName: vendors.name,
        accountName: accounts.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(vendors, eq(transactions.vendorId, vendors.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(LIVE)
      .orderBy(desc(transactions.txnDate), desc(transactions.createdAt))
      .limit(8);

    return rows.map((row) => ({
      id: row.id,
      refNo: row.refNo,
      txnDate: row.txnDate,
      description: row.description,
      direction: row.direction,
      amount: row.amount,
      categoryName: row.categoryName,
      vendorName: row.vendorName,
      accountName: row.accountName,
    }));
  }

  private async headcount() {
    const rows = await this.db.client
      .select({
        engagement: teamMembers.engagementType,
        total: sql<number>`count(*)::int`,
      })
      .from(teamMembers)
      .where(
        and(eq(teamMembers.status, "active"), isNull(teamMembers.deletedAt)),
      )
      .groupBy(teamMembers.engagementType);

    return {
      employees: Number(
        rows.find((r) => r.engagement === "employee")?.total ?? 0,
      ),
      contractors: Number(
        rows.find((r) => r.engagement === "contractor")?.total ?? 0,
      ),
    };
  }

  /**
   * Twelve months to the end of the period, each with its closing balance.
   *
   * One query for the movements and one for the opening position, rather than
   * twelve round trips — the running balance is then carried forward in code
   * from a single starting figure.
   */
  private async trend(endDate: string): Promise<MonthStat[]> {
    const end = monthRange(
      Number(endDate.slice(0, 4)),
      Number(endDate.slice(5, 7)),
    );

    const ranges: PeriodRange[] = [];
    let year = Number(end.start.slice(0, 4));
    let month = Number(end.start.slice(5, 7));
    for (let i = 0; i < TREND_MONTHS; i++) {
      ranges.unshift(monthRange(year, month));
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }

    const first = ranges[0];

    const [openingRow] = await this.db.client
      .select({
        total: sql<string>`coalesce(sum(${accounts.openingBalance}), 0)::text`,
      })
      .from(accounts)
      .where(isNull(accounts.deletedAt));

    const [movedBefore] = await this.db.client
      .select({
        net: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
      })
      .from(transactions)
      .where(and(sql`${transactions.txnDate} < ${first.start}`, LIVE));

    const rows = await this.db.client
      .select({
        month: sql<string>`to_char(${transactions.txnDate}, 'YYYY-MM')`,
        moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
        moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.txnDate, first.start),
          lte(transactions.txnDate, ranges[ranges.length - 1].end),
          LIVE,
        ),
      )
      .groupBy(sql`1`);

    const byMonth = new Map(rows.map((r) => [r.month, r]));

    let running = Number(openingRow.total) + Number(movedBefore.net);
    let previousIn: number | null = null;
    let previousOut: number | null = null;

    return ranges.map((range) => {
      const key = range.start.slice(0, 7);
      const row = byMonth.get(key);
      const moneyIn = Number(row?.moneyIn ?? 0);
      const moneyOut = Number(row?.moneyOut ?? 0);
      running += moneyIn - moneyOut;

      const stat: MonthStat = {
        year: Number(range.start.slice(0, 4)),
        month: Number(range.start.slice(5, 7)),
        label: range.label,
        moneyIn: moneyIn.toFixed(2),
        moneyOut: moneyOut.toFixed(2),
        net: (moneyIn - moneyOut).toFixed(2),
        closingBalance: running.toFixed(2),
        entries: Number(row?.entries ?? 0),
        inChange: change(previousIn, moneyIn),
        outChange: change(previousOut, moneyOut),
      };

      previousIn = moneyIn;
      previousOut = moneyOut;
      return stat;
    });
  }
}

/* -------------------------------------------------------------------------- */

function inPeriod(range: PeriodRange) {
  return and(
    gte(transactions.txnDate, range.start),
    lte(transactions.txnDate, range.end),
    LIVE,
  );
}

/** Null rather than Infinity when there was nothing to grow from. */
function change(previous: number | null, current: number): number | null {
  if (previous === null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** "118.300000" is a database column; "118.30" is a rate somebody reads. */
function trimRate(rate: string): string {
  const value = Number(rate);
  return Number.isFinite(value) ? value.toFixed(2) : rate;
}
