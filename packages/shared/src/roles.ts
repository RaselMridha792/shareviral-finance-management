import { z } from "zod";

/**
 * Every value the Postgres `user_role` enum holds — including the two nobody
 * can be given any more.
 *
 * This describes the DATABASE, and the database still has all six: Postgres has
 * no `ALTER TYPE ... DROP VALUE`, so removing one means recreating the type and
 * rewriting every column that uses it, on a live table, to delete two words.
 * `userRoleEnum = pgEnum("user_role", STORED_ROLES)` therefore reads from here,
 * and Drizzle's picture of the column stays true.
 *
 * The order is the enum's declaration order, and a value added to a Postgres
 * enum can only go on the end without rewriting the type — so a new role
 * appends here, whatever seniority might suggest.
 */
export const STORED_ROLES = [
  "super_admin",
  "ceo",
  "admin",
  "finance",
  "hr",
  "cfo",
] as const;

/** Any role a stored row may carry, live or retired. */
export const storedRoleSchema = z.enum(STORED_ROLES);
export type StoredRole = z.infer<typeof storedRoleSchema>;

/**
 * The roles a user can actually be given.
 *
 * The owner, 5 Sep 2026: *"admin role take delete kore daw and Finance Role take
 * delete kore daw ekhane Finance and CFO akoi role er under a ache tader kaj
 * akoi and admin er dorkar nai super admin holei hobe."*
 *
 * He is right about both. `cfo` and `admin` held the SAME permission array —
 * two names for one row of the matrix — and Finance was that row minus master
 * data. So the four below lose nobody anything: everyone on either was moved to
 * `cfo` by `2026-09-05-retire-admin-finance-roles.sql`, on the release before
 * this list shrank.
 */
export const ROLES = ["super_admin", "ceo", "hr", "cfo"] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * Withdrawn, and kept here so history can still say their names.
 *
 * `audit_logs.actor_role` records the role somebody held AT THE TIME. Those
 * rows are not rewritten — an audit trail edited to say somebody was always a
 * CFO is not an audit trail — so an entry from August has to keep reading
 * "Admin" rather than going blank.
 */
export const RETIRED_ROLES = ["admin", "finance"] as const;
export type RetiredRole = (typeof RETIRED_ROLES)[number];

export function isRetiredRole(role: string): role is RetiredRole {
  return (RETIRED_ROLES as readonly string[]).includes(role);
}

/**
 * Keyed by every role a row may carry, not only the assignable ones — because
 * the two places this is read are a signed-in user's own role and an audit
 * entry's actor, and the second is history.
 */
export const ROLE_LABELS: Record<StoredRole, string> = {
  super_admin: "Super Admin",
  ceo: "CEO",
  admin: "Admin",
  finance: "Finance",
  hr: "HR",
  cfo: "CFO",
};
