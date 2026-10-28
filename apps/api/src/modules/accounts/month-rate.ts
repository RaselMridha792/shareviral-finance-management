import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";

import type { DbService } from "../../db/db.service";
import { transactions } from "../../db/schema";
import { booksMonthSql, monthOf } from "../transactions/books-month";

/**
 * The rate a month is read in dollars at: the one its own entries carry.
 *
 * Every entry stores the day's rate (`usd_rate`), and in practice a month's
 * entries all carry the same one — May 122, June 122.45, July and August
 * 122.77, the boss's sheet's own C6. Taken as the rate most of the month's
 * entries carry, by the month they belong to; a month with none takes the
 * latest earlier month's. Null only before any rate was ever recorded.
 *
 * What it is for (the owner, 28 Oct 2026): a TAKA account's balance is fixed
 * in taka and its dollars move with the rate — "bank asia, and standard
 * charterd bank holo bd bank etay bdt thik theke rate onujayi usd change hote
 * pare". So a taka account's opening and closing in dollars are its taka at
 * this rate, as the sheet shows them. A dollar account is the other way round
 * and does not use this.
 */
export async function monthRateFor(
  db: DbService["client"],
  day: string,
): Promise<number | null> {
  const month = monthOf(day);
  const live = and(
    isNull(transactions.voidedAt),
    isNull(transactions.deletedAt),
    gt(transactions.usdRate, "0"),
  );

  const [own] = await db
    .select({ rate: sql<string>`${transactions.usdRate}::text` })
    .from(transactions)
    .where(and(live, eq(booksMonthSql, month)))
    .groupBy(transactions.usdRate)
    .orderBy(desc(sql`count(*)`), desc(transactions.usdRate))
    .limit(1);
  if (own) return Number(own.rate);

  const [earlier] = await db
    .select({ rate: sql<string>`${transactions.usdRate}::text` })
    .from(transactions)
    .where(and(live, lt(booksMonthSql, month)))
    .orderBy(desc(booksMonthSql), desc(transactions.txnDate))
    .limit(1);
  return earlier ? Number(earlier.rate) : null;
}

/** Taka read in dollars at `rate`, to the cent. */
export function inDollarsAt(taka: string | number, rate: number): string {
  return (Number(taka) / rate).toFixed(2);
}
