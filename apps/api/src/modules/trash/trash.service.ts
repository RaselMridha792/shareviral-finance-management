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
import { overdraftWatch } from "../../common/money/overdraft";

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

    /*
     * Deleting an "in" row takes money back out of the account's story, and
     * spending recorded after it may then never have been possible. The
     * account rule — never below zero — holds here exactly as it does at the
     * moment of typing an expense, and the refusal names the account.
     */
    const watch =
      entry.kind === "transaction"
        ? await overdraftWatch(this.db.client, await this.accountIdsOf(ids))
        : null;

    await this.audit.mutate({
      action: "delete",
      entityTable: entry.table,
      entityId: id,
      module: entry.module,
      summary:
        `Deleted ${entry.label} "${row.__title ?? id}"` +
        alsoWent(entry, ids.length) +
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
        if (watch) await watch.assert(tx);
      },
    });

    return { deleted: ids.length };
  }

  /**
   * The same act, on a ticked list.
   *
   * The owner's complaint was arithmetic: "akhon to prottekta one by one trash
   * a felte hoy". Forty rows meant forty confirmations. What this must NOT do
   * is become a softer delete than the single one — every refusal `remove`
   * makes, this makes too, and it makes them BEFORE writing anything.
   *
   * All-or-nothing, in one transaction. The alternative — delete what we can
   * and report the rest — reads as success and leaves the owner to work out
   * which of forty rows are still there. `imports.service.ts` already answers
   * this question the same way for the same reason.
   *
   * The audit trail is N + 1 rows, all sharing one `request_id`: one per
   * deleted id, keeping its own `entity_id` and before-image so that row's own
   * history still reads, and one envelope naming the act. A single row with
   * `entity_id = null` would be unreachable from `GET /audit/:table/:id`, which
   * is where somebody looks when they ask what happened to *this* entry.
   */
  async removeMany(
    kind: string,
    ids: string[],
    reason: string | null,
    actor: AuthenticatedUser,
  ) {
    const entry = this.entryFor(kind, actor);
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) {
      throw new BadRequestException("Nothing was selected");
    }

    /*
     * Read every row first, and refuse the whole request naming what is wrong
     * with it. A partial answer here is the thing this is trying to avoid.
     */
    const rows = new Map<string, StoredRow>();
    const refusals: string[] = [];
    for (const id of wanted) {
      const row = await this.readRow(entry, id);
      if (row.deleted_at) {
        refusals.push(`"${row.__title ?? id}" is already in the trash`);
        continue;
      }
      rows.set(id, row);
    }

    if (entry.blockedWhen && rows.size > 0) {
      const live = [...rows.keys()];
      const check = await this.db.client.execute(
        sql`${sql.raw(`select r.id::text as id, (${entry.blockedWhen.sql}) as blocked, (${entry.title})::text as __title from ${entry.table} r where r.id`)} in (${sql.join(
          live.map((one) => sql`${one}::uuid`),
          sql`, `,
        )})`,
      );
      for (const found of check.rows as unknown as {
        id: string;
        blocked: boolean;
        __title: string | null;
      }[]) {
        if (found.blocked) {
          refusals.push(
            `"${found.__title ?? found.id}" — ${entry.blockedWhen.message}`,
          );
          rows.delete(found.id);
        }
      }
    }

    if (refusals.length > 0) {
      throw new BadRequestException(
        `Nothing was deleted. ${refusals.length} of ${wanted.length} cannot be: ` +
          refusals.slice(0, 5).join("; ") +
          (refusals.length > 5 ? ` and ${refusals.length - 5} more` : ""),
      );
    }

    /*
     * Expand each through its siblings — a transfer's other half, a heading's
     * children — then dedupe, because two ticked halves of one transfer must
     * not be counted twice.
     */
    const expanded = new Set<string>();
    for (const [id, row] of rows) {
      for (const sibling of await this.siblingIds(entry, id, row)) {
        expanded.add(sibling);
      }
    }
    const all = [...expanded];

    /* One watch over every account any of them touches, not one per row. */
    const watch =
      entry.kind === "transaction"
        ? await overdraftWatch(this.db.client, await this.accountIdsOf(all))
        : null;

    const alsoCount = all.length - rows.size;
    await this.audit.mutate({
      action: "delete",
      entityTable: entry.table,
      /*
       * The envelope names no single row on purpose — it is the act, not an
       * entry. The per-row rows below carry the entity ids.
       */
      entityId: null,
      module: entry.module,
      summary:
        `Moved ${rows.size} ${rows.size === 1 ? entry.label : entry.label + "s"} to the trash` +
        (alsoCount > 0
          ? ` (${all.length} rows including what had to go with them)`
          : "") +
        (reason ? `: ${reason}` : ""),
      read: () => Promise.resolve({ ids: all }),
      run: async (tx) => {
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
                all.map((one) => sql`${one}::uuid`),
                sql`, `,
              )})`,
        );

        /* One line per ticked row, so each entry's own history still reads. */
        for (const [id, row] of rows) {
          await this.audit.record(tx, {
            action: "delete",
            entityTable: entry.table,
            entityId: id,
            module: entry.module,
            summary:
              `Deleted ${entry.label} "${row.__title ?? id}"` +
              (reason ? `: ${reason}` : ""),
            before: row,
          });
        }

        if (watch) await watch.assert(tx);
        return { ticked: rows.size, deleted: all.length };
      },
    });

    return { ticked: rows.size, deleted: all.length };
  }

  /** The accounts a set of transaction rows sits on. */
  private async accountIdsOf(ids: string[]): Promise<string[]> {
    const found = await this.db.client.execute(
      sql`select distinct account_id::text as id from transactions where id in (${sql.join(
        ids.map((one) => sql`${one}::uuid`),
        sql`, `,
      )})`,
    );
    return (found.rows as unknown as { id: string }[]).map((r) => r.id);
  }

  /**
   * What goes with the row: both halves of a transfer, a heading's
   * sub-categories, or nothing.
   *
   * A sub-category is not a separate thing that happens to point at a heading
   * — it is part of it. Left behind, it belongs to a heading that is in the
   * trash, which means it renders nowhere (the screen draws headings and their
   * children) while payments carry on being filed against it. Invisible and
   * still in use is the worst of the three possible answers, so it travels
   * with its parent, and `restore` brings back exactly the ones that came.
   */
  private async siblingIds(
    entry: TrashEntry,
    id: string,
    row: StoredRow,
  ): Promise<string[]> {
    if (entry.kind === "category") {
      const found = await this.db.client.execute(
        sql`select id::text as id from categories
             where parent_id = ${id}::uuid and deleted_at is null`,
      );
      return [
        id,
        ...(found.rows as unknown as { id: string }[]).map((r) => r.id),
      ];
    }
    if (entry.kind !== "transaction" || !row.transfer_group_id) return [id];
    const found = await this.db.client.execute(
      sql`select id::text as id from transactions where transfer_group_id = ${row.transfer_group_id}::uuid and deleted_at is null`,
    );
    return (found.rows as unknown as { id: string }[]).map((r) => r.id);
  }

  /* -------------------------------------------------------------- restoring */

  /** Puts it back exactly where it was. */
  /**
   * Restore, or purge, a ticked list.
   *
   * Bulk delete arrived without a bulk undo, which made the delete more
   * dangerous than it needed to be: forty rows went in one click and came back
   * in forty. So these two exist for the same reason the bulk delete does, and
   * they are deliberately thin — each is the single act, in a loop, inside one
   * transaction is NOT what happens here and that is worth saying.
   *
   * They loop over `restore`/`purge` as they are, one at a time, each with its
   * own audit row. Two reasons, and the second is the one that decided it:
   *
   *   - restore has real per-row logic (a void it caused versus one that was
   *     already there, a heading's children, a sibling still in the trash) and
   *     re-implementing that in a set-based query is how the two would drift;
   *   - unlike a delete, a PARTIAL restore is not a trap. Nothing is lost by
   *     twelve of twenty coming back — the other eight are still in the trash,
   *     visibly, and can be tried again. The all-or-nothing rule earned its
   *     place on the delete because a half-delete looks like success; a
   *     half-restore looks like a half-restore.
   *
   * So this reports what happened rather than refusing the lot, and the screen
   * says so.
   */
  async restoreMany(kind: string, ids: string[], actor: AuthenticatedUser) {
    /*
     * The kind is checked ONCE, up front, and is allowed to throw.
     *
     * Without this a mistyped kind — or a role that may not touch this sort of
     * row — came back as HTTP 201 with every id listed as an individual
     * failure, which reads as "the rows are the problem" when the request was.
     * A permission refusal in particular must not be reported as twenty
     * separate mishaps.
     */
    this.entryFor(kind, actor);
    return this.eachOf(ids, (id) => this.restore(kind, id, actor));
  }

  async purgeMany(kind: string, ids: string[], actor: AuthenticatedUser) {
    this.entryFor(kind, actor);
    return this.eachOf(ids, (id) => this.purge(kind, id, actor));
  }

  private async eachOf(
    ids: string[],
    act: (id: string) => Promise<unknown>,
  ): Promise<{ done: number; failed: { id: string; reason: string }[] }> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) {
      throw new BadRequestException("Nothing was selected");
    }
    if (wanted.length > 200) {
      throw new BadRequestException("Too many at once — 200 is the limit");
    }

    let done = 0;
    const failed: { id: string; reason: string }[] = [];
    for (const id of wanted) {
      try {
        await act(id);
        done += 1;
      } catch (caught) {
        failed.push({
          id,
          reason:
            caught instanceof Error ? caught.message : "That one did not work.",
        });
      }
    }
    return { done, failed };
  }

  async restore(kind: string, id: string, actor: AuthenticatedUser) {
    const entry = this.entryFor(kind, actor);
    const row = await this.readRow(entry, id);

    if (!row.deleted_at) {
      throw new BadRequestException(`That ${entry.label} is not in the trash`);
    }

    const ids = await this.siblingIdsInTrash(entry, id, row);

    // Restoring an "out" row spends the money again. The account rule holds
    // on the way out of the trash exactly as it does everywhere else.
    const watch =
      entry.kind === "transaction"
        ? await overdraftWatch(this.db.client, await this.accountIdsOf(ids))
        : null;

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
        if (watch) await watch.assert(tx);
      },
    });

    return { restored: ids.length };
  }

  private async siblingIdsInTrash(
    entry: TrashEntry,
    id: string,
    row: StoredRow,
  ): Promise<string[]> {
    if (entry.kind === "category") {
      /*
       * `deleted_at` equality, the same trick `restore` uses on `voided_at`:
       * the cascade wrote parent and children in one statement, so they share
       * the transaction's clock to the microsecond. A sub-category deleted on
       * its own last week does not match, and stays in the trash where its
       * owner put it.
       */
      const found = await this.db.client.execute(
        sql`select id::text as id from categories
             where parent_id = ${id}::uuid and deleted_at = ${row.deleted_at}`,
      );
      return [
        id,
        ...(found.rows as unknown as { id: string }[]).map((r) => r.id),
      ];
    }
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

    /*
     * A transfer purges as the pair it is, for the same reason it deletes as
     * one: removing half for ever leaves the other half in the trash pointing
     * at a movement that no longer has a far side, and restoring it later
     * would un-balance two accounts at once.
     */
    const ids = await this.siblingIdsInTrash(entry, id, row);

    try {
      await this.audit.mutate({
        action: "delete",
        entityTable: entry.table,
        entityId: id,
        module: entry.module,
        isSensitive: true,
        summary:
          `Permanently removed ${entry.label} "${row.__title ?? id}"` +
          alsoWent(entry, ids.length) +
          ` from the trash`,
        read: () => Promise.resolve(row),
        run: async (tx) => {
          await tx.execute(
            sql`${sql.raw(`delete from ${entry.table} where deleted_at is not null and id`)} in (${sql.join(
              ids.map((one) => sql`${one}::uuid`),
              sql`, `,
            )})`,
          );
        },
      });
    } catch (caught) {
      /*
       * The database refuses to orphan what still points here — ledger rows
       * at an account, payroll lines at a person. Soft delete has no such
       * wall (the row survives, hidden), but a permanent delete would leave
       * references to a row that does not exist, and Postgres will not.
       * Turned into a sentence, because a 500 says none of that.
       */
      if (isForeignKeyViolation(caught)) {
        throw new BadRequestException(
          `This ${entry.label} still has records pointing at it — ledger entries, payroll lines or files. ` +
            `It can stay in the trash, but it can only be removed for good once those are gone too.`,
        );
      }
      throw caught;
    }

    return { purged: ids.length };
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
    const kept: string[] = [];

    for (const entry of entries) {
      const rows = await this.db.client.execute(
        sql.raw(
          `select r.id::text as id, (${entry.title})::text as title from ${entry.table} r where r.deleted_at is not null`,
        ),
      );
      const found = rows.rows as unknown as { id: string; title: string }[];
      if (found.length === 0) continue;

      try {
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
              sql.raw(
                `delete from ${entry.table} where deleted_at is not null`,
              ),
            );
          },
        });
        purged += found.length;
      } catch (caught) {
        // Rows still referenced from outside stay in the trash; everything
        // else empties. Reported by kind rather than failing the sweep.
        if (isForeignKeyViolation(caught)) {
          kept.push(entry.plural.toLowerCase());
          continue;
        }
        throw caught;
      }
    }

    return {
      purged,
      kept,
      message: kept.length
        ? `Some ${kept.join(", ")} stayed: records elsewhere still point at them, so they cannot be removed for good yet.`
        : undefined,
    };
  }
}

/**
 * Postgres 23503: a FOREIGN KEY held. The driver wraps it, so the code is
 * read off whichever layer carries it.
 */
/**
 * What the audit line says came along, in words that fit what it was.
 *
 * "and its matching transfer row" was written when a transfer pair was the
 * only thing that travelled. A heading now takes its sub-categories, and an
 * audit entry that describes those as a transfer row is a record that misleads
 * whoever reads it back.
 */
function alsoWent(entry: TrashEntry, count: number): string {
  if (count <= 1) return "";
  if (entry.kind === "category") {
    const kids = count - 1;
    return ` and its ${kids} sub-categor${kids === 1 ? "y" : "ies"}`;
  }
  return " and its matching transfer row";
}

function isForeignKeyViolation(caught: unknown): boolean {
  const err = caught as { code?: string; cause?: { code?: string } };
  return err?.code === "23503" || err?.cause?.code === "23503";
}
