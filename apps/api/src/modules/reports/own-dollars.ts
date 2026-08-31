import { and, gte, isNull, lte, sql, type SQL } from "drizzle-orm";

import { transactions } from "../../db/schema";
import { notATransfer } from "../transactions/own-money";

/**
 * Dollars are added up, never divided out of taka.
 *
 * The owner's rule, and the last piece of an argument the account balances
 * already settled: *"report ta calculate hobe kono fx rate theke na, karon
 * prottekta transaction a manual dollar type er option ache."*
 *
 * What was there before divided a period's taka total by one governing rate.
 * That reads back correctly only while the rate never moves — a month funded
 * at 118.00 and read at 122.50 reported dollars nobody ever had, and the
 * figure changed on its own whenever somebody edited the rate in Settings.
 * The same mistake, in the same shape, as the one that made $14,000 shrink to
 * $13,485 on the accounts screen.
 *
 * So: every row already carries what it was in dollars, when anybody typed it.
 * A period's dollars are those figures summed. Nothing is inferred.
 *
 * **A row with no dollars contributes nothing, and makes the total
 * approximate rather than wrong.** `exact` says which, and the screen marks
 * it — the same contract `ownBalanceExact` uses on an account, so the two
 * cannot disagree about what a tilde means.
 *
 * **Where a figure is not a sum of transactions, there is no dollar view at
 * all.** Salary, tax withheld, tax outstanding are taka facts: payroll is
 * computed, filed and paid in taka, and no row of it carries a dollar figure.
 * Showing one would mean inventing a rate, which is the thing being removed.
 * The honest answer is to show nothing.
 */

/** The dollars a row is worth, or null when nobody said. */
const rowDollars = sql`
  case
    when ${transactions.originalCurrency} = 'USD'
         and ${transactions.originalAmount} is not null
    then ${transactions.originalAmount}
    else null
  end`;

/**
 * Money in and money out for a period, in the dollars the rows carry.
 *
 * Transfers are excluded for the same reason they are excluded from the taka
 * totals: moving money between two of our own accounts is not income and not
 * spending. See `own-money.ts`.
 */
export function periodDollars(range: { start: string; end: string }): {
  moneyIn: SQL<string>;
  moneyOut: SQL<string>;
  exact: SQL<boolean>;
  where: SQL;
} {
  const inPeriod = and(
    gte(transactions.txnDate, range.start),
    lte(transactions.txnDate, range.end),
    isNull(transactions.voidedAt),
    isNull(transactions.deletedAt),
    notATransfer(),
  );

  return {
    moneyIn: sql<string>`coalesce(sum(case when ${transactions.direction} = 'in' then ${rowDollars} else 0 end), 0)::numeric(14,2)::text`,
    moneyOut: sql<string>`coalesce(sum(case when ${transactions.direction} = 'out' then ${rowDollars} else 0 end), 0)::numeric(14,2)::text`,
    /*
     * `coalesce(bool_and(...), true)` — and the inner coalesce matters more.
     * Postgres's three-valued logic makes `bool_and` SKIP a row whose test is
     * UNKNOWN rather than count it as false, so an all-null column reported
     * "exact" when it was the opposite. The same trap `ownCurrencyExact` fell
     * into on the accounts screen; the fix is the same and is written here so
     * the next person does not have to rediscover it.
     */
    exact: sql<boolean>`coalesce(bool_and(coalesce(${rowDollars} is not null, false)), true)`,
    where: inPeriod as SQL,
  };
}
