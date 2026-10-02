import { sql } from "drizzle-orm";

import type { DbTransaction } from "../../db";
import type { DbService } from "../../db/db.service";

/**
 * The renewal a plan already has in the month of `txnDate`, or null.
 *
 * A renewal is any live payment on the plan — not voided, not in the trash,
 * not a bank-charge row — that no upgrade names as its own. Raw SQL for the
 * `not exists` against `subscription_upgrades`, with every column written
 * against an alias so nothing resolves to the wrong table.
 *
 * In a file of its own (2 Oct 2026) because two things ask it now: the
 * endpoint that takes a renewal, which refuses a second in the month, and
 * the assistant, which will not offer a renewal as ready when that refusal
 * is what Save would meet. One definition, so the two cannot disagree about
 * what "already renewed" means.
 */
export async function renewalInMonth(
  client: DbTransaction | DbService["client"],
  subscriptionId: string,
  txnDate: string,
): Promise<{ refNo: string; txnDate: string } | null> {
  const result = await client.execute(sql`
    select t.ref_no, t.txn_date::text as txn_date
      from transactions t
     where t.subscription_id = ${subscriptionId}::uuid
       and t.voided_at is null
       and t.deleted_at is null
       and t.charge_for_id is null
       and date_trunc('month', t.txn_date) = date_trunc('month', ${txnDate}::date)
       and not exists (
         select 1 from subscription_upgrades u where u.transaction_id = t.id
       )
     order by t.txn_date
     limit 1
  `);
  const row = (
    result.rows as unknown as { ref_no: string; txn_date: string }[]
  )[0];
  return row ? { refNo: row.ref_no, txnDate: row.txn_date } : null;
}
