import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { auditActionEnum, userRoleEnum } from "./enums";

/**
 * Who changed what, when, from what, to what.
 *
 * Written inside the same transaction as the mutation it describes, so there is
 * no such thing as an unaudited change or an orphan audit row.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Null for system jobs and for failed logins where no user was identified.
    actorUserId: uuid("actor_user_id"),
    actorRole: userRoleEnum("actor_role"),
    actorIp: inet("actor_ip"),
    actorUserAgent: text("actor_user_agent"),
    requestId: uuid("request_id"),

    action: auditActionEnum("action").notNull(),
    entityTable: varchar("entity_table", { length: 64 }).notNull(),
    entityId: text("entity_id"),

    /**
     * Human-readable, written by the service:
     * "Voided TXN-2026-000412, ৳25,000.00 office rent".
     * A log that needs JSON diffed by eye to be understood is not a log.
     */
    summary: text("summary").notNull(),

    before: jsonb("before"),
    after: jsonb("after"),
    changedFields: text("changed_fields").array(),

    module: varchar("module", { length: 40 }),

    /**
     * True when the payload contains compensation. The audit reader filters
     * these out for anyone without `team.compensation.read` — an audit trail
     * that leaks the thing it audits is an easy and expensive mistake.
     */
    isSensitive: boolean("is_sensitive").notNull().default(false),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityTable, t.entityId, t.occurredAt),
    index("audit_actor_idx").on(t.actorUserId, t.occurredAt),
    index("audit_occurred_idx").on(t.occurredAt),
    index("audit_sensitive_idx")
      .on(t.occurredAt)
      .where(sql`${t.isSensitive}`),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
