/**
 * Drizzle tables, one file per domain, all re-exported here.
 * drizzle.config.ts points at this barrel.
 *
 * Arriving in later phases:
 *   imports.ts        Excel import batches            (Phase 4)
 *   team-members.ts   employee and contractor records (Phase 5)
 *   payroll.ts        runs, lines, compensation       (Phase 5)
 *   tds.ts            challans and withholding        (Phase 6)
 *   income-tax.ts     corporate tax records           (Phase 6)
 *   fx.ts             USD/BDT rates                   (Phase 7)
 */

export * from "./enums";
export * from "./users";
export * from "./audit";
export * from "./accounts";
export * from "./categories";
export * from "./vendors";
export * from "./settings";
export * from "./transactions";
export * from "./imports";
export * from "./team";
export * from "./tax";
export * from "./fx";
export * from "./statements";
export * from "./files";
export * from "./ai-chats";
export * from "./ai-attachments";
export * from "./ai-corrections";
