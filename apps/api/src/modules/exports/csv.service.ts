import { Injectable } from "@nestjs/common";

export type CsvColumnKind = "text" | "money" | "date" | "number";

export type CsvColumn<T> = {
  header: string;
  kind: CsvColumnKind;
  value: (row: T) => string | number | null | undefined;
};

export type CsvSpec<T> = {
  columns: CsvColumn<T>[];
  rows: T[];
};

/**
 * Builds CSV files that open correctly in Excel on Windows.
 *
 * The owner asked for this in those words — *"eta hobe windows CSV format
 * export"* — and it is not the same file `writeFile(rows.join(","))` produces.
 * Three things separate the two, and each of them is a real complaint
 * somebody would otherwise bring back:
 *
 * **A UTF-8 byte-order mark.** Excel on Windows does not sniff encodings; with
 * no BOM it reads a `.csv` in the system code page, so a Bangla name arrives
 * as mojibake and an employee list is unusable for the one thing it is for.
 * Three bytes at the front fix it, and every other reader on earth ignores
 * them.
 *
 * **CRLF line endings.** RFC 4180 says so, and Windows tools that split on
 * `\r\n` leave a stray carriage return on every field otherwise.
 *
 * **A guard against formula injection**, which is the one with teeth. Excel
 * evaluates a cell beginning `=`, `+`, `@`, or a control character — so a
 * person whose name or department was typed as `=HYPERLINK(...)` becomes code
 * that runs on the machine of whoever opens the export. This is a finance
 * system: the export is mailed to accountants. Text cells get a leading
 * apostrophe, which Excel strips on display and never evaluates.
 *
 * Money and number cells are deliberately **not** guarded — `-500.00` is a
 * negative figure, not an attack, and quoting it as text would break the sum
 * at the bottom of somebody's column. Only `text` is treated as hostile,
 * which is exactly where free-typed values live.
 */
@Injectable()
export class CsvService {
  /** Above this the file stops being something a spreadsheet wants to open. */
  static readonly MAX_ROWS = 50_000;

  build<T>(spec: CsvSpec<T>): Buffer {
    const lines: string[] = [];

    lines.push(
      spec.columns.map((column) => cell(column.header, "text")).join(","),
    );

    for (const row of spec.rows.slice(0, CsvService.MAX_ROWS)) {
      lines.push(
        spec.columns
          .map((column) => cell(column.value(row), column.kind))
          .join(","),
      );
    }

    /*
     * The BOM is prepended to the encoded bytes, not to the string. Putting a
     * U+FEFF at the front of the string and encoding the whole thing produces
     * the same three bytes here — but only because the rest is UTF-8 too, and
     * that is a coincidence to rely on rather than a rule. This says what it
     * means, and keeps an invisible character out of the source.
     */
    return Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(lines.join("\r\n") + "\r\n", "utf8"),
    ]);
  }

  static filename(base: string, today: string): string {
    return `sfm-${base}-${today}.csv`;
  }
}

/** Characters Excel reads as the start of a formula rather than of a word. */
const FORMULA_START = /^[=+@\t\r]/;

function cell(
  value: string | number | null | undefined,
  kind: CsvColumnKind,
): string {
  if (value === null || value === undefined) return "";

  let text = String(value);

  if (kind === "text" && FORMULA_START.test(text)) {
    text = `'${text}`;
  }

  /*
   * Quote when the value contains a delimiter, a quote, or a line break —
   * and doubling the quotes inside is what RFC 4180 asks for. A leading or
   * trailing space is quoted too: Excel eats it otherwise, and on an employee
   * ID that silently changes the value.
   */
  const mustQuote =
    /[",\r\n]/.test(text) || text !== text.trim() || text.startsWith("'");

  return mustQuote ? `"${text.replace(/"/g, '""')}"` : text;
}
