/**
 * Throwaway: the past tab carries one extra column (Last day), and the header
 * and the cells have disagreed there before — every value shifted one to the
 * left for a deploy. So: mark three people resigned locally, count the cells,
 * put them back.
 */
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
const { rows: picks } = await db.query(
  `select id, full_name, engagement_type from team_members where deleted_at is null order by full_name limit 4`);
console.log("marking resigned  :", JSON.stringify(picks.map((p) => `${p.full_name} (${p.engagement_type})`)));
await db.query(`update team_members set status='resigned', ended_on='2026-07-31' where id = any($1)`, [picks.map((p) => p.id)]);

const { rows } = await db.query(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);
const token = jwt.sign({ sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: fs.existsSync(chrome) ? chrome : edge, headless: "new", args: ["--no-sandbox"] });
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
await page.goto("http://localhost:3000/team", { waitUntil: "networkidle0", timeout: 90000 });
await page.evaluate(() => [...document.querySelectorAll('[role="tab"], button')].find((b) => /past team/i.test(b.textContent))?.click());
await new Promise((r) => setTimeout(r, 900));

const m = await page.evaluate(() => {
  const p = [...document.querySelectorAll("section")].find((s) => s.querySelector("table.table-data"));
  const headers = [...p.querySelectorAll("thead th")].map((th) => th.textContent.trim() || "(actions)");
  const rows = [...p.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()));
  const wrapper = p.querySelector(".overflow-x-auto");
  return {
    heading: p.querySelector("h2")?.textContent.trim().replace(/^groups/, ""),
    sub: p.querySelector("h2 + p")?.textContent.trim(),
    panels: [...document.querySelectorAll("section")].filter((s) => s.querySelector("table.table-data")).length,
    headers, rows,
    misaligned: rows.filter((r) => r.length !== headers.length).length,
    pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    insideScroll: wrapper.scrollWidth - wrapper.clientWidth,
  };
});
console.log("panels            :", m.panels);
console.log("heading           :", `${m.heading} — ${m.sub}`);
console.log("headers           :", m.headers.join(" | "));
console.log("employment col at :", m.headers.findIndex((h) => /employment type/i.test(h)));
console.log("rows / misaligned :", m.rows.length, "/", m.misaligned);
console.log("pageOverflow      :", m.pageOverflow, " insideScroll:", m.insideScroll);
for (const r of m.rows) console.log("  row             :", JSON.stringify(r));
await page.screenshot({ path: "team-past.png", fullPage: true });
await browser.close();

await db.query(`update team_members set status='active', ended_on=null where id = any($1)`, [picks.map((p) => p.id)]);
const { rows: back } = await db.query(`select count(*)::int as still_past from team_members where status <> 'active' and deleted_at is null`);
console.log("restored, non-active left:", JSON.stringify(back));
await db.end();
