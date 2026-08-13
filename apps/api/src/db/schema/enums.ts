import { ROLES } from "@finance/shared";
import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Postgres enums, all declared here so one file shows every closed set the
 * database enforces. Role names come from `@finance/shared` so the database,
 * the API guard, and the frontend nav can never disagree about what a role is.
 */

export const userRoleEnum = pgEnum("user_role", ROLES);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
]);

export const accountTypeEnum = pgEnum("account_type", [
  "bank",
  "cash",
  "mobile_wallet",
]);

/** Which side of the ledger a category belongs to. */
export const categoryKindEnum = pgEnum("category_kind", ["in", "out", "both"]);

export const vendorTypeEnum = pgEnum("vendor_type", [
  "supplier",
  "contractor",
  "landlord",
  "utility",
  "government",
  "other",
]);

/** Proof of Submission of Return. Missing PSR raises the TDS rate by 50%. */
export const psrStatusEnum = pgEnum("psr_status", [
  "unknown",
  "submitted",
  "not_submitted",
]);

export const fiscalYearModeEnum = pgEnum("fiscal_year_mode", [
  "bd_july_june",
  "calendar",
]);

export const numberFormatEnum = pgEnum("number_format", [
  "bangladeshi",
  "western",
]);

export const fxModeEnum = pgEnum("fx_mode", ["fixed", "live"]);

export const fxReportBasisEnum = pgEnum("fx_report_basis", [
  "period_end",
  "period_average",
  "current",
]);

/** Which way money moved. `amount` is always positive; this carries the sign. */
export const txnDirectionEnum = pgEnum("txn_direction", ["in", "out"]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "bank_transfer",
  "cash",
  "cheque",
  "mobile_banking",
  "card",
  "other",
]);

/** How a ledger row came to exist — useful when a figure looks wrong. */
export const txnOriginEnum = pgEnum("txn_origin", [
  "manual",
  "excel_import",
  "ai_intake",
  "payroll",
  "tax_payment",
  "system",
]);

export const fxSourceEnum = pgEnum("fx_source", ["manual", "api"]);

export const auditActionEnum = pgEnum("audit_action", [
  "create",
  "update",
  "delete",
  "void",
  "login",
  "login_failed",
  "logout",
  "export",
  "import",
  "finalize",
  "pay",
  "settings_change",
]);
