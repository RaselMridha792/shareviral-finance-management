/**
 * Does the Expenses page still scroll after the "add category" drawer closes?
 *
 * The drawer locks body scroll while it is open. The question this answers is
 * whether it gives the lock back — once for a plain open/close, and once for
 * the nested "Create a heading" drawer, which is where two cleanups run in an
 * order nobody chose.
 *
 *   node .scrolllock.mjs
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";

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

const client = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const { rows } = await client.query(
  `select id, role, token_version from users
     where role = 'super_admin' and status = 'active' and deleted_at is null
     order by created_at limit 1`,
);
await client.end();

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
await browser.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto("http://localhost:3000/expenses", { waitUntil: "networkidle0", timeout: 90000 });
await new Promise((r) => setTimeout(r, 600));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const state = () =>
  page.evaluate(() => {
    const doc = document.scrollingElement || document.documentElement;
    const before = doc.scrollTop;
    doc.scrollTop = 400;
    const moved = doc.scrollTop !== before || doc.scrollTop === 400;
    const landed = doc.scrollTop;
    doc.scrollTop = before;
    return {
      bodyOverflow: document.body.style.overflow || "(none)",
      computed: getComputedStyle(document.body).overflowY,
      canScroll: landed > 0,
      scrollable: doc.scrollHeight - doc.clientHeight,
      drawers: document.querySelectorAll('[role="dialog"]').length,
    };
  });

const clickText = (text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").trim().toLowerCase().includes(t.toLowerCase()),
    );
    if (!el) return false;
    el.click();
    return true;
  }, text);

const show = (label, s) =>
  console.log(
    `${label.padEnd(34)} body.overflow=${String(s.bodyOverflow).padEnd(8)} computed=${String(s.computed).padEnd(8)} canScroll=${String(s.canScroll).padEnd(5)} dialogs=${s.drawers} scrollable=${s.scrollable}px`,
  );

show("1 fresh load", await state());

console.log(`click "add category": ${await clickText("add category")}`);
await wait(300);
show("2 chooser open", await state());

console.log(`press Escape`);
await page.keyboard.press("Escape");
await wait(300);
show("3 chooser closed", await state());

console.log(`click "add category" again: ${await clickText("add category")}`);
await wait(300);
console.log(`click "Create a heading": ${await clickText("Create a heading")}`);
await wait(300);
show("4 both drawers open", await state());

console.log(`click "Cancel": ${await clickText("Cancel")}`);
await wait(300);
show("5 create cancelled", await state());

await page.keyboard.press("Escape");
await wait(300);
show("6 chooser closed too", await state());

await browser.close();
