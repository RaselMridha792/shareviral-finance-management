/**
 * Throwaway: measure the Team page after the Employment type column landed.
 *
 * Reads the real screen rather than the diff — how many panels there are, what
 * the headings say, which column the new one sits in, whether every row has as
 * many cells as the header has columns (the past tab grew a column once and
 * the rows did not, which silently shifted every value one to the left), and
 * whether the page scrolls sideways at any width in either theme.
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
const { rows } = await db.query(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);
console.log("db split          :", JSON.stringify((await db.query(`select engagement_type, employment_type, count(*)::int from team_members group by 1,2 order by 1,2`)).rows));
await db.end();
const token = jwt.sign({ sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: fs.existsSync(chrome) ? chrome : edge, headless: "new", args: ["--no-sandbox"] });
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();

const read = () => page.evaluate(() => {
  const panels = [...document.querySelectorAll("section")].filter((s) => s.querySelector("table.table-data"));
  const doc = document.documentElement;
  return {
    pageOverflow: doc.scrollWidth - doc.clientWidth,
    panels: panels.map((p) => {
      const headers = [...p.querySelectorAll("thead th")].map((th) => th.textContent.trim());
      const rows = [...p.querySelectorAll("tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()));
      const i = headers.findIndex((h) => /employment type/i.test(h));
      const wrapper = p.querySelector(".overflow-x-auto");
      const values = {};
      for (const r of rows) values[r[i]] = (values[r[i]] ?? 0) + 1;
      return {
        heading: p.querySelector("h2")?.textContent.trim().replace(/^groups/, ""),
        sub: p.querySelector("h2 + p")?.textContent.trim(),
        headers, index: i, before: headers[i - 1], after: headers[i + 1],
        rowCount: rows.length,
        misaligned: rows.filter((r) => r.length !== headers.length).length,
        values,
        insideScroll: wrapper ? wrapper.scrollWidth - wrapper.clientWidth : null,
      };
    }),
  };
});

for (const theme of ["dark", "light"]) {
  for (const width of [1440, 1024, 768, 390]) {
    for (const tab of ["current", "past"]) {
      await page.setViewport({ width, height: 1100 });
      await page.goto("http://localhost:3000/team", { waitUntil: "networkidle0", timeout: 90000 });
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      if (tab === "past") {
        await page.evaluate(() => [...document.querySelectorAll('[role="tab"], button')].find((b) => /past team/i.test(b.textContent))?.click());
      }
      await new Promise((r) => setTimeout(r, 800));
      const m = await read();
      const p = m.panels[0];
      const head = `${theme} ${width} ${tab}`.padEnd(22);
      if (!p) { console.log(head, `panels=0 (empty state) pageOverflow=${m.pageOverflow}`); continue; }
      console.log(head, `panels=${m.panels.length} pageOverflow=${m.pageOverflow} insideScroll=${p.insideScroll} rows=${p.rowCount} misaligned=${p.misaligned} col#${p.index} [${p.before} | Employment type | ${p.after}] ${JSON.stringify(p.values)}`);
      if (theme === "dark" && width === 1440) {
        console.log(" ".repeat(22), `heading="${p.heading}" sub="${p.sub}"`);
        console.log(" ".repeat(22), `headers=${p.headers.join(" | ")}`);
        await page.screenshot({ path: `team-${tab}.png`, fullPage: true });
      }
    }
  }
}
await browser.close();
