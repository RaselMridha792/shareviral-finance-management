/**
 * Walk the bank statement page by page and check the things a diff cannot show:
 * that the serials run 1..N unbroken across the pages, that no movement is
 * dropped or shown twice, that the order really is newest first, and that the
 * totals under the table stay the whole period's rather than the page's.
 *
 *   node .stmtpage.mjs                 # every account with rows
 *   node .stmtpage.mjs <accountId>     # one of them
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
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
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
// What the page asks the API for: one account, voided rows included.
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
await b.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 950 });

/** Everything on screen right now: the rows, the pager sentence, the foot. */
const readPage = () =>
  p.evaluate(() => {
    const table = document.querySelector(".table-data");
    const cells = (tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim());
    const rows = [...(table?.querySelectorAll("tbody tr") ?? [])]
      .map(cells)
      .filter((r) => r.length >= 8)
      .map((r) => ({
        sl: Number(r[0]),
        date: r[1],
        description: r[2],
        debit: r[3],
        credit: r[4],
        balance: r[5].split("\n")[0],
        txnId: r[6],
      }));
    const foot = [...(table?.querySelectorAll("tfoot td") ?? [])].map((td) =>
      td.innerText.trim().split("\n")[0],
    );
    const sentence = document.body.innerText.match(/Page\s+(\d+)\s+of\s+(\d+)\s+·\s+([\d,]+)\s+\w+/);
    const next = [...document.querySelectorAll("button")].find(
      (btn) => btn.innerText.trim() === "Next",
    );
    return {
      rows,
      foot,
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

const targets = process.argv[2]
  ? accounts.filter((a) => a.id === process.argv[2])
  : accounts.slice(0, 6);

for (const account of targets) {
  await p.goto(`http://localhost:3000/statement?account=${account.id}`, {
    waitUntil: "networkidle0",
    timeout: 90000,
  });
  await new Promise((r) => setTimeout(r, 400));

  const seen = [];
  const foots = [];
  const pageSizes = [];
  let first = null;
  let guard = 0;
  for (;;) {
    const view = await readPage();
    if (!first) first = view;
    seen.push(...view.rows);
    pageSizes.push(view.rows.length);
    foots.push(JSON.stringify(view.foot));
    if (view.rows.length === 0) break;
    if (!view.hasNext || guard++ > 200) break;
    await p.evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((btn) => btn.innerText.trim() === "Next")
        ?.click(),
    );
    await new Promise((r) => setTimeout(r, 250));
  }

  const label = `${account.name} (${account.rows} txns)`;
  console.log(
    `\n${label}\n  pager: ${first.page ? `page 1 of ${first.totalPages}, ${first.total} entries` : "none"} · walked ${seen.length} rows`,
  );

  // Every movement the database holds for this account reaches the screen.
  if (seen.length !== account.rows)
    fail(`${account.rows} rows in the database, ${seen.length} on screen`);
  if (first.total !== null && first.total !== seen.length)
    fail(`pager counts ${first.total}, the pages hold ${seen.length}`);

  // 1..N, each exactly once, in order — the number somebody reads out loud.
  const serials = seen.map((r) => r.sl);
  const wrong = serials.findIndex((n, i) => n !== i + 1);
  if (wrong !== -1)
    fail(`serial ${serials[wrong]} where ${wrong + 1} belongs (row ${wrong + 1})`);

  // No movement shown twice, none skipped between pages.
  const keys = seen.map((r) => `${r.date}|${r.description}|${r.txnId}|${r.balance}`);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length) fail(`${dupes.length} duplicated row(s), e.g. ${dupes[0]}`);

  // Newest first, all the way down and across the page break.
  const backwards = seen.findIndex((r, i) => i > 0 && r.date > seen[i - 1].date);
  if (backwards !== -1)
    fail(
      `order breaks at row ${backwards + 1}: ${seen[backwards - 1].date} then ${seen[backwards].date}`,
    );

  // The foot is the period's, so it may not change as the pages turn.
  if (new Set(foots).size > 1) fail(`the closing line changes between pages`);

  // The newest row's running balance is the closing balance under the table.
  const closing = first.foot?.[3];
  if (seen.length && closing && seen[0].balance !== closing)
    fail(`top row shows ${seen[0].balance}, the closing line ${closing}`);

  // Twenty to a page, and the last one holds the remainder.
  const overfull = pageSizes.findIndex((n) => n > 20);
  if (overfull !== -1) fail(`page ${overfull + 1} held ${pageSizes[overfull]} rows`);
  const short = pageSizes.slice(0, -1).findIndex((n) => n !== 20);
  if (short !== -1) fail(`page ${short + 1} held ${pageSizes[short]} rows, not twenty`);
  console.log(
    `  pages: [${pageSizes.join(", ")}] · first: ${seen[0]?.date} #${seen[0]?.sl} · last: ${seen.at(-1)?.date} #${seen.at(-1)?.sl} · foot ${first.foot?.slice(3, 6).join(" | ")}`,
  );
}

/* --- the two states a pager gets wrong when nobody drives it ------------- */

// 1. Deep in one account, then switch account: the page number must not travel.
const big = accounts[0];
const other = accounts[1];
await p.goto(`http://localhost:3000/statement?account=${big.id}`, {
  waitUntil: "networkidle0",
  timeout: 90000,
});
const next = async () => {
  await p.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((btn) => btn.innerText.trim() === "Next")
      ?.click(),
  );
  await new Promise((r) => setTimeout(r, 250));
};
await next();
await next();
const deep = await readPage();
await p.select("select", other.id);
await new Promise((r) => setTimeout(r, 1500));
const after = await readPage();
console.log(
  `
switch account: was page ${deep.page} of ${deep.totalPages} (${big.name}) → page ${after.page} of ${after.totalPages} (${other.name}), ${after.rows.length} rows`,
);
if (deep.page !== 3) fail(`could not reach page 3 of ${big.name}`);
if (after.page !== 1) fail(`page ${after.page} survived the account change`);
if (after.total !== other.rows)
  fail(`${other.name} has ${other.rows} rows, the pager counts ${after.total}`);

// 2. A range with nothing in it: a message, and no pager to strand anybody on.
await p.goto(
  `http://localhost:3000/statement?account=${big.id}&from=2031-01-01&to=2031-12-31`,
  { waitUntil: "networkidle0", timeout: 90000 },
);
const empty = await readPage();
const message = await p.evaluate(
  () => document.querySelector(".table-data tbody")?.innerText.trim() ?? "",
);
console.log(`empty range: ${empty.rows.length} rows, pager ${empty.page ? "shown" : "hidden"} — "${message}"`);
if (empty.rows.length !== 0) fail(`an empty range drew ${empty.rows.length} rows`);
if (empty.page !== null) fail(`a pager on a one-page table`);
if (!message.startsWith("Nothing on this account")) fail(`no empty message`);

await b.close();
console.log(bad === 0 ? "\nOK — every check passed." : `\n${bad} FAILURE(S)`);
process.exit(bad === 0 ? 0 : 1);
