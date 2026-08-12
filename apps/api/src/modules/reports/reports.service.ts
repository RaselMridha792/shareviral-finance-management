import { Injectable } from "@nestjs/common";
import {
  currentFiscalYear,
  monthRange,
  periodsInFiscalYear,
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
} from "@finance/shared";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";

import { DbService } from "../../db/db.service";
import { accounts, categories, transactions } from "../../db/schema";
import { FxService } from "../fx/fx.service";
import { SettingsService } from "../settings/settings.service";

/** Never count a voided row. It stays visible; it is not money. */
const LIVE = isNull(transactions.voidedAt);

@Injectable()
export class ReportsService {
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
    const fx =
      query.currency === "USD" ? await this.fx.contextFor(range) : null;

    const convert = (value: string) =>
      query.currency === "USD"
        ? (FxService.convert(value, fx) ?? value)
        : value;

    return {
      label: range.label,
      start: range.start,
      end: range.end,
      currency: query.currency,
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

  /** Which periods a picker can offer, so the UI never invents one. */
  async availablePeriods(granularity: PeriodQuery["granularity"]) {
    const settings = await this.settings.get();
    const mode = settings.fiscalYearMode;
    const thisYear = currentFiscalYear(mode);

    return {
      fiscalYearMode: mode,
      years: [thisYear + 1, thisYear, thisYear - 1, thisYear - 2],
      periods: periodsInFiscalYear(thisYear, mode, granularity).map(
        (range, i) => ({
          index: i + 1,
          label: range.label,
          start: range.start,
          end: range.end,
        }),
      ),
    };
  }

  private async totalsFor(range: PeriodRange) {
    const [row] = await this.db.client
      .select({
        moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${transactions.amount} else 0 end), 0)::text`,
        moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${transactions.amount} else 0 end), 0)::text`,
        entries: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(
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
  private async balanceAsOf(date: string): Promise<string> {
    const [row] = await this.db.client
      .select({
        opening: sql<string>`coalesce(sum(${accounts.openingBalance}), 0)::text`,
      })
      .from(accounts)
      .where(isNull(accounts.deletedAt));

    const [moved] = await this.db.client
      .select({
        net: sql<string>`coalesce(sum(${transactions.signedAmount}), 0)::text`,
      })
      .from(transactions)
      .where(and(sql`${transactions.txnDate} < ${date}`, LIVE));

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
        ? await this.fx.contextFor({
            start: `${query.year}-01-01`,
            end: `${query.year}-12-31`,
          })
        : null;
    const convert = (v: string) =>
      query.currency === "USD" ? (FxService.convert(v, fx) ?? v) : v;

    // Opening balance at the start of the year, then rolled forward month by
    // month — one query rather than twelve.
    let running = Number(await this.balanceAsOf(`${query.year}-01-01`));

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
      currency: query.currency,
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

    const remittances: Remittance[] = [];
    for (const row of rows) {
      const usd = Number(row.usdSent);
      const bdt = Number(row.bdtReceived);
      const realised = usd > 0 ? bdt / usd : 0;

      // The market rate that day, if one was ever recorded — the gap between
      // that and what landed is what the transfer cost.
      const market = await this.marketRateOn(row.txnDate);

      remittances.push({
        id: row.id,
        refNo: row.refNo,
        txnDate: row.txnDate,
        description: row.description,
        accountName: row.accountName,
        usdSent: usd.toFixed(2),
        bdtReceived: bdt.toFixed(2),
        realisedRate: realised.toFixed(4),
        marketRate: market,
        spread: market ? (usd * Number(market) - bdt).toFixed(2) : null,
      });
    }

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

  private async marketRateOn(date: string): Promise<string | null> {
    const context = await this.fx.contextFor({ start: date, end: date });
    return context.unavailable ? null : context.rate;
  }
}

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
