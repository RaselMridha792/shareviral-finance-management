/**
 * Accounts ▸ Bank status in a browser — piece 4 of
 * docs/briefs/2026-10-13-books-month-and-bank-status.md.
 *
 * The sidebar link; the page opens on the current month; May through the
 * picker reads the sheet; money headings sit right over their figures; no
 * sideways page scroll at three widths; a Note typed in the row is saved and
 * cleared; the CEO sees the note and no box to type in.
 *
 * WRITES A NOTE, then clears it. Run on a copy, against a web build pointed at
 * an API on that copy:
 *
 *   BS_DB=postgres://postgres:pw@localhost:55433/sfm BS_WEB=http://localhost:3095 \
 *   node .bankstatusuiqa.mjs
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.BS_WEB ?? "http://localhost:3095";
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
const tokenFor = async (role) => {
  const p = (await q(`select id, role, token_version from users where role=$1 and status='active' and deleted_at is null order by created_at limit 1`, [role]))[0];
  return jwt.sign({ sub: p.id, role: p.role, tv: p.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });
};

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
};

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: fs.existsSync(chrome) ? chrome : edge, headless: "new", args: ["--no-sandbox"] });

async function openAs(role) {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: await tokenFor(role), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${WEB}/accounts/bank-status`, { waitUntil: "networkidle0", timeout: 120000 });
  return { page, context };
}
const pickMay = async (page) => {
  await page.select('select[aria-label="Month"]', "2026-05-01");
  await page.waitForSelector('table[data-bank-status="2026-05-01"]', { timeout: 30000 });
};

console.log("Super Admin");
{
  const { page, context } = await openAs("super_admin");
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Dhaka" }).slice(0, 7);
  check("opens on the current month", Boolean(await page.$(`table[data-bank-status="${now}-01"]`)), now);
  check("the sidebar links to it", Boolean(await page.$('a[href="/accounts/bank-status"]')));

  await pickMay(page);
  const jpm = await page.$eval("tbody tr", (tr) => tr.innerText.replace(/\s+/g, " "));
  check("May, JPMorgan: 17,08,000 in, 8,54,000 out, 4,880 fee, 8,49,120 closing", ["17,08,000", "8,54,000", "4,880", "8,49,120"].every((s) => jpm.includes(s)), jpm.slice(0, 160));
  const asia = await page.$$eval("tbody tr", (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, " ")).find((t) => /Bank Asia/.test(t)) ?? "");
  check("May, Bank Asia: 5,17,535.90 out and 3,36,344.10 closing", asia.includes("5,17,535.90") && asia.includes("3,36,344.10"), asia.slice(0, 160));
  check("a totals row closes the table", /Total/.test(await page.$eval("tfoot", (f) => f.innerText)));

  const align = await page.$$eval("thead th", (ths) => ths.map((th) => [th.innerText.trim(), getComputedStyle(th).textAlign]));
  const money = align.filter(([t]) => /OPENING|IN|OUT|FEE|CLOSING/i.test(t) && t.length <= 8);
  check("the five money headings are right-aligned", money.length === 5 && money.every(([, a]) => a === "right"), JSON.stringify(money));
  const cells = await page.$$eval("tbody tr:first-child td", (tds) => tds.slice(2, 7).map((td) => getComputedStyle(td).textAlign));
  check("and so are their figures", cells.every((a) => a === "right"), JSON.stringify(cells));

  for (const width of [1440, 1180, 900]) {
    await page.setViewport({ width, height: 900 });
    await new Promise((r) => setTimeout(r, 300));
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    check(`no sideways page scroll at ${width}px`, sw <= iw, `${sw} / ${iw}`);
  }
  await page.setViewport({ width: 1440, height: 900 });
  if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });

  const account = await page.$eval("tbody tr", (tr) => tr.dataset.accountId);
  const box = 'tbody tr:first-child input[aria-label^="Note for"]';
  await page.click(box);
  await page.type(box, "Closed in June");
  check("the box fits on screen at 1440px", await page.$eval(box, (i) => { const r = i.getBoundingClientRect(); const c = i.closest(".overflow-x-auto").getBoundingClientRect(); return r.right <= c.right; }));
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 1500));
  const saved = await q(`select note from account_month_notes where account_id=$1 and month='2026-05-01'`, [account]);
  check("a note typed in the row is saved on Enter", saved[0]?.note === "Closed in June", JSON.stringify(saved));

  await page.reload({ waitUntil: "networkidle0" });
  await pickMay(page);
  check("and comes back when the month is opened again", (await page.$eval(box, (i) => i.value)) === "Closed in June");
  await context.close();
}

console.log("CEO");
{
  const { page, context } = await openAs("ceo");
  await pickMay(page);
  check("sees the note", (await page.$eval("tbody tr:first-child", (tr) => tr.innerText)).includes("Closed in June"));
  check("and has no box to type in", (await page.$$('input[aria-label^="Note for"]')).length === 0);
  await context.close();
}

console.log("clearing it");
{
  const { page, context } = await openAs("super_admin");
  await pickMay(page);
  const box = 'tbody tr:first-child input[aria-label^="Note for"]';
  await page.click(box);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Tab");
  await new Promise((r) => setTimeout(r, 1500));
  check("emptying the box and leaving it clears the note", (await q(`select count(*)::int n from account_month_notes where month='2026-05-01'`))[0].n === 0);
  await context.close();
}

await browser.close();
await db.end();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
