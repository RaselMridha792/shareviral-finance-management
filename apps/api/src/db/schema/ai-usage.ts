import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { aiChats } from "./ai-chats";
import { users } from "./users";

/**
 * One call to a model, and the tokens it took (3 Oct 2026, piece B3 of the
 * "made strong" brief). Made by `deploy/sql/2026-10-03-assistant-usage.sql`.
 *
 * The owner asked for a report and an optional monthly limit. The report reads
 * this by day, month, person and model; the cost beside it is an estimate,
 * worked out when it is read from a price table in the code, so there is no
 * cost column. The invoice from Anthropic or Google is the real figure.
 *
 * Nothing said is kept here: counts only. A row outlives the person and the
 * chat it came from (`set null`), because what was spent stays spent, and
 * deleting a chat must not lower the month's total under its limit.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Who asked. */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    /** The conversation, when there is one. Null for a key's Test. */
    chatId: uuid("chat_id").references(() => aiChats.id, {
      onDelete: "set null",
    }),

    /** The way it went, as `app_settings.ai_provider` names it. */
    provider: text("provider").$type<"anthropic" | "vertex">().notNull(),

    /** As the app names it. No check: the list changes when one is retired. */
    model: text("model").notNull(),

    /**
     * `turn`: one round of a conversation. `document`: a PDF read into a
     * statement. `test`: a key's Test button.
     */
    kind: text("kind")
      .$type<"turn" | "document" | "test">()
      .notNull()
      .default("turn"),

    /** Input at the full rate. Cached input is not in it. */
    inputTokens: integer("input_tokens").notNull().default(0),

    /** Input read back from the cache. */
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),

    /** Input written to Claude's cache. Gemini's writes nothing here. */
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),

    /** What the model wrote. Claude's thinking is counted in this. */
    outputTokens: integer("output_tokens").notNull().default(0),

    /**
     * Gemini's thinking, which Google counts apart and bills as output. Null
     * where the model gives no separate figure (Claude) — not the same as 0.
     */
    thinkingTokens: integer("thinking_tokens"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The month's total, read before every turn once a limit is set.
    index("ai_usage_created_idx").on(t.createdAt),
    // The report by person.
    index("ai_usage_user_idx").on(t.userId, t.createdAt),
    // Deleting a chat finds its rows without reading the whole table.
    index("ai_usage_chat_idx").on(t.chatId),
  ],
);

export type AiUsageRow = typeof aiUsage.$inferSelect;
export type NewAiUsage = typeof aiUsage.$inferInsert;
