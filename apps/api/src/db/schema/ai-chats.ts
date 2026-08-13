import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./users";

/**
 * One conversation with the assistant.
 *
 * Kept on the server rather than in the browser for two reasons. It follows the
 * person to another machine, which is what anybody expects of a history list.
 * And a transcript can contain real figures — once it is here, deleting it
 * actually removes it, instead of leaving a copy in a local store that outlives
 * the session and survives signing out.
 *
 * It belongs to one person. Every read and write is scoped to `user_id`; there
 * is no endpoint that returns somebody else's conversation, Super Admin
 * included. Nothing here is a financial record, so a delete is a delete.
 */
export const aiChats = pgTable(
  "ai_chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** The opening line, trimmed — what shows in the history list. */
    title: text("title").notNull().default("New chat"),

    /** `[{ role, content }]`, the whole exchange in order. */
    messages: jsonb("messages")
      .$type<Array<{ role: "user" | "assistant"; content: string }>>()
      .notNull()
      .default([]),

    /**
     * The last reply, draft and all, so reopening a conversation puts the
     * half-filled form back rather than starting the questions again.
     */
    reply: jsonb("reply").$type<Record<string, unknown> | null>(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The history list is always "mine, newest first".
    index("ai_chats_user_idx").on(t.userId, t.updatedAt),
  ],
);

export type AiChatRow = typeof aiChats.$inferSelect;
export type NewAiChat = typeof aiChats.$inferInsert;
