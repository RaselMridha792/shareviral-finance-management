import { BadRequestException } from "@nestjs/common";
import { formatMoney } from "@finance/shared";
import { sql } from "drizzle-orm";

import type { Database, DbTransaction } from "../../db";

/**
 * An account can never go below zero. This is where that sentence is enforced.
 *
 * The owner's rule, and a bank's: money that is not in the account cannot
 * leave it. Rather than teaching each of the eleven places that move money to
 * check first — a list that would be wrong by one within a month — every one
 * of them runs its mutation and then asks this helper whether any account it
 * touched now dips below zero at any point in its history. Inside the same
 * database transaction, so a refusal rolls the whole write back.
 *
 * "At any point in its history", not "now": a backdated expense can leave
 * today's balance positive while June's was impossible, and the dashboard
 * prints June. The check is therefore the *minimum of the running balance* —
 * opening balance plus the cumulative net at the end of each day. Days rather
 * than individual rows, deliberately: within one day the in and the out are
 * treated as simultaneous, so recording the morning's expense before the
 * morning's funding has been typed does not fail on an ordering nobody meant.
 *
 * The comparison is against where the account already stood, not against
 * zero alone. An account that is already negative — data from before this
 * rule existed — must still accept deposits and corrections; only a change
 * that takes its lowest point *further down* while below zero is refused.
 * For a healthy account the two rules are the same rule.
 *
 * Two writers racing on one account can each pass this check and jointly
 * overdraw — read-committed isolation does not serialise them. For a
 * five-person finance team recording entries by hand, that window is
 * accepted; the deploy-time fix would be serializable isolation, not more
 * checking here.
 */

type Low = {
  name: string;
  /** The lowest the running balance ever gets, as cents. */
  low: number;
  /** Where the account stands after everything, as cents. */
  end: number;
  /** The day the low happens, or null when the opening balance is the low. */
  dipDate: string | null;
};

async function lowestPoint(
  db: Database | DbTransaction,
  accountId: string,
): Promise<Low | null> {
  const result = await db.execute(sql`
    with days as (
      select txn_date, sum(signed_amount) as day_net
        from transactions
       where account_id = ${accountId}::uuid
         and voided_at is null
         and deleted_at is null
       group by txn_date
    ),
    running as (
      select txn_date,
             sum(day_net) over (order by txn_date) as cum
        from days
    ),
    worst as (
      select txn_date, cum from running order by cum asc, txn_date asc limit 1
    ),
    total as (
      select coalesce(sum(day_net), 0) as net from days
    )
    select a.name,
           round(
             least(
               a.opening_balance::numeric,
               a.opening_balance::numeric + coalesce(w.cum, 0)
             ) * 100
           )::bigint::text as low_cents,
           round((a.opening_balance::numeric + t.net) * 100)::bigint::text as end_cents,
           case
             when w.cum is not null and w.cum < 0 then w.txn_date::text
             else null
           end as dip_date
      from accounts a
      left join worst w on true
      cross join total t
     where a.id = ${accountId}::uuid
  `);

  const row = (
    result.rows as unknown as {
      name: string;
      low_cents: string;
      end_cents: string;
      dip_date: string | null;
    }[]
  )[0];
  if (!row) return null;
  return {
    name: row.name,
    low: Number(row.low_cents),
    end: Number(row.end_cents),
    dipDate: row.dip_date,
  };
}

export type OverdraftWatch = {
  /** Call inside the mutation's transaction, after the write. Throws to roll back. */
  assert(tx: Database | DbTransaction): Promise<void>;
};

/**
 * Snapshot the accounts about to be touched, and get back the check to run
 * after touching them.
 *
 *     const watch = await overdraftWatch(this.db.client, [accountId]);
 *     await this.audit.mutate({
 *       ...,
 *       run: async (tx) => {
 *         ...the write...
 *         await watch.assert(tx);
 *       },
 *     });
 */
export async function overdraftWatch(
  db: Database,
  accountIds: (string | null | undefined)[],
): Promise<OverdraftWatch> {
  const ids = [
    ...new Set(accountIds.filter((id): id is string => Boolean(id))),
  ];
  const before = new Map<string, Low>();
  for (const id of ids) {
    const snapshot = await lowestPoint(db, id);
    if (snapshot) before.set(id, snapshot);
  }

  return {
    async assert(tx) {
      for (const id of ids) {
        const after = await lowestPoint(tx, id);
        if (!after) continue;
        const was = before.get(id);

        /*
         * Two conditions, because they fail on different days.
         *
         * The *low* is the account's worst historical moment — a backdated
         * entry can break a month that is already printed. The *end* is where
         * the account stands now — the figure on the dashboard. A deposit into
         * a legacy-negative account raises the end without touching the old
         * low, and a spend after that deposit could bring the end back under
         * zero while staying above the old low; only checking both refuses
         * that spend while still letting the deposit in.
         */
        const lowBroken =
          after.low < 0 && after.low < Math.min(0, was?.low ?? 0);
        const endBroken =
          after.end < 0 && after.end < Math.min(0, was?.end ?? 0);

        if (lowBroken || endBroken) {
          const standing = lowBroken ? after.low : after.end;
          throw new BadRequestException(
            `${after.name} does not hold enough money for this. It would stand at ` +
              `${formatMoney((standing / 100).toFixed(2))}` +
              (lowBroken && after.dipDate ? ` on ${after.dipDate}` : "") +
              `, and an account can never go below zero. Record the money coming in first.`,
          );
        }
      }
    },
  };
}
