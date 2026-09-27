/**
 * Five changes to two tables, driven rather than read off a diff.
 *
 * The owner asked for these together, and they are the kind that a diff shows
 * perfectly while the screen shows something else — a column removed from the
 * headings but not the body, a colour that lands on the wrong row, a link that
 * stops being a link but keeps its click.
 *
 *   24  "All accounts" gone from the filter; "Show voided" gone; the dollars
 *       read small under the taka instead of taking their own column
 *   25  a money-in row is green and a money-out row red — the whole row
 *   26  no Category column, and no small line under the description
 *   27  a reference with nothing attached says N/A and does not open a viewer
 *   31  the bank statement reads oldest first, with the same row colours
 *
 * It also checks the two things most likely to be broken BY those changes: the
 * headings and the cells still agreeing on how many columns there are, and the
 * running balance still counting downwards now that the statement is the other
 * way round.
 *
 *     node .tabletidyqa.mjs      (local only — writes and deletes)
 *
 * Brought up to date 27 Sep 2026: the expense states the `usdRate` every entry
 * now requires (#67); the tints are read off a cell, where `tr.row-in > td`
 * paints them; and the Reference cell is found by its heading, since #45 took
 * the TXN- entry number off this table.
 *
 * Brought up to date 27 Sep 2026 (2): rows found by data-row-id, the
 * Description column is gone. The tints are read off the Date cell, and #26
 * ("no small line under the description") now asks that the payment method is
 * not on the row and is in the row's popup, with the description.
 */
import fs from "node:fs";
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
const call = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const wipe = async () => {
  await db.query("delete from transactions where description like 'TIDYQA%'");
  await db.query("delete from accounts where name like 'TIDYQA %'");
};
await wipe();

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const month = TODAY.slice(0, 8);
const account = (
  await call("POST", "/accounts", {
    name: "TIDYQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "100000.00",
    openingBalanceOn: month + "01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/* One in, one out, on different days so the order is checkable. */
const cashIn = await call("POST", "/transactions/cash-in", {
  txnDate: month + "05",
  accountId: account.id,
  amount: "50000.00",
  description: "TIDYQA money arriving",
  usdRate: "122.00",
  usdSent: "409.84",
});
const spend = await call("POST", "/transactions", {
  direction: "out",
  txnDate: month + "20",
  accountId: account.id,
  amount: "9000.00",
  categoryId: cat.id,
  description: "TIDYQA money leaving",
  paymentMethod: "bank_transfer",
  usdRate: "122.00", // required on every entry now (SESSIONS #67)
});
check(
  "one movement in and one out are recorded",
  cashIn.status === 201 && spend.status === 201,
  `HTTP ${cashIn.status}/${spend.status}`,
);

/* The rows are found by what they ARE — `tr[data-row-id]` — and not by their
   description, which is no longer on any ledger table. The id comes from the
   response that made the entry, or from the row by its description. */
const idOf = async (res, description) =>
  res.body?.id ??
  (
    await db.query(
      "select id from transactions where description=$1 and deleted_at is null limit 1",
      [description],
    )
  ).rows[0]?.id ??
  "";
const IN_ID = await idOf(cashIn, "TIDYQA money arriving");
const OUT_ID = await idOf(spend, "TIDYQA money leaving");

/* -------------------------------- browser ------------------------------ */

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
const page = await browser.newPage();
await page.setViewport({ width: 1700, height: 1200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * The browser reports these as oklab, not rgb.
 *
 * The tints are written as Tailwind alpha shades of the app's own tokens, and
 * those tokens are oklch — so `getComputedStyle` answers
 * `oklab(0.78 -0.12 0.05 / 0.06)`. An rgb-only parser read every one of them as
 * "none" and reported the colours as missing when they were on the screen. In
 * oklab the SECOND number is the green-red axis: negative is green, positive is
 * red, which is the whole test.
 */
const tint = (value) => {
  const s = String(value ?? "");
  const lab = /oklab\(\s*[\d.]+\s+(-?[\d.]+)/.exec(s);
  if (lab) {
    const a = Number(lab[1]);
    if (Math.abs(a) < 0.01) return "none";
    return a < 0 ? "green" : "red";
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(s);
  if (!rgb) return "none";
  const [r, g, , alpha] = rgb[1].split(",").map((n) => Number(n.trim()));
  if (alpha === 0) return "none";
  if (g > r) return "green";
  if (r > g) return "red";
  return "none";
};

await page.goto(`${WEB}/transactions`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);

/*
 * One row, read by its id: its text, its tint, and the cells under the
 * headings asked for. The tint is painted on the CELLS — `tr.row-in > td` in
 * globals.css, since 9c03cdb ("the row's colour", 1 Sep) coloured the text
 * with it — and the <tr> itself stays transparent. It used to be read off the
 * description cell; that column is gone, so it is read off the Date cell,
 * which every ledger table still has.
 */
const readRow = (id, wanted) => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const all = [...document.querySelectorAll("tbody tr")];
  const row = document.querySelector(`tbody tr[data-row-id="${id}"]`);
  const cells = [...(row?.querySelectorAll("td") ?? [])];
  const under = (heading) => cells[heads.indexOf(heading)];
  const byHead = Object.fromEntries(
    wanted.map((h) => {
      const c = under(h);
      return [
        h,
        {
          text: (c?.textContent ?? "").replace(/\s+/g, " ").trim(),
          isButton: Boolean(c?.querySelector("button")),
        },
      ];
    }),
  );
  const dateCell = under("Date");
  return {
    found: Boolean(row),
    index: row ? all.indexOf(row) : -1,
    text: (row?.textContent ?? "").replace(/\s+/g, " "),
    bg: dateCell ? getComputedStyle(dateCell).backgroundColor : undefined,
    cells: byHead,
  };
};

const txn = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const first = document.querySelector("tbody tr");
  const cells = first ? first.querySelectorAll("td").length : 0;
  const filters = (document.querySelector("main")?.textContent ?? "").replace(
    /\s+/g,
    " ",
  );
  const options = [...document.querySelectorAll("select option")].map((o) =>
    (o.textContent ?? "").trim(),
  );
  return { heads, cells, filters, options };
});

check(
  "26: the Category column is gone from the headings",
  !txn.heads.some((h) => /^Category$/i.test(h)),
  txn.heads.join(" | ").slice(0, 170),
);
check(
  "and the headings and the cells still agree on how many columns there are",
  txn.cells === txn.heads.length,
  `${txn.heads.length} headings, ${txn.cells} cells`,
);
check(
  "24: the dollars no longer have a column of their own",
  !txn.heads.some((h) => /Amount \(USD\)/i.test(h)) &&
    txn.heads.some((h) => /^Amount$/i.test(h)),
  txn.heads.filter((h) => /amount|usd/i.test(h)).join(" | "),
);
check(
  '24: "Show voided" is gone',
  !/Show voided/i.test(txn.filters),
  "",
);
check(
  '24: the account filter no longer offers "All accounts"',
  !txn.options.some((o) => /^All accounts$/i.test(o)),
  txn.options.slice(0, 6).join(" | "),
);

const inRow = await page.evaluate(readRow, IN_ID, ["Amount"]);
const outRow = await page.evaluate(readRow, OUT_ID, ["Amount", "Reference"]);
const notFound = (r) => (r.found ? "" : " (row not found)");
check(
  "25: the money-in row is tinted green",
  inRow.found && tint(inRow.bg) === "green",
  `${inRow.bg} -> ${tint(inRow.bg)}${notFound(inRow)}`,
);
check(
  "25: and the money-out row red",
  outRow.found && tint(outRow.bg) === "red",
  `${outRow.bg} -> ${tint(outRow.bg)}${notFound(outRow)}`,
);

/* 26, re-expressed now the description has left the table. The small line
   that used to sit under it (payment method, transfer chip) must not have
   moved onto the row in some other cell — All transactions draws no payment
   method — and it is still there to be read, in the popup a click on the row
   opens, which is where the description itself lives now. */
check(
  "26: the payment method and transfer chip are not on the row",
  outRow.found && !/Bank transfer|\btransfer\b/i.test(outRow.text),
  outRow.found ? outRow.text.slice(0, 110) : "row not found",
);
const popup = await (async () => {
  const opened = await page.evaluate((id) => {
    const row = document.querySelector(`tbody tr[data-row-id="${id}"]`);
    /* On the Date cell: a click that lands on a link or a button inside the
       row is left to that control and does not open the popup. */
    const target = row?.querySelectorAll("td")[
      [...document.querySelectorAll("thead th")].findIndex(
        (h) => (h.textContent ?? "").trim() === "Date",
      )
    ];
    if (!target) return false;
    target.click();
    return true;
  }, OUT_ID);
  if (!opened) return { found: false, title: "", text: "" };
  await settle(900);
  const read = await page.evaluate(() => {
    const p = [...document.querySelectorAll("[data-popup]")].pop();
    const heading = p?.querySelector("h1, h2, h3, [id$='title']");
    return {
      found: Boolean(p),
      title: (heading?.textContent ?? "").trim(),
      text: (p?.textContent ?? "").replace(/\s+/g, " "),
    };
  });
  await page.keyboard.press("Escape");
  await settle(500);
  return read;
})();
check(
  "26: the description, and how it was paid, are in the row's popup instead",
  popup.found &&
    popup.title === "TIDYQA money leaving" &&
    /Paid by\s*Bank transfer/i.test(popup.text),
  popup.found
    ? `title "${popup.title}" — ${popup.text.slice(0, 140)}`
    : "no popup opened",
);
check(
  "24: the dollars still show, small, on the row that has them",
  inRow.found && /409\.84|\$409/.test(inRow.cells.Amount?.text ?? ""),
  inRow.found ? `Amount cell "${inRow.cells.Amount?.text}"` : "row not found",
);

/* 27: a reference with no document is not a link.
   Found by its heading. It used to be the cell holding the TXN- number, but
   #45 took Entry No. off this table ("entry no thakbena") and Reference is
   its own `ReferenceCell` column, so no cell on the row says TXN- any more. */
const refCell = outRow.cells.Reference ?? { text: "", isButton: false };
check(
  "27: a reference with nothing attached says N/A and is not clickable",
  outRow.found && refCell.text.includes("N/A") && !refCell.isButton,
  `"${refCell.text}", button ${refCell.isButton}${notFound(outRow)}`,
);

/* ---------------------------- the statement ---------------------------- */

/* `?account=`, which is the key the page reads. With the wrong key it fell
   back to whichever account sorts first and every check below measured a
   statement of somebody else's money. */
await page.goto(`${WEB}/statement?account=${account.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);

/* Off a cell, as above: the statement uses the same `row-in`/`row-out`, and
   its rows carry the same `data-row-id`. */
const stmtIn = await page.evaluate(readRow, IN_ID, []);
const stmtOut = await page.evaluate(readRow, OUT_ID, []);
const stmt = {
  blurb: await page.evaluate(() =>
    (document.querySelector("main")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 200),
  ),
};

const firstIdx = stmtIn.index;
const lastIdx = stmtOut.index;
check(
  "31: the statement reads oldest first",
  firstIdx >= 0 && lastIdx >= 0 && firstIdx < lastIdx,
  `arriving at ${firstIdx}, leaving at ${lastIdx}`,
);
check(
  "31: and the page says so rather than still claiming newest first",
  /oldest first/i.test(stmt.blurb) && !/newest first/i.test(stmt.blurb),
  stmt.blurb.slice(0, 110),
);
check(
  "31: the statement rows carry the same colours",
  tint(stmtIn.bg) === "green" && tint(stmtOut.bg) === "red",
  `${tint(stmtIn.bg)} / ${tint(stmtOut.bg)}`,
);

/*
 * The running balance has to count DOWNWARDS now. This is what the reversal
 * could quietly break: the figures were computed ascending and then shown
 * descending, so reading them in the new order must still add up.
 */
const balances = await page.evaluate(() =>
  [...document.querySelectorAll("tbody tr")]
    .map((r) => {
      const cells = [...r.querySelectorAll("td")];
      const last = cells
        .map((c) => (c.textContent ?? "").trim())
        .filter((t) => /^৳/.test(t));
      return last[last.length - 1] ?? null;
    })
    .filter(Boolean),
);
check(
  "31: the balance still ends at the account's closing figure",
  balances.length >= 2 &&
    Number(String(balances[balances.length - 1]).replace(/[^0-9.]/g, "")) ===
      141000,
  `${balances.join(" -> ")} (100000 + 50000 - 9000 = 141000)`,
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
