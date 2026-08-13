import type { Role } from "@finance/shared";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "void"
  | "login"
  | "login_failed"
  | "logout"
  | "export"
  | "import"
  | "finalize"
  | "pay"
  | "settings_change";

export type AuditEntry = {
  action: AuditAction;
  entityTable: string;
  entityId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
  module?: string;
  /** Set for anything carrying salary figures. */
  isSensitive?: boolean;
  /** Overrides the actor from the request context (used by the seed script). */
  actorUserId?: string | null;
  actorRole?: Role | null;
};

/** Columns that are noise in a diff — they change on every write. */
const IGNORED_FIELDS = new Set(["updatedAt", "updatedBy", "createdAt"]);

/**
 * Fields that differ between two row snapshots.
 * Values are compared by JSON so dates and numerics behave predictably.
 */
export function diffFields(
  before: unknown,
  after: unknown,
): string[] | undefined {
  if (!isRecord(before) || !isRecord(after)) return undefined;

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];

  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push(key);
    }
  }

  return changed.length ? changed.sort() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strips secrets before a row is written into the audit trail. */
const REDACTED = "[redacted]";
const SECRET_FIELDS = new Set([
  "passwordHash",
  "password",
  "tokenHash",
  "refreshToken",
  "accessToken",
]);

export function redact(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SECRET_FIELDS.has(key) ? REDACTED : entry;
  }
  return output;
}
