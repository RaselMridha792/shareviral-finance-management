import { z } from "zod";

import { isoDateSchema } from "./masters.ts";
import { paginationQuerySchema } from "./pagination.ts";
import { roleSchema, type Role } from "./roles.ts";

export const AUDIT_ACTIONS = [
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
] as const;
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof auditActionSchema>;

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: "Added",
  update: "Changed",
  delete: "Deleted",
  void: "Voided",
  login: "Signed in",
  login_failed: "Failed sign-in",
  logout: "Signed out",
  export: "Downloaded",
  import: "Imported",
  finalize: "Finalised",
  pay: "Paid",
  settings_change: "Settings changed",
};

export const listAuditQuerySchema = paginationQuerySchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  action: auditActionSchema.optional(),
  module: z.string().trim().max(40).optional(),
  actorUserId: z.string().uuid().optional(),
  entityTable: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(120).optional(),
  /** Matches the human-readable summary. */
  q: z.string().trim().max(160).optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export type AuditEntryDto = {
  id: number;
  occurredAt: string;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: Role | null;
  actorIp: string | null;
  action: AuditAction;
  entityTable: string;
  entityId: string | null;
  summary: string;
  module: string | null;
  changedFields: string[] | null;
  /**
   * Null when the row is marked sensitive and the reader may not see
   * compensation. The row itself still appears — an audit trail that hides
   * that something happened is worse than one that hides what changed.
   */
  before: unknown;
  after: unknown;
  isSensitive: boolean;
  /** True when the payloads were withheld from this reader. */
  redacted: boolean;
};

export const auditActorSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  role: roleSchema,
});
export type AuditActor = z.infer<typeof auditActorSchema>;
