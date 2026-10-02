/**
 * Does a page scroll sideways on a phone? Each address given, at 390px,
 * signed in as the first Super Admin.
 *
 *     node .narrowqa.mjs "/settings?tab=assistant" /assistant
 *
 * Needs `npm run dev` (web :3000, api :4001). Reads nothing and writes
 * nothing; prints the page's width against the window's for each.
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
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
const [user] = (await db.query(`select id, role, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`)).rows;
await db.end();
const token = jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "10m" });

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
let failed = 0;
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const address of process.argv.slice(2)) {
    await page.goto(`${WEB}${address}`, { waitUntil: "networkidle0", timeout: 120000 });
    await new Promise((resolve) => setTimeout(resolve, 800));
    const { page: wide, window: shown } = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      window: window.innerWidth,
    }));
    const ok = wide <= shown && !errors.length;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${address}: page ${wide}px in a ${shown}px window${errors.length ? ` — ${errors.join(" | ")}` : ""}`);
    errors.length = 0;
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
