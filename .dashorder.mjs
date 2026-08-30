/**
 * Does the dashboard's account order do what it says?
 *
 * Default order, the arrows, a real drag, persistence across a reload, and
 * Reset — measured on the running page, because every one of those is a claim
 * about behaviour rather than about code.
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

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const { rows: users } = await c.query(
  "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1",
);
await c.end();

const token = jwt.sign(
  { sub: users[0].id, role: users[0].role, tv: users[0].token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });

const TYPES = ["Bank account", "Card", "Mobile wallet", "Cash"];
const NL = String.fromCharCode(10);

async function load() {
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle0", timeout: 180000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
}

/** The account headings, top to bottom, as the page has them. */
const order = () =>
  page.evaluate(
    (types, nl) =>
      [...document.querySelectorAll("h2")]
        .map((h) => {
          // The first span in a heading is the icon ligature; the qualifier is
          // whichever one reads as an account type.
          const type = [...h.querySelectorAll("span")]
            .map((s) => s.innerText.trim())
            .find((t) => types.includes(t));
          if (!type) return null;
          const name = h.innerText
            .split(nl)
            .map((x) => x.trim())
            .filter(Boolean)
            .find((line) => line !== type && !/^[a-z_]+$/.test(line));
          return `${name} [${type}]`;
        })
        .filter(Boolean),
    TYPES,
    NL,
  );

const stored = () => page.evaluate(() => window.localStorage.getItem("sfm.dashboard.account-order.v1"));

const click = (label) =>
  page.evaluate((text) => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.innerText.trim() === text || b.getAttribute("aria-label") === text,
    );
    if (!button) return false;
    button.click();
    return true;
  }, label);

const show = (label, list) => console.log(`${NL}${label}${NL}  ` + list.join(`${NL}  `));

await load();
await page.evaluate(() => window.localStorage.removeItem("sfm.dashboard.account-order.v1"));
await load();

const initial = await order();
show("default order (nothing saved)", initial);
console.log(`  Edit button present: ${await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Edit"))}`);

console.log(`${NL}click Edit: ${await click("Edit")}`);
await new Promise((r) => setTimeout(r, 400));
const arrows = await page.evaluate(() => document.querySelectorAll('button[aria-label^="Move "]').length);
console.log(`  move buttons drawn: ${arrows} (two per block, so ${initial.length * 2} expected)`);

// --- the arrows -----------------------------------------------------------
const bottom = initial[initial.length - 1].replace(/ \[.*\]$/, "");
console.log(`${NL}move "${bottom}" up with the arrow: ${await click(`Move ${bottom} up`)}`);
await new Promise((r) => setTimeout(r, 400));
const afterArrow = await order();
show("after one arrow", afterArrow);
console.log(`  saved: ${String(await stored()).slice(0, 70)}...`);

// --- a real drag, dispatched the way a mouse would: start, hover, drop ----
const grab = (index) =>
  page.evaluate((wanted) => {
    const blocks = [...document.querySelectorAll("h2")]
      .filter((h) =>
        [...h.querySelectorAll("span")].some((s) =>
          /^(Bank account|Card|Mobile wallet|Cash)$/.test(s.innerText.trim()),
        ),
      )
      .map((h) => h.closest("section"))
      .filter(Boolean);
    window.__drag = window.__drag || new DataTransfer();
    const block = wanted === -1 ? blocks[blocks.length - 1] : blocks[wanted];
    window.__from = block;
    block.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: window.__drag }));
    return blocks.length;
  }, index);

const hover = (index) =>
  page.evaluate((wanted) => {
    const blocks = [...document.querySelectorAll("h2")]
      .filter((h) =>
        [...h.querySelectorAll("span")].some((s) =>
          /^(Bank account|Card|Mobile wallet|Cash)$/.test(s.innerText.trim()),
        ),
      )
      .map((h) => h.closest("section"))
      .filter(Boolean);
    blocks[wanted].dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer: window.__drag }));
    blocks[wanted].dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: window.__drag }));
    return true;
  }, index);

const release = () =>
  page.evaluate(() => {
    window.__from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: window.__drag }));
    return true;
  });

console.log(`${NL}drag the bottom block to the top: blocks=${await grab(-1)}`);
await new Promise((r) => setTimeout(r, 300));
await hover(0);
await new Promise((r) => setTimeout(r, 300));
await release();
await new Promise((r) => setTimeout(r, 400));
const afterDrag = await order();
show("after the drag", afterDrag);
console.log(`  the dragged block is now on top: ${afterDrag[0] === afterArrow[afterArrow.length - 1]}`);

console.log(`${NL}click Done: ${await click("Done")}`);
await new Promise((r) => setTimeout(r, 300));

// --- does it survive a reload? -------------------------------------------
await load();
const afterReload = await order();
show("after a reload", afterReload);
console.log(`  same as before the reload: ${JSON.stringify(afterReload) === JSON.stringify(afterDrag)}`);
console.log(`  arrows gone when not editing: ${(await page.evaluate(() => document.querySelectorAll('button[aria-label^="Move "]').length)) === 0}`);

// --- reset ----------------------------------------------------------------
await click("Edit");
await new Promise((r) => setTimeout(r, 300));
console.log(`${NL}click Reset: ${await click("Reset")}`);
await new Promise((r) => setTimeout(r, 400));
const afterReset = await order();
show("after Reset", afterReset);
console.log(`  back to the default order: ${JSON.stringify(afterReset) === JSON.stringify(initial)}`);
console.log(`  storage cleared: ${(await stored()) === null}`);

await browser.close();
