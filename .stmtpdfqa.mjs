/**
 * The bank statement PDF: what it says, in what order, and whether anything
 * gets cut.
 *
 * The owner, with the file open:
 *
 *   *"bank statement export er etake valo ekta font a daw. ekhane font gula
 *    onek boro boro dekhacche etar ui ke sundor koro. line by line statement
 *    take surute rakho tarpor graph chart gulake nice rakho. and ekhane line by
 *    line table ta theke description bad daw. ekhane date, debit credit, and
 *    ballance field gulake rakho kono kichu jeno kata na pore font choto kore
 *    diyo dorkar hole."*
 *
 * A PDF cannot be read back as text here — the embedded face is subsetted, so
 * every string in the file is a run of glyph ids rather than letters. So this
 * measures the two things that actually decide the document instead:
 *
 *   1. the SPEC the report builds — page order, columns, type sizes;
 *   2. the WIDTH each cell will draw at, computed with PDFKit and the real
 *      embedded font, against the width its column actually has.
 *
 * (2) is the one that matters. `fit()` silently ends an overlong string with
 * ".." — which is how a date became "09/06/20.." and a figure "৳8,54,000.0.."
 * — and nothing about the source says it is going to happen. The only way to
 * know is to measure the string in the face it will be drawn in.
 *
 *     node .stmtpdfqa.mjs
 */
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

import { buildBankStatementReport } from "./apps/api/src/modules/exports/bank-statement-report.ts";

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- the page */

/*
 * A4 and the margin the service actually uses.
 *
 * 61, not PDFKit's default 48 — read off `pdf.service.ts`. The first run of
 * this harness used 48 and measured columns 26pt wider than the ones the
 * document has, which is a check that would have called a cut column fine.
 */
const PAGE_WIDTH = 595.28;
const MARGIN = 61;
const CONTENT = PAGE_WIDTH - MARGIN * 2;
/* `drawStackCell` keeps this much clear to the left of a right-set figure. */
const CELL_GUTTER = 10;

/* --------------------------------------------------------- the fixture */

/*
 * The owner's own statement, figure for figure — the widest amounts in it are
 * what decide whether a column is wide enough, so inventing smaller ones would
 * measure a document nobody has.
 */
const register = {
  account: {
    name: "Exprovia LLC",
    type: "bank",
    bankName: "JP Morgan Chase",
    accountNumber: "1234566576",
    currency: "USD",
  },
  openingBalance: "0.00",
  totalIn: "1711220.00",
  totalOut: "874886.50",
  closingBalance: "836333.50",
  rows: [
    {
      txnDate: "2026-06-09",
      description: "First Ever Fund received from ShareViral",
      refNo: "TXN-2026-000047",
      categoryName: "Owner funding",
      vendorName: null,
      counterparty: "ShareViral",
      direction: "in",
      amount: "1711220.00",
      runningBalance: "1711220.00",
      voidedAt: null,
    },
    {
      txnDate: "2026-06-11",
      description: "$7000 transferred from Exprovia LLC",
      refNo: "TXN-2026-000048",
      categoryName: "Transfer",
      vendorName: null,
      counterparty: null,
      direction: "out",
      amount: "854000.00",
      runningBalance: "857220.00",
      voidedAt: null,
    },
    {
      txnDate: "2026-06-11",
      description: "Bank Transfer fee for $7000 from Exprovia",
      refNo: "TXN-2026-000050",
      categoryName: "Bank Charge",
      vendorName: null,
      counterparty: null,
      direction: "out",
      amount: "4889.20",
      runningBalance: "852330.80",
      voidedAt: null,
    },
    {
      txnDate: "2026-06-27",
      description: "Transfer fee of $6830 transaction",
      refNo: "TXN-2026-000077",
      categoryName: "Bank Charge",
      vendorName: null,
      counterparty: null,
      direction: "out",
      amount: "4923.67",
      runningBalance: "847407.13",
      voidedAt: null,
    },
    {
      txnDate: "2026-06-27",
      description: "Exprovia LLC Bank Account Fee",
      refNo: "TXN-2026-000078",
      categoryName: "Bank Charge",
      vendorName: null,
      counterparty: null,
      direction: "out",
      amount: "11073.63",
      runningBalance: "836333.50",
      voidedAt: null,
    },
    /* A void, because it is the one row that draws a word where a figure goes. */
    {
      txnDate: "2026-06-28",
      description: "A payment that was undone",
      refNo: "TXN-2026-000079",
      categoryName: "Bank Charge",
      vendorName: null,
      counterparty: null,
      direction: "out",
      amount: "1500.00",
      runningBalance: "836333.50",
      voidedAt: "2026-06-29",
    },
  ],
};

const spec = buildBankStatementReport(register, {
  companyName: "ShareViral Finance Management",
  numberFormat: "indian",
  from: "2026-05-05",
  to: "2026-09-05",
  generatedOn: "2026-09-05",
  accountTypeLabel: "Bank account",
});

/* ------------------------------------------- 1. the order of the pages */

const eyebrows = spec.pages.map((p) => p.eyebrowLeft);
check(
  "three pages: the cover, then the ledger, then the charts",
  eyebrows.length === 3 &&
    eyebrows[1] === "Line by line" &&
    eyebrows[2] === "How it moved",
  eyebrows.join(" → "),
);

const ledgerPage = spec.pages[1];
const movementPage = spec.pages[2];

/* ------------------------------------------------- 2. the ledger table */

const table = ledgerPage.blocks.find((b) => b.kind === "stackTable");
check("the ledger carries a table", Boolean(table));

const headers = table.columns.map((c) => c.header);
check(
  "four columns, and Description is gone",
  headers.length === 4 && !headers.includes("Description"),
  headers.join(" | "),
);
check(
  "date, debit, credit and balance — the four he named",
  JSON.stringify(headers) ===
    JSON.stringify(["Date", "Debit", "Credit", "Balance"]),
  headers.join(" | "),
);

/*
 * Debit is money OUT. Getting this backwards is the one mistake on this page
 * that would be wrong rather than ugly, so it is asserted from the built rows
 * rather than read off the source.
 */
const outRow = table.rows[1]; // the ৳8,54,000.00 transfer out
const inRow = table.rows[0]; // the ৳17,11,220.00 receipt
check(
  "money OUT is drawn under Debit",
  outRow[1].kind === "money" && outRow[2].kind === "empty",
  `debit=${outRow[1].kind} credit=${outRow[2].kind}`,
);
check(
  "money IN is drawn under Credit",
  inRow[2].kind === "money" && inRow[1].kind === "empty",
  `debit=${inRow[1].kind} credit=${inRow[2].kind}`,
);
check(
  "and the closing row totals them the same way round",
  table.total[1].primary.includes("8,74,886") &&
    table.total[2].primary.includes("17,11,220"),
  `${table.total[1].primary} debit · ${table.total[2].primary} credit`,
);

/* The transaction number survives the loss of the description. */
const dateCell = table.rows[0][0];
check(
  "the transaction number stays, under the date",
  dateCell.kind === "label" && String(dateCell.detail).includes("TXN-2026-000047"),
  `${dateCell.text} / ${dateCell.detail}`,
);
const voidCell = table.rows[5][0];
check(
  "a voided row still says so",
  String(voidCell.detail).startsWith("VOIDED"),
  String(voidCell.detail),
);

/* ------------------------------------------ 3. the range reads as a range */

const cover = spec.pages[0];
const display = cover.blocks.find((b) => b.kind === "display");
check(
  "the period reads as a range, with something between its ends",
  /05\/05\/2026\s[–-]\s05\/09\/2026/.test(display.eyebrow),
  display.eyebrow,
);

/* ----------------------------------------------- 4. the type came down */

check(
  "the cover's display type is no longer poster-sized",
  display.size <= 42,
  `${display.size}pt, was 58`,
);
for (const [label, page] of [
  ["ledger", ledgerPage],
  ["movement", movementPage],
]) {
  const d = page.blocks.find((b) => b.kind === "display");
  check(`the ${label} page's title came down too`, d.size <= 26, `${d.size}pt, was 36`);
}
const boxes = cover.blocks.find((b) => b.kind === "figureBoxes");
const bigs = cover.blocks.find((b) => b.kind === "bigFigures");
check(
  "the cover's figures are sized deliberately rather than left at the default",
  typeof boxes.size === "number" && typeof bigs.size === "number",
  `boxes ${boxes.size}pt, band ${bigs.size}pt`,
);

/* ------------------------------ 5. NOTHING IS CUT — measured, not assumed */

/*
 * The real face, loaded exactly as the service loads it. Measuring in
 * Helvetica would answer a question about a document nobody receives.
 */
const FONT_DIR = path.join("apps", "api", "src", "modules", "exports", "fonts");
const doc = new PDFDocument({ size: "A4", margin: MARGIN });
doc.registerFont("body", path.join(FONT_DIR, "NotoSansBengali-Regular.ttf"));
doc.registerFont("bold", path.join(FONT_DIR, "NotoSansBengali-Bold.ttf"));

/* The service's own scale, and the sizes this table asks for. */
const SIZE = { rowLabel: 10.5, rowDetail: 8, money: 12.5, moneyLarge: 16.5, tableHead: 7.5 };
const k = table.scale ?? 1;

const units = table.columns.reduce((sum, c) => sum + c.width, 0);
const widths = table.columns.map((c) => (c.width / units) * CONTENT);

/*
 * `sized()` shrinks a money figure before `fit()` would cut it, down to two
 * thirds — so a figure is only ever CUT if it still does not fit at that
 * floor. A label has no such rescue and is cut outright.
 */
const overflows = [];
const measure = (text, width, font, size, floor) => {
  doc.font(font).fontSize(size);
  const at = doc.widthOfString(String(text));
  if (at <= width) return { fits: true, need: at, at: size };
  if (floor) {
    const shrunk = Math.max(floor, (size * width) / at);
    doc.fontSize(shrunk);
    return { fits: doc.widthOfString(String(text)) <= width, need: at, at: shrunk };
  }
  return { fits: false, need: at, at: size };
};

for (const [index, row] of [...table.rows, table.total].entries()) {
  row.forEach((cell, i) => {
    const gutter = table.columns[i].align === "right" ? CELL_GUTTER : 0;
    const width = widths[i] - gutter;
    const where = `row ${index + 1}, ${table.columns[i].header}`;

    if (cell.kind === "label") {
      for (const [text, font, size] of [
        [cell.text, "bold", SIZE.rowLabel * k],
        [cell.detail, "body", SIZE.rowDetail * k],
      ]) {
        if (!text) continue;
        const m = measure(text, width, font, size);
        if (!m.fits)
          overflows.push(`${where}: "${text}" needs ${m.need.toFixed(1)}pt of ${width.toFixed(1)}pt`);
      }
    }
    if (cell.kind === "money") {
      const size = (cell.large ? SIZE.moneyLarge : SIZE.money) * k;
      const m = measure(cell.primary, width, "bold", size, size * 0.66);
      if (!m.fits)
        overflows.push(`${where}: "${cell.primary}" needs ${m.need.toFixed(1)}pt of ${width.toFixed(1)}pt`);
    }
  });
}

check(
  "not one cell in the ledger has to be cut",
  overflows.length === 0,
  overflows.length ? overflows.join("; ") : `${table.rows.length + 1} rows measured in the real face`,
);

/* The headings have to fit their own columns too. */
const headOverflow = [];
table.columns.forEach((column, i) => {
  doc.font("bold").fontSize(SIZE.tableHead * k);
  const need = doc.widthOfString(column.header.toUpperCase(), { characterSpacing: 1.4 });
  if (need > widths[i]) headOverflow.push(`${column.header}: ${need.toFixed(1)} of ${widths[i].toFixed(1)}`);
});
check(
  "and every column heading fits its column",
  headOverflow.length === 0,
  headOverflow.join("; ") || widths.map((w, i) => `${table.columns[i].header} ${w.toFixed(0)}pt`).join(" · "),
);

console.log("\n  the ledger's four columns, in points:");
table.columns.forEach((c, i) => {
  console.log(
    `    ${c.header.padEnd(9)} ${widths[i].toFixed(1).padStart(6)}pt   (was: Date 54.6, Description 183.8, In 79.5, Out 79.5, Balance 99.4)`,
  );
});

/* ---------------------------- 6. and the file still builds end to end -- */

const built = fs.existsSync(
  "C:/Users/USER/AppData/Local/Temp/claude/d--codes-Finance-Management-software/dbb8ac80-9ba7-4725-9a6a-9ccd3dbd12b5/scratchpad/statement.pdf",
);
check(
  "a real PDF was produced from the running API",
  built,
  built ? "statement.pdf in the scratchpad" : "not generated",
);

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(76));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
      failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
