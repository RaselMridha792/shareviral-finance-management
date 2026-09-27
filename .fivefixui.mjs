/**
 * The three fixes that only a browser can vouch for.
 *
 *   1. Table links are visibly links: underlined, violet-ink — and inside a
 *      coloured money row, the row's own colour (#46) — measured off the
 *      computed style, not read off the class list. The Entry No. column is
 *      off All transactions (#45); the attached paper opens from Reference,
 *      and a cell with neither a number nor a paper is plain text reading N/A.
 *   2. The dashboard heading carries the bank's name under it, not the type
 *      label beside it, and untouched zero accounts are not on the page.
 *   3. Deleting a payroll run removes the row without a reload.
 *
 *     node .fivefixui.mjs      (local only)
 *
 * Brought up to date 27 Sep 2026: no Entry No. column (SESSIONS #45 "Entry No.
 * off" — the bank's number is in Reference, the paper opens by its eye); links
 * are violet-ink in the new design (#80), and inside a money row they take the
 * row's colour (#46), so "blue, not lime" is measured as those two rules. The
 * payroll fixture is January 2033 alone, so .sheetqa's May 2033 is left be.
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
// something to draw and the Invoice and Reference cells have both of their
// cases (paper, and neither); a payroll run to delete. Files go first — the seeded bank slip hangs off an entry, and
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
 * attached; since #45 the column is gone and a bank slip with no number typed
 * is opened from Reference by an eye — so this row carries one.
 */
await db.query(
  `insert into files (storage_key, original_name, mime_type, size_bytes, checksum, kind, transaction_id)
   values ('qa/fivefix-' || $1::text, 'qa-bank-slip.pdf', 'application/pdf', 100, 'qa-checksum', 'bank_statement', $1::uuid)`,
  [withDoc.id],
);
/*
 * And the other half of that rule: an entry with nothing attached and no
 * invoice number. Its Invoice cell reads N/A instead of pretending to open
 * something, and the bank's number still shows in Reference.
 */
await db.query(
  `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, category_id, description, reference, created_by, updated_by)
   values ('TXN-UIQA-2', $1, 'out', '2026-08-15', '250.00', 'BDT', $2, 'QA UI paperless row', 'FT26UIQA0091', $3, $3)`,
  [acct.id, catOut, admin],
);
await db.query("delete from payroll_runs where period_year = 2033 and period_month = 1");
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

/*
 * Cells are located by their column heading, never by a counted index, and
 * each one is read for what it shows, whether it holds a control, and the
 * computed colour and underline of that control beside the cell's own colour.
 *
 * Was: every short <a>/<button> in the row, matched by its text. The row now
 * carries an eye button and the row actions as well, and the Entry No. cell it
 * looked for is gone (#45), so the columns are named instead.
 */
const measured = await links.evaluate(() => {
  const table = [...document.querySelectorAll("table")].find((t) =>
    (t.textContent ?? "").includes("INV-UIQA-7"),
  );
  if (!table) return { missing: true };
  const heads = [...table.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
  const rowOf = (needle) =>
    [...table.querySelectorAll("tbody tr")].find((r) =>
      (r.textContent ?? "").includes(needle),
    ) ?? null;
  const read = (row) => {
    if (!row) return null;
    const tds = [...row.querySelectorAll("td")];
    const cell = (label) => {
      const td = tds[heads.indexOf(label)];
      if (!td) return null;
      const control = td.querySelector("a, button");
      const style = control ? getComputedStyle(control) : null;
      return {
        text: (td.textContent ?? "").replace(/\s+/g, " ").trim(),
        clickable: Boolean(control),
        label: control?.getAttribute("aria-label") ?? null,
        title: control?.getAttribute("title") ?? null,
        color: style?.color ?? null,
        tdColor: getComputedStyle(td).color,
        underlined: [td, ...td.querySelectorAll("*")].some((el) =>
          getComputedStyle(el).textDecorationLine.includes("underline"),
        ),
      };
    };
    return {
      text: (row.textContent ?? "").replace(/\s+/g, " ").trim(),
      rowClass: row.className,
      invoice: cell("Invoice"),
      reference: cell("Reference"),
      account: cell("Account"),
    };
  };
  return {
    missing: false,
    heads,
    withDoc: read(rowOf("INV-UIQA-7")),
    paperless: read(rowOf("FT26UIQA0091")),
  };
});

check(
  "the row under test is on the screen",
  !measured.missing && Boolean(measured.withDoc),
  measured.withDoc ? "" : "seeded row not found",
);
const invoiceCell = measured.withDoc?.invoice;
const accountCell = measured.withDoc?.account;
check(
  "the invoice number is underlined",
  Boolean(invoiceCell?.underlined) && /INV-UIQA-7/.test(invoiceCell?.text ?? ""),
  invoiceCell ? `color ${invoiceCell.color}` : "no invoice cell",
);
/*
 * Was: "the Entry No. is a link when a document is attached". The owner took
 * Entry No. off All transactions (SESSIONS #45, "entry no thakbena"): our own
 * number stays on the statement, the exports and the documents drawer, and the
 * bank's number is the Reference column. So the column must be gone, and the
 * attached bank slip is reached from Reference — by its eye, since no number
 * was typed (ReferenceCell: "an eye when there is only paper").
 */
check(
  "the Entry No. column is off this list, and our own number on neither row",
  !measured.missing &&
    !measured.heads.some((h) => /Entry No/i.test(h)) &&
    !(measured.withDoc?.text ?? "").includes("TXN-UIQA-1") &&
    !(measured.paperless?.text ?? "").includes("TXN-UIQA-2"),
  (measured.heads ?? []).map((h) => h || "( )").join(" | "),
);
const refCell = measured.withDoc?.reference;
check(
  "the bank slip attached to the entry opens from Reference, by its eye",
  Boolean(refCell?.clickable) &&
    refCell?.label === "Show the attached record" &&
    /View/.test(refCell?.text ?? ""),
  refCell ? `cell ${JSON.stringify(refCell.text)}, control ${refCell.label}` : "no Reference cell",
);
check(
  "the account name link is underlined",
  Boolean(accountCell?.underlined) && /QA UI Bank/.test(accountCell?.text ?? ""),
  accountCell ? `color ${accountCell.color}` : "no account cell",
);
/*
 * Was: "and they are blue, not the brand lime". Two decisions since: a link
 * inside a coloured row takes the ROW's colour and is told apart by its
 * underline (SESSIONS #46, "sob color red hobe ... sudhu underline holei
 * colbe"; globals.css `tr.row-out > td a { color: inherit }`), and the link
 * colour itself is violet-ink, not blue (the new design, #80) — measured on a
 * link outside a coloured row, the payroll run below. These rows are money
 * out, so the links here must read the red the cell reads.
 */
check(
  "and in a money-out row they wear the row's own colour — one colour per row",
  /\brow-out\b/.test(measured.withDoc?.rowClass ?? "") &&
    Boolean(invoiceCell?.color) &&
    invoiceCell.color === invoiceCell.tdColor &&
    Boolean(accountCell?.color) &&
    accountCell.color === accountCell.tdColor,
  `invoice ${invoiceCell?.color} in a ${invoiceCell?.tdColor} cell, account ${accountCell?.color} in a ${accountCell?.tdColor} cell`,
);

/*
 * The other branch: nothing attached and no invoice number, so nothing to
 * press. Read off the <td> rather than off a control, because the point of the
 * check is that there is no control. The row is found by the bank's number now
 * that ours is not on the screen.
 */
const paperless = measured.paperless;
check(
  "the paperless row is on the screen",
  Boolean(paperless),
  paperless ? "" : "seeded paperless row not found",
);
// Was: the Entry No. cell with no document (c4590a1). That column is gone
// (#45); the Invoice cell carries the same rule — N/A when there is neither a
// number nor a paper (reference-kind.tsx ReferenceCell).
check(
  "an Invoice cell with no number and nothing attached is not a link",
  Boolean(paperless?.invoice) &&
    !paperless.invoice.clickable &&
    !paperless.invoice.underlined,
  `clickable ${paperless?.invoice?.clickable}, underlined ${paperless?.invoice?.underlined}`,
);
check(
  "it reads N/A, and the bank's number still shows in Reference",
  paperless?.invoice?.text === "N/A" &&
    (paperless?.reference?.text ?? "").includes("FT26UIQA0091"),
  `invoice ${JSON.stringify(paperless?.invoice?.text)}, reference ${JSON.stringify(paperless?.reference?.text)}`,
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

/*
 * The link colour itself, where no row tints it: the run's name on the payroll
 * list is a link in an uncoloured table. Was "blue, not the brand lime"; the
 * new design made links violet-ink (SESSIONS #80: "Links are violet-ink and
 * keep their underline"). Compared with --sv-violet-ink as the browser
 * resolves it, and by hue as well — violet is blue over red over green, which
 * the old link blue (green over red) and the lime (green first) both fail.
 */
const runLink = await pay.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("January 2033"),
  );
  const a = [...(row?.querySelectorAll("a") ?? [])].find(
    (el) => (el.textContent ?? "").trim() === "January 2033",
  );
  const probe = document.createElement("span");
  probe.style.color = "var(--sv-violet-ink)";
  document.body.append(probe);
  const violetInk = getComputedStyle(probe).color;
  probe.remove();
  if (!a) return { missing: true, violetInk };
  const style = getComputedStyle(a);
  return {
    missing: false,
    color: style.color,
    underlined: style.textDecorationLine.includes("underline"),
    violetInk,
  };
});
const isViolet = (c) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c ?? "");
  if (!m) return false;
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return b > r && r > g;
};
check(
  "a link outside a coloured row is violet-ink and underlined — not blue, not the brand lime",
  !runLink.missing &&
    runLink.underlined &&
    runLink.color === runLink.violetInk &&
    isViolet(runLink.color),
  runLink.missing
    ? "no run link found"
    : `run link ${runLink.color}, --sv-violet-ink ${runLink.violetInk}, underlined ${runLink.underlined}`,
);

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
await db.query("delete from payroll_runs where period_year = 2033 and period_month = 1");
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
