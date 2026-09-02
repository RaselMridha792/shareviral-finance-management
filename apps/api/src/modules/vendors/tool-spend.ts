import { RECURRING_VENDOR_TYPES } from "@finance/shared";
import { inArray, sql, type SQL } from "drizzle-orm";

import { accounts, transactions, vendors } from "../../db/schema";

/**
 * What counts as money spent on tooling, in one place.
 *
 * The overview's "AI tooling & subscriptions" tile and the AI tools screen ask
 * the same question of the ledger, and two hand-written copies of it drift the
 * first time somebody adds a vendor type. `OverviewService.toolsAndSubscriptions`
 * still carries its own inline copy of `isToolSpend()` — it should import this
 * one; the two must not be edited apart.
 *
 * Both predicates read `vendors` and `accounts`, so any query using them has to
 * join both tables.
 */

/**
 * Vendors whose spending is tooling: AI tools, subscriptions, hosting.
 *
 * Taken from the shared list rather than spelled out, so adding a fourth kind
 * of tool changes one array and not three SQL strings.
 */
export function isToolVendor(): SQL {
  // `coalesce(…, false)` because this is reached through a LEFT JOIN: a row
  // with no vendor gives `NULL in (…)`, which is UNKNOWN rather than false.
  // Read positively that behaves like false and nothing goes wrong; negated,
  // `NOT UNKNOWN` is still UNKNOWN, and the row silently disappears. See
  // `isToolSpend`.
  return sql`coalesce(${inArray(vendors.type, [...RECURRING_VENDOR_TYPES])}, false)`;
}

/**
 * Money out that counts as tooling: paid to a tool vendor, or settled on a
 * non-taka account.
 *
 * One OR rather than two sums added together — a Vercel bill on the card is
 * both, and adding two counts would double it. The card half is there because
 * the prepaid card exists to pay for tooling, so its spending is tooling
 * whether or not anybody named the vendor on the row.
 */
export function isToolSpend(): SQL {
  /**
   * Definitely true or definitely false — never UNKNOWN.
   *
   * Both halves come through LEFT JOINs, so both can be NULL, and this used to
   * evaluate to UNKNOWN for a row with neither a vendor nor a joined account.
   * That was harmless while the predicate was only ever read positively: a
   * WHERE clause treats UNKNOWN as "no". The moment it was negated for
   * "everything except tooling", UNKNOWN stayed UNKNOWN through the NOT and
   * every vendor-less row vanished from the answer — a TDS deposit, the
   * electricity bill, an ad spend and the office pantry, ৳72,700 of expenses
   * that are not tooling by any reading, missing from the screen that exists
   * to list them.
   */
  /*
   * The card half now also demands the account be a card. It used to read
   * any non-taka account as tooling, which held while the only non-taka
   * account WAS the prepaid card — but accounts can now choose USD as their
   * primary currency, and a USD bank's rent is not tooling by any reading.
   * The heuristic keeps its original sentence: the prepaid CARD exists to
   * pay for tooling.
   */
  /*
   * The FIRST question is now a fact, not a heuristic.
   *
   * `subscription_id` says this row paid that plan. Everything else here is a
   * guess about intent — "paid to a recurring vendor", "settled on the card
   * that buys tools" — and both guesses miss a plan paid from an ordinary taka
   * bank account, which is how the AI and other tools card came to read zero
   * while the money had genuinely gone out.
   *
   * The guesses are kept behind it rather than replaced. Every payment recorded
   * before this column existed has a null in it, and those rows are still
   * tooling; dropping the heuristic would rewrite history downward.
   */
  return sql`(
    ${transactions.subscriptionId} is not null
    or ${isToolVendor()}
    or coalesce(${accounts.currency} <> 'BDT' and ${accounts.type} = 'card', false)
  )`;
}
