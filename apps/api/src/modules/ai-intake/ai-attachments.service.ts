import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AI_ATTACHMENT_EXTENSIONS,
  AI_ATTACHMENT_MAX_BYTES,
  AI_DOC_SUFFIX,
  AI_MAX_ATTACHMENTS,
  type AiAttachment,
  type AiAttachmentColumn,
  findGoogleLinks,
  isDocAttachment,
  isPdfAttachment,
} from "@finance/shared";
import { and, eq, max } from "drizzle-orm";

import type { AuthenticatedUser } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";
import { aiAttachments, appSettings } from "../../db/schema";
import { openServiceAccount } from "../connections/google";
import {
  GoogleFileProblem,
  googleReadToken,
  readGoogleFile,
  whyNotRead,
  type GoogleRead,
} from "../connections/google-files";
import type { RawRow } from "../imports/row-parser";
import { readWorkbook, type WorkbookSheet } from "../imports/spreadsheet";
import type { ModelTool } from "./model-turn";

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

/**
 * The tools for these attachments. A Doc has no columns to group or total,
 * so it is offered the reading one alone rather than a tool that cannot work.
 *
 * Several files (a Sheet's tabs, A3b) add `file` to each tool: which one, by
 * the number it was described under. One file has no such choice to make, so
 * its tools are exactly as they were.
 */
export function attachmentToolsFor(attachments: AiAttachment[]): ModelTool[] {
  const tools = attachments.some((attachment) => attachment.kind === "table")
    ? AI_ATTACHMENT_TOOLS
    : AI_ATTACHMENT_TOOLS.filter((tool) => tool.name === "read_attachment");
  if (attachments.length < 2) return tools;

  return tools.map((tool) => ({
    ...tool,
    input_schema: {
      ...tool.input_schema,
      properties: {
        file: {
          type: "number",
          description: `Which file, by its number: FILE 1 to FILE ${attachments.length}`,
        },
        ...tool.input_schema.properties,
      },
      required: [
        "file",
        ...((tool.input_schema as { required?: string[] }).required ?? []),
      ],
    },
  }));
}

/**
 * How much of a Doc's text goes into the prompt itself, about 3,000 tokens.
 * The rest is a read_attachment away, a window at a time.
 */
const DOC_PROMPT_CHARACTERS = 12_000;

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
   *
   * An Excel workbook of several sheets comes back as every sheet (A3c),
   * each an attachment of its own, as a Google Sheet's tabs do; anything else
   * as one. So does a workbook whose data is on one sheet alone (A3d).
   */
  async upload(
    file: { originalname: string; buffer: Buffer },
    actor: AuthenticatedUser,
    readPdf?: (
      buffer: Buffer,
    ) => Promise<{ headers: string[]; rows: RawRow[] }>,
  ): Promise<AiAttachment[]> {
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
        "Reading a PDF needs the assistant switched on. A Super Admin can add a key in the Assistant's settings.",
      );
    }

    const sheets: WorkbookSheet[] = pdf
      ? [{ name: "", hidden: false, ...(await readPdf!(file.buffer)) }]
      : await readWorkbook(file.buffer);

    // One sheet is read as a workbook always was: named by the file alone,
    // and refused the same ways.
    if (sheets.length < 2) {
      const [only] = sheets;
      return [
        await this.keep(
          file.originalname,
          only?.headers ?? [],
          only?.rows ?? [],
          actor,
        ),
      ];
    }
    return this.keepSheets(file.originalname, sheets, actor);
  }

  /**
   * A workbook's every sheet (A3c), each kept as an attachment of its own, as
   * a Google Sheet's tabs are (`keepTabs`).
   *
   * Each is named with its place among the sheets, and said to be hidden if
   * it is, so nobody takes one sheet for the whole workbook. An empty sheet
   * is kept and shown as empty. A workbook too large to read whole is
   * refused rather than cut short, with the same limits as a Sheet's tabs.
   *
   * A workbook with one sheet of data among empty ones is that sheet alone
   * (A3d, `keepBook`), whatever the count of empty ones beside it.
   */
  private async keepSheets(
    filename: string,
    sheets: WorkbookSheet[],
    actor: AuthenticatedUser,
  ): Promise<AiAttachment[]> {
    const parts = sheets.map((sheet, at) => ({
      name: `${filename} — ${sheet.name} (sheet ${at + 1} of ${sheets.length}${
        sheet.hidden ? ", hidden" : ""
      })`,
      tab: sheet.name,
      hidden: sheet.hidden,
      headers: sheet.headers,
      rows: sheet.rows,
    }));
    if (parts.filter((part) => part.rows.length).length === 1) {
      return this.keepBook(filename, parts, actor);
    }

    if (sheets.length > AI_MAX_ATTACHMENTS) {
      throw new BadRequestException(
        `"${filename}" has ${sheets.length} sheets. The Assistant reads up to ${AI_MAX_ATTACHMENTS} at once: copy the sheets you mean into a workbook of their own and attach that.`,
      );
    }
    const rows = sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0);
    if (!rows) {
      throw new BadRequestException(
        `"${filename}" has no rows under a heading row on any of its ${sheets.length} sheets.`,
      );
    }
    if (rows > MAX_ROWS) {
      throw new BadRequestException(
        `"${filename}" has ${rows.toLocaleString("en-US")} rows across its ${sheets.length} sheets. The Assistant reads up to ${MAX_ROWS.toLocaleString("en-US")} at once: split it into smaller workbooks and attach them one at a time.`,
      );
    }

    return this.keepBook(filename, parts, actor);
  }

  /**
   * A Sheet's tabs (A3b) or a workbook's sheets (A3c), kept.
   *
   * When exactly one of them holds data, the file is read as that one (A3d,
   * the owner, 3 Oct). An older workbook keeps its rows on Sheet1 and leaves
   * Sheet2 and Sheet3 empty; as three cards it was offered no Import plan,
   * since a plan is for one file. Kept as one, it has its card, its plan and
   * its tools exactly as a workbook of one sheet does.
   *
   * The empty ones are not dropped unsaid. They are named on a second line
   * of the name, "Book.xlsx — Sheet1\nSheet2, Sheet3: empty", which is what
   * the card shows under itself and what the model is told (`emptyPartsOf`).
   * The name is the one place a stored row can carry it without a column of
   * its own, as a Doc's ".gdoc" does; no file or tab name holds a line break.
   *
   * Several with data stay several, each with its own card, the empty ones
   * among them shown as empty.
   */
  private async keepBook(
    book: string,
    parts: {
      name: string;
      tab: string;
      hidden: boolean;
      headers: string[];
      rows: RawRow[];
    }[],
    actor: AuthenticatedUser,
  ): Promise<AiAttachment[]> {
    const withRows = parts.filter((part) => part.rows.length);
    if (withRows.length !== 1) return this.keepTabs(parts, actor);

    const [only] = withRows;
    const empty = parts.filter((part) => part !== only).map((part) => part.tab);
    return [
      await this.keep(
        `${book} — ${only.tab}${only.hidden ? " (hidden)" : ""}\n${empty.join(", ")}${EMPTY_LINE_END}`,
        only.headers,
        only.rows,
        actor,
      ),
    ];
  }

  /**
   * A Google Sheet, Doc or Drive file, by the link somebody pasted (A3).
   *
   * Read with the Google Cloud service account from the Assistant's
   * settings, then kept
   * exactly as an upload is: a Sheet's tab as rows, a file in Drive through
   * `upload` itself, a Doc as its paragraphs. From here on nothing can tell a
   * link from an upload except a Doc's name.
   *
   * A Sheet whose link names no tab comes back as every tab (A3b), and an
   * Excel workbook kept in Drive as every sheet (A3c), each an attachment of
   * its own; anything else as one, a Sheet or a workbook with one tab or
   * sheet of data among empty ones included (A3d).
   *
   * Gated like an upload, on owning what is made. The account can read
   * whatever was shared with it; this reads one file, by its id, and only
   * because the person has the link to it.
   */
  async fromLink(
    url: string,
    actor: AuthenticatedUser,
    readPdf?: (
      buffer: Buffer,
    ) => Promise<{ headers: string[]; rows: RawRow[] }>,
  ): Promise<AiAttachment[]> {
    const [link] = findGoogleLinks(url);
    if (!link) {
      throw new BadRequestException(
        "That is not a link to a Google Sheet, Doc or Drive file.",
      );
    }
    const why = whyNotRead(link);
    if (why) throw new BadRequestException(why);

    const [settings] = await this.db.client
      .select({ sealed: appSettings.googleServiceAccount })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    const account = openServiceAccount(settings?.sealed);
    if (!account) {
      throw new BadRequestException(
        "Reading a Google link needs the Google Cloud key, which a Super Admin adds in the Assistant's settings. Until then, download the file and attach it.",
      );
    }

    let read: GoogleRead;
    try {
      read = await readGoogleFile(
        link,
        {
          token: await googleReadToken(account),
          shareWith: account.client_email,
        },
        { maxBytes: AI_ATTACHMENT_MAX_BYTES, maxRows: MAX_ROWS },
      );
    } catch (error) {
      if (!(error instanceof GoogleFileProblem)) throw error;
      throw error.unavailable
        ? new ServiceUnavailableException(error.message)
        : new BadRequestException(error.message);
    }

    if (read.kind === "file") {
      return this.upload(
        { originalname: read.name, buffer: read.buffer },
        actor,
        readPdf,
      );
    }
    if (read.kind === "text") {
      return [
        await this.keep(
          `${read.name}${AI_DOC_SUFFIX}`,
          ["Text"],
          read.paragraphs.map((paragraph) => ({ Text: paragraph })),
          actor,
        ),
      ];
    }
    if (read.kind === "tabs") {
      return this.keepBook(read.title, read.tables, actor);
    }
    return [await this.keep(read.name, read.headers, read.rows, actor)];
  }

  /**
   * A Sheet's tabs, or a workbook's sheets (A3c), each kept as an attachment
   * of its own, in one statement.
   *
   * One statement gives them one `created_at`, which is how a conversation
   * reopened knows them for one Sheet (`forChat`). An empty tab is kept too,
   * with no rows: it is shown as empty rather than left out unsaid. The
   * reader has already refused a book with no rows at all, or too many.
   */
  private async keepTabs(
    tables: { name: string; headers: string[]; rows: RawRow[] }[],
    actor: AuthenticatedUser,
  ): Promise<AiAttachment[]> {
    const saved = await this.db.client
      .insert(aiAttachments)
      .values(
        tables.map((table) => ({
          userId: actor.id,
          filename: table.name,
          headers: table.headers,
          rows: table.rows,
          totalRows: table.rows.length,
        })),
      )
      .returning();

    // In the Sheet's own order, whatever order the rows came back in. A tab's
    // name carries its place, so no two are alike.
    return tables.map((table) =>
      toDto(saved.find((row) => row.filename === table.name)!),
    );
  }

  /** What was read, checked and kept: the same for a file and for a link. */
  private async keep(
    filename: string,
    headers: string[],
    rows: RawRow[],
    actor: AuthenticatedUser,
  ): Promise<AiAttachment> {
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
        filename,
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

  /**
   * The files a conversation was last about, for when it is reopened: the
   * last upload, or every tab of the last Sheet (every sheet of the last
   * workbook), which were kept in one statement and so share its moment to
   * the microsecond (`keepTabs`). In the Sheet's own order.
   */
  async forChat(
    chatId: string,
    actor: AuthenticatedUser,
  ): Promise<AiAttachment[]> {
    const mine = and(
      eq(aiAttachments.chatId, chatId),
      eq(aiAttachments.userId, actor.id),
    );
    const rows = await this.db.client
      .select()
      .from(aiAttachments)
      .where(
        and(
          mine,
          eq(
            aiAttachments.createdAt,
            this.db.client
              .select({ last: max(aiAttachments.createdAt) })
              .from(aiAttachments)
              .where(mine),
          ),
        ),
      );

    return rows.map(toDto).sort((a, b) => placeOf(a.name) - placeOf(b.name));
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
  describe(attachment: AiAttachment, number?: number): string {
    if (attachment.kind === "text") return this.describeDoc(attachment);

    // One of several (a Sheet's tabs, A3b; a workbook's sheets, A3c):
    // numbered, so the tools can be told which.
    const { name, empty } = emptyPartsOf(attachment.name);
    const heading = `FILE${number ? ` ${number}` : ""} ATTACHED: ${name}`;
    if (!attachment.rowCount) {
      return `${heading}\nThis ${sheetOrTab(attachment.name)} is empty: no rows under a heading row. Nothing in it was read, and it has nothing to total.`;
    }

    const lines = [
      heading,
      // The one sheet or tab of data among empty ones (A3d), read as the
      // whole file, and said to be.
      ...(empty
        ? [
            `The rest of the file is empty: ${empty} — no rows under a heading row, so nothing there was read. This is the only part of the file that holds data, so it is the whole file.`,
          ]
        : []),
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

    // Several files are told this once, after the last of them.
    if (!number) {
      lines.push(
        "",
        "The totals above were computed from the file, not by you. Quote them as they are and do not re-add them.",
        "Use read_attachment to see more rows, and group_attachment to break a numeric column down by another column.",
      );
    }

    return lines.join("\n");
  }

  /**
   * A Doc, as its own words: the text itself, up to a few thousand tokens,
   * and where to read on from. Nothing in it was added up by the app, and
   * the model is told so, since a document's figures are only as right as
   * whoever typed them.
   */
  private describeDoc(attachment: AiAttachment): string {
    // A Doc's sample is its opening, as much as the prompt takes (`toDto`).
    const shown = attachment.sample.map((row) => asText(row.Text));

    return [
      `DOCUMENT ATTACHED: ${attachment.name} (a Google Doc)`,
      `${attachment.rowCount} paragraph${attachment.rowCount === 1 ? "" : "s"}. A table in it is one line a row, its cells parted by " | ".`,
      "",
      "TEXT",
      ...shown,
      ...(shown.length < attachment.rowCount
        ? [
            "",
            `The text stops here, at paragraph ${shown.length} of ${attachment.rowCount}. Use read_attachment with offset ${shown.length} to read on before you answer about the rest.`,
          ]
        : []),
      "",
      "Nothing in this document was added up by the app. Quote a figure exactly as it is written. Do not add figures up yourself: if a total is wanted, say it is not in the document and list the figures it would be made of.",
    ].join("\n");
  }

  /**
   * Runs one of the two attachment tools, on the file it names.
   *
   * `attachmentIds` are the turn's files in the order they were described,
   * and `file` is a number among them; with one file it may be left out. The
   * attachment is fetched with the actor, so a tool call naming somebody
   * else's file id gets the same "not here" a direct request would.
   */
  async runTool(
    name: string,
    input: Record<string, unknown>,
    attachmentIds: string[],
    actor: AuthenticatedUser,
  ): Promise<{ ok: boolean; text: string }> {
    const file =
      attachmentIds.length === 1 && input.file === undefined
        ? 1
        : Number(input.file);
    const attachmentId = Number.isInteger(file)
      ? attachmentIds[file - 1]
      : undefined;
    if (!attachmentId) {
      return {
        ok: false,
        text: `Say which file, by its number: 1 to ${attachmentIds.length}.`,
      };
    }

    const result = await this.toolOn(name, input, attachmentId, actor);
    // Which file the answer is about, when there was a choice.
    return attachmentIds.length > 1
      ? { ...result, text: `FILE ${file}: ${result.text}` }
      : result;
  }

  private async toolOn(
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

      if (isDocAttachment(row.filename)) {
        return slice.length
          ? {
              ok: true,
              text:
                `Paragraphs ${offset + 1}–${offset + slice.length} of ${row.rows.length}:\n` +
                slice.map((record) => asText(record.Text)).join("\n"),
            }
          : {
              ok: true,
              text: `No paragraph at ${offset}. The document has ${row.rows.length}.`,
            };
      }

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
      if (isDocAttachment(row.filename)) {
        return {
          ok: false,
          text: "A document has no columns to group. Read it with read_attachment.",
        };
      }
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

/** How the line naming a file's empty sheets or tabs ends (A3d). */
const EMPTY_LINE_END = ": empty";

/**
 * A file kept as its one sheet or tab of data (A3d, `keepBook`): its name,
 * and the empty ones beside it, "Sheet2, Sheet3"; null for any other file.
 */
export function emptyPartsOf(name: string): {
  name: string;
  empty: string | null;
} {
  const cut = name.indexOf("\n");
  if (cut < 0 || !name.endsWith(EMPTY_LINE_END)) return { name, empty: null };
  return {
    name: name.slice(0, cut),
    empty: name.slice(cut + 1, -EMPTY_LINE_END.length),
  };
}

/** "(tab 2 of 3)", "(sheet 3 of 3, hidden)": where one of several files sits. */
const PLACE = /\((tab|sheet) (\d+) of \d+(?:, hidden)?\)$/;

/**
 * A Sheet's tab's place among its tabs, or a workbook's sheet's among its
 * sheets, from its name; 0 for anything else.
 */
function placeOf(name: string): number {
  return Number(PLACE.exec(name)?.[2] ?? 0);
}

/**
 * What one of several files is: a Google Sheet's "tab" (A3b) or an Excel
 * workbook's "sheet" (A3c), from its name. The model is told in that word.
 */
export function sheetOrTab(name: string): "tab" | "sheet" {
  return PLACE.exec(name)?.[1] === "sheet" ? "sheet" : "tab";
}

function toDto(row: {
  id: string;
  filename: string;
  headers: string[];
  rows: RawRow[];
  totalRows: number;
  importBatchId: string | null;
}): AiAttachment {
  /*
   * A Doc is its paragraphs under the one column "Text". Its sample is its
   * opening, as much of it as the prompt takes, so the model is given the
   * words themselves and the card can show how it begins. A column summary
   * of paragraphs would say nothing, so it carries only the count.
   */
  if (isDocAttachment(row.filename)) {
    const opening: RawRow[] = [];
    let used = 0;
    for (const paragraph of row.rows) {
      const length = asText(paragraph.Text).length;
      if (opening.length && used + length > DOC_PROMPT_CHARACTERS) break;
      opening.push(paragraph);
      used += length;
    }
    return {
      id: row.id,
      name: row.filename.slice(0, -AI_DOC_SUFFIX.length),
      kind: "text",
      rowCount: row.totalRows,
      storedRows: row.rows.length,
      columns: [
        { name: "Text", filled: row.rows.length, kind: "text", examples: [] },
      ],
      sample: opening,
      importBatchId: null,
    };
  }

  return {
    id: row.id,
    name: row.filename,
    kind: "table",
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
