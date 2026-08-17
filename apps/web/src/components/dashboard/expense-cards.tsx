"use client";

import type { OverviewReport } from "@finance/shared";
import {
  Banknote,
  CalendarClock,
  Coins,
  HandCoins,
  Landmark,
  Receipt,
  Scale,
  Sparkles,
  Tag,
  TrendingDown,
  Users,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";

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
  icon: ComponentType<{ className?: string }>;
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

export function buildCatalogue(
  report: OverviewReport,
  previous: OverviewReport["previous"],
  money: (value: string, options?: { hideDecimals?: boolean }) => string,
): CardSpec[] {
  const { expense, totals } = report;
  const usd = expense.usd;

  const fixed: CardSpec[] = [
    {
      key: "salaryPaid",
      label: "Salary paid",
      group: "Spending",
      icon: Users,
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
      icon: Sparkles,
      value: expense.toolsAndSubscriptions,
      usd: usd.toolsAndSubscriptions,
      hint: "subscriptions and the card",
    },
    {
      key: "moneyOut",
      label: "Total spent",
      group: "Spending",
      icon: TrendingDown,
      tone: "out",
      accent: "negative",
      value: totals.moneyOut,
      change: percentChange(totals.moneyOut, previous?.moneyOut),
      risingIsGood: false,
      hint: `${totals.entries} entries this period`,
    },
    {
      key: "moneyIn",
      label: "Money in",
      group: "Position",
      icon: HandCoins,
      tone: "in",
      accent: "positive",
      value: totals.moneyIn,
      change: percentChange(totals.moneyIn, previous?.moneyIn),
    },
    {
      key: "net",
      label: "Net for the period",
      group: "Position",
      icon: Scale,
      value: totals.net,
      change: percentChange(totals.net, previous?.net),
      hint: "in minus out",
    },
    {
      key: "cashInHand",
      label: "Cash in hand",
      group: "Position",
      icon: Wallet,
      accent: "primary",
      value: totals.cashInHand,
      // Said out loud because it is the one figure on a row of period figures
      // that is not one. Every account, every entry, all time.
      hint: "every account, all time",
    },
    {
      key: "funding",
      label: "Funding received",
      group: "Position",
      icon: Landmark,
      tone: "in",
      accent: "positive",
      value: totals.fundingReceived,
      change: percentChange(totals.fundingReceived, previous?.fundingReceived),
      hint: "landed from the CEO",
    },
    {
      key: "tdsWithheld",
      label: "TDS withheld",
      group: "Tax",
      icon: Receipt,
      value: expense.taxWithheld,
      usd: usd.taxWithheld,
      hint: `${money(totals.taxDeposited, { hideDecimals: true })} deposited`,
    },
    {
      key: "tdsDeposited",
      label: "TDS deposited",
      group: "Tax",
      icon: Banknote,
      value: totals.taxDeposited,
      hint: "by challan, this period",
    },
    {
      key: "tdsOutstanding",
      label: "TDS still held",
      group: "Tax",
      icon: CalendarClock,
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
      icon: Tag,
      tone: "out" as const,
      value: line.total,
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
    icon: Coins,
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
