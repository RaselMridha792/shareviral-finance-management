import type Anthropic from "@anthropic-ai/sdk";
import { BadRequestException } from "@nestjs/common";

import type { RawRow } from "../imports/row-parser";

/**
 * Turning a PDF bank statement into rows.
 *
 * Read by the model rather than by a PDF library, and that is a deliberate
 * choice rather than a shortcut. A statement is a *printed* table: the file
 * holds glyphs at coordinates, not cells. A text extractor hands back a soup of
 * positioned strings, and recovering columns from it means guessing at x
 * offsets — which every bank lays out differently, and which changes the day
 * they redesign the template. Each new bank would be a new heuristic and a new
 * silent failure mode.
 *
 * What comes out the other side is treated as untrusted either way. These rows
 * do not become entries here; they go to the import screen, where the mapping
 * is chosen, every row is shown with what it would become, duplicates are
 * flagged, and the whole batch can be reverted after the fact. That is the
 * same gate a spreadsheet goes through — the difference is only how the rows
 * were obtained, and it is exactly why nothing writes straight to the ledger.
 */

/**
 * Rows come back as arrays aligned to `headers`, not as objects.
 *
 * An object per row invites invented keys — a `balance` on one row and a
 * `Balance` on the next — and there is no schema that forbids it without
 * naming every column in advance, which is the thing we do not know. Arrays
 * cannot drift: position N is header N, and a short row is padded in code.
 */
const TRANSCRIBE_TOOL = {
  name: "statement_rows",
  description: "Return the statement's own table, transcribed exactly.",
  input_schema: {
    type: "object" as const,
    properties: {
      headers: {
        type: "array",
        items: { type: "string" },
        description:
          "The column headings the statement itself uses, left to right.",
      },
      rows: {
        type: "array",
        items: { type: "array", items: { type: "string" } },
        description:
          "One array per transaction row, values in the same order as headers.",
      },
    },
    required: ["headers", "rows"],
  },
};

const INSTRUCTION = `Transcribe the transaction table from this bank statement.

Rules, in order of importance:
- Copy every figure EXACTLY as printed. Do not add, subtract, round, reformat
  or convert anything. If a debit is written "1,234.50" send "1,234.50".
- Never invent a row, a date or an amount. If a cell is blank, send "".
- Use the statement's own column headings, in the order it prints them.
- One array per transaction line, in the order they appear.
- Skip anything that is not a transaction line: page headers and footers,
  the address block, "brought forward"/"carried forward" markers, and the
  summary box of opening and closing balances. A running balance COLUMN
  beside each transaction is part of the table — keep it.
- A transaction split over two printed lines is still one row: join the
  description with a space.

You are transcribing, not interpreting. Somebody will check every row on the
next screen before any of it is recorded, and a figure you tidied is one they
cannot catch by reading.`;

/** Generous: statements are mostly repeated short rows, and truncation is silent. */
const MAX_OUTPUT_TOKENS = 32_000;

export async function readPdfStatement(
  client: Anthropic,
  model: string,
  buffer: Buffer,
): Promise<{ headers: string[]; rows: RawRow[] }> {
  const response = await client.messages
    .stream({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: buffer.toString("base64"),
              },
            },
            { type: "text", text: INSTRUCTION },
          ],
        },
      ],
      tools: [TRANSCRIBE_TOOL],
      tool_choice: { type: "tool", name: TRANSCRIBE_TOOL.name },
    })
    .finalMessage();

  /**
   * A statement longer than the budget stops mid-table, and the rows it did
   * produce look perfectly ordinary. Saying so is the whole point: a silently
   * half-read statement is a set of books missing a fortnight.
   */
  if (response.stop_reason === "max_tokens") {
    throw new BadRequestException(
      "That statement is longer than can be read in one go. Split the PDF by month and attach them one at a time.",
    );
  }

  const call = response.content.find(
    (block) => block.type === "tool_use" && block.name === TRANSCRIBE_TOOL.name,
  );

  if (!call || call.type !== "tool_use") {
    throw new BadRequestException(
      "Nothing that looked like a statement table came back from that PDF. If it is a scan, the import screen takes a spreadsheet.",
    );
  }

  const parsed = call.input as { headers?: unknown; rows?: unknown };
  const headers = asStrings(parsed.headers).map((h) => h.trim());

  if (!headers.length) {
    throw new BadRequestException(
      "No column headings were found in that PDF. If it is a scan or an image, it has to be entered by hand.",
    );
  }

  const rows: RawRow[] = [];
  for (const raw of Array.isArray(parsed.rows) ? parsed.rows : []) {
    const values = asStrings(raw);
    // A row of nothing but blanks is a printed separator, not an entry.
    if (!values.some((v) => v.trim() !== "")) continue;

    const record: RawRow = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });
    rows.push(record);
  }

  if (!rows.length) {
    throw new BadRequestException(
      "That PDF had column headings but no transaction rows under them.",
    );
  }

  return { headers, rows };
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v : String(v ?? "")));
}
