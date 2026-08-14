import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./users";

/**
 * One field somebody fixed on a draft before saving it.
 *
 * This is the app's only form of learning, and it is deliberately not the
 * obvious one. Fine-tuning is not available for these models, and would be the
 * wrong shape anyway: it wants thousands of examples where this company will
 * produce a few hundred a year, it freezes against a category list that
 * changes, a correction would take effect after a retraining run rather than
 * at once, and a lesson that turned out to be wrong could not be found and
 * removed. A row here can be deleted, and the next message is already better.
 *
 * The signal was always there and was being thrown away: the draft the model
 * produced is on the conversation, and the values the person actually
 * confirmed go to the endpoint. Where those two differ is a correction, and
 * nobody had to be asked for it.
 *
 * WHAT IS DELIBERATELY NOT KEPT HERE
 *
 * No money. Not the amount, not the rate, not a salary — see LEARNABLE_FIELDS.
 * Two reasons, and the second is the one that matters. An amount is true of one
 * payment and teaches nothing about the next. And these rows are read back into
 * other people's prompts, so anything kept here is shown to everybody the
 * filter lets through — an HR user has `ai.use` and no `transactions.read`, and
 * a "lesson" carrying ৳85,000 would walk the ledger straight through the wall
 * the whole permission matrix exists to hold. What is worth learning is which
 * words mean which category, and that survives the money being left out.
 *
 * `said` has its digits masked for the same reason, and reading is gated on the
 * permission for the record type — belt and braces, because this is the one
 * table whose whole purpose is to be shown to somebody else.
 */
export const aiCorrections = pgTable(
  "ai_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Which kind of record was being drafted. */
    target: varchar("target", { length: 32 }).notNull(),

    /** What the person had said, with every run of digits replaced. */
    said: text("said").notNull(),

    /** The field they changed. Always one of LEARNABLE_FIELDS. */
    field: varchar("field", { length: 64 }).notNull(),

    /** What the assistant had put there. Null when it left it empty. */
    drafted: text("drafted"),

    /** What they made it. Null when they cleared it. */
    corrected: text("corrected"),

    /**
     * Who corrected it — for removing one lesson later, not for showing.
     * `set null` so deleting a person does not delete what the company learnt.
     */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Read as "the most recent for this kind of record", every time.
  (t) => [index("ai_corrections_target_idx").on(t.target, t.createdAt)],
);

export type AiCorrectionRow = typeof aiCorrections.$inferSelect;
export type NewAiCorrection = typeof aiCorrections.$inferInsert;
