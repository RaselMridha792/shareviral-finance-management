/**
 * Screenshots of any screens, signed in as the first Super Admin — for looking
 * at a page with data in it (a past month, a filter) rather than measuring it.
 *
 *     node .shotqa.mjs "/expenses?from=2026-08-01&to=2026-08-31" /transactions
 *
 * Each goes to .shots/look-<path>.png, full page at 1440. Console errors are
 * printed. Local only; reads, writes nothing. Needs `npm run dev`.
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB ?? "http://localhost:3000";
const WIDTH = Number(process.env.WIDTH ?? 1440);
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
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const admin = (
  await db.query(
    `select id, role, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`,
  )
).rows[0];
await db.end();
const token = jwt.sign({ sub: admin.id, role: admin.role, tv: admin.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && console.log("  console:", m.text().slice(0, 160)));
  page.on("pageerror", (e) => console.log("  pageerror:", String(e).slice(0, 160)));
  await page.setViewport({ width: WIDTH, height: 900 });
  for (const path of process.argv.slice(2)) {
    // Git Bash rewrites a leading "/" into a Windows path; take it back off.
    const clean = path.replace(/^[A-Z]:\/Program Files\/Git/, "");
    await page.goto(`${WEB}${clean}`, { waitUntil: "networkidle0", timeout: 120000 });
    await new Promise((r) => setTimeout(r, 900));
    const name = clean.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
    await page.screenshot({ path: `.shots/look-${name}.png`, fullPage: true });
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${clean} -> .shots/look-${name}.png${over > 0 ? ` (${over}px sideways)` : ""}`);
  }
} finally {
  await browser.close();
}
