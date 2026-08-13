import type { BillingCycle, VendorType } from "./masters.ts";

/**
 * The tools the company uses, what they usually cost, and what was actually
 * paid for them.
 *
 * There is deliberately no projection in this file. These are bought month by
 * month — some months yes, some months no — so a stored "renews on the 3rd" is
 * a habit, not a schedule, and a monthly total built from it would assert
 * spending that may never happen. Every figure below comes from the ledger,
 * and the stored price is carried only as context: "about $20 a month".
 */

/**
 * How a billing cycle reads once it is a habit rather than a commitment.
 *
 * `BILLING_CYCLE_LABELS` says "Every month", which is a promise nobody made.
 * These say "About monthly", which is what the company actually knows.
 */
export const BILLING_CYCLE_HABIT_LABELS: Record<BillingCycle, string> = {
  none: "As needed",
  monthly: "About monthly",
  quarterly: "About quarterly",
  yearly: "About yearly",
};

export type SubscriptionLine = {
  id: string;
  name: string;
  type: VendorType;
  /** How often it tends to get bought. A habit, not a schedule. */
  billingCycle: BillingCycle;
  /** What it usually costs, in `billingCurrency`. Context, not a bill. */
  billingAmount: string | null;
  billingCurrency: string;
  /** What actually left the accounts for this tool in the period, in BDT. */
  paidThisPeriod: string;
  /** How many ledger entries made that up. */
  entriesThisPeriod: number;
  /** The most recent payment ever recorded against it, period or not. */
  lastPaidOn: string | null;
  /** Where it is usually paid from — the card, most often. */
  billingAccountId: string | null;
  billingAccountName: string | null;
};

export type SubscriptionSummary = {
  /** The period every "this period" figure below is measured over. */
  period: { label: string; start: string; end: string };
  /**
   * Everything that left the accounts on tooling this period.
   *
   * The same rule as the overview's "AI tooling & subscriptions" tile: money
   * out to a tool vendor, or out of a non-taka account. That makes it at least
   * the sum of the lines and sometimes more, because card spend nobody
   * attributed to a named tool is still tooling.
   */
  paidThisPeriod: string;
  /**
   * The part of `paidThisPeriod` that no line below accounts for — card
   * spending nobody attributed to a tool. "0.00" when everything ties out.
   *
   * Computed alongside the total rather than by subtracting in the browser:
   * this is a difference of two ledger figures, and `0.1 + 0.2` has no place
   * in one.
   */
  unattributed: string;
  /** Every tool on the books, by name. */
  lines: SubscriptionLine[];
};

/**
 * Has this one been bought in the period being looked at?
 *
 * Postgres hands back "0.00" for a tool with no entries, which is falsy in
 * neither the string nor the loose-equality sense — the comparison has to be
 * numeric or every tool reads as paid.
 */
export function wasPaidInPeriod(line: SubscriptionLine): boolean {
  return Number(line.paidThisPeriod) > 0;
}
