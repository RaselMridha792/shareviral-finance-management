import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

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
