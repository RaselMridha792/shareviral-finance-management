/**
 * The Accounts screens against the ledger.
 *
 * Three questions the harness cannot ask, because two of these screens have no
 * table and the third's numbers are cumulative:
 *
 *   - does every balance on the list equal opening + in - out?
 *   - is Cash In showing every cash-in entry, or only the ones on page one?
 *   - does the register's running balance actually run — first row from the
 *     opening figure, each one after from the row above?
 *
 * The third is the one worth having. A running balance is a window function
 * over an order, and it is wrong in a way that looks right: every figure is
 * plausible, and only the arithmetic between them gives it away.
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

const u = (
  await c.query(
    "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1",
  )
).rows[0];

const balances = (
  await c.query(`
    select a.id, a.name,
           a.opening_balance::numeric
             + coalesce(sum(t.signed_amount::numeric) filter (where t.voided_at is null), 0) as closing
      from accounts a
      left join transactions t on t.account_id = a.id
     where a.deleted_at is null
     group by a.id, a.name
     order by a.name`)
).rows;

const cashIn = (
  await c.query(`
    select count(*)::int as n
      from transactions
     where direction = 'in' and voided_at is null`)
).rows[0];

const account = balances[0];
const register = (
  await c.query(
    `select txn_date, signed_amount::numeric as signed
       from transactions
      where account_id = $1 and voided_at is null
      order by txn_date asc, created_at asc
      limit 20`,
    [account.id],
  )
).rows;
const opening = (
  await c.query(
    "select opening_balance::numeric as v from accounts where id = $1",
    [account.id],
  )
).rows[0].v;
await c.end();

const token = jwt.sign(
  { sub: u.id, role: u.role, tv: u.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
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
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1400 });

const amount = (s) => {
  const negative = /[-\u2212]/.test(String(s));
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return negative ? -n : n;
};

/* ---- 1. every balance on the list ------------------------------------- */
await page
  .goto("http://localhost:3000/accounts", { waitUntil: "networkidle0", timeout: 120000 })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 2200));
const listText = await page.evaluate(() => document.body.innerText);

console.log("--- /accounts: each balance against the ledger");
let wrong = 0;
for (const b of balances) {
  const at = listText.indexOf(b.name);
  if (at === -1) {
    console.log(`   ${b.name}: not on the page`);
    wrong += 1;
    continue;
  }
  const near =
    listText.slice(at, at + 260).match(/[-\u2212]?[\u09f3$]?[\d,]+\.\d\d/g) || [];
  const want = Number(b.closing);
  if (!near.some((v) => Math.abs(amount(v) - want) < 0.02)) {
    console.log(
      `   ${b.name}: ledger ${want.toFixed(2)}, page shows ${near.slice(0, 3).join(" ")}`,
    );
    wrong += 1;
  }
}
console.log(
  wrong === 0 ? "   all " + balances.length + " match" : `   ${wrong} disagree`,
);

/* ---- 2. Cash In: is the count the whole set? --------------------------- */
await page
  .goto("http://localhost:3000/accounts/cash-in", { waitUntil: "networkidle0", timeout: 120000 })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 2200));
const cash = await page.evaluate(() => {
  const t = document.querySelector(".table-data");
  return {
    rows: t ? t.querySelectorAll("tbody tr").length : 0,
    text: document.body.innerText,
  };
});
console.log("\n--- /accounts/cash-in");
console.log(`   ledger has ${cashIn.n} money-in entries; the page shows ${cash.rows} row(s)`);
const totalOnPage = /(\d[\d,]*)\s+(entr|entries|of)/i.exec(cash.text);
console.log(
  `   the page's own count: ${totalOnPage ? totalOnPage[0].trim() : "not stated"}`,
);

/* ---- 3. the register's running balance --------------------------------- */
await page
  .goto(`http://localhost:3000/accounts/${account.id}/register`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 2200));
const shown = await page.evaluate(() => {
  const t = document.querySelector(".table-data");
  if (!t) return [];
  const heads = [...t.querySelectorAll("thead th")].map((h) => h.textContent.trim());
  const col = heads.findIndex((h) => /balance/i.test(h));
  if (col === -1) return [];
  return [...t.querySelectorAll("tbody tr")].map(
    (r) => (r.children[col]?.textContent || "").trim(),
  );
});

console.log("\n--- register: does the running balance run?");
if (shown.length === 0) {
  console.log("   no balance column found");
} else {
  let running = Number(opening);
  let bad = 0;
  for (let i = 0; i < Math.min(shown.length, register.length); i += 1) {
    running += Number(register[i].signed);
    const onPage = amount(shown[i]);
    if (Math.abs(onPage - running) > 0.02) {
      if (bad < 3) {
        console.log(
          `   row ${i + 1}: ledger says ${running.toFixed(2)}, page says ${onPage.toFixed(2)}`,
        );
      }
      bad += 1;
    }
  }
  console.log(
    bad === 0
      ? `   all ${Math.min(shown.length, register.length)} rows follow from the opening figure`
      : `   ${bad} row(s) do not follow`,
  );
}

await browser.close();
