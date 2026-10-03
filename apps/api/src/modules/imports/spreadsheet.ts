import ExcelJS from "exceljs";

import type { RawRow } from "./row-parser";

/**
 * Reading a spreadsheet somebody exported from their bank.
 *
 * Lifted out of the import service because the assistant reads files too — an
 * attachment in a chat and a file on the import screen are the same bytes, and
 * two parsers would drift on exactly the awkward cases below.
 */

export async function readSpreadsheet(buffer: Buffer): Promise<{
  headers: string[];
  rows: RawRow[];
}> {
  const workbook = await loadWorkbook(buffer);
  // Not xlsx — try CSV, which many banks still hand out.
  if (!workbook) return readDelimited(buffer.toString("utf8"));

  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };
  return readSheet(sheet);
}

/** One sheet of a workbook: its name, whether it is hidden, and its rows. */
export type WorkbookSheet = {
  name: string;
  hidden: boolean;
  headers: string[];
  rows: RawRow[];
};

/**
 * Every sheet of a workbook, in the workbook's own order (A3c, 3 Oct 2026).
 *
 * The Assistant reads a workbook whole, as it reads a Google Sheet's tabs:
 * each sheet on its own, by the rules `readSpreadsheet` applies to the first.
 * An empty sheet is one too, with no rows, so the count of sheets read is the
 * count the workbook has. A chart on a sheet of its own has no cells, and
 * exceljs does not list it. A CSV is one sheet, with no name.
 *
 * The Import screen still reads the first sheet alone, through
 * `readSpreadsheet`.
 */
export async function readWorkbook(buffer: Buffer): Promise<WorkbookSheet[]> {
  const workbook = await loadWorkbook(buffer);
  if (!workbook) {
    return [
      { name: "", hidden: false, ...readDelimited(buffer.toString("utf8")) },
    ];
  }

  return workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    // "veryHidden" is a sheet Excel's own menus cannot show; it is hidden too.
    hidden: sheet.state !== "visible",
    ...readSheet(sheet),
  }));
}

/** The workbook in the bytes, or null when they are not an .xlsx. */
async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook | null> {
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs types this against its own Buffer declaration, which no longer
    // lines up with Node's generic Buffer<ArrayBufferLike>.
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook;
  } catch {
    return null;
  }
}

/** A sheet's first row as the headings, and every row under it with a value. */
function readSheet(sheet: ExcelJS.Worksheet): {
  headers: string[];
  rows: RawRow[];
} {
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
 * A grid of cells, as Google Sheets hands a tab back (A3, 2 Oct 2026).
 *
 * The same rules as a workbook above: the first row is the headings, a
 * column with no heading is left out, a row with nothing in it is skipped,
 * and every cell arrives as text. A Sheet read by link then reaches the
 * Assistant in exactly the shape an uploaded .xlsx does.
 */
export function readGrid(grid: unknown[][]): {
  headers: string[];
  rows: RawRow[];
} {
  const headers = (grid[0] ?? []).map((cell) => (cellText(cell) ?? "").trim());

  const rows: RawRow[] = [];
  for (const line of grid.slice(1)) {
    const record: RawRow = {};
    let hasValue = false;

    headers.forEach((header, offset) => {
      if (!header) return;
      const text = cellText(line?.[offset]);
      if (text && text.trim() !== "") hasValue = true;
      record[header] = text === "" ? null : text;
    });

    if (hasValue) rows.push(record);
  }

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
export function cellText(value: unknown): string | null {
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

/**
 * CSV, or the tab-separated file a spreadsheet produces when somebody picks
 * the wrong export option. The separator is taken from whichever appears more
 * often in the heading row, so a file full of commas inside descriptions is
 * not mistaken for a comma-separated one.
 */
export function readDelimited(text: string): {
  headers: string[];
  rows: RawRow[];
} {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };

  const tabs = (lines[0].match(/\t/g) ?? []).length;
  const commas = (lines[0].match(/,/g) ?? []).length;
  const separator = tabs > commas ? "\t" : ",";

  const headers = splitLine(lines[0], separator).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line, separator);
    const record: RawRow = {};
    headers.forEach((header, index) => {
      if (header) record[header] = cells[index]?.trim() ?? null;
    });
    return record;
  });

  return { headers: headers.filter(Boolean), rows };
}

/** Handles quoted fields containing the separator — common in descriptions. */
function splitLine(line: string, separator: string): string[] {
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
    } else if (char === separator && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}
