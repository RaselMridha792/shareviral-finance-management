import { Injectable } from "@nestjs/common";

import {
  getRequestContext,
  markAuditWritten,
} from "../context/request-context";
import { auditLogs } from "../../db/schema";
import { DbService } from "../../db/db.service";
import type { Database, DbTransaction } from "../../db";
import { diffFields, redact, type AuditEntry } from "./audit.types";

type Writer = Database | DbTransaction;

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  /**
   * Writes an audit row using `writer`.
   *
   * Pass the transaction handle whenever the change itself is transactional, so
   * the record and the change commit or roll back together.
   */
  async record(writer: Writer, entry: AuditEntry): Promise<void> {
    const context = getRequestContext();

    await writer.insert(auditLogs).values({
      actorUserId: entry.actorUserId ?? context?.userId ?? null,
      actorRole: entry.actorRole ?? context?.role ?? null,
      actorIp: context?.ip ?? null,
      actorUserAgent: context?.userAgent ?? null,
      requestId: context?.requestId ?? null,
      action: entry.action,
      entityTable: entry.entityTable,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      before: entry.before === undefined ? null : redact(entry.before),
      after: entry.after === undefined ? null : redact(entry.after),
      changedFields: diffFields(entry.before, entry.after) ?? null,
      module: entry.module ?? null,
      isSensitive: entry.isSensitive ?? false,
    });

    markAuditWritten();
  }

  /** Convenience for events outside a transaction — logins, exports. */
  async log(entry: AuditEntry): Promise<void> {
    await this.record(this.db.client, entry);
  }

  /**
   * Runs a mutation and records it in the same transaction.
   *
   * `read` fetches the row as it stands; it is called before and after so the
   * audit row carries a real before/after diff rather than just the request
   * payload. Either both the change and its audit row land, or neither does.
   */
  async mutate<T>(
    entry: Omit<AuditEntry, "before" | "after"> & {
      read: (tx: DbTransaction) => Promise<unknown>;
      run: (tx: DbTransaction) => Promise<T>;
      /** Builds the summary once the result is known. */
      describe?: (result: T, before: unknown, after: unknown) => string;
    },
  ): Promise<T> {
    const { read, run, describe, ...rest } = entry;

    return this.db.transaction(async (tx) => {
      const isCreate = rest.action === "create";
      const before = isCreate ? undefined : await read(tx);
      const result = await run(tx);

      // On a create there is nothing to read beforehand, so `read` is a no-op
      // and would leave `after` empty — the log would say a row was added
      // without recording what. The inserted row comes back from `run`.
      const after = isCreate
        ? result
        : rest.action === "delete"
          ? undefined
          : await read(tx);

      /**
       * On a create, the id only exists once `run` has returned it.
       *
       * Callers cannot pass `entityId` for a create — the row is not there yet
       * — and nothing back-filled it, so every create row in the log carried
       * `entity_id = null`. The row itself was fine, with a readable summary;
       * it was simply unreachable from the record it described, and
       * `GET /audit/accounts/:id` answered with the updates and no sign of who
       * created the account or with what opening balance. That is the first
       * question anybody asks of an audit trail.
       */
      const entityId =
        rest.entityId ??
        (isCreate && result && typeof result === "object" && "id" in result
          ? String((result as { id: unknown }).id)
          : undefined);

      await this.record(tx, {
        ...rest,
        entityId,
        before,
        after,
        summary: describe ? describe(result, before, after) : rest.summary,
      });

      return result;
    });
  }
}
