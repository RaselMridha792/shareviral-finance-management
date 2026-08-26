import { sql, type SQL } from "drizzle-orm";
import { text, timestamp, uuid, type PgColumn } from "drizzle-orm/pg-core";

/** The stand-in for "no entity yet", used only inside index expressions. */
const SINGLE_ENTITY = "00000000-0000-0000-0000-000000000000";

/**
 * Every business table carries a nullable `entity_id` so a second company can
 * be added without data surgery, and every uniqueness rule includes it. But
 * Postgres treats NULLs as distinct from each other, so a unique index on a
 * column that is NULL on every row enforces nothing at all — two accounts both
 * named "City Bank" would both be accepted.
 *
 * Coalescing to a fixed UUID makes the constraint real today and still correct
 * once entities exist.
 */
export function entityKey(column: PgColumn): SQL {
  return sql`coalesce(${column}, ${sql.raw(`'${SINGLE_ENTITY}'::uuid`)})`;
}

/**
 * What a deleted row carries, on every table that can hold one.
 *
 * Spread into the columns rather than typed out seventeen times, because the
 * trash reads all of them through one query shape and the first table to spell
 * a column differently is the one that silently drops out of the listing.
 *
 * Note what this is not. `voided_at` on a money row means "this happened and
 * was reversed" — it stays on screen, struck through, and every total already
 * ignores it. `deleted_at` means "this should never have been here": it leaves
 * the screen entirely and waits in the trash to be restored or purged.
 *
 * Deleting a money row sets both, and that is deliberate. Every sum in this
 * application already excludes voided rows, so a deleted one drops out of all
 * of them without a single query being edited — the exclusion is structural
 * rather than remembered in twenty-nine places.
 */
export function deletion() {
  return {
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    deleteReason: text("delete_reason"),
  };
}
