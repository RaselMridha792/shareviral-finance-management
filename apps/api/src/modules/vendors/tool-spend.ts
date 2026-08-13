import { RECURRING_VENDOR_TYPES } from "@finance/shared";
import { inArray, or, sql, type SQL } from "drizzle-orm";

import { accounts, vendors } from "../../db/schema";

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
  return inArray(vendors.type, [...RECURRING_VENDOR_TYPES]);
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
  // `or` is only undefined when given nothing; two conditions always produce
  // one, and the cast keeps callers from having to prove that.
  return or(isToolVendor(), sql`${accounts.currency} <> 'BDT'`) as SQL;
}
