/**
 * The three fixes that only a browser can vouch for.
 *
 *   1. Table links are visibly links: blue, underlined — measured off the
 *      computed style, not read off the class list. The Entry No. cell is a
 *      link only where a document hangs off the entry; where none does it is
 *      plain text reading N/A (c4590a1).
 *   2. The dashboard heading carries the bank's name under it, not the type
 *      label beside it, and untouched zero accounts are not on the page.
 *   3. Deleting a payroll run removes the row without a reload.
 *
 *     node .fivefixui.mjs      (local only)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

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

/* ------------------------------------------------------------- fixtures */

// An account with a bank name and two movements, so the dashboard has
// something to draw and the Entry No. column has both of its cases; a payroll
// run to delete. Files go first — the seeded bank slip hangs off an entry, and
// the entry cannot go while it is there.
await db.query(`delete from files where transaction_id in (select id from transactions where account_id in (select id from accounts where name = 'QA UI Bank'))`);
await db.query(`delete from transactions where account_id in (select id from accounts where name = 'QA UI Bank')`);
await db.query(`delete from accounts where name in ('QA UI Bank', 'QA UI Sleeper')`);
const admin = person.id;
const acct = (
  await db.query(
    `insert into accounts (name, type, bank_name, account_number, currency, opening_balance, opening_balance_on, created_by, updated_by)
     values ('QA UI Bank', 'bank', 'Standard Chartered Bank', '01711223344', 'BDT', '5000.00', '2026-08-01', $1, $1) returning id`,
    [admin],
  )
).rows[0];
// A sleeper: zero opening, no movement — must NOT appear on the dashboard.
await db.query(
  `insert into accounts (name, type, currency, opening_balance, opening_balance_on, created_by, updated_by)
   values ('QA UI Sleeper', 'bank', 'BDT', '0.00', '2026-08-01', $1, $1)`,
  [admin],
);
const catOut = (
  await db.query("select id from categories where kind='out' and deleted_at is null limit 1")
).rows[0].id;
const withDoc = (
  await db.query(
    `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, category_id, description, invoice_no, created_by, updated_by)
     values ('TXN-UIQA-1', $1, 'out', '2026-08-15', '750.00', 'BDT', $2, 'QA UI link row', 'INV-UIQA-7', $3, $3) returning id`,
    [acct.id, catOut, admin],
  )
).rows[0];
/*
 * A document on the entry.
 *
 * The Entry No. cell used to be a link on every row — an empty drawer on the
 * common case, with an amber triangle marking the exception that was most of
 * the table. Since c4590a1 the cell is a link only when something is actually
 * attached, so a row that is to be measured as a link has to have a file.
 */
await db.query(
  `insert into files (storage_key, original_name, mime_type, size_bytes, checksum, kind, transaction_id)
   values ('qa/fivefix-' || $1::text, 'qa-bank-slip.pdf', 'application/pdf', 100, 'qa-checksum', 'bank_statement', $1::uuid)`,
  [withDoc.id],
);
/*
 * And the other half of that rule: an entry with nothing attached. It keeps
 * its own number and the bank's, and reads N/A instead of pretending to open
 * something.
 */
await db.query(
  `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, category_id, description, reference, created_by, updated_by)
   values ('TXN-UIQA-2', $1, 'out', '2026-08-15', '250.00', 'BDT', $2, 'QA UI paperless row', 'FT26UIQA0091', $3, $3)`,
  [acct.id, catOut, admin],
);
await db.query("delete from payroll_runs where period_year = 2033");
await db.query(
  `insert into payroll_runs (period_year, period_month, label, status, total_gross, total_additions, total_tds, total_deductions, total_net, created_by, updated_by)
   values (2033, 1, 'January 2033', 'draft', '0.00','0.00','0.00','0.00','0.00', $1, $1)`,
  [admin],
);

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------ 1. links are links */

const links = await browser.newPage();
await links.setViewport({ width: 1500, height: 1000 });
await links.goto(`${WEB}/transactions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);

const measured = await links.evaluate(() => {
  const out = [];
  const linkVar = getComputedStyle(document.documentElement)
    .getPropertyValue("--link")
    .trim();
  // The invoice cell, the refNo cell, and the account-name link on the row
  // that carries an invoice.
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("INV-UIQA-7"),
  );
  if (!row) return { linkVar, out: [], missing: true };
  for (const el of row.querySelectorAll("a, button")) {
    const text = (el.textContent ?? "").trim();
    if (!text || text.length > 40) continue;
    /*
     * The underline may live on the control itself or on a span inside it —
     * the refNo button wraps its text in a styled span, and measuring the
     * button reported the app's one correctly-underlined two-line cell as
     * bare. Whichever element actually paints the text is the one measured.
     */
    const painted =
      [...el.querySelectorAll("span")].find((s) =>
        s.className.includes("underline"),
      ) ?? el;
    const style = getComputedStyle(painted);
    out.push({
      text: text.slice(0, 24),
      color: style.color,
      underlined: style.textDecorationLine.includes("underline"),
    });
  }
  return { linkVar, out, missing: false };
});

check(
  "the row under test is on the screen",
  !measured.missing,
  measured.missing ? "seeded row not found" : "",
);
const invoiceCell = measured.out.find((c) => c.text === "INV-UIQA-7");
const refCell = measured.out.find((c) => /^TXN-UIQA-1/.test(c.text));
const accountCell = measured.out.find((c) => c.text === "QA UI Bank");
check(
  "the invoice number is underlined",
  Boolean(invoiceCell?.underlined),
  invoiceCell ? `color ${invoiceCell.color}` : "no invoice cell",
);
/*
 * Was: "the transaction id is underlined", asserted on a row with no document
 * attached. Until c4590a1 the Entry No. cell rendered as a link on every row;
 * now it is a link only when something is attached to the entry, so the row
 * under test carries a file (see the fixtures) and the paperless case is
 * checked below instead of expected to be a link.
 */
check(
  "the Entry No. is a link when a document is attached",
  Boolean(refCell?.underlined),
  refCell ? `color ${refCell.color}` : "no Entry No. cell",
);
check(
  "the account name link is underlined",
  Boolean(accountCell?.underlined),
  accountCell ? `color ${accountCell.color}` : "no account cell",
);
// Blue rather than the lime the app uses for emphasis: the blue channel
// should dominate red and be well clear of the green-heavy brand colour.
const isBlue = (c) => {
  // Chrome reports oklch-derived colours as lab(); a negative b* axis is
  // the blue half of the plane, and the brand lime sits far on the other side.
  const lab = /lab\(([\d.]+)%?\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(c ?? "");
  if (lab) return Number(lab[3]) < -20;
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c ?? "");
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return b > r && b > 120;
};
check(
  "and they are blue, not the brand lime",
  isBlue(invoiceCell?.color) && isBlue(accountCell?.color),
  `invoice ${invoiceCell?.color}, account ${accountCell?.color}`,
);

/*
 * The other branch of the same cell: nothing attached, so nothing to press.
 * Read off the <td> that carries our number rather than off a control, because
 * the point of the check is that there is no control.
 */
const paperless = await links.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("TXN-UIQA-2"),
  );
  if (!row) return { missing: true };
  const cell = [...row.querySelectorAll("td")].find((td) =>
    (td.textContent ?? "").includes("TXN-UIQA-2"),
  );
  if (!cell) return { missing: true };
  return {
    missing: false,
    text: (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
    clickable: Boolean(cell.querySelector("a, button")),
    underlined: [cell, ...cell.querySelectorAll("*")].some((el) =>
      getComputedStyle(el).textDecorationLine.includes("underline"),
    ),
  };
});
check(
  "the paperless row is on the screen",
  !paperless.missing,
  paperless.missing ? "seeded paperless row not found" : "",
);
check(
  "an Entry No. with no document is not a link",
  !paperless.missing && !paperless.clickable && !paperless.underlined,
  `clickable ${paperless.clickable}, underlined ${paperless.underlined}`,
);
check(
  "it reads N/A, and still shows our number and the bank's",
  /N\/A/.test(paperless.text ?? "") &&
    (paperless.text ?? "").includes("TXN-UIQA-2") &&
    (paperless.text ?? "").includes("FT26UIQA0091"),
  `cell: ${JSON.stringify(paperless.text)}`,
);
await links.close();

/* --------------------------------------- 2. the dashboard heading and hush */

const dash = await browser.newPage();
await dash.setViewport({ width: 1500, height: 1200 });
await dash.goto(`${WEB}/`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(3000);

const dashRead = await dash.evaluate(() => {
  const text = document.body.innerText;
  const heading = [...document.querySelectorAll("h2")].find((h) =>
    (h.textContent ?? "").includes("QA UI Bank"),
  );
  const sub = heading?.parentElement?.querySelector("p")?.textContent?.trim();
  return {
    hasBank: text.includes("QA UI Bank"),
    hasSleeper: text.includes("QA UI Sleeper"),
    subtitle: sub ?? null,
    qualifierBesideTitle: (heading?.textContent ?? "").includes("Bank account"),
  };
});
check(
  "the moved account is on the dashboard",
  dashRead.hasBank,
  "",
);
check(
  "the untouched zero account is not",
  !dashRead.hasSleeper,
  dashRead.hasSleeper ? "QA UI Sleeper is still shown" : "",
);
check(
  "the bank's own name sits under the heading",
  dashRead.subtitle === "Standard Chartered Bank · 01711223344",
  `subtitle: ${JSON.stringify(dashRead.subtitle)}`,
);
check(
  "and the type label no longer rides beside the title",
  !dashRead.qualifierBesideTitle,
  "",
);
await dash.close();

/* ----------------------------- 3. a deleted payroll run leaves immediately */

const pay = await browser.newPage();
await pay.setViewport({ width: 1500, height: 1000 });
await pay.goto(`${WEB}/payroll`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);

const rowThere = await pay.evaluate(() =>
  document.body.innerText.includes("January 2033"),
);
check("the run to delete is listed", rowThere, "");

await pay.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("January 2033"),
  );
  row.querySelector('button[aria-label="Move to trash"]').click();
});
await settle(500);
await pay.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  box.querySelector('input[type="checkbox"]').click();
});
await pay.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  const field = [...box.querySelectorAll("input")].find((i) =>
    i.className.includes("font-mono"),
  );
  field.focus();
});
await pay.keyboard.type("trash", { delay: 15 });
await settle(300);
await pay.evaluate(() => {
  const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  );
  [...box.querySelectorAll("button")]
    .find((b) => /^Yes, trash/i.test(b.textContent ?? ""))
    .click();
});
await settle(2500);

const afterDelete = await pay.evaluate(() => ({
  stillListed: document.body.innerText.includes("January 2033"),
  dialogOpen: [...document.querySelectorAll('[role="dialog"]')].some((d) =>
    /to the trash\?/i.test(d.textContent ?? ""),
  ),
}));
check(
  "the deleted run leaves the table without a reload",
  !afterDelete.stillListed && !afterDelete.dialogOpen,
  afterDelete.stillListed ? "the row is still there" : "",
);
const inDb = (
  await db.query(
    "select deleted_at from payroll_runs where period_year = 2033 and period_month = 1",
  )
).rows[0];
check(
  "and it is really in the trash, not just hidden",
  Boolean(inDb?.deleted_at),
  "",
);
await pay.close();

await browser.close();

/* ---------------------------------------------------------------- tidy up */
await db.query("delete from payroll_runs where period_year = 2033");
// Files first: the seeded bank slip hangs off the entry, and the row it
// hangs off cannot go while it is there.
await db.query(`delete from files where transaction_id in (select id from transactions where account_id in (select id from accounts where name = 'QA UI Bank'))`);
await db.query(`delete from transactions where account_id in (select id from accounts where name = 'QA UI Bank')`);
await db.query(`delete from accounts where name in ('QA UI Bank', 'QA UI Sleeper')`);
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
