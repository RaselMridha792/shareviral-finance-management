// The whole gesture, through the browser: pencil, type, save, and the table
// afterwards. Nothing here calls the API directly.
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, "apps/api/.env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows: u } = await db.query(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);
const token = jwt.sign({ sub: u[0].id, role: u[0].role, tv: u[0].token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: fs.existsSync(chrome) ? chrome : edge, headless: "new", args: ["--no-sandbox"] });
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.setViewport({ width: 1440, height: 1000 });
await page.goto("http://localhost:3000/tax/withholding", { waitUntil: "networkidle0", timeout: 120000 });
await wait(800);
await page.evaluate(() => {
  for (const select of document.querySelectorAll("select")) {
    const option = [...select.options].find((o) => o.textContent.trim() === "July 2026");
    if (option) { select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true })); return; }
  }
});
await wait(1600);

// The row that has no challan — the third one, cleared earlier.
const before = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("tbody tr")];
  const index = rows.findIndex((tr) => tr.textContent.includes("Challan not recorded yet"));
  return { index, name: rows[index]?.children[2]?.textContent.trim().split("Salary")[0] };
});
console.log("row without a challan:", JSON.stringify(before));

// Untick the month switch: this one is being written on its own.
await page.evaluate((index) => {
  const row = document.querySelectorAll("tbody tr")[index];
  row.querySelector('button[aria-label^="Record the challan"]').click();
}, before.index);
await wait(600);
await page.evaluate(() => { document.querySelector('input[type="checkbox"]').click(); });
await page.type('input[name="challanNumber"]', "A-TYPED-BY-HAND");
const state = await page.evaluate(() => ({
  value: document.querySelector('input[name="challanNumber"]').value,
  applyToMonth: document.querySelector('input[type="checkbox"]').checked,
}));
console.log("drawer before save:", JSON.stringify(state));

await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save")?.click();
});
await wait(2500);

const after = await page.evaluate(() => {
  const cells = [...document.querySelectorAll("tbody tr")].map((tr) => tr.children[5]?.textContent.trim());
  return {
    toast: [...document.querySelectorAll("div,p,span")].map((n) => n.textContent.trim())
      .find((t) => /recorded for|recorded on|cleared/i.test(t) && t.length < 120) ?? null,
    typed: cells.filter((c) => c === "A-TYPED-BY-HAND").length,
    monthNumber: cells.filter((c) => c.includes("A-2026071142")).length,
    stillEmpty: cells.filter((c) => c.includes("Challan not recorded yet")).length,
    drawerClosed: !document.querySelector('input[name="challanNumber"]'),
  };
});
console.log("after save:", JSON.stringify(after));
await page.screenshot({ path: "tdsflow-after.png" });

const { rows: check } = await db.query(
  `select l.tds_challan_number, count(*)::int as n from payroll_lines l
     join payroll_runs r on r.id = l.payroll_run_id
    where r.period_year = 2026 and r.period_month = 7 and l.tds_amount > 0
    group by 1 order by 2 desc`);
console.log("database, July 2026:", JSON.stringify(check));

await db.end();
await browser.close();
