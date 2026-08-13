import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  inet,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { userRoleEnum, userStatusEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    role: userRoleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("active"),

    /**
     * Links a login to an employee record. No FK yet — team_members arrives in
     * Phase 5; the constraint is added then.
     */
    teamMemberId: uuid("team_member_id"),

    /**
     * Bumped when the role changes or the password is reset. A JWT carrying an
     * older value is rejected, so a demoted user's live token dies immediately
     * instead of staying valid until it expires.
     */
    tokenVersion: integer("token_version").notNull().default(0),

    mustChangePassword: boolean("must_change_password")
      .notNull()
      .default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),

    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    // Multi-entity provision. Unenforced for now — see the plan.
    entityId: uuid("entity_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Case-insensitive: "Mirza@x.com" and "mirza@x.com" are one account.
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
    index("users_role_idx").on(t.role),
  ],
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /**
     * SHA-256 of an opaque random token — never the token itself, and never a
     * JWT. A leaked database dump must not yield usable sessions.
     */
    tokenHash: text("token_hash").notNull(),

    /**
     * Rotation family. Every refresh issues a new row in the same family; if a
     * token that was already rotated is presented again, the whole family is
     * revoked because the only way that happens is theft.
     */
    familyId: uuid("family_id").notNull(),

    userAgent: text("user_agent"),
    ip: inet("ip"),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    replacedById: uuid("replaced_by_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_idx").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId, t.expiresAt),
    index("refresh_tokens_family_idx").on(t.familyId),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
