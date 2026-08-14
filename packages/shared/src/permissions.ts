import { z } from "zod";

import { ROLES, type Role } from "./roles.ts";

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
 * - `admin` runs operations but cannot change settings or manage users.
 * - `finance` matches admin minus master-data admin and imports.
 * - `hr` has team.read/write but NOT team.compensation.* and NOT payroll.* —
 *   this is the boundary the whole permission system exists to hold.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: PERMISSIONS,
  ceo: READ_ONLY_EVERYTHING,
  admin: OPERATIONAL_FULL,
  finance: [
    "dashboard.view",
    "dashboard.money",
    "transactions.read",
    "transactions.write",
    "transactions.void",
    "accounts.read",
    "vendors.read",
    "vendors.write",
    "categories.read",
    "team.read",
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
  ],
  hr: [
    "dashboard.view",
    "team.read",
    "team.write",
    "vendors.read",
    "categories.read",
    /**
     * `reports.view` is deliberately absent.
     *
     * It was here, and it undid the boundary this whole matrix exists for. HR
     * cannot open payroll, cannot read a compensation record and cannot see a
     * salary sheet — and then Reports rendered the company's position in full:
     * opening ৳20,77,083, in ৳11,80,000, out ৳7,09,646, and a spend breakdown
     * whose largest line was **"People 56% ৳3,94,300"** — that month's payroll,
     * total, on the screen of a role whose own dashboard says "balances,
     * payroll and pay are held elsewhere".
     *
     * Withholding the individual figures while publishing their sum is not a
     * boundary. `reports.view` also carries the funding report and the bank
     * statistics, neither of which is an HR question.
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

export function hasPermission(
  role: Role | undefined,
  permission: Permission,
): boolean {
  if (!role) return false;
  return ROLE_PERMISSION_SETS[role].has(permission);
}

export function hasAnyPermission(
  role: Role | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((p) => hasPermission(role, p));
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Roles allowed to see salary figures anywhere in the app. */
export function canSeeCompensation(role: Role | undefined): boolean {
  return hasPermission(role, "team.compensation.read");
}
