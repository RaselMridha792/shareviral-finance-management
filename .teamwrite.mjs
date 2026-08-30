// Throwaway: prove the drawer writes the column, from null to a value.
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";
const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs.readFileSync(REPO + "/apps/api/.env", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query(`update team_members set employment_type = null where engagement_type = 'employee'`);
const { rows } = await db.query(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);
const token = jwt.sign({ sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: fs.existsSync(chrome) ? chrome : edge, headless: "new", args: ["--no-sandbox"] });
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });

const firstRow = () => page.evaluate(() => {
  const td = document.querySelector("tbody tr").querySelectorAll("td");
  return { name: td[2].textContent.trim(), employmentType: td[5].textContent.trim() };
});

await page.goto("http://localhost:3000/team", { waitUntil: "networkidle0", timeout: 90000 });
await new Promise((r) => setTimeout(r, 700));
console.log("before saving      :", JSON.stringify(await firstRow()));

await page.evaluate(() => document.querySelector("tbody tr").querySelector('button[aria-label*="Edit" i], button[title*="Edit" i]')?.click());
await new Promise((r) => setTimeout(r, 900));
console.log("drawer default     :", await page.$eval('select[name="employmentType"]', (s) => JSON.stringify({ value: s.value, options: [...s.options].map((o) => o.textContent) })));
await page.screenshot({ path: "team-column-drawer.png" });
await page.select('select[name="employmentType"]', "hybrid");
await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^save/i.test(b.textContent.trim()))?.click());
await new Promise((r) => setTimeout(r, 2500));
console.log("after picking Hybrid:", JSON.stringify(await firstRow()));
const { rows: check } = await db.query(`select full_name, employment_type from team_members where employment_type is not null and engagement_type = 'employee'`);
console.log("in the database    :", JSON.stringify(check));
await page.screenshot({ path: "team-column.png", fullPage: true });
await browser.close();
await db.end();
