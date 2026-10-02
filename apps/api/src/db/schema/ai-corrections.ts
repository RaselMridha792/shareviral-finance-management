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
 * filter lets through — HR held `ai.use` and no `transactions.read` until 3 Oct
 * 2026, and a "lesson" carrying ৳85,000 would have walked the ledger straight
 * through the wall the whole permission matrix exists to hold. What is worth
 * learning is which words mean which category, and that survives the money
 * being left out.
 *
 * `said` has its digits masked for the same reason, and reading is gated on the
 * permission for the record type — belt and braces, because this is the one
 * table whose whole purpose is to be shown to somebody else.
 *
 * TWO KINDS OF MISTAKE (2 Oct 2026, piece A2b of the "made strong" brief)
 *
 * A field changed before Save is one. A reply the person marks "this was
 * wrong", and says why, is the other: a count that was off, a request filed
 * under the wrong part of the app. Either way the row is what was asked
 * (`said`), what the Assistant gave (`drafted`) and what was right
 * (`corrected`). Made by `deploy/sql/2026-10-02-assistant-learning.sql`.
 */
export const aiCorrections = pgTable(
  "ai_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * `field`: a draft's field changed before Save — every row before A2b.
     * `reply`: a reply marked wrong.
     */
    kind: varchar("kind", { length: 16 })
      .$type<"field" | "reply">()
      .notNull()
      .default("field"),

    /**
     * Which kind of record was being drafted. Null on a reply marked wrong
     * that drafted nothing — a count, or "that is Payroll's".
     */
    target: varchar("target", { length: 32 }),

    /**
     * The part of the app's map the reply was in (`ai-intake/app-map.ts`).
     * Null on the rows from before A2b; their `target` says it.
     */
    area: varchar("area", { length: 32 }),

    /** What the person had said, with every run of digits replaced. */
    said: text("said").notNull(),

    /**
     * The field they changed. Always one of LEARNABLE_FIELDS. Null on a reply
     * marked wrong, which is about the whole answer.
     */
    field: varchar("field", { length: 64 }),

    /**
     * What the assistant had put there. Null when it left it empty. On a
     * reply marked wrong: what the reply said or drafted.
     */
    drafted: text("drafted"),

    /**
     * What they made it. Null when they cleared it. On a reply marked wrong:
     * what was right, in the person's words.
     */
    corrected: text("corrected"),

    /** Which model gave it, so the owner can see which one errs. */
    model: varchar("model", { length: 64 }),

    /**
     * When the owner made it one of their rules: a line written into
     * `app_settings.ai_instructions`. Null: not a rule.
     */
    ruledAt: timestamp("ruled_at", { withTimezone: true }),

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
