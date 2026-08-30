/* Where does deleting a payroll run stall? Step by step, reporting state. */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const env = Object.fromEntries(
  fs.readFileSync("apps/api/.env", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; }),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
await db.connect();
const person = (await db.query(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1`)).rows[0];
const token = jwt.sign({ sub: person.id, role: person.role, tv: person.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

await db.query("delete from payroll_lines where payroll_run_id in (select id from payroll_runs where period_year = 2035)");
await db.query("delete from payroll_runs where period_year = 2035");
await db.query(
  `insert into payroll_runs (period_year, period_month, label, status, total_gross, total_additions, total_tds, total_deductions, total_net, created_by, updated_by)
   values (2035, 1, 'January 2035', 'draft', '0.00','0.00','0.00','0.00','0.00', $1, $1)`, [person.id]);

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox"] });
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const net = [];
page.on("response", (r) => { const u = r.url(); if (u.includes("/api/")) net.push(`${r.request().method()} ${r.status()} ${u.replace("http://localhost:4001","")}`); });
page.on("console", (m) => { if (m.type() === "error") net.push("console.error: " + m.text().slice(0,160)); });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/payroll`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);
console.log("1. row listed:", await page.evaluate(() => document.body.innerText.includes("January 2035")));
console.log("   trash button:", await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find(r => (r.textContent??"").includes("January 2035"));
  const b = row?.querySelector('button[aria-label="Move to trash"]');
  return b ? { found: true, disabled: b.disabled } : { found: false, labels: [...(row?.querySelectorAll("button")??[])].map(x=>x.getAttribute("aria-label")) };
}));

await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find(r => (r.textContent??"").includes("January 2035"));
  row.querySelector('button[aria-label="Move to trash"]').click();
});
await settle(900);
const dlg = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')][0];
  if (!d) return { open: false, dialogs: document.querySelectorAll('[role="dialog"]').length };
  return {
    open: true,
    heading: d.querySelector("h2,h3")?.textContent?.trim() ?? null,
    text: (d.textContent ?? "").replace(/\s+/g," ").slice(0, 420),
    checkboxes: d.querySelectorAll('input[type="checkbox"]').length,
    inputs: [...d.querySelectorAll("input")].map(i => ({ type: i.type, cls: i.className.slice(0,60), ph: i.placeholder })),
    buttons: [...d.querySelectorAll("button")].map(b => ({ t: (b.textContent??"").trim().slice(0,40), disabled: b.disabled })),
  };
});
console.log("2. dialog:", JSON.stringify(dlg, null, 1));

if (dlg.open) {
  await page.evaluate(() => { document.querySelector('[role="dialog"] input[type="checkbox"]')?.click(); });
  await settle(300);
  const field = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const f = [...d.querySelectorAll("input")].find(i => i.type !== "checkbox");
    if (!f) return null; f.focus(); return { cls: f.className.slice(0,80), ph: f.placeholder };
  });
  console.log("3. typing field:", JSON.stringify(field));
  await page.keyboard.type("trash", { delay: 20 });
  await settle(400);
  console.log("4. buttons now:", await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return [...d.querySelectorAll("button")].map(b => ({ t:(b.textContent??"").trim().slice(0,40), disabled: b.disabled }));
  }));
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const b = [...d.querySelectorAll("button")].find(x => /^Yes,/i.test((x.textContent??"").trim()));
    b?.click();
  });
  await settle(3000);
  console.log("5. after confirm:", await page.evaluate(() => ({
    stillListed: document.body.innerText.includes("January 2035"),
    dialogOpen: document.querySelectorAll('[role="dialog"]').length > 0,
    dialogText: (document.querySelector('[role="dialog"]')?.textContent ?? "").replace(/\s+/g," ").slice(0,300),
  })));
}
const row = (await db.query("select status, deleted_at from payroll_runs where period_year=2035")).rows[0];
console.log("6. database:", JSON.stringify(row));
console.log("7. network:\n   " + net.join("\n   "));

await browser.close();
await db.query("delete from payroll_runs where period_year = 2035");
await db.end();
