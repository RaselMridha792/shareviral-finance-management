import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { DbService } from "../../db/db.service";
import { notifications, users } from "../../db/schema";

/**
 * The bell, and the only place anything writes to it.
 *
 * Two rules hold this together and both are about the same failure. First,
 * nothing here decides *when* an event happens — the events service does, and
 * this takes an already-composed message. Second, raising is idempotent: the
 * jobs that call it run daily, and "already raised" has to be the normal case
 * rather than an error, or every restart doubles somebody's bell.
 *
 * Idempotence is the database's, not this code's. A read-then-write would let
 * two runs both find nothing and both insert; inserting and letting the unique
 * index refuse the duplicate is the version that holds when the same minute
 * happens twice.
 */

export type RaiseArgs = {
  /** Who to tell. Empty is fine and does nothing. */
  userIds: string[];
  kind: string;
  /**
   * What makes this notification distinct — `subscription:<id>:<date>`.
   *
   * Composed by the caller because only the caller knows what "the same one
   * again" means for its event: a renewal is per plan per date, a deadline is
   * per period, and a month's unpaid payroll is per month.
   */
  dedupeKey: string;
  title: string;
  body?: string;
  href?: string;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  /**
   * Raise one for each person, and return how many were actually new.
   *
   * The count is what a caller reports — "raised 3" has to mean three people
   * learnt something, not three rows the index threw away.
   */
  async raise(args: RaiseArgs): Promise<number> {
    if (args.userIds.length === 0) return 0;

    const inserted = await this.db.client
      .insert(notifications)
      .values(
        args.userIds.map((userId) => ({
          userId,
          kind: args.kind,
          dedupeKey: args.dedupeKey,
          title: args.title,
          body: args.body ?? null,
          href: args.href ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: notifications.id });

    return inserted.length;
  }

  /**
   * The people in these roles who could actually read a bell.
   *
   * Active and not deleted, because raising a notification for somebody whose
   * account is closed writes rows nobody will ever mark read — and the unread
   * count on a shared screen is then permanently wrong.
   */
  async recipientsInRoles(roles: ("cfo" | "super_admin" | "admin")[]) {
    const rows = await this.db.client
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.role, roles),
          eq(users.status, "active"),
          isNull(users.deletedAt),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** This person's, newest first, with the unread count for the badge. */
  async forUser(userId: string, limit = 30) {
    const rows = await this.db.client
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    const [{ unread }] = await this.db.client
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );

    return { items: rows, unread };
  }

  /**
   * Mark one read.
   *
   * Scoped to the signed-in person in the `where`, not checked first and
   * updated after: an id from a browser is somebody's guess until the query
   * proves otherwise, and a two-step version is a window where it stops being
   * true.
   */
  async markRead(userId: string, id: string) {
    const [row] = await this.db.client
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });

    return { marked: Boolean(row) };
  }

  async markAllRead(userId: string) {
    const rows = await this.db.client
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      )
      .returning({ id: notifications.id });

    return { marked: rows.length };
  }
}
