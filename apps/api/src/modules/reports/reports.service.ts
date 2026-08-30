import { Injectable, Logger } from "@nestjs/common";
import {
  RECORDS_START,
  currentFiscalYear,
  fiscalYearOf,
  isoDate,
  monthRange,
  periodsInFiscalYear,
  todayInDhaka,
  type BankStats,
  type BankStatsQuery,
  type CategoryLine,
  type FundingQuery,
  type FundingReport,
  type MonthStat,
  type PeriodQuery,
  type PeriodRange,
  type PeriodReport,
  type Remittance,
  GOVERNING_RATE_LABELS,
} from "@finance/shared";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";

import { DbService } from "../../db/db.service";
import { accounts, categories, fxRates, transactions } from "../../db/schema";
import { FxService } from "../fx/fx.service";
import { SettingsService } from "../settings/settings.service";
import { notATransfer } from "../transactions/own-money";

/** Never count a voided row. It stays visible; it is not money. */
const LIVE = isNull(transactions.voidedAt);

@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly fx: FxService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /*  One period, with the one before it for comparison                      */
  /* ---------------------------------------------------------------------- */

  async period(query: PeriodQuery): Promise<PeriodReport> {
    const settings = await this.settings.get();
    const mode = settings.fiscalYearMode;
    const fiscalYear = query.fiscalYear ?? currentFiscalYear(mode);

    const all = periodsInFiscalYear(fiscalYear, mode, query.granularity);
    const index = Math.min(query.index ?? 1, all.length) - 1;
    const range = all[index];
    const before = index > 0 ? all[index - 1] : null;

    const [totals, previousTotals, income, spend, opening] = await Promise.all([
      this.totalsFor(range),
      before ? this.totalsFor(before) : Promise.resolve(null),
      this.byCategory(range, "in"),
      this.byCategory(range, "out"),
      this.balanceAsOf(range.start),
    ]);

    const closing = (Number(opening) + Number(totals.net)).toFixed(2);

    // USD is a translation of these figures, never a second set of books, so
    // the rate is resolved once for the period and carried with the answer.
    /**
     * The same rate the dashboard uses, not a second opinion.
     *
     * This asked `contextFor` directly, which knows only what the rate table
     * holds — so one taka figure got different dollar answers depending on
     * which screen you opened. August's ৳11,83,000 was $10,000 on the
     * dashboard (the rate the month was funded at, 118.30) and $9,657.14 here
     * (the fixed rate in Settings, 122.50). Both screens matched their own
     * endpoint; the endpoints disagreed. `governingRateFor` is the one place
     * the order is written down.
     */
    const fx = query.currency === "USD" ? await this.fxForPeriod(range) : null;

    // If the translation could not happen, the answer is taka and says so.
    // Returning unconverted figures still labelled USD is how a screen ends up
    // rendering a taka amount behind a dollar sign — a number 118 times wrong,
    // with nothing on the page to suggest it.
    const currency = fx?.unavailable ? "BDT" : query.currency;
    const convert = (value: string) =>
      currency === "USD" ? (FxService.convert(value, fx) ?? value) : value;

    return {
      label: range.label,
      start: range.start,
      end: range.end,
      currency,
      fx,
      moneyIn: convert(totals.moneyIn),
      moneyOut: convert(totals.moneyOut),
      net: convert(totals.net),
      entries: totals.entries,
      openingBalance: convert(opening),
      closingBalance: convert(closing),
      incomeByCategory: income.map((line) => ({
        ...line,
        total: convert(line.total),
      })),
      spendByCategory: spend.map((line) => ({
        ...line,
        total: convert(line.total),
      })),
      previous: previousTotals
        ? {
            label: before!.label,
            moneyIn: convert(previousTotals.moneyIn),
            moneyOut: convert(previousTotals.moneyOut),
            net: convert(previousTotals.net),
          }
        : null,
    };
  }

  /**
   * Which periods a picker can offer, so the UI never invents one.
   *
   * Both ends are now bounded. It used to answer `[thisYear + 1, thisYear,
   * thisYear - 1, thisYear - 2]` — a year that has not begun and two the company
   * did not exist in. Every one of those renders a report of zeroes, and a
   * report of zeroes reads as a finding rather than as an absence.
   *
   * The floor is the fiscal year containing May 2026, not the year 2026:
   * under the July–June setting May 2026 falls in financial year 2025, so
   * flooring at 2026 would hide the company's first two months.
   *
   * Future periods are returned rather than dropped, carrying `selectable:
   * false`. The picker greys them — somebody looking for September needs to see
   * that September exists and has not happened, instead of wondering whether
   * the app has lost it.
   */
  async availablePeriods(granularity: PeriodQuery["granularity"]) {
    const settings = await this.settings.get();
    const mode = settings.fiscalYearMode;
    const thisYear = currentFiscalYear(mode);

    const firstRecordedDay = isoDate(
      RECORDS_START.year,
      RECORDS_START.month,
      1,
    );
    const firstYear = fiscalYearOf(firstRecordedDay, mode);

    const years: number[] = [];
    for (let year = thisYear; year >= firstYear; year--) years.push(year);

    const today = todayInDhaka();

    return {
      fiscalYearMode: mode,
      years,
      periods: periodsInFiscalYear(thisYear, mode, granularity).map(
        (range, i) => ({
          index: i + 1,
          label: range.label,
          start: range.start,
          end: range.end,
          // A period that has not started yet, or one that ended before the
          // books did. The period in progress is selectable: it is the one
          // everybody works in.
          selectable: range.start <= today && range.end >= firstRecordedDay,
        }),
      ),
    };
  }

  private async totalsFor(range: PeriodRange) {
    // The company's own money — transfers between our accounts are not it.
    const [row] = await this.db.client
      .select({
        moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
        moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          notATransfer(),
          gte(transactions.txnDate, range.start),
          lte(transactions.txnDate, range.end),
          LIVE,
        ),
      );

    return {
      moneyIn: row.moneyIn,
      moneyOut: row.moneyOut,
      net: (Number(row.moneyIn) - Number(row.moneyOut)).toFixed(2),
      entries: Number(row.entries),
    };
  }

  /**
   * Grouped by the **top-level** category, not the sub-category.
   *
   * A report with thirty rows answers nothing. Rent and electricity both roll
   * up to "Office & premises"; the detail is one click away on the expenses
   * screen, where it is the point.
   */
  private async byCategory(
    range: PeriodRange,
    direction: "in" | "out",
  ): Promise<CategoryLine[]> {
    const parent = sql`coalesce(${categories.parentId}, ${categories.id})`;

    const rows = await this.db.client
      .select({
        id: sql<string | null>`${parent}::text`,
        total: sql<string>`sum(${transactions.amount})::text`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          gte(transactions.txnDate, range.start),
          lte(transactions.txnDate, range.end),
          eq(transactions.direction, direction),
          LIVE,
        ),
      )
      .groupBy(sql`1`);

    if (!rows.length) return [];

    const named = await this.nameCategories(
      rows.map((r) => r.id).filter((id): id is string => Boolean(id)),
    );

    const total = rows.reduce((sum, r) => sum + Number(r.total), 0);

    return rows
      .map((row) => {
        const meta = row.id ? named.get(row.id) : undefined;
        return {
          id: row.id,
          name: meta?.name ?? "Uncategorised",
          color: meta?.color ?? null,
          total: Number(row.total).toFixed(2),
          share: total > 0 ? (Number(row.total) / total) * 100 : 0,
        };
      })
      .sort((a, b) => Number(b.total) - Number(a.total));
  }

  private async nameCategories(ids: string[]) {
    if (!ids.length)
      return new Map<string, { name: string; color: string | null }>();

    const rows = await this.db.client
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
      })
      .from(categories)
      .where(sql`${categories.id} in ${idList(ids)}`);

    return new Map(rows.map((r) => [r.id, { name: r.name, color: r.color }]));
  }

  /**
   * Every account's opening balance plus everything that moved before `date`.
   *
   * Summed in SQL against the generated `signed_amount` column, so the arithmetic
   * that produces a balance is the same arithmetic the register uses.
   */
  /**
   * The period's FX context, resolved by the app's one rule.
   *
   * `governingRateFor` decides *which* rate governs — the month's funding,
   * then Settings, then the table. `contextFor` still supplies the shape and
   * the sentence that explains it, so the caption keeps naming the source.
   */
  private async fxForPeriod(period: { start: string; end: string }) {
    const context = await this.fx.contextFor(period);
    const governing = await this.fx.governingRateFor(period);

    if (!governing) return context;
    if (!context.unavailable && context.rate === governing.rate) return context;

    return {
      ...context,
      rate: governing.rate,
      unavailable: false,
      caption: `translated at ${trimRate(governing.rate)} — ${GOVERNING_RATE_LABELS[governing.source]}`,
    };
  }

  private async balanceAsOf(date: string, accountId?: string): Promise<string> {
    /**
     * Scoped to the same account as the movements it is rolled forward with.
     *
     * This took no account id: filtered to one account, the opening was still
     * the sum of *every* account's opening while the monthly in/out figures
     * below were account-scoped. The running balance therefore started too
     * high and stayed too high for the whole year — Standard Chartered's
     * "balance after July" read 26,72,983 against a register that closes the
     * same month at 24,45,900, out by exactly the other two accounts'
     * openings. Opening and movement have to describe the same account or the
     * column is not a balance at all.
     */
    const [row] = await this.db.client
      .select({
        opening: sql<string>`coalesce(sum(${accounts.openingBalance}), 0)::text`,
      })
      .from(accounts)
      .where(
        and(
          isNull(accounts.deletedAt),
          accountId ? eq(accounts.id, accountId) : undefined,
        ),
      );

    const [moved] = await this.db.client
      .select({
        net: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
      })
      .from(transactions)
      .where(
        and(
          sql`${transactions.txnDate} < ${date}`,
          LIVE,
          accountId ? eq(transactions.accountId, accountId) : undefined,
        ),
      );

    return (Number(row.opening) + Number(moved.net)).toFixed(2);
  }

  /* ---------------------------------------------------------------------- */
  /*  Month by month, against the month before                               */
  /* ---------------------------------------------------------------------- */

  async bankStats(query: BankStatsQuery): Promise<BankStats> {
    const account = query.accountId
      ? (
          await this.db.client
            .select({ name: accounts.name })
            .from(accounts)
            .where(eq(accounts.id, query.accountId))
            .limit(1)
        )[0]
      : undefined;

    const scope = query.accountId
      ? eq(transactions.accountId, query.accountId)
      : undefined;

    const rows = await this.db.client
      .select({
        month: sql<number>`extract(month from ${transactions.txnDate})::int`,
        moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
        moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          sql`extract(year from ${transactions.txnDate}) = ${query.year}`,
          LIVE,
          scope,
        ),
      )
      .groupBy(sql`1`)
      .orderBy(asc(sql`1`));

    const byMonth = new Map(rows.map((r) => [Number(r.month), r]));

    const fx =
      query.currency === "USD"
        ? await this.fxForPeriod({
            start: `${query.year}-01-01`,
            end: `${query.year}-12-31`,
          })
        : null;
    // As in period(): no rate means the answer is taka, labelled taka.
    const currency = fx?.unavailable ? "BDT" : query.currency;
    const convert = (v: string) =>
      currency === "USD" ? (FxService.convert(v, fx) ?? v) : v;

    // Opening balance at the start of the year, then rolled forward month by
    // month — one query rather than twelve.
    let running = Number(
      await this.balanceAsOf(`${query.year}-01-01`, query.accountId),
    );

    const months: MonthStat[] = [];
    let previous: { moneyIn: string; moneyOut: string } | null = null;

    for (let month = 1; month <= 12; month++) {
      const row = byMonth.get(month);
      const moneyIn = row?.moneyIn ?? "0";
      const moneyOut = row?.moneyOut ?? "0";
      const net = Number(moneyIn) - Number(moneyOut);
      running += net;

      months.push({
        year: query.year,
        month,
        label: monthRange(query.year, month).label,
        moneyIn: convert(Number(moneyIn).toFixed(2)),
        moneyOut: convert(Number(moneyOut).toFixed(2)),
        net: convert(net.toFixed(2)),
        closingBalance: convert(running.toFixed(2)),
        entries: Number(row?.entries ?? 0),
        inChange: percentChange(moneyIn, previous?.moneyIn),
        outChange: percentChange(moneyOut, previous?.moneyOut),
      });

      // Only compare against a month that actually had activity; "+100% on
      // nothing" is not a comparison.
      if (row) previous = { moneyIn, moneyOut };
    }

    const active = months.filter((m) => m.entries > 0);
    const busiest = active.length
      ? active.reduce((a, b) => (b.entries > a.entries ? b : a))
      : null;

    return {
      year: query.year,
      currency,
      fx,
      accountName: account?.name ?? "All accounts",
      months,
      totals: {
        moneyIn: sumOf(months.map((m) => m.moneyIn)),
        moneyOut: sumOf(months.map((m) => m.moneyOut)),
        net: sumOf(months.map((m) => m.net)),
      },
      busiest: busiest
        ? { label: busiest.label, entries: busiest.entries }
        : null,
    };
  }

  /* ---------------------------------------------------------------------- */
  /*  Funding — the one place USD is a fact                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * What the CEO sent against what actually landed.
   *
   * These rates are not translations. Each one is what a specific transfer
   * really achieved after the bank took its cut, recorded at the time and
   * frozen. It is the only honest answer to "what is a dollar worth to us".
   */
  async funding(query: FundingQuery): Promise<FundingReport> {
    const where = [
      eq(transactions.direction, "in"),
      sql`${transactions.originalCurrency} = 'USD'`,
      sql`${transactions.originalAmount} > 0`,
      LIVE,
    ];
    if (query.from) where.push(gte(transactions.txnDate, query.from));
    if (query.to) where.push(lte(transactions.txnDate, query.to));

    const rows = await this.db.client
      .select({
        id: transactions.id,
        refNo: transactions.refNo,
        txnDate: transactions.txnDate,
        description: transactions.description,
        accountName: accounts.name,
        usdSent: transactions.originalAmount,
        bdtReceived: transactions.amount,
        recordedRate: transactions.fxRate,
      })
      .from(transactions)
      .innerJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(and(...where))
      .orderBy(asc(transactions.txnDate));

    // The market rate on each of those days, if one was ever recorded — the gap
    // between that and what landed is what the transfer cost. Resolved for the
    // whole set at once: a rate per remittance is a query per remittance, and a
    // year of funding is not a reason to open sixty round trips.
    const market = await this.marketRatesOn(rows.map((row) => row.txnDate));

    const remittances: Remittance[] = rows.map((row) => {
      const usd = Number(row.usdSent);
      const bdt = Number(row.bdtReceived);
      const realised = usd > 0 ? bdt / usd : 0;
      const rate = market.get(row.txnDate) ?? null;

      return {
        id: row.id,
        refNo: row.refNo,
        txnDate: row.txnDate,
        description: row.description,
        accountName: row.accountName,
        usdSent: usd.toFixed(2),
        bdtReceived: bdt.toFixed(2),
        realisedRate: realised.toFixed(4),
        marketRate: rate,
        spread: rate ? (usd * Number(rate) - bdt).toFixed(2) : null,
      };
    });

    const totalUsd = remittances.reduce((s, r) => s + Number(r.usdSent), 0);
    const totalBdt = remittances.reduce((s, r) => s + Number(r.bdtReceived), 0);

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      remittances,
      totals: {
        usdSent: totalUsd.toFixed(2),
        bdtReceived: totalBdt.toFixed(2),
        // Weighted by size. Averaging the per-transfer rates would let a $200
        // transfer count as much as a $20,000 one.
        averageRate: totalUsd > 0 ? (totalBdt / totalUsd).toFixed(4) : "0",
      },
    };
  }

  /**
   * The market rate for each of a set of days, in one query.
   *
   * This is `fx.contextFor({ start: day, end: day })` per day — the same answer,
   * asked once instead of once per remittance. The rules it reproduces, from
   * FxService:
   *
   * - a fixed rate in Settings governs every day, whatever the calendar holds;
   * - `period_average` across a single day is that day's own average, and falls
   *   through to the rule below when the day has no rate of its own, because an
   *   average of nothing is not an average;
   * - otherwise it is the last rate recorded **on or before** the day — nearest
   *   earlier, not exact match. `current` measures that from today, the other
   *   bases from the day itself;
   * - a day with nothing on or before it has no market rate. Nor does a lookup
   *   that failed: reporting in taka is always possible, and losing the whole
   *   report because the rate table would not answer is not a trade worth
   *   making. The column simply stays blank, exactly as it does today.
   */
  private async marketRatesOn(
    days: string[],
  ): Promise<Map<string, string | null>> {
    const wanted = [...new Set(days)];
    const rates = new Map<string, string | null>();
    if (!wanted.length) return rates;

    try {
      // Inside the try, like the settings read in `FxService.contextFor`. It
      // is a database call too, and if it is the thing that fails, the funding
      // report should still come back in taka with the rate column blank —
      // which is the whole point of the catch below.
      const settings = await this.settings.get();

      if (settings.fxMode === "fixed") {
        const fixed = settings.fxFixedUsdBdt;
        const rate = fixed && Number(fixed) > 0 ? fixed : null;
        for (const day of wanted) rates.set(day, rate);
        return rates;
      }

      const basis = settings.fxReportBasis;
      const averaged = basis === "period_average";
      // `current` asks what a dollar is worth now, so every day resolves
      // against today rather than against itself.
      const today = todayInDhaka();
      const asOf = (day: string) => (basis === "current" ? today : day);

      const result = await this.db.client.execute(sql`
        select
          to_char(wanted.day, 'YYYY-MM-DD') as day,
          ${averaged ? sql`same_day.rate` : sql`null::text`} as same_day_rate,
          ${averaged ? sql`same_day.days` : sql`0`} as same_day_days,
          latest.rate as latest_rate
        from (values ${sql.join(
          wanted.map((day) => sql`(${day}::date, ${asOf(day)}::date)`),
          sql`, `,
        )}) as wanted(day, as_of)
        ${
          averaged
            ? sql`left join lateral (
                select round(avg(${fxRates.rate}), 6)::text as rate,
                       count(*)::int as days
                  from ${fxRates}
                 where ${fxRates.deletedAt} is null
                   and ${fxRates.rateDate} >= wanted.day
                   and ${fxRates.rateDate} <= wanted.day
              ) same_day on true`
            : sql``
        }
        left join lateral (
          select ${fxRates.rate} as rate
            from ${fxRates}
           where ${fxRates.deletedAt} is null
             and ${fxRates.rateDate} <= wanted.as_of
           order by ${fxRates.rateDate} desc
           limit 1
        ) latest on true
      `);

      for (const row of result.rows as unknown as MarketRateRow[]) {
        const average =
          row.same_day_rate && Number(row.same_day_days) > 0
            ? row.same_day_rate
            : null;
        rates.set(row.day, average ?? row.latest_rate ?? null);
      }
    } catch (error) {
      this.log.warn(
        `Could not resolve market rates for ${wanted.length} funding day(s): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      for (const day of wanted) rates.set(day, null);
    }

    return rates;
  }
}

type MarketRateRow = {
  day: string;
  same_day_rate: string | null;
  same_day_days: number | null;
  latest_rate: string | null;
};

/* -------------------------------------------------------------------------- */

function sumOf(values: string[]): string {
  return values.reduce((sum, v) => sum + Number(v), 0).toFixed(2);
}

/** Null when there is nothing to compare against — "+100%" from zero is noise. */
function percentChange(current: string, previous?: string): number | null {
  if (previous === undefined) return null;
  const before = Number(previous);
  if (before === 0) return null;
  return ((Number(current) - before) / before) * 100;
}

/** A uuid list drizzle will inline safely. */
function idList(ids: string[]) {
  return sql`(${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

/** "118.300000" is a database column; "118.30" is a rate somebody reads. */
function trimRate(rate: string): string {
  const value = Number(rate);
  return Number.isFinite(value) ? value.toFixed(2) : rate;
}
