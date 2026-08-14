import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AI_ATTACHMENT_EXTENSIONS,
  type AiAttachment,
  type AiAttachmentColumn,
  isPdfAttachment,
} from "@finance/shared";
import { and, desc, eq } from "drizzle-orm";

import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { aiAttachments } from "../../db/schema";
import type { RawRow } from "../imports/row-parser";
import { readSpreadsheet } from "../imports/spreadsheet";

/**
 * The whole file is kept, up to what the import pipeline itself accepts.
 *
 * Storing a truncated copy would be worse than useless: "Send to Import"
 * would then stage 2,000 of a 3,000-row statement and nothing would say so.
 * What is bounded is how much of it the *model* ever sees — a summary plus at
 * most 100 rows a call — not how much is held.
 */
const MAX_ROWS = 10_000;

/** Values listed individually for a text column, before it is just "text". */
const MAX_DISTINCT = 25;

/**
 * The two tools for reading an attached file.
 *
 * Deliberately not part of AI_TOOL_DEFINITIONS. Those read the company's
 * books and are gated on the asker's permissions; these read a file the asker
 * chose to hand over, and are gated on owning it. Keeping the two lists apart
 * means the ledger's permission check can never be loosened by something that
 * only ever needed to read a spreadsheet.
 */
export const AI_ATTACHMENT_TOOLS = [
  {
    name: "read_attachment",
    description:
      "Read rows from the attached file. Use when the summary is not enough — to check a particular entry, or to see how the rows are written. Returns at most 100 rows.",
    input_schema: {
      type: "object" as const,
      properties: {
        offset: { type: "number", description: "Row to start at, from 0" },
        limit: { type: "number", description: "How many rows, up to 100" },
      },
    },
  },
  {
    name: "group_attachment",
    description:
      "Break the file down: count rows and total a numeric column, grouped by another column. Use for 'which category cost the most' or 'how much per month'. The arithmetic is done in code, so the figures are exact — never add up rows yourself.",
    input_schema: {
      type: "object" as const,
      properties: {
        by: {
          type: "string",
          description: "The column to group by, named exactly as in the file",
        },
        sum: {
          type: "string",
          description: "The numeric column to total. Omit to only count rows.",
        },
      },
      required: ["by"],
    },
  },
];

export const AI_ATTACHMENT_TOOL_NAMES = AI_ATTACHMENT_TOOLS.map((t) => t.name);

@Injectable()
export class AiAttachmentsService {
  constructor(private readonly db: DbService) {}

  /**
   * `readPdf` is handed in rather than reached for.
   *
   * Reading a PDF needs the Anthropic client, which is built from the key in
   * Settings by AiIntakeService — and AiIntakeService already depends on this
   * service for `describe` and `runTool`. Injecting it back would close the
   * circle. The caller has both, so the caller supplies the one function this
   * needs, and a spreadsheet upload never touches the assistant at all.
   */
  async upload(
    file: { originalname: string; buffer: Buffer },
    actor: AuthenticatedUser,
    readPdf?: (
      buffer: Buffer,
    ) => Promise<{ headers: string[]; rows: RawRow[] }>,
  ): Promise<AiAttachment> {
    const extension = file.originalname
      .slice(file.originalname.lastIndexOf("."))
      .toLowerCase();

    if (!(AI_ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new BadRequestException(
        `The assistant can read ${AI_ATTACHMENT_EXTENSIONS.join(", ")}.`,
      );
    }

    const pdf = isPdfAttachment(file.originalname);
    if (pdf && !readPdf) {
      throw new BadRequestException(
        "Reading a PDF needs the assistant switched on. A Super Admin can add an API key under Settings.",
      );
    }

    const { headers, rows } = pdf
      ? await readPdf!(file.buffer)
      : await readSpreadsheet(file.buffer);

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
        `That file has ${rows.length} rows. Split it into files of ${MAX_ROWS} or fewer, or take it straight to Import.`,
      );
    }

    const [saved] = await this.db.client
      .insert(aiAttachments)
      .values({
        userId: actor.id,
        filename: file.originalname,
        headers,
        rows,
        totalRows: rows.length,
      })
      .returning();

    return toDto(saved);
  }

  /** Always the asker's own — there is no shape of request that returns another's. */
  async get(id: string, actor: AuthenticatedUser) {
    const [row] = await this.db.client
      .select()
      .from(aiAttachments)
      .where(and(eq(aiAttachments.id, id), eq(aiAttachments.userId, actor.id)))
      .limit(1);

    if (!row) throw new NotFoundException("That file is not here.");
    return row;
  }

  async dto(id: string, actor: AuthenticatedUser): Promise<AiAttachment> {
    return toDto(await this.get(id, actor));
  }

  /** The files on a conversation, for when it is reopened. */
  async forChat(
    chatId: string,
    actor: AuthenticatedUser,
  ): Promise<AiAttachment[]> {
    const rows = await this.db.client
      .select()
      .from(aiAttachments)
      .where(
        and(
          eq(aiAttachments.chatId, chatId),
          eq(aiAttachments.userId, actor.id),
        ),
      )
      .orderBy(desc(aiAttachments.createdAt));

    return rows.map(toDto);
  }

  /**
   * Ties a file to the conversation it was discussed in, once that
   * conversation exists. Attaching happens before anything is said, so the
   * link cannot be made at upload time.
   */
  async attachToChat(id: string, chatId: string, actor: AuthenticatedUser) {
    await this.db.client
      .update(aiAttachments)
      .set({ chatId })
      .where(and(eq(aiAttachments.id, id), eq(aiAttachments.userId, actor.id)));
  }

  async remove(id: string, actor: AuthenticatedUser) {
    const deleted = await this.db.client
      .delete(aiAttachments)
      .where(and(eq(aiAttachments.id, id), eq(aiAttachments.userId, actor.id)))
      .returning({ id: aiAttachments.id });

    if (!deleted.length) throw new NotFoundException("That file is not here.");
  }

  async markImported(id: string, batchId: string, actor: AuthenticatedUser) {
    await this.db.client
      .update(aiAttachments)
      .set({ importBatchId: batchId })
      .where(and(eq(aiAttachments.id, id), eq(aiAttachments.userId, actor.id)));
  }

  /* --- what the model is told -------------------------------------------- */

  /**
   * The file, described rather than pasted.
   *
   * Headers, what each column holds, the totals, and a handful of rows. A
   * 2,000-row file becomes a few hundred words, and every figure in it was
   * added up in code.
   */
  describe(attachment: AiAttachment): string {
    const lines = [
      `FILE ATTACHED: ${attachment.name}`,
      `${attachment.rowCount} rows` +
        (attachment.storedRows < attachment.rowCount
          ? `, of which the first ${attachment.storedRows} are readable here`
          : ""),
      "",
      "COLUMNS",
    ];

    for (const column of attachment.columns) {
      const parts = [
        `- ${column.name} (${column.kind}, ${column.filled} filled)`,
      ];
      if (column.total !== undefined) {
        parts.push(
          `total ${column.total}, from ${column.min} to ${column.max}`,
        );
      } else if (column.kind === "date") {
        parts.push(
          `${column.min} to ${column.max}` +
            (column.dateOrder === "mdy"
              ? " (written month-first, e.g. 5/17/2026 is 17 May)"
              : column.dateOrder === "dmy"
                ? " (written day-first, e.g. 17/5/2026 is 17 May)"
                : " — CAREFUL: nothing in this column says whether it is day-first or month-first, so it was read day-first and may be wrong. Check a value against the raw examples and ask if it matters."),
        );
      } else if (column.distinct !== undefined) {
        parts.push(
          `${column.distinct} distinct: ${column.examples.join(", ")}`,
        );
      } else if (column.examples.length) {
        parts.push(`e.g. ${column.examples.join(" | ")}`);
      }
      lines.push(parts.join(" — "));
    }

    lines.push("", "FIRST ROWS");
    for (const row of attachment.sample) {
      lines.push(
        attachment.columns
          .map((c) => `${c.name}=${row[c.name] ?? ""}`)
          .join("  "),
      );
    }

    lines.push(
      "",
      "The totals above were computed from the file, not by you. Quote them as they are and do not re-add them.",
      "Use read_attachment to see more rows, and group_attachment to break a numeric column down by another column.",
    );

    return lines.join("\n");
  }

  /**
   * Runs one of the two attachment tools.
   *
   * The attachment is fetched with the actor, so a tool call naming somebody
   * else's file id gets the same "not here" a direct request would.
   */
  async runTool(
    name: string,
    input: Record<string, unknown>,
    attachmentId: string,
    actor: AuthenticatedUser,
  ): Promise<{ ok: boolean; text: string }> {
    const row = await this.get(attachmentId, actor).catch(() => null);
    if (!row) return { ok: false, text: "That file is no longer attached." };

    if (name === "read_attachment") {
      const offset = Math.max(0, Number(input.offset ?? 0) || 0);
      const limit = Math.min(100, Math.max(1, Number(input.limit ?? 25) || 25));
      const slice = this.rows(row, offset, limit);

      if (!slice.length) {
        return {
          ok: true,
          text: `No rows at ${offset}. The file has ${row.rows.length} readable rows.`,
        };
      }

      return {
        ok: true,
        text:
          `Rows ${offset + 1}–${offset + slice.length} of ${row.rows.length}:\n` +
          slice
            .map((record) =>
              row.headers
                .map((header) => `${header}=${record[header] ?? ""}`)
                .join("  "),
            )
            .join("\n"),
      };
    }

    if (name === "group_attachment") {
      const by = typeof input.by === "string" ? input.by : "";
      const sum = typeof input.sum === "string" ? input.sum : null;

      if (!row.headers.includes(by)) {
        return {
          ok: false,
          text: `There is no column called "${by}". The columns are: ${row.headers.join(", ")}.`,
        };
      }
      if (sum && !row.headers.includes(sum)) {
        return {
          ok: false,
          text: `There is no column called "${sum}". The columns are: ${row.headers.join(", ")}.`,
        };
      }

      const grouped = this.group(row, by, sum);
      return {
        ok: true,
        text:
          `Grouped by ${by}${sum ? `, totalling ${sum}` : ""} — computed from the file, exact:\n` +
          grouped
            .map(
              (g) =>
                `${g.key}: ${g.count} row${g.count === 1 ? "" : "s"}` +
                (sum ? `, ${g.total}` : ""),
            )
            .join("\n"),
      };
    }

    return { ok: false, text: `No tool called ${name}.` };
  }

  /** A window of rows, for when the summary is not enough. */
  rows(row: { rows: RawRow[] }, offset: number, limit: number) {
    return row.rows.slice(offset, offset + Math.min(limit, 100));
  }

  /**
   * Group by one column, total another — in SQL-free code rather than in the
   * model's head. "Which category took the most" is a question about the file,
   * and it deserves an answer that is right.
   */
  group(
    row: { rows: RawRow[] },
    by: string,
    sum: string | null,
  ): Array<{ key: string; count: number; total: string }> {
    const buckets = new Map<string, { count: number; total: number }>();

    for (const record of row.rows) {
      const key = asText(record[by]).trim() || "(blank)";
      const bucket = buckets.get(key) ?? { count: 0, total: 0 };
      bucket.count += 1;
      if (sum) {
        const value = asNumber(record[sum]);
        if (value !== null) bucket.total += value;
      }
      buckets.set(key, bucket);
    }

    return [...buckets.entries()]
      .map(([key, b]) => ({
        key,
        count: b.count,
        total: b.total.toFixed(2),
      }))
      .sort((a, b) => Number(b.total) - Number(a.total) || b.count - a.count)
      .slice(0, 50);
  }
}

/* -------------------------------------------------------------------------- */

function toDto(row: {
  id: string;
  filename: string;
  headers: string[];
  rows: RawRow[];
  totalRows: number;
  importBatchId: string | null;
}): AiAttachment {
  return {
    id: row.id,
    name: row.filename,
    rowCount: row.totalRows,
    storedRows: row.rows.length,
    columns: row.headers.map((header) => summarise(header, row.rows)),
    sample: row.rows.slice(0, 5),
    importBatchId: row.importBatchId,
  };
}

/**
 * What one column holds.
 *
 * A column counts as numeric only if nearly everything in it parses as a
 * number — one stray "N/A" in an amount column should not make it text, and
 * one stray figure in a description column should not make it numeric.
 */
function summarise(name: string, rows: RawRow[]): AiAttachmentColumn {
  // A cell can arrive as a number from a spreadsheet and as text from a CSV;
  // the summary treats them the same, because the file does.
  const values = rows
    .map((row) => asText(row[name]))
    .filter((v) => v.trim() !== "");

  if (!values.length) {
    return { name, filled: 0, kind: "text", examples: [] };
  }

  const numbers = values.map(asNumber).filter((n): n is number => n !== null);
  if (numbers.length >= values.length * 0.8) {
    const total = numbers.reduce((sum, n) => sum + n, 0);
    return {
      name,
      filled: values.length,
      kind: "number",
      total: total.toFixed(2),
      min: Math.min(...numbers).toFixed(2),
      max: Math.max(...numbers).toFixed(2),
      examples: values.slice(0, 3),
    };
  }

  const order = detectDateOrder(values);
  const dates = values.filter((v) => asDate(v, order) !== null);
  if (dates.length >= values.length * 0.8) {
    const sorted = dates
      .map((v) => asDate(v, order))
      .filter((d): d is string => d !== null)
      .sort();
    return {
      name,
      filled: values.length,
      kind: "date",
      min: sorted[0],
      max: sorted[sorted.length - 1],
      /**
       * The raw values go alongside the range on purpose. When nothing in the
       * column settles the order, the model sees both what was written and
       * what it was read as, and can ask rather than assume.
       */
      examples: values.slice(0, 3),
      dateOrder: order,
    };
  }

  const distinct = new Set(values.map((v) => v.trim()));
  return {
    name,
    filled: values.length,
    kind: "text",
    ...(distinct.size <= MAX_DISTINCT
      ? {
          distinct: distinct.size,
          examples: [...distinct].slice(0, MAX_DISTINCT),
        }
      : { examples: values.slice(0, 3) }),
  };
}

/** A cell as text, whichever way the parser handed it over. */
function asText(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  return typeof raw === "number" ? String(raw) : raw;
}

/** Tolerates the separators and currency marks a real export contains. */
function asNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const cleaned = raw.replace(/[,\s৳$]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Which way round a column of slashed dates is written.
 *
 * Decided from the whole column, never from one value, because one value
 * usually cannot say. 05/08/2026 is 5 August to a Bangladeshi bank and 8 May
 * to an American payroll sheet, and nothing in those eight characters settles
 * it — but a column almost always contains one value that does: a 17 or a 23
 * can only be the day.
 *
 * This used to assume day-first for everything, which is right for a local
 * bank export and wrong for the staff sheet whose own heading says
 * MM/DD/YYYY. The visible damage was impossible dates — "7/17/2002" read as
 * month seventeen — which the assistant then reported to the person as errors
 * in their file. The quiet damage was worse: 1/2/1996 came back as 2 January
 * with nothing to show it had been swapped.
 */
type DateOrder = "dmy" | "mdy" | "unknown";

function detectDateOrder(values: string[]): DateOrder {
  let dayFirst = false;
  let monthFirst = false;

  for (const value of values) {
    const parts = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value.trim());
    if (!parts) continue;
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    // Only a day can be past twelve.
    if (first > 12) dayFirst = true;
    if (second > 12) monthFirst = true;
  }

  // Both would mean the column disagrees with itself — trust neither.
  if (dayFirst && monthFirst) return "unknown";
  if (dayFirst) return "dmy";
  if (monthFirst) return "mdy";
  return "unknown";
}

/** ISO, or a slashed date read the way the column says to read it. */
function asDate(raw: string, order: DateOrder = "dmy"): string | null {
  const text = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slashed = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (slashed) {
    const [, first, second, year] = slashed;
    // "unknown" falls back to day-first, which is what a Bangladeshi export
    // is; the column description says so out loud when it is a guess.
    const [day, month] = order === "mdy" ? [second, first] : [first, second];
    if (Number(month) > 12 || Number(day) > 31) return null;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return null;
}
