/*
 * `jszip` is not in this package's own dependencies: it arrives with
 * `exceljs`, which is, and which needs it — so every install that builds this
 * has it. Adding it here by name rewrote the lockfile's platform fields on the
 * machine that tried, which is a bigger change than one import.
 */
import JSZip from "jszip";

import {
  AMOUNT_COLUMN,
  BANK_CODE_COLUMN,
  COLUMN_NAMES,
  cellsOf,
  type FileAdvice,
  type FileLine,
} from "./bank-format";
import { BANK_TEMPLATE_XLSX } from "./bank-template";

/**
 * The bank's own workbook, filled — Standard Chartered's "Bank Standard
 * Format Final-R1.xlsx" with this advice's payments in it and nothing else
 * changed.
 *
 * The owner, 29 Sep 2026, after the first version drew its own sheet:
 * *"pdf instructions and demo je xl file ta dilam exact same korte hobe. kono
 * kichu missing thakle r format thik na thakle bank accept korbena"*. So this
 * does not draw a sheet at all. It opens the bank's file and replaces its
 * sample payment rows (3 to 7) with ours, each written exactly as the bank's
 * own filled example (row 4) is — the same style on every cell, the same
 * empty-text cells in the hidden columns, the debit account, date, bank code
 * and account number as text with Excel's leading apostrophe so their zeros
 * stay, the amount as a number — then puts the bank's T row after them. The
 * column names, the H row, the widths, the hidden columns, the borders, the
 * yellow cells and the bank's classification label are the bank's own bytes.
 *
 * Deleting row 1 and saving it as "CSV (Comma delimited)", as the bank's
 * instructions say, gives the CSV `buildCsv` writes; `.bankadviceqa.mjs`
 * checks that the two agree.
 */

const SHEET = "xl/worksheets/sheet1.xml";
const STRINGS = "xl/sharedStrings.xml";
const CORE = "docProps/core.xml";

/** The bank's filled example row, and its blank rows' shape. */
const EXAMPLE_ROW = 4;
const H_ROW = 2;
const T_ROW = 8;
const BLANK_ROW = 9;
/** The template runs to row 1000; a longer advice runs past it. */
const TEMPLATE_LAST_ROW = 1000;

/**
 * Column P as text: the bank's example holds its routing number as a number
 * (225261729 — its two leading zeros lost), and the bank's instructions say
 * to write it as text, '00240100436. Style 4 is the example's own yellow,
 * bordered, apostrophe-prefixed text cell — the one its account numbers use.
 */
const TEXT_WITH_ZEROS_STYLE = "4";

type TemplateCell = { style: string; emptyText: boolean };

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function rowXml(sheet: string, row: number): string {
  const found = new RegExp(
    `<row r="${row}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`,
  ).exec(sheet);
  if (!found) throw new Error(`The bank's template has no row ${row}`);
  return found[0];
}

/** A row moved to another number: its own `r`, and every cell's. */
function renumber(xml: string, from: number, to: number): string {
  return xml
    .replace(`<row r="${from}"`, `<row r="${to}"`)
    .replace(new RegExp(`r="([A-Z]+)${from}"`, "g"), `r="$1${to}"`);
}

export async function buildWorkbook(
  advice: FileAdvice,
  lines: FileLine[],
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(Buffer.from(BANK_TEMPLATE_XLSX, "base64"));
  const sheet = await zip.file(SHEET)!.async("string");
  const strings = await zip.file(STRINGS)!.async("string");

  /* The shared strings, extended as the payments need new ones. */
  const items = [...strings.matchAll(/<si>[\s\S]*?<\/si>/g)].map((m) => m[0]);
  const lookup = new Map<string, number>();
  items.forEach((item, index) => {
    if (item === "<si><t/></si>") {
      if (!lookup.has("")) lookup.set("", index);
      return;
    }
    const plain = /^<si><t(?: xml:space="preserve")?>([^<]*)<\/t><\/si>$/.exec(
      item,
    );
    if (plain) {
      const text = unescapeXml(plain[1]);
      if (!lookup.has(text)) lookup.set(text, index);
    }
  });
  const stringIndex = (text: string): number => {
    const known = lookup.get(text);
    if (known !== undefined) return known;
    const index = items.length;
    items.push(
      text === ""
        ? "<si><t/></si>"
        : `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`,
    );
    lookup.set(text, index);
    return index;
  };

  /* The example row's cells: each column's style, and whether the bank
     left it as empty text or with no value at all. */
  const example = rowXml(sheet, EXAMPLE_ROW);
  const pattern = new Map<string, TemplateCell>();
  for (const cell of example.matchAll(
    /<c r="([A-Z]+)\d+" s="(\d+)"(?: t="(\w+)")?(?:\/>|>(?:<v>([^<]*)<\/v>)?<\/c>)/g,
  )) {
    const [, column, style, type, value] = cell;
    const emptyText =
      type === "s" &&
      value !== undefined &&
      items[Number(value)] === "<si><t/></si>";
    pattern.set(column, { style, emptyText });
  }
  const rowOpen = /^<row [^>]*?(?=>)/.exec(example)![0];

  const rows: string[] = [rowXml(sheet, 1), rowXml(sheet, H_ROW)];
  lines.forEach((line, index) => {
    const r = H_ROW + 1 + index;
    const values = cellsOf(advice, line);
    const cells = COLUMN_NAMES.map((_, c) => {
      const column = columnName(c);
      const ref = `${column}${r}`;
      const template = pattern.get(column) ?? { style: "2", emptyText: false };
      const value = values[c];
      if (c === AMOUNT_COLUMN) {
        return `<c r="${ref}" s="${template.style}"><v>${value}</v></c>`;
      }
      if (value !== "") {
        const style =
          c === BANK_CODE_COLUMN ? TEXT_WITH_ZEROS_STYLE : template.style;
        return `<c r="${ref}" s="${style}" t="s"><v>${stringIndex(value)}</v></c>`;
      }
      if (template.emptyText) {
        return `<c r="${ref}" s="${template.style}" t="s"><v>${stringIndex("")}</v></c>`;
      }
      return `<c r="${ref}" s="${template.style}"/>`;
    });
    rows.push(
      `${rowOpen.replace(`r="${EXAMPLE_ROW}"`, `r="${r}"`)}>${cells.join("")}</row>`,
    );
  });

  const tRow = H_ROW + 1 + lines.length;
  rows.push(renumber(rowXml(sheet, T_ROW), T_ROW, tRow));
  const last = Math.max(TEMPLATE_LAST_ROW, tRow);
  const blank = rowXml(sheet, BLANK_ROW);
  for (let r = tRow + 1; r <= last; r++) {
    rows.push(blank.replace(`r="${BLANK_ROW}"`, `r="${r}"`));
  }

  const filled = sheet
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:AR${last}"/>`)
    .replace(
      /<sheetData>[\s\S]*<\/sheetData>/,
      `<sheetData>${rows.join("")}</sheetData>`,
    );
  zip.file(SHEET, filled);

  const count = (filled.match(/ t="s"/g) ?? []).length;
  zip.file(
    STRINGS,
    strings.replace(
      /<sst ([^>]*?)count="\d+" uniqueCount="\d+">[\s\S]*<\/sst>/,
      `<sst $1count="${count}" uniqueCount="${items.length}">${items.join("")}</sst>`,
    ),
  );

  const core = await zip.file(CORE)!.async("string");
  zip.file(
    CORE,
    core.replace(
      /<dcterms:modified xsi:type="dcterms:W3CDTF">[^<]*<\/dcterms:modified>/,
      `<dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</dcterms:modified>`,
    ),
  );

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
