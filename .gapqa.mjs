/**
 * The empty band either side of every screen.
 *
 * The owner, pointing at two red boxes on the dashboard at 1920px: "prottek
 * page a dui pase je gap ache ... ei gap ta komate hobe". The column was capped
 * at 1560px and centred, so on a 1920px screen every page sat ~64px in from the
 * rail and ~64px in from the edge — `.sweep.mjs` measures at 1440 and never met
 * the cap, which is why it never showed.
 *
 * This measures, at the widths people actually use, the distance from the
 * rail's edge to the first block and from the last block to the window's edge.
 *
 *     node .gapqa.mjs            (needs `npm run dev`: web :3000, api :4001)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB ?? "http://localhost:3000";
const ROUTES = ["/", "/accounts", "/accounts/cash-in", "/transactions", "/team", "/payroll", "/reports", "/settings"];
const WIDTHS = [1920, 1680, 1440];
/** The column's own padding, which is meant to stay: the handoff's 24px. */
const GUTTER = 24;

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

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 1000 });
    for (const route of ROUTES) {
      await page.goto(`${WEB}${route}`, { waitUntil: "networkidle0", timeout: 120000 });
      const m = await page.evaluate(() => {
        const main = document.querySelector("main");
        const first = main?.querySelector(":scope > div > *");
        const rail = document.querySelector("aside");
        if (!main || !first) return null;
        const r = first.getBoundingClientRect();
        return {
          railRight: Math.round(rail ? rail.getBoundingClientRect().right : 0),
          left: Math.round(r.left),
          right: Math.round(r.right),
          viewport: document.documentElement.clientWidth,
        };
      });
      if (!m) {
        check(`${width} ${route}`, false, "no main column found");
        continue;
      }
      const leftGap = m.left - m.railRight;
      const rightGap = m.viewport - m.right;
      check(
        `${String(width).padEnd(4)} ${route.padEnd(18)}`,
        leftGap <= GUTTER + 1 && rightGap <= GUTTER + 1,
        `rail→page ${leftGap}px, page→edge ${rightGap}px`,
      );
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
