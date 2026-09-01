import {
  and,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { transactions } from "../../db/schema/transactions";
import { isToolSpend } from "../vendors/tool-spend";
import { notATransfer } from "./own-money";

/**
 * A month's spending, cut into slices that do not overlap.
 *
 * The owner asked for at least six dynamic boxes on a new Expenses overview,
 * with Salary among them. A first plan gave him six that counted the same money
 * five times — salary sat inside Operational expenses, inside Other expenses
 * and inside the headline, so "Other expenses" read HIGHER than "Operational
 * expenses" beside it. Shown the two shapes, he chose the one that adds up:
 *
 *   salary + tooling + operational + uncategorised = total money out
 *
 * That equality is the whole design, and it is why each slice is defined by
 * excluding the ones before it rather than by its own idea of what it means.
 * Tax withheld sits outside the sum and says so: it is money HELD, not spent.
 *
 * THREE RULES EVERY SLICE OBEYS, each of them a bug this app has already had:
 *
 *   - **a transfer is not an expense.** Moving money between our own accounts
 *     is money out of one and into another, and counting it as spending
 *     inflated five aggregates on this system before. `notATransfer()` is the
 *     predicate every existing total uses and every slice here uses it too.
 *   - **a voided row is not spending.** It stays on screen struck through and
 *     out of every total, which is what makes voiding safe.
 *   - **the sums are done in SQL.** Money is `numeric(14,2)` text; adding it in
 *     JavaScript is how a figure ends up a paisa out and nobody can say where.
 */

/** Money out that is neither a transfer nor voided, in the window. */
function spendingIn(from: string, to: string): SQL[] {
  return [
    isNull(transactions.deletedAt),
    isNull(transactions.voidedAt),
    eq(transactions.direction, "out"),
    notATransfer(),
    gte(transactions.txnDate, from),
    lte(transactions.txnDate, to),
  ];
}

/**
 * Salary is the ledger's own payroll rows, not the payroll tables.
 *
 * Reading `payroll_lines` would give a truer answer to "what did we pay people"
 * — it knows about a sheet finalised and not yet paid — but it would break the
 * arithmetic this page exists for: a figure that is not part of the ledger
 * cannot be a slice of the ledger's total. `created_via = 'payroll'` is the
 * money that actually left the bank for salary, which is also what the other
 * three slices are made of.
 */
const isSalary = (): SQL => eq(transactions.createdVia, "payroll");

/** A row that recorded what it was in dollars, at the time somebody typed it. */
const carriesDollars = (): SQL =>
  sql`${transactions.originalCurrency} = 'USD'
      and ${transactions.originalAmount} is not null`;

export type ExpenseOverview = {
  from: string;
  to: string;
  /** The four that add up to `total`, in the order the page shows them. */
  salary: string;
  tooling: string;
  operational: string;
  uncategorised: string;
  total: string;
  /** Held against a tax liability. Deliberately NOT part of the total. */
  withheld: string;
  /**
   * The four and the total in dollars, ADDED UP from what the rows carry.
   *
   * Null when no row this month recorded one. `exact` is false when only some
   * did, so the dollar figures are a floor and the screen marks them.
   */
  usd: {
    salary: string;
    tooling: string;
    operational: string;
    uncategorised: string;
    total: string;
    exact: boolean;
  } | null;
  /** How the four compare with the month before, for the "vs August" line. */
  previous: {
    label: string;
    salary: string;
    tooling: string;
    operational: string;
    uncategorised: string;
    total: string;
  };
};

/**
 * One query, four `filter` clauses.
 *
 * Four separate queries over the same rows would be four chances for the window
 * to be written slightly differently, and the equality would then fail for a
 * reason nobody could see. `sum(...) filter (where ...)` computes every slice
 * from one scan of one predicate.
 */
export function overviewSelect() {
  return {
    salary: sql<string>`coalesce(sum(${transactions.amount}) filter (
      where ${isSalary()}
    ), 0)::text`,

    /* Tooling, minus anything already counted as salary — a payroll row is
       never tool spend in practice, and the exclusion is written down anyway so
       the four cannot start overlapping the day somebody changes a rule. */
    tooling: sql<string>`coalesce(sum(${transactions.amount}) filter (
      where not ${isSalary()} and ${isToolSpend()}
    ), 0)::text`,

    /* Categorised spend that is neither of the two above. */
    operational: sql<string>`coalesce(sum(${transactions.amount}) filter (
      where not ${isSalary()}
        and not ${isToolSpend()}
        and ${isNotNull(transactions.categoryId)}
    ), 0)::text`,

    /*
     * Money out with no heading at all.
     *
     * Invisible on the category grid, which inner-joins categories — so this
     * box is the only place it appears. That is worth a box of its own: an
     * expense nobody filed is exactly the one somebody needs to go and file.
     */
    uncategorised: sql<string>`coalesce(sum(${transactions.amount}) filter (
      where not ${isSalary()}
        and not ${isToolSpend()}
        and ${isNull(transactions.categoryId)}
    ), 0)::text`,

    total: sql<string>`coalesce(sum(${transactions.amount}), 0)::text`,

    /*
     * The same four, in the dollars the ROWS carry.
     *
     * The owner: "aigula kono fx rate theke hobena. prottekta transaction er
     * usd amount o save hoy oitai jog hobe." Added up, never divided — a figure
     * produced by division moves on its own the moment somebody edits a rate.
     *
     * They partition exactly as the taka slices do, because they are the same
     * `filter` clauses over the same rows. A row with no dollar figure adds
     * nothing to any of them, so the dollar total is a FLOOR of the taka total
     * rather than a different reading of it.
     */
    salaryUsd: sql<string>`coalesce(sum(${transactions.originalAmount}) filter (
      where ${isSalary()} and ${carriesDollars()}
    ), 0)::text`,
    toolingUsd: sql<string>`coalesce(sum(${transactions.originalAmount}) filter (
      where not ${isSalary()} and ${isToolSpend()} and ${carriesDollars()}
    ), 0)::text`,
    operationalUsd: sql<string>`coalesce(sum(${transactions.originalAmount}) filter (
      where not ${isSalary()}
        and not ${isToolSpend()}
        and ${isNotNull(transactions.categoryId)}
        and ${carriesDollars()}
    ), 0)::text`,
    uncategorisedUsd: sql<string>`coalesce(sum(${transactions.originalAmount}) filter (
      where not ${isSalary()}
        and not ${isToolSpend()}
        and ${isNull(transactions.categoryId)}
        and ${carriesDollars()}
    ), 0)::text`,
    totalUsd: sql<string>`coalesce(sum(${transactions.originalAmount}) filter (
      where ${carriesDollars()}
    ), 0)::text`,
    /* How many rows carry one at all. Zero means this month has no dollar view,
       which is a different answer from "$0.00". */
    withUsd: sql<number>`count(*) filter (where ${carriesDollars()})::int`,
    rows: sql<number>`count(*)::int`,

    /* Withheld against a tax liability: in the account, not the company's to
       spend, and not part of the sum above. */
    withheld: sql<string>`coalesce(sum(${transactions.withheldTaxAmount}), 0)::text`,
  };
}

/** The window, as one clause. */
export function overviewWhere(from: string, to: string) {
  return and(...spendingIn(from, to));
}
