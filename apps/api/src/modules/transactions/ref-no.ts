import { sql } from "drizzle-orm";

import type { DbTransaction } from "../../db";
import { transactions } from "../../db/schema";

/**
 * The next `TXN-2026-000412` for a calendar year.
 *
 * Two things this deliberately does not do:
 *
 * **It does not count rows.** `count(*) + 1` looks equivalent and is not: delete
 * one row from the middle and every later insert collides with an existing
 * reference for ever, because `transactions_ref_idx` is unique. Taking the
 * highest number actually issued survives any gap.
 *
 * **It does not race.** The advisory lock is held to the end of the enclosing
 * transaction, so two payroll runs committed at the same moment queue rather
 * than both reading the same maximum. It is per year, so unrelated years never
 * wait on each other.
 *
 * Must be called inside a transaction — the lock is worthless otherwise.
 */
export async function nextRefNo(
  tx: DbTransaction,
  year: number,
): Promise<string> {
  return (await nextRefNos(tx, year, 1))[0];
}

/** Several at once, for a run that writes one row per person. */
export async function nextRefNos(
  tx: DbTransaction,
  year: number,
  howMany: number,
): Promise<string[]> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`txn-ref-${year}`}))`,
  );

  const [row] = await tx
    .select({
      highest: sql<number>`coalesce(max(substring(${transactions.refNo} from '[0-9]+$')::int), 0)`,
    })
    .from(transactions)
    .where(sql`${transactions.refNo} like ${`TXN-${year}-%`}`);

  const from = Number(row.highest);
  return Array.from(
    { length: howMany },
    (_, i) => `TXN-${year}-${String(from + i + 1).padStart(6, "0")}`,
  );
}
