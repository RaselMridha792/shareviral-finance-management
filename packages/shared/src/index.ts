/**
 * Everything the frontend and backend both need lives here.
 *
 * Rule of thumb: if changing it should break the other side's build, it belongs
 * in this package. Zod schemas, DTO types, role and permission names, period and
 * deadline maths, money handling. Nothing here may import from `apps/*`.
 *
 * The Zod schemas also generate the AI intake's structured-output JSON Schema
 * via `z.toJSONSchema()`, so the assistant asks for exactly the fields the
 * manual form requires — one definition, no drift.
 */

export * from "./roles.ts";
export * from "./users.ts";
export * from "./audit.ts";
export * from "./ai.ts";
export * from "./permissions.ts";
export * from "./pagination.ts";
export * from "./datetime.ts";
export * from "./money.ts";
export * from "./periods.ts";
export * from "./deadlines.ts";
export * from "./masters.ts";
export * from "./subscriptions.ts";
export * from "./transactions.ts";
export * from "./payroll.ts";
export * from "./tax.ts";
export * from "./reports.ts";
