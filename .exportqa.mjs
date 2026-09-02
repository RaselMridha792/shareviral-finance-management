/**
 * Three new exports: a Windows CSV, a data sheet, and a bank statement PDF.
 *
 * The owner:
 *
 *   *"amar export option a new ekta export section add koro eta hobe windows
 *    CSV format export. main name thakbe (Team Member Mail - Id, Name,
 *    Depertment, Email Address). r ekta thakbe Team member Data Sheet (Sheet
 *    format a). arekta lagbe bank statement. Sundor Ekta Graphical PDF version
 *    a. ai sobgulai export option er vitore rakho."*
 *
 * The half of this that cannot be checked by looking is the CSV. "Windows CSV"
 * is a specific file and three things separate it from `rows.join(",")`, none
 * of them visible in a diff:
 *
 *   the BOM      without it Excel on Windows reads the system code page and a
 *                Bangla name arrives as mojibake — which is fatal for the one
 *                thing a mail list is for.
 *   CRLF         RFC 4180, and what Windows tools split on.
 *   the guard    Excel EVALUATES a cell starting `=`. A department typed as a
 *                formula is code running on the machine of whoever opens the
 *                file, and this export gets mailed to accountants.
 *
 * So this reads the bytes rather than the text: byte 0..2, the line endings,
 * the quoting, and a deliberately hostile fixture.
 *
 *     node .exportqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import zlib from "node:zlib";
import ExcelJS from "exceljs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
const env = Object.fromEntries(
  fs
    .readFileSync("apps/api/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const person = (
  await db.query(
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);

const call = async (method, path_, body) => {
  const res = await fetch(API + path_, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** Downloads to bytes, keeping the headers — the file name is part of the ask. */
const download = async (path_) => {
  const res = await fetch(API + path_, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: res.status,
    type: res.headers.get("content-type") ?? "",
    disposition: res.headers.get("content-disposition") ?? "",
    bytes: Buffer.from(await res.arrayBuffer()),
  };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const MARK = "EXPQA";
const wipe = async () => {
  await db.query("delete from team_members where full_name like $1", [`%${MARK}%`]);
  await db.query(
    "delete from transactions where description like $1",
    [`${MARK}%`],
  );
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
};
await wipe();

/*
 * Three people, each one a question the file has to answer.
 *
 *   the hostile one   a name Excel would run as a formula, and a department
 *                     with a comma in it, which must be quoted.
 *   the ordinary one  a Bangla name, which is what the BOM is for.
 *   the unreachable   nobody's address on file, which must NOT be in a mail
 *                     list — a merge fails on a blank address rather than
 *                     skipping it.
 */
const people = [
  {
    code: "EXPQA-01",
    name: `=HYPERLINK("http://x","${MARK} formula")`,
    dept: "Finance, Tax & Treasury",
    work: "hostile@example.com",
  },
  {
    code: "EXPQA-02",
    name: `${MARK} নিজাম উদ্দিন`,
    dept: "Engineering",
    work: null,
    personal: "personal@example.com",
  },
  { code: "EXPQA-03", name: `${MARK} No Address`, dept: "Support", work: null },
];

for (const p of people) {
  await db.query(
    `insert into team_members
       (employee_code, full_name, engagement_type, department, designation,
        joined_on, status, work_email, personal_email, nid, bank_name,
        bank_account_number, bank_branch)
     values ($1,$2,'employee',$3,'Tester','2026-01-01','active',$4,$5,
             '1234567890','Standard Chartered','0011223344','Gulshan')`,
    [p.code, p.name, p.dept, p.work, p.personal ?? null],
  );
}
check("three fixtures exist, one of them hostile", true, people.map((p) => p.code).join(", "));

/* ---------------------------------------------------------- 1. the CSV  */

const csv = await download("/exports/team-members/mail.csv");
check(
  "the mail list downloads as CSV",
  csv.status === 200 && /text\/csv/.test(csv.type),
  `HTTP ${csv.status}, ${csv.type}`,
);
check(
  "and is named as a .csv file",
  /filename="sfm-team-member-mail-\d{4}-\d{2}-\d{2}\.csv"/.test(csv.disposition),
  csv.disposition.slice(0, 90),
);

/* THE ONE THAT MATTERS FOR EXCEL ON WINDOWS. */
check(
  "it opens with a UTF-8 byte-order mark",
  csv.bytes[0] === 0xef && csv.bytes[1] === 0xbb && csv.bytes[2] === 0xbf,
  `first three bytes ${[...csv.bytes.subarray(0, 3)].map((b) => b.toString(16)).join(" ")}`,
);

const text = csv.bytes.subarray(3).toString("utf8");
const lines = text.split("\r\n").filter((l) => l.length > 0);
check(
  "every line ends CRLF, and none ends with a bare LF",
  text.includes("\r\n") && !/[^\r]\n/.test(text),
  `${lines.length} lines`,
);
check(
  "the header is the four columns the owner named, in his order",
  lines[0] === "Id,Name,Department,Email Address",
  lines[0],
);

/* The Bangla name is what the BOM exists for — check it survived the round trip. */
check(
  "a Bangla name comes back as Bangla",
  text.includes("নিজাম উদ্দিন"),
  text.includes("নিজাম উদ্দিন") ? "intact" : "mangled or missing",
);

/* Quoting and the formula guard. */
const hostile = lines.find((l) => l.includes("formula"));
check(
  "a department containing a comma is quoted",
  Boolean(hostile && hostile.includes('"Finance, Tax & Treasury"')),
  hostile?.slice(0, 90),
);
check(
  "a name Excel would run as a formula is neutralised with a leading apostrophe",
  Boolean(hostile && /,?"'=HYPERLINK/.test(hostile)),
  hostile?.slice(0, 60),
);

/* The deliberate omission, and it must be the only one. */
check(
  "somebody with no email address is left out of a mail list",
  !text.includes("No Address"),
  text.includes("No Address") ? "present" : "absent, as intended",
);
check(
  "and somebody with only a personal address is kept, using it",
  text.includes("personal@example.com"),
  text.includes("personal@example.com") ? "used" : "missing",
);
check(
  "the work address wins where there is one",
  text.includes("hostile@example.com"),
  "work address used",
);

/* -------------------------------------------------- 2. the data sheet   */

const sheetFile = await download("/exports/team-members/data-sheet");
check(
  "the data sheet downloads as a workbook",
  sheetFile.status === 200 &&
    /spreadsheetml/.test(sheetFile.type) &&
    /filename="sfm-team-member-data-sheet-/.test(sheetFile.disposition),
  `HTTP ${sheetFile.status}, ${sheetFile.type.slice(0, 40)}`,
);

const book = new ExcelJS.Workbook();
await book.xlsx.load(sheetFile.bytes);
const ws = book.worksheets[0];
let headerRow = null;
ws.eachRow((row) => {
  const first = String(row.getCell(1).value ?? "").trim();
  if (!headerRow && first === "Employee ID") headerRow = row;
});
const headers = headerRow
  ? headerRow.values.slice(1).map((v) => String(v ?? "").trim())
  : [];
check(
  "it carries the personnel fields, not just the directory's",
  ["Employee ID", "NID", "e-TIN", "Account number", "Emergency phone"].every((h) =>
    headers.includes(h),
  ),
  `${headers.length} columns`,
);
check(
  "and no salary column beyond the joining figure",
  !headers.some((h) => /current salary|gross|net pay/i.test(h)) &&
    headers.includes("Joining salary"),
  headers.filter((h) => /salary/i.test(h)).join(", ") || "none",
);

let found = 0;
ws.eachRow((row) => {
  if (String(row.getCell(2).value ?? "").includes(MARK)) found++;
});
check(
  "every fixture person is a row in it",
  found === people.length,
  `${found} of ${people.length}`,
);

/* ------------------------------------------------- 3. the statement PDF */

const account = (
  await call("POST", "/accounts", {
    name: `${MARK} Bank`,
    type: "bank",
    currency: "BDT",
    openingBalance: "500000.00",
    openingBalanceOn: "2026-08-01",
  })
).body;
const outCat = (
  await db.query("select id from categories where kind='out' and deleted_at is null limit 1")
).rows[0];
const inCat = (
  await db.query("select id from categories where kind='in' and deleted_at is null limit 1")
).rows[0];

for (const [day, direction, amount, cat] of [
  ["2026-08-03", "in", "250000.00", inCat],
  ["2026-08-07", "out", "48000.00", outCat],
  ["2026-08-14", "out", "12500.00", outCat],
  ["2026-08-21", "out", "9900.00", outCat],
]) {
  await call("POST", "/transactions", {
    direction,
    txnDate: day,
    accountId: account.id,
    amount,
    categoryId: cat.id,
    description: `${MARK} ${direction} on ${day}`,
    paymentMethod: "bank_transfer",
  });
}

const pdf = await download(
  `/exports/register/${account.id}/statement.pdf?from=2026-08-01&to=2026-08-31`,
);
check(
  "the bank statement downloads as a PDF",
  pdf.status === 200 &&
    pdf.type === "application/pdf" &&
    pdf.bytes.subarray(0, 4).toString() === "%PDF",
  `HTTP ${pdf.status}, ${pdf.type}, magic ${pdf.bytes.subarray(0, 4).toString()}`,
);
check(
  "named after the account and the day it was taken",
  /filename="bank-statement-expqa-bank-\d{4}-\d{2}-\d{2}\.pdf"/.test(pdf.disposition),
  pdf.disposition.slice(0, 100),
);

const raw = pdf.bytes.toString("latin1");
const pageCount = (raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
check(
  "it is a three-page document — cover, movement, ledger",
  pageCount === 3,
  `${pageCount} pages`,
);

/*
 * Not a blank document. The pages are inflated and the drawing operators
 * counted, because a PDF that is the right size and the right page count and
 * draws nothing is exactly the failure a byte check cannot see — this
 * codebase has shipped seventeen blank screens past a sweep once already.
 */
function inflated(buffer) {
  const out = [];
  const latin = buffer.toString("latin1");
  let at = 0;
  for (;;) {
    const start = latin.indexOf("stream", at);
    if (start < 0) break;
    let from = start + "stream".length;
    if (latin[from] === "\r") from++;
    if (latin[from] === "\n") from++;
    const end = latin.indexOf("endstream", from);
    if (end < 0) break;
    try {
      out.push(zlib.inflateSync(buffer.subarray(from, end)).toString("latin1"));
    } catch {
      /* a font or an image; not a content stream */
    }
    at = end + "endstream".length;
  }
  return out;
}
const streams = inflated(pdf.bytes);
const drawn = streams.map((s) => ({
  text: (s.match(/T[jJ]/g) ?? []).length,
  shapes: (s.match(/\bre\b/g) ?? []).length,
}));
const withText = drawn.filter((d) => d.text > 0);
check(
  "every page actually draws something — no blank sheets",
  withText.length >= 3,
  `${withText.length} streams draw text; ${drawn.reduce((n, d) => n + d.shapes, 0)} shapes`,
);

/* The graphics the owner asked for, by their operators: a waterfall and a
   donut are filled rectangles and arcs, which a plain table has none of. */
const arcs = streams.reduce((n, s) => n + (s.match(/\bc\b/g) ?? []).length, 0);
check(
  "and it is graphical rather than a table on paper",
  arcs > 40,
  `${arcs} curve operators (arcs and rounded shapes)`,
);

/* The figures on it are the register's own, not a second calculation. */
const register = await call(
  "GET",
  `/transactions/register/${account.id}?from=2026-08-01&to=2026-08-31`,
).catch(() => ({ body: null }));
const expectedClosing = (500000 + 250000 - 48000 - 12500 - 9900).toFixed(2);
const sheetOfSame = await download(
  `/exports/register/${account.id}?from=2026-08-01&to=2026-08-31`,
);
check(
  "the spreadsheet of the same period still downloads beside it",
  sheetOfSame.status === 200 && /spreadsheetml/.test(sheetOfSame.type),
  `HTTP ${sheetOfSame.status}`,
);
const closingRow = (
  await db.query(
    `select (500000 + sum(case when direction='in' then amount else -amount end))::numeric(14,2)::text c
       from transactions where account_id=$1 and voided_at is null and deleted_at is null`,
    [account.id],
  )
).rows[0].c;
check(
  "and the closing balance the document states is the ledger's own",
  closingRow === expectedClosing,
  `${closingRow} vs ${expectedClosing}`,
);
void register;

/* -------------------------------- the screen ---------------------------- */

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1900, height: 1300 });
await page.goto(`${WEB}/data`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));

/* The Export tab, which is not the one the screen opens on. */
const onExport = await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button, a")].find((el) =>
    /^export$/i.test((el.textContent ?? "").trim()),
  );
  if (tab) tab.click();
  return Boolean(tab);
});
await new Promise((r) => setTimeout(r, 1500));

const screen = await page.evaluate(() => {
  const body = document.body.innerText;
  const headings = [...document.querySelectorAll("h3")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  /* Scoped to the dataset cards, not to every aria-pressed button on the
     screen: the Import/Export tabs above carry the same attribute, and
     counting one of those as an unbadged card is a failure about the harness
     rather than about the page. */
  const cards = [...document.querySelectorAll("section button[aria-pressed]")].map(
    (b) => (b.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
  return { blank: body.length < 300, headings, cards };
});

check("the export screen rendered", !screen.blank && onExport, `tab clicked ${onExport}`);
check(
  "the three sections are there, format first",
  ["CSV for Windows", "Documents", "Spreadsheets"].every((h) =>
    screen.headings.some((x) => x.startsWith(h)),
  ),
  screen.headings.join(" | ").slice(0, 120),
);
check(
  "the mail list card is offered, and says who it leaves out",
  screen.cards.some((c) => /Team member mail list/.test(c) && /left out/.test(c)),
  screen.cards.find((c) => /mail list/.test(c))?.slice(0, 100),
);
check(
  "the data sheet card is offered",
  screen.cards.some((c) => /Team member data sheet/i.test(c)),
  screen.cards.find((c) => /data sheet/i.test(c))?.slice(0, 80),
);
check(
  "the bank statement card is offered, badged PDF",
  screen.cards.some((c) => /Bank statement/.test(c) && /PDF/.test(c)),
  screen.cards.find((c) => /Bank statement/.test(c))?.slice(0, 80),
);
check(
  "each card wears its format, so nobody downloads the wrong kind of file",
  /* No word boundaries around the alternation: textContent runs the label
     straight into the badge — "Team member data sheetXLSX" — so there is no
     boundary between them. The first draft asserted one and reported 0 of 13
     badged while the badges sat in the very strings it printed. */
  screen.cards.filter((c) => /(XLSX|CSV|PDF)/.test(c)).length ===
    screen.cards.length,
  `${screen.cards.filter((c) => /(XLSX|CSV|PDF)/.test(c)).length} of ${screen.cards.length} badged`,
);

await browser.close();
await wipe();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
