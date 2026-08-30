/**
 * Every drawer and dialog in the app, opened and closed, one at a time.
 *
 * The scroll lock is shared by sixteen callers now, so "the Expenses drawer
 * works" is not the claim that matters. This clicks whatever opens a dialog on
 * each screen, presses Escape, and asks the page whether it can scroll again.
 *
 *   node .drawerlock.mjs
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";

const ROUTES = [
  "/accounts",
  "/accounts/cash-in",
  "/expenses",
  "/expenses/other",
  "/subscriptions",
  "/transactions",
  "/team",
  "/payroll",
  "/tax/withholding",
  "/settings",
];

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const { rows } = await db.query(
  `select id, role, token_version from users
     where role = 'super_admin' and status = 'active' and deleted_at is null
     order by created_at limit 1`,
);
await db.end();

const token = jwt.sign(
  { sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome) ? chrome : edge,
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const state = () =>
  page.evaluate(() => ({
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    overflow: getComputedStyle(document.body).overflowY,
  }));

let checked = 0;
let stuck = 0;

for (const route of ROUTES) {
  await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle0", timeout: 90000 }).catch(() => {});
  await wait(700);

  // Whatever is on the page and might open something. Destructive words are
  // left alone - this is a live-ish database, not a place to click "delete".
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("main button, header button")]
      .map((b) => (b.textContent || "").trim())
      .filter((t) => t && t.length < 40)
      .filter((t) => !/delete|remove|void|deactivate|archive|sign out|log out/i.test(t))
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 6),
  );

  const opened = [];

  for (const label of labels) {
    const before = await state();
    if (before.dialogs > 0) break;

    await page.evaluate((t) => {
      const b = [...document.querySelectorAll("main button, header button")].find(
        (x) => (x.textContent || "").trim() === t,
      );
      b?.click();
    }, label);
    await wait(450);

    const during = await state();
    if (during.dialogs === 0) continue;

    await page.keyboard.press("Escape");
    await wait(450);
    const after = await state();

    checked += 1;
    const ok = after.dialogs === 0 && after.overflow !== "hidden";
    if (!ok) stuck += 1;
    opened.push(`${ok ? "ok " : "STUCK"} "${label}" (open=${during.overflow}, closed=${after.overflow}, dialogs=${after.dialogs})`);

    if (after.dialogs > 0) {
      // Something that Escape does not close. Reload rather than carry it on.
      await page.goto(`http://localhost:3000${route}`, { waitUntil: "networkidle0", timeout: 90000 }).catch(() => {});
      await wait(600);
    }
  }

  console.log(`${route.padEnd(20)} ${opened.length ? opened.join("\n" + " ".repeat(21)) : "(nothing opened a dialog)"}`);
}

console.log(`\n${checked} dialogs opened and closed, ${stuck} left the page locked`);
await browser.close();
process.exit(stuck === 0 ? 0 : 1);
