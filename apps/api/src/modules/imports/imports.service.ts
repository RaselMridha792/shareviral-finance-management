import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import ExcelJS from "exceljs";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import { AuditService } from "../../common/audit/audit.service";
import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import {
  accounts,
  categories,
  importBatches,
  importRows,
  transactions,
  vendors,
} from "../../db/schema";
import { SettingsService } from "../settings/settings.service";
import { dedupeKey } from "../transactions/transactions.service";
import type {
  CommitInput,
  MappingInput,
  PreviewQuery,
  TransactionField,
} from "./imports.schemas";
import { parseRow, type RawRow } from "./row-parser";
import { nextRefNos } from "../transactions/ref-no";

const MAX_ROWS = 10_000;

@Injectable()
export class ImportsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  /** Reads the file, stores every row verbatim, and returns the headers. */
  async upload(
    file: { originalname: string; buffer: Buffer },
    actor: AuthenticatedUser,
  ) {
    const { headers, rows } = await readSpreadsheet(file.buffer);

    if (!headers.length) {
      throw new BadRequestException(
        "The first row must be column headings — none were found.",
      );
    }
    if (!rows.length) {
      throw new BadRequestException("There are no rows below the headings.");
    }
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(
        `That file has ${rows.length} rows. Split it into files of ${MAX_ROWS} or fewer.`,
      );
    }

    const [batch] = await this.db.client
      .insert(importBatches)
      .values({
        target: "transactions",
        filename: file.originalname,
        status: "uploaded",
        totalRows: rows.length,
        uploadedBy: actor.id,
      })
      .returning();

    // Chunked because a single insert of 10,000 rows exceeds the parameter limit.
    for (let i = 0; i < rows.length; i += 500) {
      await this.db.client.insert(importRows).values(
        rows.slice(i, i + 500).map((raw, offset) => ({
          batchId: batch.id,
          rowNumber: i + offset + 1,
          raw,
        })),
      );
    }

    return {
      batch,
      headers,
      /** A few rows so the mapping screen can show what the columns hold. */
      sample: rows.slice(0, 5),
      suggestion: suggestMapping(headers),
    };
  }

  /**
   * Applies the mapping and works out what each row would become.
   * Nothing is written to the ledger yet.
   */
  async applyMapping(
    batchId: string,
    input: MappingInput,
    _actor: AuthenticatedUser,
  ) {
    const batch = await this.findBatch(batchId);
    if (batch.status === "committed") {
      throw new BadRequestException("This file has already been imported.");
    }

    const [account] = await this.db.client
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, input.defaults.accountId))
      .limit(1);
    if (!account) {
      throw new BadRequestException({
        message: "Validation failed",
        errors: { accountId: ["No such account"] },
      });
    }

    const categoryList = await this.db.client
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
      })
      .from(categories)
      .where(eq(categories.isActive, true));

    const byName = new Map(
      categoryList.map((c) => [c.name.trim().toLowerCase(), c]),
    );

    const rows = await this.db.client
      .select()
      .from(importRows)
      .where(eq(importRows.batchId, batchId))
      .orderBy(asc(importRows.rowNumber));

    // Everything already in this account, so re-importing the same file is
    // recognised rather than silently doubling the balances.
    const existing = new Set(
      (
        await this.db.client
          .select({ hash: transactions.dedupeHash })
          .from(transactions)
          .where(eq(transactions.accountId, input.defaults.accountId))
      )
        .map((r) => r.hash)
        .filter((h): h is string => Boolean(h)),
    );

    // A file can also repeat a row within itself.
    const seenInFile = new Set<string>();

    let valid = 0;
    let errored = 0;
    let duplicates = 0;

    for (const row of rows) {
      const parsed = parseRow(
        row.raw as RawRow,
        input.columnMap,
        input.defaults,
      );

      if (!parsed.ok) {
        errored++;
        await this.db.client
          .update(importRows)
          .set({ status: "error", errors: parsed.errors, mapped: null })
          .where(eq(importRows.id, row.id));
        continue;
      }

      const categoryId = resolveCategory(
        parsed.row.categoryName,
        parsed.row.direction,
        byName,
        input.defaults.fallbackCategoryId,
      );

      if (!categoryId) {
        errored++;
        await this.db.client
          .update(importRows)
          .set({
            status: "error",
            errors: [
              parsed.row.categoryName
                ? `No active category called "${parsed.row.categoryName}" on the ${parsed.row.direction === "in" ? "money in" : "money out"} side`
                : "No category, and no fallback chosen",
            ],
            mapped: parsed.row,
          })
          .where(eq(importRows.id, row.id));
        continue;
      }

      const hash = dedupeKey({
        accountId: input.defaults.accountId,
        txnDate: parsed.row.txnDate,
        amount: parsed.row.amount,
        direction: parsed.row.direction,
        description: parsed.row.description,
      });

      const duplicate = existing.has(hash) || seenInFile.has(hash);
      seenInFile.add(hash);
      if (duplicate) duplicates++;
      else valid++;

      await this.db.client
        .update(importRows)
        .set({
          status: duplicate ? "duplicate" : "valid",
          mapped: { ...parsed.row, categoryId },
          errors: null,
          warning: duplicate
            ? "An entry with the same date, amount and description is already recorded"
            : null,
        })
        .where(eq(importRows.id, row.id));
    }

    const [updated] = await this.db.client
      .update(importBatches)
      .set({
        status: "previewed",
        columnMap: input.columnMap,
        defaults: input.defaults,
        validRows: valid,
        errorRows: errored,
        duplicateRows: duplicates,
      })
      .where(eq(importBatches.id, batchId))
      .returning();

    return updated;
  }

  async preview(batchId: string, query: PreviewQuery) {
    const batch = await this.findBatch(batchId);

    const where = query.status
      ? and(
          eq(importRows.batchId, batchId),
          eq(importRows.status, query.status),
        )
      : eq(importRows.batchId, batchId);

    const [rows, [{ total }]] = await Promise.all([
      this.db.client
        .select()
        .from(importRows)
        .where(where)
        .orderBy(asc(importRows.rowNumber))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.client.select({ total: count() }).from(importRows).where(where),
    ]);

    return {
      batch,
      rows,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / query.pageSize)),
    };
  }

  /** Writes the valid rows into the ledger, all inside one transaction. */
  async commit(batchId: string, input: CommitInput, actor: AuthenticatedUser) {
    const batch = await this.findBatch(batchId);

    if (batch.status === "committed") {
      throw new BadRequestException("This file has already been imported.");
    }
    if (batch.status !== "previewed") {
      throw new BadRequestException("Map the columns before importing.");
    }

    const defaults = batch.defaults as { accountId: string };
    const skip = new Set(input.skipRows);

    const candidates = (
      await this.db.client
        .select()
        .from(importRows)
        .where(
          and(
            eq(importRows.batchId, batchId),
            inArray(importRows.status, ["valid", "duplicate"]),
          ),
        )
        .orderBy(asc(importRows.rowNumber))
    ).filter((row) => !skip.has(row.rowNumber));

    if (!candidates.length) {
      throw new BadRequestException("There is nothing left to import.");
    }

    // Refuse the whole file if any row lands in a closed period, rather than
    // importing half of it.
    for (const row of candidates) {
      const mapped = row.mapped as { txnDate: string };
      await this.settings.assertPeriodOpen(mapped.txnDate);
    }

    const year = Number(
      (candidates[0].mapped as { txnDate: string }).txnDate.slice(0, 4),
    );

    const imported = await this.audit.mutate({
      action: "import",
      entityTable: "transactions",
      entityId: batchId,
      summary: `Imported ${candidates.length} entries from ${batch.filename}`,
      module: "imports",
      read: () => Promise.resolve(undefined),
      run: async (tx) => {
        const refs = await nextRefNos(tx, year, candidates.length);
        let sequence = 0;
        let created = 0;

        for (const row of candidates) {
          const mapped = row.mapped as {
            txnDate: string;
            description: string;
            amount: string;
            direction: "in" | "out";
            categoryId: string;
            vendorName?: string;
            reference?: string;
            notes?: string;
          };

          const vendorId = mapped.vendorName
            ? await findOrCreateVendor(tx, mapped.vendorName, actor.id)
            : null;

          const [inserted] = await tx
            .insert(transactions)
            .values({
              refNo: refs[sequence++],
              accountId: defaults.accountId,
              direction: mapped.direction,
              txnDate: mapped.txnDate,
              amount: mapped.amount,
              categoryId: mapped.categoryId,
              vendorId,
              reference: mapped.reference,
              description: mapped.description,
              notes: mapped.notes,
              createdVia: "excel_import",
              importBatchId: batchId,
              dedupeHash: dedupeKey({
                accountId: defaults.accountId,
                txnDate: mapped.txnDate,
                amount: mapped.amount,
                direction: mapped.direction,
                description: mapped.description,
              }),
              createdBy: actor.id,
              updatedBy: actor.id,
            })
            .returning({ id: transactions.id });

          await tx
            .update(importRows)
            .set({ status: "imported", createdEntityId: inserted.id })
            .where(eq(importRows.id, row.id));

          created++;
        }

        if (skip.size) {
          await tx
            .update(importRows)
            .set({ status: "skipped" })
            .where(
              and(
                eq(importRows.batchId, batchId),
                inArray(importRows.rowNumber, [...skip]),
              ),
            );
        }

        await tx
          .update(importBatches)
          .set({
            status: "committed",
            importedRows: created,
            committedAt: new Date(),
          })
          .where(eq(importBatches.id, batchId));

        return created;
      },
    });

    return { imported, batchId };
  }

  /**
   * Removes everything a batch created.
   *
   * Deleting rather than voiding: an import that should not have happened is a
   * mistake in the recording, not a movement of money to be preserved. Blocked
   * once anything has been edited, so a manual correction is never silently
   * thrown away.
   */
  async revert(batchId: string, _actor: AuthenticatedUser) {
    const batch = await this.findBatch(batchId);

    if (batch.status !== "committed") {
      throw new BadRequestException("This file has not been imported.");
    }

    const rows = await this.db.client
      .select({
        id: transactions.id,
        refNo: transactions.refNo,
        txnDate: transactions.txnDate,
        updatedAt: transactions.updatedAt,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .where(eq(transactions.importBatchId, batchId));

    const edited = rows.filter(
      (r) => r.updatedAt.getTime() - r.createdAt.getTime() > 1000,
    );
    if (edited.length) {
      throw new BadRequestException(
        `${edited.length} of these entries have been edited since the import (${edited
          .slice(0, 3)
          .map((r) => r.refNo)
          .join(", ")}). Void them individually instead.`,
      );
    }

    for (const row of rows) {
      await this.settings.assertPeriodOpen(row.txnDate);
    }

    await this.audit.mutate({
      action: "delete",
      entityTable: "transactions",
      entityId: batchId,
      summary: `Reverted the import of ${batch.filename} — removed ${rows.length} entries`,
      module: "imports",
      read: () => Promise.resolve({ removed: rows.length }),
      run: async (tx) => {
        await tx
          .delete(transactions)
          .where(eq(transactions.importBatchId, batchId));
        await tx
          .update(importRows)
          .set({ status: "valid", createdEntityId: null })
          .where(eq(importRows.batchId, batchId));
        await tx
          .update(importBatches)
          .set({ status: "reverted", revertedAt: new Date(), importedRows: 0 })
          .where(eq(importBatches.id, batchId));
      },
    });

    return { reverted: rows.length };
  }

  async listBatches() {
    return this.db.client
      .select()
      .from(importBatches)
      .orderBy(sql`${importBatches.createdAt} desc`)
      .limit(25);
  }

  private async findBatch(id: string) {
    const [batch] = await this.db.client
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, id))
      .limit(1);
    if (!batch) throw new NotFoundException("No such import");
    return batch;
  }
}

/* -------------------------------------------------------------------------- */

async function readSpreadsheet(buffer: Buffer): Promise<{
  headers: string[];
  rows: RawRow[];
}> {
  const workbook = new ExcelJS.Workbook();

  try {
    // exceljs types this against its own Buffer declaration, which no longer
    // lines up with Node's generic Buffer<ArrayBufferLike>.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    // Not xlsx — try CSV, which many banks still hand out.
    const text = buffer.toString("utf8");
    return readCsv(text);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
    headers[column - 1] = (cellText(cell.value) ?? "").trim();
  });

  const rows: RawRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, index) => {
    if (index === 1) return;
    const record: RawRow = {};
    let hasValue = false;

    headers.forEach((header, offset) => {
      if (!header) return;
      const text = cellText(row.getCell(offset + 1).value);
      if (text && text.trim() !== "") hasValue = true;
      record[header] = text;
    });

    if (hasValue) rows.push(record);
  });

  return { headers: headers.filter(Boolean), rows };
}

/**
 * One cell as plain text.
 *
 * exceljs hands back an object for anything but a plain value — a formula
 * carries its `result`, rich text its `text`, a hyperlink both. Letting any of
 * those reach `String()` produces "[object Object]" in a bank statement column,
 * which then fails to parse for a reason nobody can see.
 */
function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "object") {
    const cell = value as Record<string, unknown>;
    if ("result" in cell) return cellText(cell.result);
    if ("richText" in cell && Array.isArray(cell.richText)) {
      return cell.richText
        .map((part) => cellText((part as { text?: unknown }).text) ?? "")
        .join("");
    }
    if ("text" in cell) return cellText(cell.text);
    return null;
  }

  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return null;
}

function readCsv(text: string): { headers: string[]; rows: RawRow[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const record: RawRow = {};
    headers.forEach((header, index) => {
      if (header) record[header] = cells[index]?.trim() ?? null;
    });
    return record;
  });

  return { headers: headers.filter(Boolean), rows };
}

/** Handles quoted fields containing commas — common in descriptions. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/** First guess at the column mapping, from the header names. */
function suggestMapping(
  headers: string[],
): Record<string, TransactionField | null> {
  const patterns: Array<[RegExp, TransactionField]> = [
    [/^(date|txn date|transaction date|value date|posting date)$/i, "txnDate"],
    [/^(description|particulars|narration|details|remarks)$/i, "description"],
    [/^(credit|deposit|money in|in|receipt)$/i, "amountIn"],
    [/^(debit|withdrawal|money out|out|payment)$/i, "amountOut"],
    [/^(amount|value)$/i, "amount"],
    [/^(type|direction|dr\/cr|cr\/dr)$/i, "direction"],
    [/^(category|head|expense head)$/i, "categoryName"],
    [/^(vendor|party|payee|supplier|paid to)$/i, "vendorName"],
    [/^(reference|ref|cheque|cheque no|instrument)$/i, "reference"],
    [/^(method|mode|payment method|payment mode)$/i, "paymentMethod"],
    [/^(note|notes|comment|comments)$/i, "notes"],
  ];

  const map: Record<string, TransactionField | null> = {};
  for (const header of headers) {
    const match = patterns.find(([pattern]) => pattern.test(header.trim()));
    map[header] = match ? match[1] : null;
  }
  return map;
}

/** Matches a category by name on the right side of the ledger. */
function resolveCategory(
  name: string | undefined,
  direction: "in" | "out",
  byName: Map<string, { id: string; kind: string }>,
  fallback: string | undefined,
): string | undefined {
  if (name) {
    const match = byName.get(name.trim().toLowerCase());
    if (match && (match.kind === direction || match.kind === "both")) {
      return match.id;
    }
  }
  return fallback;
}

async function findOrCreateVendor(
  tx: Parameters<Parameters<DbService["transaction"]>[0]>[0],
  name: string,
  actorId: string,
): Promise<string> {
  const [existing] = await tx
    .select({ id: vendors.id })
    .from(vendors)
    .where(sql`lower(${vendors.name}) = ${name.trim().toLowerCase()}`)
    .limit(1);

  if (existing) return existing.id;

  const [created] = await tx
    .insert(vendors)
    .values({ name: name.trim(), createdBy: actorId, updatedBy: actorId })
    .returning({ id: vendors.id });

  return created.id;
}
