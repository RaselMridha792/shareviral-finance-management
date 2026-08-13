import { addMonths, type IsoDate } from "./datetime.ts";
import {
  BILLING_CYCLE_MONTHS,
  type BillingCycle,
  type VendorType,
} from "./masters.ts";

/**
 * What a recurring payment costs and when it comes round again.
 *
 * The stored renewal date is an *anchor*, not a promise. Somebody sets "the
 * 3rd, monthly" once and never touches it again; a field that has to be
 * maintained by hand is a field that is wrong within two months. The next date
 * is rolled forward from the anchor every time it is read, so the answer stays
 * correct without anybody doing anything.
 */

/**
 * The next renewal on or after `today`, rolled forward from the anchor.
 *
 * Returns the anchor itself when it is still ahead, null when there is nothing
 * recurring to compute.
 */
export function nextRenewal(
  anchor: IsoDate | null | undefined,
  cycle: BillingCycle,
  today: IsoDate,
): IsoDate | null {
  if (!anchor) return null;
  const step = BILLING_CYCLE_MONTHS[cycle];
  if (!step) return null;
  if (anchor >= today) return anchor;

  let date = anchor;
  // Jump most of the way in one go rather than stepping month by month from a
  // date that might be years old.
  const monthsApart =
    (Number(today.slice(0, 4)) - Number(date.slice(0, 4))) * 12 +
    (Number(today.slice(5, 7)) - Number(date.slice(5, 7)));
  const jumps = Math.floor(monthsApart / step);
  if (jumps > 0) date = addMonths(date, jumps * step);

  // Guard rather than `while (true)`: a corrupt anchor should not hang a
  // request. Two extra steps is more than any rounding can need.
  for (let i = 0; i < 3 && date < today; i++) {
    date = addMonths(date, step);
  }

  return date;
}

/**
 * What one subscription costs per month, so a yearly and a monthly one can sit
 * in the same total.
 *
 * A twelfth of the annual figure is an average, not a bill — it is the right
 * number for "what are we committed to each month" and the wrong one for "what
 * leaves the account in March". Only ever used for the former.
 */
export function monthlyEquivalent(
  amount: string | null | undefined,
  cycle: BillingCycle,
): number {
  const months = BILLING_CYCLE_MONTHS[cycle];
  if (!amount || !months) return 0;
  const value = Number(amount);
  return Number.isFinite(value) ? value / months : 0;
}

export type SubscriptionLine = {
  id: string;
  name: string;
  type: VendorType;
  billingCycle: BillingCycle;
  billingAmount: string | null;
  billingCurrency: string;
  /** Rolled forward from the anchor — always today or later. */
  nextRenewalOn: string | null;
  daysAway: number | null;
  billingAccountId: string | null;
  billingAccountName: string | null;
};

export type SubscriptionSummary = {
  /** Committed each month, split by the currency it is billed in. */
  monthlyBdt: string;
  monthlyUsd: string;
  /** Everything recurring, soonest renewal first. */
  lines: SubscriptionLine[];
  /** Renewing within the next week. */
  dueSoon: SubscriptionLine[];
};
