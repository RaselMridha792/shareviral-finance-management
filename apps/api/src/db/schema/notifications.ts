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
