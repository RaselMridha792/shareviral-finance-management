/**
 * Accounts ▸ Bank status, Check ticked by hand, in a browser — piece 4d-2 of
 * docs/briefs/2026-10-13-books-month-and-bank-status.md.
 *
 * The CFO ticks a row's box: it reads Matched, "By hand", with who and when on
 * hover, reaches the database and survives a reload. The CEO sees it with no
 * box. Unticking puts the dash back. A reconciled month reads "Reconciled"
 * with no tick. The table still has no sideways page scroll.
 *
 * WRITES A TICK AND A STATEMENT, then removes them. Run on a copy, against a
 * web build pointed at an API on that copy:
 *
 *   BS_DB=postgres://postgres:pw@localhost:55438/sfm BS_WEB=http://localhost:3099 \
 *   node .bankcheckuiqa.mjs
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.BS_WEB ?? "http://localhost:3099";
if (!process.env.BS_DB) {
  console.error("BS_DB is required: the connection string of a COPY of the database.");
  process.exit(2);
}
const SHOT = process.env.BS_SHOT;

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
const db = new pg.Client({ connectionString: process.env.BS_DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const userOf = async (role) =>
  (await q(`select id, role, full_name, token_version from users where role=$1 and status='active' and deleted_at is null order by created_at limit 1`, [role]))[0];
const tokenOf = (p) => jwt.sign({ sub: p.id, role: p.role, tv: p.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: fs.existsSync(chrome) ? chrome : edge, headless: "new", args: ["--no-sandbox"] });

async function openAs(role, month) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenOf(await userOf(role)), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${WEB}/accounts/bank-status`, { waitUntil: "networkidle0", timeout: 120000 });
  await pickMonth(page, month);
  return { page, context };
}
/* The picker answers only once React has hydrated it; try until it does. */
async function pickMonth(page, month) {
  for (let i = 0; i < 20; i++) {
    await page.select('select[aria-label="Month"]', month);
    if (await page.waitForSelector(`table[data-bank-status="${month}"]`, { timeout: 1500 }).catch(() => null)) return;
  }
  throw new Error(`the picker never showed ${month}`);
}
const cell = (page) => page.$eval("tbody tr:first-child [data-check]", (d) => ({ state: d.dataset.check, text: d.innerText.replace(/\s+/g, " ").trim() }));
const BOX = 'tbody tr:first-child input[aria-label$=" by hand"]';

const MAY = "2026-05-01";
const AUG = "2026-08-01";
const cfo = await userOf("cfo");
const started = new Date();
let statementId = null;

try {
  console.log("CFO ticks a row");
  {
    const { page, context } = await openAs("cfo", MAY);
    check("the row starts with a dash and an empty box", (await cell(page)).state === "none" && (await page.$eval(BOX, (i) => i.checked)) === false, JSON.stringify(await cell(page)));
    const account = await page.$eval("tbody tr", (tr) => tr.dataset.accountId);
    await page.click(BOX);
    await pause(1500);
    const now = await cell(page);
    check("it reads Matched, By hand", now.state === "hand" && /Matched/.test(now.text) && /By hand/.test(now.text), now.text);
    const hover = await page.$eval("tbody tr:first-child [data-check] p", (p) => p.title);
    check("hover says who ticked it and when", hover.includes(cfo.full_name) && /2026/.test(hover), hover);
    const stored = await q(`select checked_by from account_month_checks where account_id=$1 and month=$2`, [account, MAY]);
    check("the tick reaches the database", stored[0]?.checked_by === cfo.id);

    for (const width of [1440, 1180, 900]) {
      await page.setViewport({ width, height: 900 });
      await pause(300);
      const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
      check(`no sideways page scroll at ${width}px`, sw <= iw, `${sw} / ${iw}`);
    }
    await page.setViewport({ width: 1440, height: 900 });
    if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });

    await page.reload({ waitUntil: "networkidle0" });
    await pickMonth(page, MAY);
    await pause(500);
    check("after a reload it is still ticked", (await cell(page)).state === "hand" && (await page.$eval(BOX, (i) => i.checked)));
    await context.close();
  }

  console.log("CEO reads it");
  {
    const { page, context } = await openAs("ceo", MAY);
    const seen = await cell(page);
    check("sees Matched, By hand", seen.state === "hand" && /Matched/.test(seen.text), seen.text);
    check("and has no box", (await page.$$('input[aria-label$=" by hand"]')).length === 0);
    await context.close();
  }

  console.log("CFO unticks it");
  {
    const { page, context } = await openAs("cfo", MAY);
    await page.click(BOX);
    await pause(1500);
    check("the dash is back", (await cell(page)).state === "none", (await cell(page)).text);
    check("the row is gone from the database", (await q(`select count(*)::int n from account_month_checks where month=$1 and checked_at >= $2`, [MAY, started]))[0].n === 0);
    await context.close();
  }

  console.log("a reconciled month");
  {
    const [st] = await q(`insert into statements (period_start, period_end, status) values ($1, '2026-08-31', 'reconciled') returning id`, [AUG]);
    statementId = st.id;
    const { page, context } = await openAs("cfo", AUG);
    const r = await cell(page);
    check("reads Matched, Reconciled, with the box empty", r.state === "reconciled" && /Reconciled/.test(r.text) && !(await page.$eval(BOX, (i) => i.checked)), r.text);
    await page.click(BOX);
    await pause(1500);
    check("ticked there too: By hand · reconciled", /By hand · reconciled/.test((await cell(page)).text), (await cell(page)).text);
    await page.click(BOX);
    await pause(1500);
    check("unticked: still Matched, Reconciled", (await cell(page)).state === "reconciled" && /Matched/.test((await cell(page)).text));
    await context.close();
  }
} finally {
  await q(`delete from account_month_checks where checked_at >= $1`, [started]);
  if (statementId) await q(`delete from statements where id = $1`, [statementId]);
  await browser.close();
  await db.end();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
