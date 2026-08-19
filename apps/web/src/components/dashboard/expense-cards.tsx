"use client";

import type { OverviewReport } from "@finance/shared";

/**
 * What a card on the expense row can show.
 *
 * The row used to be four fixed tiles, and which four was a decision made once,
 * by me, for a company whose spending I do not watch. Every one of these is a
 * figure the report already carries — nothing here asks the server for
 * anything new, which is why the chooser can be as long as it is without
 * costing a request.
 */
export type CardSpec = {
  key: string;
  label: string;
  /** For the chooser, which groups options under a heading. */
  group: "Spending" | "Tax" | "Position" | "By category";
  /**
   * A Material Symbols name, and the colour its meaning gives it.
   *
   * Coloured by what the figure IS — green for money arriving, red for money
   * leaving, amber for tax, lime for a balance — rather than to decorate. A row
   * of four identically grey icons tells a reader nothing they could not get
   * from the labels.
   */
  symbol: string;
  iconTone: string;
  accent?: "muted" | "primary" | "positive" | "negative" | "warning";
  tone?: "in" | "out" | "neutral";
  value: string;
  usd?: string | null;
  hint?: string;
  /** Only where a comparable figure for the period before actually exists. */
  change?: number | null;
  risingIsGood?: boolean;
};

/**
 * The four the dashboard opens on.
 *
 * "Tax withheld" is TDS by name now — it is the only withholding this company
 * does and the accountant, the challan and the return all call it TDS, so the
 * generic word was the app translating out of its users' vocabulary. "Tax not
 * yet deposited" is off the row: it is an all-time obligation sitting in a row
 * of period figures, which is exactly the kind of quiet mismatch that gets a
 * number read as this month's. It is still available in the chooser, labelled
 * so the difference is visible.
 *
 * Total spent takes the fourth place. It is the figure the other three are
 * parts of, so the row reads as a whole and its parts rather than as three
 * unrelated headings.
 */
export const DEFAULT_CARDS = [
  "salaryPaid",
  "tools",
  "tdsWithheld",
  "moneyOut",
] as const;

/** More than this and they stop being a glance and start being a table. */
export const MAX_CARDS = 8;

/**
 * A taka figure in dollars, at the rate this period's report was built with.
 *
 * The four original cards get their dollar line from the server, which
 * converted them with `report.usdRate`. Everything the chooser added — total
 * spent, money in, cash in hand, every spend heading — had no such field, so
 * those cards rendered with no dollar line at all while the four beside them
 * had one. On a page whose whole rule is "every taka figure carries its
 * dollars", four cards keeping the rule and four breaking it is worse than
 * either.
 *
 * The same rate as the server used, deliberately: two cards on one row
 * translated at two different rates would not add up, and somebody would
 * eventually try to add them.
 *
 * Null when no rate is on file — the dollar line is then absent everywhere,
 * which is the honest outcome and already what the four do.
 */
function inUsd(value: string, rate: string | null): string | null {
  if (!rate) return null;
  const perDollar = Number(rate);
  const amount = Number(value);
  if (!Number.isFinite(perDollar) || perDollar <= 0) return null;
  if (!Number.isFinite(amount)) return null;
  return (amount / perDollar).toFixed(2);
}

export function buildCatalogue(
  report: OverviewReport,
  previous: OverviewReport["previous"],
  money: (value: string, options?: { hideDecimals?: boolean }) => string,
): CardSpec[] {
  const { expense, totals, usdRate } = report;
  const usd = expense.usd;
  const dollars = (value: string) => inUsd(value, usdRate);

  const fixed: CardSpec[] = [
    {
      key: "salaryPaid",
      label: "Salary paid",
      group: "Spending",
      symbol: "groups",
      iconTone: "text-chart-1",
      value: expense.salaryPaid,
      usd: usd.salaryPaid,
      change: percentChange(expense.salaryPaid, previous?.salaryPaid),
      risingIsGood: false,
      hint: `${report.headcount.employees} on payroll`,
    },
    {
      key: "tools",
      label: "AI & other tools",
      group: "Spending",
      symbol: "auto_awesome",
      iconTone: "text-chart-6",
      value: expense.toolsAndSubscriptions,
      usd: usd.toolsAndSubscriptions,
      hint: "subscriptions and the card",
    },
    {
      key: "moneyOut",
      label: "Total spent",
      group: "Spending",
      symbol: "trending_down",
      iconTone: "text-negative",
      tone: "out",
      accent: "negative",
      value: totals.moneyOut,
      usd: dollars(totals.moneyOut),
      change: percentChange(totals.moneyOut, previous?.moneyOut),
      risingIsGood: false,
      hint: `${totals.entries} entries this period`,
    },
    {
      key: "moneyIn",
      label: "Money in",
      group: "Position",
      symbol: "savings",
      iconTone: "text-positive",
      tone: "in",
      accent: "positive",
      value: totals.moneyIn,
      usd: dollars(totals.moneyIn),
      change: percentChange(totals.moneyIn, previous?.moneyIn),
    },
    {
      key: "net",
      label: "Net for the period",
      group: "Position",
      symbol: "balance",
      iconTone: "text-chart-5",
      value: totals.net,
      usd: dollars(totals.net),
      change: percentChange(totals.net, previous?.net),
      hint: "in minus out",
    },
    {
      key: "cashInHand",
      label: "Cash in hand",
      group: "Position",
      symbol: "account_balance_wallet",
      iconTone: "text-primary-text",
      accent: "primary",
      value: totals.cashInHand,
      usd: dollars(totals.cashInHand),
      // Said out loud because it is the one figure on a row of period figures
      // that is not one. Every account, every entry, all time.
      hint: "every account, all time",
    },
    {
      key: "funding",
      label: "Funding received",
      group: "Position",
      symbol: "account_balance",
      iconTone: "text-chart-1",
      tone: "in",
      accent: "positive",
      value: totals.fundingReceived,
      usd: dollars(totals.fundingReceived),
      change: percentChange(totals.fundingReceived, previous?.fundingReceived),
      hint: "landed from the CEO",
    },
    {
      key: "tdsWithheld",
      label: "TDS withheld",
      group: "Tax",
      symbol: "receipt_long",
      iconTone: "text-negative",
      value: expense.taxWithheld,
      usd: usd.taxWithheld,
      hint: `${money(totals.taxDeposited, { hideDecimals: true })} deposited`,
    },
    {
      key: "tdsDeposited",
      label: "TDS deposited",
      group: "Tax",
      symbol: "payments",
      iconTone: "text-chart-1",
      value: totals.taxDeposited,
      usd: dollars(totals.taxDeposited),
      hint: "by challan, this period",
    },
    {
      key: "tdsOutstanding",
      label: "TDS still held",
      group: "Tax",
      symbol: "event_upcoming",
      iconTone: "text-warning",
      value: expense.taxOutstanding,
      usd: usd.taxOutstanding,
      accent: Number(expense.taxOutstanding) > 0 ? "warning" : "muted",
      // The label says "still held" and the hint says since when. It sat on
      // this row reading as a monthly figure when it is an all-time
      // obligation, which is the sort of thing somebody takes to an
      // accountant.
      hint: "all time, not this period",
    },
  ];

  /**
   * One card per spend heading, which is what makes the chooser worth having.
   *
   * A company that wants to watch office rent every month cannot do that from a
   * fixed row of four, and the figures are already on the report — the donut
   * below the row is drawn from this same array.
   *
   * Keyed by id rather than by name so renaming a category does not silently
   * drop somebody's chosen card. The uncategorised bucket has a null id and is
   * skipped: "Uncategorised" is a gap to close, not a heading to watch.
   */
  const categories: CardSpec[] = report.spendByCategory
    .filter((line) => line.id)
    .map((line) => ({
      key: `category:${line.id}`,
      label: line.name,
      group: "By category" as const,
      symbol: "sell",
      iconTone: "text-faint",
      tone: "out" as const,
      value: line.total,
      usd: inUsd(line.total, usdRate),
      hint: `${line.share.toFixed(0)}% of what went out`,
    }));

  return [...fixed, ...categories];
}

/**
 * A card whose figure is not in this period's report.
 *
 * A chosen category drops out of `spendByCategory` the moment a month has no
 * spending under it — so stepping from August to September would make the card
 * vanish, which looks exactly like the app losing the setting. It stays,
 * showing zero, which is the true answer to "what did we spend on office rent
 * in September".
 *
 * The label comes from what was stored when the card was chosen. Without it
 * this said "Nothing this period", which is the one thing a card must not do:
 * be about a heading and not say which.
 */
export function placeholderFor(key: string, label?: string): CardSpec | null {
  if (!key.startsWith("category:")) return null;
  return {
    key,
    label: label ?? "A category with nothing in it",
    group: "By category",
    symbol: "sell",
    iconTone: "text-faint",
    value: "0.00",
    hint: "nothing under this heading in this period",
  };
}

/** Null when there is no previous figure — "+100%" from zero is meaningless. */
function percentChange(
  current: string,
  previous: string | undefined,
): number | null {
  if (previous === undefined) return null;
  const before = Number(previous);
  if (before === 0) return null;
  return ((Number(current) - before) / before) * 100;
}
