/**
 * The redesigned heading summary, measured rather than admired.
 *
 * Walks the panel at four widths in both themes: does anything overflow, does
 * the track wrap instead of clipping, does picking a segment re-scope the big
 * figure and filter the table, and does picking it again let go.
 *
 *   node .catpanel.mjs [slug]
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const SLUG = process.argv[2] || "technology";
const SHOTS = process.argv[3] || null;

const env = Object.fromEntries(
  fs.readFileSync("apps/api/.env", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`select id,role,token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);
await db.end();
const token = jwt.sign({ sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: fs.existsSync(chrome) ? chrome : edge, headless: "new", args: ["--no-sandbox"] });
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const setTheme = (t) =>
  page.evaluate((theme) => {
    localStorage.setItem("svf-theme-brand", theme);
  }, t);

async function load(width, theme) {
  await page.setViewport({ width, height: 900 });
  await page.goto(`http://localhost:3000/expenses/${SLUG}`, { waitUntil: "networkidle0", timeout: 90000 });
  await setTheme(theme);
  await page.reload({ waitUntil: "networkidle0", timeout: 90000 });
  await wait(600);
}

const probe = () =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const panel = document.querySelector("main section");
    const track = document.querySelector('[role="tablist"]');
    const segs = track ? [...track.querySelectorAll('[role="tab"]')] : [];
    const bar = document.querySelector('main section [aria-hidden="true"].flex.h-2');
    const hero = document.querySelector("main section p:nth-of-type(2)");
    const px = (el, p) => (el ? Math.round(parseFloat(getComputedStyle(el)[p])) : null);
    return {
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      panelW: panel ? Math.round(panel.getBoundingClientRect().width) : null,
      panelRadius: px(panel, "borderTopLeftRadius"),
      trackOverflow: track ? track.scrollWidth - track.clientWidth : null,
      trackRows: track ? new Set(segs.map((b) => Math.round(b.getBoundingClientRect().top))).size : null,
      segs: segs.length,
      clipped: segs.filter((b) => { const r = b.getBoundingClientRect(); return r.right > window.innerWidth + 1 || r.left < -1; }).length,
      ellipsized: segs.filter((b) => b.scrollWidth > b.clientWidth + 1).length,
      active: segs.filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.textContent.trim()),
      labels: segs.map((b) => b.textContent.trim()),
      heroPx: px(hero, "fontSize"),
      barSegs: bar ? bar.children.length : 0,
      barWidths: bar ? [...bar.children].map((c) => c.style.width) : [],
      tableRows: document.querySelectorAll("main table tbody tr").length,
      shown: (document.querySelector("main section p:nth-of-type(3)")?.textContent || "").replace(/\s+/g, " ").trim(),
      amount: (hero?.textContent || "").replace(/\s+/g, " ").trim(),
    };
  });

const clickSeg = (i) =>
  page.evaluate((n) => {
    const b = [...document.querySelectorAll('[role="tab"]')][n];
    if (!b) return null;
    b.click();
    return b.textContent.trim();
  }, i);

for (const theme of ["dark", "light"]) {
  console.log(`\n=== ${theme} ===`);
  for (const width of [1440, 1024, 768, 390]) {
    await load(width, theme);
    const p = await probe();
    console.log(
      `${String(width).padStart(4)}px  pageOverflow=${p.pageOverflow}px  panel=${p.panelW}px r=${p.panelRadius}  track: overflow=${p.trackOverflow}px rows=${p.trackRows} segs=${p.segs} clipped=${p.clipped} ellipsized=${p.ellipsized}  hero=${p.heroPx}px  bar=${p.barSegs}  tableRows=${p.tableRows}`,
    );
    if (width === 1440) console.log(`        amount="${p.amount}"  sub="${p.shown}"  barWidths=${p.barWidths.join(" ")}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/cat-${theme}-${width}.png`, fullPage: width === 1440 });
  }
}

console.log(`\n=== filtering (dark, 1440) ===`);
await load(1440, "dark");
const before = await probe();
console.log(`tabs:       ${before.labels.join(" | ")}`);
console.log(`all:        amount="${before.amount}"  sub="${before.shown}"  tableRows=${before.tableRows}`);
const label = await clickSeg(1);
await wait(400);
const after = await probe();
console.log(`picked:     "${label}"  active=${after.active.join(",")}`);
console.log(`            amount="${after.amount}"  sub="${after.shown}"  tableRows=${after.tableRows}`);
await clickSeg(1);
await wait(400);
const off = await probe();
console.log(`picked again: amount="${off.amount}"  sub="${off.shown}"  tableRows=${off.tableRows}`);
await clickSeg(1);
await wait(300);
await clickSeg(0);
await wait(400);
const all = await probe();
console.log(`then "All":   amount="${all.amount}"  sub="${all.shown}"  tableRows=${all.tableRows}`);
if (SHOTS) {
  await clickSeg(1);
  await wait(400);
  await page.screenshot({ path: `${SHOTS}/cat-selected.png` });
}
await browser.close();
