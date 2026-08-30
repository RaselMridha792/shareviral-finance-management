// The switch, after the default flipped: one row unless somebody says so.
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

const API = "http://localhost:4001/api";
const headers = { cookie: `sfm_access=${token}`, "X-Requested-With": "finance-web", "content-type": "application/json" };
const july = async () => (await (await fetch(`${API}/tds/salary-deductions?granularity=month&fiscalYear=2026&index=1`, { headers })).json());
const spread = async (label) => {
  const { rows } = await db.query(
    `select coalesce(l.tds_challan_number, '(none)') as challan, count(*)::int as n
       from payroll_lines l join payroll_runs r on r.id = l.payroll_run_id
      where r.period_year = 2026 and r.period_month = 7 and l.tds_amount > 0
      group by 1 order by 2 desc`);
  console.log(`  ${label}:`, JSON.stringify(rows));
};

// --- start from a clean month --------------------------------------------
const start = await july();
await fetch(`${API}/tds/salary-deductions/${start.rows[0].payrollLineId}/challan`, {
  method: "PATCH", headers, body: JSON.stringify({ challanNumber: "", applyToMonth: true }),
});
await spread("cleared to begin");

// --- 1. the API default, with no applyToMonth sent at all ----------------
const bare = await fetch(`${API}/tds/salary-deductions/${start.rows[0].payrollLineId}/challan`, {
  method: "PATCH", headers, body: JSON.stringify({ challanNumber: "A-API-DEFAULT" }),
});
console.log("API with the field omitted:", JSON.stringify(await bare.json()), "(rowsChanged must be 1)");
await spread("after");

// Back to empty, so the drawer test starts from a row with nothing on it.
await fetch(`${API}/tds/salary-deductions/${start.rows[0].payrollLineId}/challan`, {
  method: "PATCH", headers, body: JSON.stringify({ challanNumber: "", applyToMonth: true }),
});
await spread("cleared again");

// --- 2. the drawer, saved without touching anything ----------------------
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

await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes("Challan not recorded yet"));
  row.querySelector('button[aria-label^="Record the challan"]').click();
});
await wait(700);
console.log("drawer as it opens:", await page.evaluate(() => {
  const box = document.querySelector('input[type="checkbox"]');
  return {
    checkbox: box ? box.checked : "no checkbox",
    label: box?.closest("label")?.textContent.replace(/\s+/g, " ").trim().slice(0, 120),
    numberField: document.querySelector('input[name="challanNumber"]').value,
  };
}));
await page.screenshot({ path: "tdsdefault-drawer.png" });

await page.type('input[name="challanNumber"]', "A-ONE-ROW-ONLY");
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save")?.click());
await wait(2500);
console.log("after saving untouched:", await page.evaluate(() => {
  const cells = [...document.querySelectorAll("tbody tr")].map((tr) => tr.children[5]?.textContent.trim());
  return {
    thisRow: cells.filter((c) => c === "A-ONE-ROW-ONLY").length,
    others: cells.filter((c) => c.includes("A-API-DEFAULT")).length,
    rows: cells.length,
    empty: cells.filter((c) => c.includes("Challan not recorded yet")).length,
    toast: [...document.querySelectorAll("div,p,span")].map((n) => n.textContent.trim())
      .find((t) => /recorded (for|on)/i.test(t) && t.length < 120) ?? null,
  };
}));
await spread("database");

// --- 3. ticked on purpose, it still reaches the month --------------------
await page.evaluate(() => {
  document.querySelectorAll("tbody tr")[4].querySelector('button[aria-label^="Record the challan"]').click();
});
await wait(700);
await page.evaluate(() => document.querySelector('input[type="checkbox"]').click());
await page.evaluate(() => { document.querySelector('input[name="challanNumber"]').value = ""; });
await page.type('input[name="challanNumber"]', "A-2026071142");
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save")?.click());
await wait(2500);
console.log("after ticking it on purpose:", await page.evaluate(() => {
  const cells = [...document.querySelectorAll("tbody tr")].map((tr) => tr.children[5]?.textContent.trim());
  return {
    month: cells.filter((c) => c.includes("A-2026071142")).length,
    leftovers: cells.filter((c) => c.includes("A-ONE-ROW-ONLY") || c.includes("A-API-DEFAULT")).length,
    toast: [...document.querySelectorAll("div,p,span")].map((n) => n.textContent.trim())
      .find((t) => /recorded on/i.test(t) && t.length < 120) ?? null,
  };
}));
await spread("database");

await db.end();
await browser.close();
