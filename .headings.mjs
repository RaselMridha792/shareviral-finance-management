/**
 * Can the Expenses page take a heading it has no spend for, and keep it?
 *
 * The drawer used to list only the headings money had gone to this month, so
 * ticking one could never add a card - it could only swap between the ones
 * already there, and a heading created from here appeared nowhere until its
 * first bill. This walks the actual page: creates a heading, checks a card
 * shows up for it at once, reloads, unticks it, then removes the row again.
 *
 *   node .headings.mjs
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const PROBE = "Zz probe heading";

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

const connect = async () => {
  const c = new pg.Client({
    connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  return c;
};

let db = await connect();
const { rows: users } = await db.query(
  `select id, role, token_version from users
     where role = 'super_admin' and status = 'active' and deleted_at is null
     order by created_at limit 1`,
);
// A leftover from a previous run would make the counts below lie.
await db.query(`delete from categories where name = $1`, [PROBE]);
await db.end();

const token = jwt.sign(
  { sub: users[0].id, role: users[0].role, tv: users[0].token_version },
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

async function go() {
  await page.goto("http://localhost:3000/expenses", { waitUntil: "networkidle0", timeout: 90000 });
  await wait(700);
}

const cards = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('main a[href*="/expenses/"]')].map((a) => ({
      name: (a.querySelector("span.truncate")?.textContent || "").trim(),
      amount: (a.querySelector(".num")?.textContent || "").trim(),
    })),
  );

const names = async () => (await cards()).map((c) => c.name);
const tables = () => page.evaluate(() => document.querySelectorAll("main table").length);
const headingText = () =>
  page.evaluate(() => (document.querySelector("main")?.textContent || "").includes("Every expense this month"));

const clickButton = (text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      (x.textContent || "").trim().toLowerCase().includes(t.toLowerCase()),
    );
    if (!b) return false;
    b.click();
    return true;
  }, text);

const boxes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] label')].map((l) => ({
      name: (l.querySelector("span.truncate")?.textContent || "").trim(),
      on: l.querySelector("input")?.checked ?? null,
      note: (l.lastElementChild?.textContent || "").trim(),
    })),
  );

const tick = (name) =>
  page.evaluate((n) => {
    const label = [...document.querySelectorAll('[role="dialog"] label')].find(
      (l) => (l.querySelector("span.truncate")?.textContent || "").trim() === n,
    );
    if (!label) return false;
    label.querySelector("input").click();
    return true;
  }, name);

await go();
const start = await names();
console.log(`1. on load: ${start.length} cards`);
console.log(`   tables under the cards: ${await tables()}`);
console.log(`   says "Every expense this month": ${await headingText()}`);

console.log(`\n2. create "${PROBE}" from the drawer`);
console.log(`   open chooser: ${await clickButton("add category")}`);
await wait(300);
console.log(`   click Create a heading: ${await clickButton("Create a heading")}`);
await wait(400);
await page.type('[role="dialog"] input[name="name"]', PROBE);
console.log(`   submit: ${await clickButton("Add it")}`);
await wait(1500);

const made = await cards();
const probe = made.find((c) => c.name === PROBE);
console.log(`   cards now: ${made.length} (was ${start.length})`);
console.log(`   card for it appeared: ${Boolean(probe)}  reads: ${probe?.amount ?? "-"}`);
console.log(`   nothing was replaced: ${start.every((n) => made.some((c) => c.name === n))}`);

console.log(`\n3. reload`);
await go();
const kept = await names();
console.log(`   cards: ${kept.length} - still has it: ${kept.includes(PROBE)}`);

console.log(`\n4. the drawer now lists it under the quiet ones`);
await clickButton("add category");
await wait(300);
const list = await boxes();
for (const r of list) console.log(`     [${r.on ? "x" : " "}] ${r.name.padEnd(24)} ${r.note.slice(0, 22)}`);

console.log(`\n5. untick it, and untick one that has spend`);
await tick(PROBE);
const spender = list.find((r) => r.note !== "nothing yet")?.name;
await tick(spender);
await wait(300);
await page.keyboard.press("Escape");
await wait(500);
const trimmed = await names();
console.log(`   cards: ${trimmed.length} - has "${PROBE}": ${trimmed.includes(PROBE)} - has "${spender}": ${trimmed.includes(spender)}`);

console.log(`\n6. put the spender back`);
await clickButton("add category");
await wait(300);
await tick(spender);
await wait(300);
await page.keyboard.press("Escape");
await wait(500);
const restored = await names();
console.log(`   cards: ${restored.length} - has "${spender}": ${restored.includes(spender)}`);

console.log(`\n7. body still scrolls: ${await page.evaluate(() => getComputedStyle(document.body).overflowY)}`);

await browser.close();

db = await connect();
const gone = await db.query(`delete from categories where name = $1`, [PROBE]);
await db.end();
console.log(`\n8. probe heading removed from the database: ${gone.rowCount} row`);
