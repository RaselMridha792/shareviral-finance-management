import { z } from "zod";

import { ROLES, type Role, type StoredRole } from "./roles.ts";

/**
 * The permission vocabulary. Lives here, not in the API, so the sidebar hides
 * exactly what the server refuses — one list, no drift.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "dashboard.money",

  "transactions.read",
  "transactions.write",
  "transactions.void",

  "accounts.read",
  "accounts.write",

  "vendors.read",
  "vendors.write",

  "categories.read",
  "categories.write",

  "team.read",
  "team.write",
  // Salary. Deliberately separate from team.* — this is the HR boundary.
  "team.compensation.read",
  "team.compensation.write",

  "payroll.read",
  "payroll.write",
  "payroll.pay",

  "tds.read",
  "tds.write",

  "incometax.read",
  "incometax.write",

  "reports.view",
  "reports.usd",

  "exports.run",
  "imports.run",

  "settings.read",
  "settings.write",
  "users.manage",
  "audit.read",

  "ai.use",
] as const;

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

/* -------------------------------------------------------------------------- */

const READ_ONLY_EVERYTHING: Permission[] = [
  "dashboard.view",
  "dashboard.money",
  "transactions.read",
  "accounts.read",
  "vendors.read",
  "categories.read",
  "team.read",
  "team.compensation.read",
  "payroll.read",
  "tds.read",
  "incometax.read",
  "reports.view",
  "reports.usd",
  "exports.run",
  "settings.read",
  "audit.read",
];

const OPERATIONAL_FULL: Permission[] = [
  "dashboard.view",
  "dashboard.money",
  /**
   * Admin reads the audit log too.
   *
   * It held every operational permission and not this one, so the role that
   * does the day-to-day work could not see who had changed what — and the two
   * roles who could, Super Admin and the CEO, are the two least likely to be
   * the ones checking. Reading it is not a privilege over the money; it is how
   * somebody notices a wrong figure was entered on Tuesday.
   *
   * Pay stays hidden inside it regardless: `audit_logs.is_sensitive` rows are
   * filtered for anybody without `team.compensation.read`, so an admin sees
   * that a compensation record changed without seeing the figure.
   */
  "audit.read",
  "transactions.read",
  "transactions.write",
  "transactions.void",
  "accounts.read",
  "accounts.write",
  "vendors.read",
  "vendors.write",
  "categories.read",
  "categories.write",
  "team.read",
  "team.write",
  "team.compensation.read",
  "team.compensation.write",
  "payroll.read",
  "payroll.write",
  "payroll.pay",
  "tds.read",
  "tds.write",
  "incometax.read",
  "incometax.write",
  "reports.view",
  "reports.usd",
  "exports.run",
  "imports.run",
  "settings.read",
  "ai.use",
];

/**
 * Role → permissions.
 *
 * - `super_admin` is the only role with `settings.write` and `users.manage`.
 * - `ceo` is read-only by decision, but sees money and the audit log.
 * - `cfo` runs operations — the whole set except those two.
 * - `hr` has team.read/write and compensation, but NOT payroll.write or
 *   payroll.pay and NOT reports — this is the boundary the whole permission
 *   system exists to hold.
 *
 * `admin` and `finance` were withdrawn on 5 Sep 2026. `admin` and `cfo` had
 * been the same array all along, and `finance` was that array minus master
 * data, so retiring them removed two names rather than any capability. The
 * people on them were moved to `cfo` the release before this changed.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  ceo: READ_ONLY_EVERYTHING,
  /**
   * Everything operational — the ledger, payroll, salary, tax, the challans
   * this role was added for — but not `settings.write` and not `users.manage`,
   * which stay with super_admin alone.
   *
   * This array used to be shared with `admin`, on the reasoning that two lists
   * meant to be identical drift the first time somebody adds to one of them.
   * They never did drift, and that is what made retiring `admin` a rename
   * rather than a decision about anybody's access.
   */
  cfo: OPERATIONAL_FULL,
  /**
   * HR owns pay at this company, so HR can see and set it.
   *
   * This was the opposite for most of the app's life: compensation lived in its
   * own table precisely so that no HR request could reach a salary, and the
   * separation was enforced in six places. The owner changed the decision on
   * 2026-08-15 — their HR runs payroll, and a role that cannot see a salary
   * cannot do that job.
   *
   * The table stayed separate anyway, and that turned out to be worth it: this
   * change is four lines here rather than a migration, and reversing it is
   * deleting them. The compensation DTO, the exports and the audit trail all
   * gate on `team.compensation.read` and pick this up on their own.
   *
   * Two things are still withheld, and both are about money leaving rather
   * than money being decided:
   */
  hr: [
    "dashboard.view",
    "team.read",
    "team.write",
    "team.compensation.read",
    "team.compensation.write",
    /**
     * The salary sheet, to read. `payroll.write` and `payroll.pay` are not
     * here: deciding a salary and moving the bank balance are different acts,
     * and the second belongs to Finance or Admin. HR prepares the month;
     * somebody else releases the money.
     */
    "payroll.read",
    "vendors.read",
    "categories.read",
    /**
     * `reports.view` is still deliberately absent, and for a reason that
     * survives the change above.
     *
     * It was here once, and it undid the boundary the matrix exists for: it
     * renders the company's whole position — opening ৳20,77,083, in
     * ৳11,80,000, out ৳7,09,646 — plus the funding report and the bank
     * statistics. HR now sees what each person earns, which is HR's business.
     * What the company holds in the bank and what the CEO sent from abroad is
     * not the same question, and letting one through does not open the other.
     */
    "exports.run",
    "settings.read",
    "ai.use",
  ],
};

// Built explicitly rather than via Object.fromEntries so the key type stays
// exactly Role — fromEntries widens it to string.
const ROLE_PERMISSION_SETS = (() => {
  const sets = {} as Record<Role, ReadonlySet<Permission>>;
  for (const role of ROLES) {
    sets[role] = new Set(ROLE_PERMISSIONS[role]);
  }
  return sets;
})();

/*
 * These take a STORED role, not an assignable one.
 *
 * What arrives here comes off a `users` row or a JWT, and the database can hold
 * a role the matrix no longer has — a user restored from an old backup, a row
 * that predates a retirement. That used to be a crash rather than a refusal:
 * `ROLE_PERMISSION_SETS[role]` is `undefined` for an unknown role and `.has()`
 * on it THROWS, so one such user would meet a 500 on every request in the app.
 *
 * They fail closed instead. No row in the matrix means no permissions: the
 * person can sign in and sees nothing, which is diagnosable and safe, where a
 * 500 is neither.
 */
export function hasPermission(
  role: StoredRole | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSION_SETS[role as Role]?.has(permission) ?? false;
}

export function hasAnyPermission(
  role: StoredRole | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function permissionsFor(role: StoredRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role as Role] ?? [];
}

/** Roles allowed to see salary figures anywhere in the app. */
export function canSeeCompensation(role: StoredRole | undefined): boolean {
  return hasPermission(role, "team.compensation.read");
}
