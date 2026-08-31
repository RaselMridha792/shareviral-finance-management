import { ForbiddenException } from "@nestjs/common";
import { sql } from "drizzle-orm";

import type { DbTransaction } from "../../db";

/**
 * The one invariant nobody can be allowed to break: somebody can still get in.
 *
 * At least one active, non-deleted super admin must exist. Without one there is
 * no way to reach Settings, add a sign-in, restore anybody, or promote anybody
 * — and the way back is a hand-written UPDATE on the production database of a
 * company that runs its payroll here.
 *
 * WHY THIS EXISTS WHEN TWO GUARDS ALREADY DID.
 *
 * Both single paths were guarded, and correctly:
 *
 *   - `UsersService.update` refuses to demote or disable the last one
 *     (`countActiveSuperAdmins() > 1`);
 *   - the trash registry's `user` entry carries a `blockedWhen` that refuses to
 *     delete the last one.
 *
 * The BULK path went round both. `trash.service.ts` evaluates `blockedWhen`
 * once per row, BEFORE anything is written, from a plain client rather than the
 * transaction. Tick two super admins together and each row's subquery sees a
 * table that still contains the other: count is 2, neither is blocked, and both
 * go out in one UPDATE. Zero active super admins, no error, no warning.
 *
 * Every one of those guards asks the same question at a moment when the answer
 * is still the old one. This one asks AFTER the write and INSIDE the
 * transaction, which is the only moment the answer is the one that will be
 * true — and it asks about the ABSOLUTE state rather than about a delta, so it
 * catches a table that was already empty as well as one this request emptied.
 *
 * THE LOCK IS NOT DECORATION. Postgres runs read-committed, so two concurrent
 * transactions each deleting a DIFFERENT super admin cannot see each other's
 * uncommitted work: both would count one survivor, both would pass, and both
 * would commit. `for update` on the super-admin rows makes the second wait for
 * the first, so it counts what actually remains.
 */
export async function assertSuperAdminRemains(
  tx: DbTransaction,
  /** What the caller was doing, for the sentence the user reads. */
  act: "delete" | "deactivate" | "change",
): Promise<void> {
  /*
   * Locked first, counted second.
   *
   * The lock is taken over every super-admin row rather than only the ones
   * this request touched: the row that has to still be there afterwards is one
   * this request never mentioned, and a lock that does not cover it lets a
   * concurrent transaction take it away between the count and the commit.
   */
  const survivors = await tx.execute(sql`
    select count(*)::int as n
      from (
        select u.id
          from users u
         where u.role = 'super_admin'
           and u.status = 'active'
           and u.deleted_at is null
         for update
      ) still_here
  `);

  const remaining = Number(
    (survivors.rows as unknown as { n: number }[])[0]?.n ?? 0,
  );
  if (remaining > 0) return;

  const verb =
    act === "delete"
      ? "Deleting those"
      : act === "deactivate"
        ? "Deactivating that"
        : "That change";

  throw new ForbiddenException(
    `${verb} would leave no super admin at all, and nobody could then reach ` +
      `Settings, add a sign-in, or undo it. Promote somebody else first.`,
  );
}
