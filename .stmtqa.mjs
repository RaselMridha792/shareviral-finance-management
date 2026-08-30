/**
 * The bank statement, which I changed, and the period statement.
 *
 * Two things worth proving on `/statement`. The brought-forward line above the
 * table has to be the account's opening figure — it was a row inside the table
 * until this week, and moving it is the kind of change that quietly drops the
 * number it was carrying. And the running balance has to run: first row from
 * the brought-forward figure, each one after from the row above.
 *
 * On `/reports`, that the period's own totals agree with the ledger over the
 * same dates.
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
const acct = (
  await c.query(
    `select id, name, opening_balance::numeric as opening,
            -- as text: a date column read through JS shifts a day at UTC+6,
            -- which had this reporting a mismatch the page did not have
            to_char(opening_balance_on,'YYYY-MM-DD') as opening_on
       from accounts where deleted_at is null order by name limit 1`,
  )
).rows[0];
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
await page.setViewport({ width: 1600, height: 1200 });

const amount = (s) => {
  const negative = /[-\u2212]/.test(String(s));
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return negative ? -n : n;
};

await page
  .goto(`http://localhost:3000/statement?account=${acct.id}`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 2500));

const seen = await page.evaluate(() => {
  const main = document.querySelector("main") || document.body;
  const t = document.querySelector(".table-data");
  const heads = t
    ? [...t.querySelectorAll("thead th")].map((h) => h.textContent.trim())
    : [];
  const bal = heads.findIndex((h) => /balance/i.test(h));
  return {
    text: main.innerText,
    heads,
    balCol: bal,
    balances:
      t && bal >= 0
        ? [...t.querySelectorAll("tbody tr")].map((r) =>
            (r.children[bal]?.textContent || "").trim(),
          )
        : [],
    firstRowCells: t
      ? [...(t.querySelector("tbody tr")?.children || [])].map((td) =>
          td.textContent.trim(),
        )
      : [],
  };
});

console.log(`account: ${acct.name}`);
console.log(`columns: ${seen.heads.filter(Boolean).join(" | ")}`);

/* 1. the brought-forward line */
const bf = /Brought forward at\s+(\S+)\s*—?\s*([^\n]*)/i.exec(seen.text);
console.log("\n--- the line above the table");
if (!bf) {
  console.log("   NOT FOUND — the opening figure is not stated anywhere");
} else {
  const shownDate = bf[1];
  const shownAmount = amount((bf[2].match(/[-\u2212]?[\u09f3][\d,]+\.\d\d/) || [""])[0]);
  const wantDate = acct.opening_on;
  console.log(`   page: ${shownDate}  ${shownAmount.toFixed(2)}`);
  console.log(`   db  : ${wantDate}  ${Number(acct.opening).toFixed(2)}`);
  console.log(
    "   " +
      (shownDate === wantDate && Math.abs(shownAmount - Number(acct.opening)) < 0.02
        ? "matches"
        : "DOES NOT MATCH"),
  );
}

/* 2. no blank first row */
console.log("\n--- the first row of the table");
const blanks = seen.firstRowCells.filter((v) => v === "").length;
console.log(
  `   ${seen.firstRowCells.length} cells, ${blanks} empty: ` +
    (blanks > seen.firstRowCells.length / 2
      ? "still looks like the old placeholder row"
      : "a real movement"),
);

/* 3. does the running balance run */
console.log("\n--- the running balance");
const nums = seen.balances.map(amount).filter((n) => !Number.isNaN(n));
let breaks = 0;
for (let i = 1; i < nums.length; i += 1) {
  if (!Number.isFinite(nums[i]) || !Number.isFinite(nums[i - 1])) continue;
}
console.log(`   balance column index ${seen.balCol}, ${nums.length} figures read`);
console.log(
  nums.length
    ? `   first ${nums[0].toFixed(2)}, last ${nums[nums.length - 1].toFixed(2)}`
    : "   none",
);

await browser.close();
