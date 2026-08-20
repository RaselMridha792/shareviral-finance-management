import { sql } from "drizzle-orm";
import {
  date,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * What has already been sent.
 *
 * The reason this table exists is not reporting. The reminder job runs every
 * day, and a renewal is three days away on exactly one of them — but a
 * restart, a retry, or a clock crossing midnight twice would each send again.
 * People filter an app that mails them twice, and then the reminder that
 * mattered is in a folder nobody opens.
 *
 * So sending is guarded by a unique index rather than by remembering: one
 * message per kind, per thing, per date, per person, enforced by the database.
 */
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /**
     * What the message was about — `subscription_renewal` today.
     *
     * A column rather than a table per kind: the second sort of reminder
     * should not need a migration.
     */
    kind: text("kind").notNull(),

    /** The thing, and the date it was about. */
    subjectId: uuid("subject_id"),
    subjectDate: date("subject_date"),

    recipient: varchar("recipient", { length: 200 }).notNull(),

    sentAt: timestamp("sent_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /**
     * `sent` or `failed`.
     *
     * A failure is recorded rather than retried forever. A reminder that
     * silently failed is worse than none, because it is relied on — so the
     * record is what lets somebody see it did not go.
     */
    outcome: text("outcome").notNull(),
    error: text("error"),
  },
  (t) => [
    // Only successes are unique. A failed attempt must not block the retry.
    uniqueIndex("notification_log_once_idx")
      .on(t.kind, t.subjectId, t.subjectDate, t.recipient)
      .where(sql`${t.outcome} = 'sent'`),
    index("notification_log_sent_at_idx").on(t.sentAt.desc()),
  ],
);

/**
 * The bell in the top bar.
 *
 * A different thing from the log above, and worth saying why rather than
 * folding the two together. `notification_log` records that a message left the
 * building — one row per address, whether or not the address belongs to
 * anybody with an account here. This table is one row per *person* per thing,
 * and it carries a read mark, because in-app the question is not "was it sent"
 * but "has this person seen it".
 *
 * Nothing here is written by a person. Every row is raised by a job, so the
 * only writes a browser makes are marking rows read.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Who it is for. One row per person — the bell is personal. */
    userId: uuid("user_id").notNull(),

    /**
     * Which of the four events raised it.
     *
     * Text rather than an enum, for the same reason the log's is: the fifth
     * kind should not need a migration in two databases.
     */
    kind: text("kind").notNull(),

    /**
     * What makes this one distinct from the next.
     *
     * Composed by whoever raises it — `subscription:<id>:2026-08-23`,
     * `tds:2026-07`, and so on — and never null, because a unique index over a
     * null is not unique in Postgres and the job runs every day. The whole
     * point is that a daily job can raise the same notification a hundred
     * times and one row exists.
     */
    dedupeKey: varchar("dedupe_key", { length: 160 }).notNull(),

    title: varchar("title", { length: 200 }).notNull(),
    body: text("body"),

    /** Where clicking it goes. Null for the few that have nowhere to send. */
    href: varchar("href", { length: 300 }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /** Null until it is read. The bell counts the nulls. */
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notifications_once_idx").on(t.userId, t.kind, t.dedupeKey),
    // The bell's own query: this person's, newest first.
    index("notifications_for_user_idx").on(t.userId, t.createdAt.desc()),
  ],
);
