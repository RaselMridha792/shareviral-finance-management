/**
 * Two-factor enrolment, and the codes that get somebody back in when the phone
 * is gone.
 *
 * Two tables rather than columns on `users`, for a reason that is about
 * deploying rather than about tidiness. Drizzle names every column in its
 * SELECT, so adding one to `users` means the very next login asks for a column
 * the database does not have yet — and there is no window in which that is not
 * every user, locked out, until a schema push catches up. A new table is only
 * touched by code that reads it, so the table can be created in one deploy and
 * used in the next.
 */
import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

export const userTwoFactor = pgTable(
  "user_two_factor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /**
     * The shared secret, encrypted — never the base32 an authenticator app
     * would accept. The nightly dump leaves this machine for Google Drive, and
     * a dump that hands over both the password hash and the second factor has
     * given away the whole point of having a second factor.
     *
     * Sealed with `common/crypto/secret-box`, the same AES-256-GCM box the
     * assistant's API key already uses. Its key lives in the environment, so
     * this table restored anywhere else yields nothing.
     *
     * One inherited behaviour matters here and is handled at the call site,
     * not by trusting it: `open()` returns null rather than throwing when the
     * server secret has been rotated. For an API key that is right. For this
     * column, null must be an error — read as "no second factor" it would turn
     * two-factor off for everybody, silently, on the day a secret was rotated.
     */
    secretEncrypted: text("secret_encrypted").notNull(),

    /**
     * Null while enrolment is half-done: a secret has been issued and shown as
     * a QR, but no code has been typed back yet. Nothing counts as enrolled
     * until this is set, so an abandoned setup cannot lock anybody out.
     */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    /**
     * The last time step accepted for this user. Anything at or below it is
     * refused, which is what stops a code being reused inside its own window —
     * long enough to be read over a shoulder and typed in again.
     *
     * bigint because a time step is seconds/30 and will outlive int4.
     */
    lastStep: bigint("last_step", { mode: "number" }),

    /**
     * Wrong codes in a row, and the wall they hit. Separate from the password
     * lockout on `users`: someone who knows the password and is guessing at
     * six digits has already passed that one, and 10^6 is not a large number
     * without a counter of its own.
     */
    failedCount: bigint("failed_count", { mode: "number" })
      .notNull()
      .default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One enrolment per person. Starting a new setup replaces the old row
    // rather than leaving two secrets that both open the door.
    uniqueIndex("user_two_factor_user_idx").on(t.userId),
  ],
);

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /**
     * SHA-256 of the code, not bcrypt.
     *
     * That is the opposite of the rule for passwords, and deliberately: bcrypt
     * is slow to make *guessable* secrets expensive to guess. These are ten
     * random 80-bit strings this server generated, so there is nothing to
     * guess, and a slow hash would only mean ten slow comparisons on a login
     * path that already has a bcrypt in it.
     */
    codeHash: text("code_hash").notNull(),

    /** Kept rather than deleted, so "which code was spent, and when" survives. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedIp: text("used_ip"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("recovery_codes_hash_idx").on(t.codeHash),
    index("recovery_codes_user_idx").on(t.userId, t.usedAt),
  ],
);

export const userTwoFactorRelations = relations(userTwoFactor, ({ one }) => ({
  user: one(users, { fields: [userTwoFactor.userId], references: [users.id] }),
}));

export const recoveryCodesRelations = relations(recoveryCodes, ({ one }) => ({
  user: one(users, { fields: [recoveryCodes.userId], references: [users.id] }),
}));

export type UserTwoFactor = typeof userTwoFactor.$inferSelect;
export type NewUserTwoFactor = typeof userTwoFactor.$inferInsert;
export type RecoveryCode = typeof recoveryCodes.$inferSelect;
export type NewRecoveryCode = typeof recoveryCodes.$inferInsert;
