import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { hasPermission } from "@finance/shared";
import { sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";

import {
  trashEntries,
  trashEntry,
  type TrashEntry,
  type TrashKind,
} from "./trash.registry";

export type TrashItem = {
  kind: TrashKind;
  kindLabel: string;
  id: string;
  title: string;
  detail: string | null;
  occurredAt: string | null;
  deletedAt: string;
  deletedBy: string | null;
  deletedByName: string | null;
  deleteReason: string | null;
};

/**
 * A row read straight back out of its own table.
 *
 * Every column comes along, because the audit's before-image should hold the
 * whole row rather than the handful this file reads. The three that are named
 * are the three it uses, and naming them is what stops `String(row.__title)`
 * quietly producing "[object Object]" on a table whose title expression
 * returned something unexpected.
 */
type StoredRow = Record<string, unknown> & {
  __title: string | null;
  deleted_at: string | null;
  transfer_group_id: string | null;
};

type Row = {
  kind: string;
  id: string;
  title: string | null;
  detail: string | null;
  occurred_at: string | null;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  delete_reason: string | null;
};

/**
 * Deleting, restoring, and the one operation that cannot be taken back.
 *
 * Three things are true of everything here and are worth stating once:
 *
 * 1. **A delete is a write, audited like any other.** `audit.mutate` reads the
 *    row before the change and stores it, which is what makes a purge
 *    survivable: the audit log holds the row's contents even after the row
 *    itself is gone.
 *
 * 2. **A money row is voided as it is deleted.** Every total in this
 *    application already excludes voided rows, so the sums are right the moment
 *    this ships rather than after twenty-nine queries have been edited.
 *
 * 3. **Permission is per kind, not per screen.** Whoever may write a
 *    transaction may delete one; whoever may not, may not — and the trash shows
 *    them nothing of that kind either, rather than showing a row they cannot
 *    act on.
 */
@Injectable()
export class TrashService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- reading */

  private allowed(actor: AuthenticatedUser): TrashEntry[] {
    return trashEntries().filter((e) =>
      hasPermission(actor.role, e.permission),
    );
  }

  private entryFor(kind: string, actor: AuthenticatedUser): TrashEntry {
    const entry = trashEntry(kind);
    if (!entry) throw new NotFoundException(`Nothing called "${kind}" here`);
    if (!hasPermission(actor.role, entry.permission)) {
      throw new ForbiddenException(
        `Your role cannot delete or restore a ${entry.label}`,
      );
    }
    return entry;
  }

  /** What each kind is called and how many of it are in the trash. */
  async summary(actor: AuthenticatedUser) {
    const entries = this.allowed(actor);
    if (entries.length === 0) return [];

    const counts = await this.db.client.execute(
      sql.raw(
        entries
          .map(
            (e) =>
              `select '${e.kind}' as kind, count(*)::int as n from ${e.table} where deleted_at is not null`,
          )
          .join(" union all "),
      ),
    );
    const byKind = new Map(
      (counts.rows as unknown as { kind: string; n: number }[]).map((r) => [
        r.kind,
        r.n,
      ]),
    );

    return entries.map((e) => ({
      kind: e.kind,
      label: e.label,
      plural: e.plural,
      count: byKind.get(e.kind) ?? 0,
    }));
  }

  /**
   * Everything deleted, newest first, across every kind the caller may see.
   *
   * One union rather than fifteen requests, so "what went missing on Tuesday"
   * is answerable by scrolling rather than by checking fifteen tabs.
   */
  async list(
    actor: AuthenticatedUser,
    query: { kind?: string; page?: number; pageSize?: number },
  ) {
    let entries = this.allowed(actor);
    if (query.kind) {
      const one = this.entryFor(query.kind, actor);
      entries = [one];
    }
    if (entries.length === 0) {
      return { items: [], total: 0, page: 1, pageSize: 20 };
    }

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));

    /*
     * `u` is the deleter, joined here rather than looked up per row: a trash
     * holding two hundred rows would otherwise be two hundred and one queries,
     * and "who deleted this" is the second thing anybody asks of it.
     */
    const union = entries
      .map(
        (e) => `
        select '${e.kind}' as kind,
               r.id::text as id,
               (${e.title})::text as title,
               (${e.detail})::text as detail,
               (${e.occurredAt})::text as occurred_at,
               r.deleted_at,
               r.deleted_by::text as deleted_by,
               u.full_name as deleted_by_name,
               r.delete_reason
          from ${e.table} r
          left join users u on u.id = r.deleted_by
         where r.deleted_at is not null`,
      )
      .join(" union all ");

    const [rows, totals] = await Promise.all([
      this.db.client.execute(
        sql`${sql.raw(`select * from (${union}) t order by t.deleted_at desc`)} limit ${pageSize} offset ${(page - 1) * pageSize}`,
      ),
      this.db.client.execute(
        sql.raw(`select count(*)::int as n from (${union}) t`),
      ),
    ]);

    const labels = new Map(entries.map((e) => [e.kind, e.label]));

    return {
      items: (rows.rows as unknown as Row[]).map((r): TrashItem => ({
        kind: r.kind as TrashKind,
        kindLabel: labels.get(r.kind as TrashKind) ?? r.kind,
        id: r.id,
        title: r.title ?? "(no name)",
        detail: r.detail,
        occurredAt: r.occurred_at,
        deletedAt: new Date(r.deleted_at).toISOString(),
        deletedBy: r.deleted_by,
        deletedByName: r.deleted_by_name,
        deleteReason: r.delete_reason,
      })),
      total: (totals.rows as unknown as { n: number }[])[0]?.n ?? 0,
      page,
      pageSize,
    };
  }

  /* --------------------------------------------------------------- deleting */

  /** The row as it stands, for the audit's before-image and the summary. */
  private async readRow(entry: TrashEntry, id: string) {
    const found = await this.db.client.execute(
      sql`${sql.raw(`select r.*, (${entry.title})::text as __title from ${entry.table} r where r.id`)} = ${id}::uuid`,
    );
    const row = (found.rows as unknown as StoredRow[])[0];
    if (!row) throw new NotFoundException(`That ${entry.label} is not here`);
    return row;
  }

  /**
   * Moves a row to the trash.
   *
   * It is still in its table — every id pointing at it still resolves, and the
   * audit log still reads. What changes is that nothing lists it and, for money
   * rows, nothing counts it.
   */
  async remove(
    kind: string,
    id: string,
    reason: string | null,
    actor: AuthenticatedUser,
  ) {
    const entry = this.entryFor(kind, actor);
    const row = await this.readRow(entry, id);

    if (row.deleted_at) {
      throw new BadRequestException(`That ${entry.label} is already deleted`);
    }

    if (entry.blockedWhen) {
      const check = await this.db.client.execute(
        sql`${sql.raw(`select (${entry.blockedWhen.sql}) as blocked from ${entry.table} r where r.id`)} = ${id}::uuid`,
      );
      if ((check.rows as unknown as { blocked: boolean }[])[0]?.blocked) {
        throw new BadRequestException(entry.blockedWhen.message);
      }
    }

    /*
     * A transfer is one movement written as two rows. Deleting half of it
     * would leave the two accounts disagreeing for ever, which is exactly what
     * `void` already guards against — the same rule, for the same reason.
     */
    const ids = await this.siblingIds(entry, id, row);

    await this.audit.mutate({
      action: "delete",
      entityTable: entry.table,
      entityId: id,
      module: entry.module,
      summary:
        `Deleted ${entry.label} "${row.__title ?? id}"` +
        (ids.length > 1 ? ` and its matching transfer row` : "") +
        (reason ? `: ${reason}` : ""),
      read: () => Promise.resolve(row),
      run: async (tx) => {
        /*
         * `now()` is the transaction's own clock, so `deleted_at` and the
         * `voided_at` set beside it land on exactly the same instant. Restore
         * reads that equality to tell a void it caused from one that was
         * already there — see `restore` below.
         */
        await tx.execute(
          sql`${sql.raw(`update ${entry.table} set`)}
                deleted_at = now(),
                deleted_by = ${actor.id}::uuid,
                delete_reason = ${reason}
                ${
                  entry.alsoVoids
                    ? sql`, voided_at = coalesce(voided_at, now()),
                          voided_by = coalesce(voided_by, ${actor.id}::uuid),
                          void_reason = coalesce(void_reason, 'Deleted')`
                    : sql``
                }
              where id in (${sql.join(
                ids.map((one) => sql`${one}::uuid`),
                sql`, `,
              )})`,
        );
      },
    });

    return { deleted: ids.length };
  }

  /** Both halves of a transfer, or just the one row. */
  private async siblingIds(
    entry: TrashEntry,
    id: string,
    row: StoredRow,
  ): Promise<string[]> {
    if (entry.kind !== "transaction" || !row.transfer_group_id) return [id];
    const found = await this.db.client.execute(
      sql`select id::text as id from transactions where transfer_group_id = ${row.transfer_group_id}::uuid and deleted_at is null`,
    );
    return (found.rows as unknown as { id: string }[]).map((r) => r.id);
  }

  /* -------------------------------------------------------------- restoring */

  /** Puts it back exactly where it was. */
  async restore(kind: string, id: string, actor: AuthenticatedUser) {
    const entry = this.entryFor(kind, actor);
    const row = await this.readRow(entry, id);

    if (!row.deleted_at) {
      throw new BadRequestException(`That ${entry.label} is not in the trash`);
    }

    const ids = await this.siblingIdsInTrash(entry, id, row);

    await this.audit.mutate({
      // There is no "restore" in the audit action enum, and adding one means
      // ALTER TYPE against two databases for a word. "update" with a sentence
      // that says what happened carries the same meaning to a reader.
      action: "update",
      entityTable: entry.table,
      entityId: id,
      module: entry.module,
      summary: `Restored ${entry.label} "${row.__title ?? id}" from the trash`,
      read: () => Promise.resolve(row),
      run: async (tx) => {
        /*
         * The void comes off only if this delete is what put it on.
         *
         * A row can be voided on Monday and deleted on Tuesday; restoring it
         * should give back a voided row, not an entry that quietly rejoins
         * every total. `voided_at = deleted_at` is exactly true when both were
         * written by the same statement, and false otherwise.
         */
        await tx.execute(
          sql`${sql.raw(
            `update ${entry.table} set deleted_at = null, deleted_by = null, delete_reason = null` +
              (entry.alsoVoids
                ? `, voided_at = case when voided_at = deleted_at then null else voided_at end` +
                  `, voided_by = case when voided_at = deleted_at then null else voided_by end` +
                  `, void_reason = case when voided_at = deleted_at then null else void_reason end`
                : ""),
          )} where id in (${sql.join(
            ids.map((one) => sql`${one}::uuid`),
            sql`, `,
          )})`,
        );
      },
    });

    return { restored: ids.length };
  }

  private async siblingIdsInTrash(
    entry: TrashEntry,
    id: string,
    row: StoredRow,
  ): Promise<string[]> {
    if (entry.kind !== "transaction" || !row.transfer_group_id) return [id];
    const found = await this.db.client.execute(
      sql`select id::text as id from transactions where transfer_group_id = ${row.transfer_group_id}::uuid and deleted_at is not null`,
    );
    return (found.rows as unknown as { id: string }[]).map((r) => r.id);
  }

  /* ---------------------------------------------------------------- purging */

  /**
   * Removes it from the database. There is no way back from here.
   *
   * The audit row written by `mutate` keeps the row's contents, so what the
   * entry said survives even though the entry does not — which is the
   * difference between a purge and a hole in the record.
   */
  async purge(kind: string, id: string, actor: AuthenticatedUser) {
    const entry = this.entryFor(kind, actor);
    const row = await this.readRow(entry, id);

    if (!row.deleted_at) {
      throw new BadRequestException(
        `That ${entry.label} is not in the trash. Only something already deleted can be removed for good.`,
      );
    }

    await this.audit.mutate({
      action: "delete",
      entityTable: entry.table,
      entityId: id,
      module: entry.module,
      isSensitive: true,
      summary: `Permanently removed ${entry.label} "${row.__title ?? id}" from the trash`,
      read: () => Promise.resolve(row),
      run: async (tx) => {
        await tx.execute(
          sql`${sql.raw(`delete from ${entry.table} where id`)} = ${id}::uuid and deleted_at is not null`,
        );
      },
    });

    return { purged: 1 };
  }

  /**
   * Empties the trash of every kind the caller may act on.
   *
   * Deliberately not "everything in the trash": somebody who may delete a
   * category should not, by pressing one button, destroy the transactions
   * another role put there. What each role can empty is what that role could
   * have deleted in the first place.
   */
  async empty(actor: AuthenticatedUser) {
    const entries = this.allowed(actor);
    let purged = 0;

    for (const entry of entries) {
      const rows = await this.db.client.execute(
        sql.raw(
          `select r.id::text as id, (${entry.title})::text as title from ${entry.table} r where r.deleted_at is not null`,
        ),
      );
      const found = rows.rows as unknown as { id: string; title: string }[];
      if (found.length === 0) continue;

      await this.audit.mutate({
        action: "delete",
        entityTable: entry.table,
        entityId: null,
        module: entry.module,
        isSensitive: true,
        summary: `Emptied ${found.length} ${entry.plural.toLowerCase()} from the trash: ${found
          .map((r) => r.title)
          .slice(0, 10)
          .join(", ")}${found.length > 10 ? ", and more" : ""}`,
        read: () => Promise.resolve(found),
        run: async (tx) => {
          await tx.execute(
            sql.raw(`delete from ${entry.table} where deleted_at is not null`),
          );
        },
      });
      purged += found.length;
    }

    return { purged };
  }
}
