/**
 * Walk the account register page by page and check the things a diff cannot
 * show: that the serials run 1..N unbroken across the page breaks, that no
 * entry is dropped or shown twice, that the order really is newest first, and
 * that the four figures above the table stay the period's rather than the
 * page's.
 *
 *   node .regpage.mjs                 # every account with rows
 *   node .regpage.mjs <accountId>     # one of them
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    }),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const { rows: users } = await c.query(
  "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1",
);
// What this page asks the API for: one account, voided rows included — so a
// voided entry counts towards the rows the pager has to carry.
const { rows: accounts } = await c.query(`
  select a.id, a.name, count(t.id)::int as rows
  from accounts a left join transactions t on t.account_id = a.id
  group by a.id, a.name having count(t.id) > 0 order by count(t.id) desc
`);
await c.end();

const token = jwt.sign(
  { sub: users[0].id, role: users[0].role, tv: users[0].token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await b.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 950 });

/**
 * Everything on screen right now: the rows, the pager sentence, the four
 * figures above the table, and whatever message stands in for an empty table.
 *
 * Eleven cells with the register's flags — SL, Date, Description, Category,
 * Amount (BDT), Amount (USD), USD rate, Invoice number, Transaction number,
 * Balance, actions. Each is read down to its first line, because the money
 * cells carry a dollar counterpart underneath and the description carries the
 * party and the payment method.
 */
const readPage = () =>
  p.evaluate(() => {
    const first = (s) => s.trim().split("\n")[0].trim();
    const table = document.querySelector(".table-data");
    const cells = (tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.innerText);
    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])]
      .map(cells)
      .filter((r) => r.length >= 11)
      .map((r) => ({
        sl: Number(first(r[0])),
        date: first(r[1]),
        description: first(r[2]),
        amount: first(r[4]),
        invoice: first(r[7]),
        txnId: first(r[8]),
        balance: first(r[9]),
      }));
    // The four cards above the table: OPENING, MONEY IN, MONEY OUT, CLOSING.
    const figures = [...document.querySelectorAll("p")]
      .filter((el) =>
        /^(OPENING|MONEY IN|MONEY OUT|CLOSING)$/i.test(el.innerText.trim()),
      )
      .map((el) => {
        const rest = el.parentElement.innerText.split("\n").slice(1);
        return el.innerText.trim().toUpperCase() + "=" + first(rest.join("\n"));
      });
    const sentence = document.body.innerText.match(
      /Page\s+(\d+)\s+of\s+(\d+)\s+\u00b7\s+([\d,]+)\s+\w+/,
    );
    const next = [...document.querySelectorAll("button")].find(
      (btn) => btn.innerText.trim() === "Next",
    );
    // With no rows the table is replaced by a card, so the message is what
    // stands where the table was.
    const message = table
      ? null
      : first(
          [...document.querySelectorAll("p")]
            .map((el) => el.innerText)
            .find((t) => t.trim().startsWith("No entries")) ?? "",
        );
    return {
      rows,
      figures,
      empty: message,
      page: sentence ? Number(sentence[1]) : null,
      totalPages: sentence ? Number(sentence[2]) : null,
      total: sentence ? Number(sentence[3].replace(/,/g, "")) : null,
      hasNext: Boolean(next) && !next.disabled,
    };
  });

let bad = 0;
const fail = (msg) => {
  bad += 1;
  console.log("   FAIL " + msg);
};

const clickNext = async () => {
  await p.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((btn) => btn.innerText.trim() === "Next")
      ?.click(),
  );
  await new Promise((r) => setTimeout(r, 250));
};

const targets = process.argv[2]
  ? accounts.filter((a) => a.id === process.argv[2])
  : accounts;

for (const account of targets) {
  await p.goto(`http://localhost:3000/accounts/${account.id}/register`, {
    waitUntil: "networkidle0",
    timeout: 90000,
  });
  await new Promise((r) => setTimeout(r, 400));

  const seen = [];
  const figures = [];
  const pageSizes = [];
  let first = null;
  let guard = 0;
  for (;;) {
    const view = await readPage();
    if (!first) first = view;
    seen.push(...view.rows);
    pageSizes.push(view.rows.length);
    figures.push(JSON.stringify(view.figures));
    if (view.rows.length === 0) break;
    if (!view.hasNext || guard++ > 200) break;
    await clickNext();
  }

  const pager = first.page
    ? `page 1 of ${first.totalPages}, ${first.total} entries`
    : "none";
  console.log(
    `\n${account.name} (${account.rows} txns)\n  pager: ${pager} · walked ${seen.length} rows`,
  );

  // Every entry the database holds for this account reaches the screen.
  if (seen.length !== account.rows)
    fail(`${account.rows} rows in the database, ${seen.length} on screen`);
  if (first.total !== null && first.total !== seen.length)
    fail(`pager counts ${first.total}, the pages hold ${seen.length}`);

  // 1..N, each exactly once, in order — the number somebody reads out loud.
  const serials = seen.map((r) => r.sl);
  const wrong = serials.findIndex((n, i) => n !== i + 1);
  if (wrong !== -1)
    fail(
      `serial ${serials[wrong]} where ${wrong + 1} belongs (row ${wrong + 1})`,
    );

  // No entry shown twice, none skipped between pages.
  const keys = seen.map(
    (r) => `${r.date}|${r.description}|${r.txnId}|${r.balance}`,
  );
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) fail(`${dupes.length} duplicated row(s), e.g. ${dupes[0]}`);

  // Newest first, all the way down and across the page break.
  const backwards = seen.findIndex((r, i) => i > 0 && r.date > seen[i - 1].date);
  if (backwards !== -1)
    fail(
      `order breaks at row ${backwards + 1}: ${seen[backwards - 1].date} then ${seen[backwards].date}`,
    );

  // The four figures are the period's, so they may not change as pages turn.
  if (new Set(figures).size > 1)
    fail(`the figures above the table change between pages`);

  // The newest row's running balance is the account's closing balance.
  const closing = (first.figures.find((f) => f.startsWith("CLOSING")) ?? "").split(
    "=",
  )[1];
  if (seen.length && closing && seen[0].balance !== closing)
    fail(`top row shows ${seen[0].balance}, the Closing card ${closing}`);

  // Twenty to a page, and the last one holds the remainder.
  const overfull = pageSizes.findIndex((n) => n > 20);
  if (overfull !== -1)
    fail(`page ${overfull + 1} held ${pageSizes[overfull]} rows`);
  const short = pageSizes.slice(0, -1).findIndex((n) => n !== 20);
  if (short !== -1)
    fail(`page ${short + 1} held ${pageSizes[short]} rows, not twenty`);
  console.log(
    `  pages: [${pageSizes.join(", ")}] · first: ${seen[0]?.date} #${seen[0]?.sl} · last: ${seen.at(-1)?.date} #${seen.at(-1)?.sl}\n  ${first.figures.join(" | ")}`,
  );
}

/* --- the states a pager gets wrong when nobody drives it ----------------- */

const big = accounts[0];

// 1. Deep in the register, then narrow the dates: the page number must not
//    survive into a shorter list.
await p.goto(`http://localhost:3000/accounts/${big.id}/register`, {
  waitUntil: "networkidle0",
  timeout: 90000,
});
await clickNext();
await clickNext();
const deep = await readPage();
await p.evaluate(() => {
  const input = document.querySelector('input[type="date"]');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, "2025-01-01");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 3000));
const after = await readPage();
console.log(
  `\ndate filter: was page ${deep.page} of ${deep.totalPages} → page ${after.page ?? 1} of ${after.totalPages ?? 1}, ${after.rows.length} rows on screen`,
);
if (deep.page !== 3) fail(`could not reach page 3 of ${big.name}`);
if ((after.page ?? 1) !== 1) fail(`page ${after.page} survived the date change`);
if (after.rows.length && after.rows[0].sl !== 1)
  fail(`the filtered list starts at serial ${after.rows[0].sl}`);

// 2. A range with nothing in it: a message, and no pager to strand anybody on.
await p.goto(
  `http://localhost:3000/accounts/${big.id}/register?from=2031-01-01&to=2031-12-31`,
  { waitUntil: "networkidle0", timeout: 90000 },
);
const empty = await readPage();
console.log(
  `empty range: ${empty.rows.length} rows, pager ${empty.page ? "shown" : "hidden"} — "${empty.empty}"`,
);
if (empty.rows.length !== 0) fail(`an empty range drew ${empty.rows.length} rows`);
if (empty.page !== null) fail(`a pager on a one-page table`);
if (!(empty.empty ?? "").startsWith("No entries for this account"))
  fail(`no empty message, got "${empty.empty}"`);

await b.close();
console.log(bad === 0 ? "\nOK — every check passed." : `\n${bad} FAILURE(S)`);
process.exit(bad === 0 ? 0 : 1);
