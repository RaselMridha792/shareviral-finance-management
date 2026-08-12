import { Injectable } from "@nestjs/common";
import {
  hasPermission,
  type AuditEntryDto,
  type ListAuditQuery,
  type Paginated,
} from "@finance/shared";
import { and, desc, eq, gte, ilike, lte, sql, type SQL } from "drizzle-orm";

import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { auditLogs, users } from "../../db/schema";

@Injectable()
export class AuditLogService {
  constructor(private readonly db: DbService) {}

  /**
   * The trail, newest first.
   *
   * Rows flagged sensitive keep their before/after hidden from a reader without
   * `team.compensation.read` — but the row still appears, with who and when
   * intact. An audit trail that conceals *that* something happened is worse
   * than one that conceals what changed: it makes the log itself unreliable.
   */
  async list(
    query: ListAuditQuery,
    actor: AuthenticatedUser,
  ): Promise<Paginated<AuditEntryDto>> {
    const where: SQL[] = [];
    if (query.from)
      where.push(gte(auditLogs.occurredAt, startOfDay(query.from)));
    if (query.to) where.push(lte(auditLogs.occurredAt, endOfDay(query.to)));
    if (query.action) where.push(eq(auditLogs.action, query.action));
    if (query.module) where.push(eq(auditLogs.module, query.module));
    if (query.actorUserId)
      where.push(eq(auditLogs.actorUserId, query.actorUserId));
    if (query.entityTable)
      where.push(eq(auditLogs.entityTable, query.entityTable));
    if (query.entityId) where.push(eq(auditLogs.entityId, query.entityId));
    if (query.q) where.push(ilike(auditLogs.summary, `%${query.q}%`));

    const filter = where.length ? and(...where) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.db.client
        .select({
          id: auditLogs.id,
          occurredAt: auditLogs.occurredAt,
          actorName: users.fullName,
          actorEmail: users.email,
          actorRole: auditLogs.actorRole,
          actorIp: auditLogs.actorIp,
          action: auditLogs.action,
          entityTable: auditLogs.entityTable,
          entityId: auditLogs.entityId,
          summary: auditLogs.summary,
          module: auditLogs.module,
          changedFields: auditLogs.changedFields,
          before: auditLogs.before,
          after: auditLogs.after,
          isSensitive: auditLogs.isSensitive,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.actorUserId, users.id))
        .where(filter)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),

      this.db.client
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(filter),
    ]);

    const maySeePay = hasPermission(actor.role, "team.compensation.read");

    return {
      items: rows.map((row) => {
        const redacted = row.isSensitive && !maySeePay;
        return {
          ...row,
          occurredAt: row.occurredAt.toISOString(),
          before: redacted ? null : row.before,
          after: redacted ? null : row.after,
          redacted,
        };
      }),
      total: Number(total),
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  /** The distinct values worth offering as filters, taken from real rows. */
  async filters() {
    const [modules, actors] = await Promise.all([
      this.db.client
        .selectDistinct({ module: auditLogs.module })
        .from(auditLogs)
        .where(sql`${auditLogs.module} is not null`)
        .orderBy(auditLogs.module),

      this.db.client
        .selectDistinct({
          id: users.id,
          fullName: users.fullName,
          role: users.role,
        })
        .from(auditLogs)
        .innerJoin(users, eq(auditLogs.actorUserId, users.id))
        .orderBy(users.fullName),
    ]);

    return {
      modules: modules.map((m) => m.module).filter(Boolean) as string[],
      actors,
    };
  }

  /** Everything recorded about one record, oldest first — its whole story. */
  async history(
    entityTable: string,
    entityId: string,
    actor: AuthenticatedUser,
  ) {
    const page = await this.list(
      {
        entityTable,
        entityId,
        page: 1,
        pageSize: 200,
      },
      actor,
    );
    return page.items.reverse();
  }
}

/* -------------------------------------------------------------------------- */

/**
 * A day in Dhaka, expressed as the UTC instants that bound it.
 *
 * The column is `timestamptz` and the server is very likely on UTC, so
 * filtering "13 August" against the raw date would silently include six hours
 * of the 12th and drop six of the 13th.
 */
function startOfDay(date: string): Date {
  return new Date(`${date}T00:00:00+06:00`);
}

function endOfDay(date: string): Date {
  return new Date(`${date}T23:59:59.999+06:00`);
}
