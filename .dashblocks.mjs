/**
 * Does the dashboard draw one block per account, and do its four figures tie?
 *
 * Reads the rendered page rather than the JSON: the grouping this replaced —
 * three banks, a card and two wallets summed into one strip headed "BD Bank
 * overview" — was correct arithmetic on the wrong question, and only looked
 * wrong on screen.
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const c = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: users } = await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1");
const { rows: accts } = await c.query("select name, type from accounts where deleted_at is null order by sort_order, name");
await c.end();

const token = jwt.sign({ sub: users[0].id, role: users[0].role, tv: users[0].token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({ executablePath: fs.existsSync(chrome) ? chrome : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: "new", args: ["--no-sandbox"] });
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 950 });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle0", timeout: 180000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));
const text = await page.evaluate(() => document.body.innerText);
await browser.close();

const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
const num = (v) => Number(String(v).replace(/[^\d.-]/g, "").replace(/^-/, "-")) * (/−|-/.test(v) ? (String(v).trim().startsWith("−") || String(v).trim().startsWith("-") ? 1 : 1) : 1);
const money = (v) => {
  const negative = /^[−-]/.test(v);
  const n = Number(v.replace(/[^\d.]/g, ""));
  return negative ? -n : n;
};
const after = (from, label) => {
  const i = lines.indexOf(label, from);
  return i === -1 ? null : { at: i, value: money(lines[i + 1]) };
};

const blocks = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i] !== "OPENING BALANCE") continue;
  const name = lines[i - 3];
  const type = lines[i - 2];
  const icon = lines[i - 4];
  const opening = money(lines[i + 1]);
  const inflow = after(i, "CASH INFLOW");
  const outflow = after(i, "CASH OUTFLOW");
  const closing = after(i, "CURRENT BALANCE") ?? after(i, "CLOSING BALANCE");
  blocks.push({ name, type, icon, opening, in: inflow?.value, out: outflow?.value, closing: closing?.value });
}

console.log(`accounts (not deleted): ${accts.length}    blocks on the dashboard: ${blocks.length}\n`);
let bad = 0;
for (const b of blocks) {
  const ties = Math.abs(b.opening + b.in - b.out - b.closing) < 0.02;
  if (!ties) bad++;
  console.log(`${ties ? "ties" : "FAIL"}  ${b.name.padEnd(26)} ${b.type.padEnd(15)} ${String(b.icon).padEnd(18)} open ${b.opening.toFixed(2).padStart(16)}  in ${b.in.toFixed(2).padStart(14)}  out ${b.out.toFixed(2).padStart(14)}  close ${b.closing.toFixed(2).padStart(16)}`);
}
const names = blocks.map((b) => b.name).sort();
const expected = accts.map((a) => a.name).sort();
console.log(`\n${blocks.length} blocks, ${bad} that do not tie`);
console.log(`names match accounts: ${JSON.stringify(names) === JSON.stringify(expected)}`);
if (JSON.stringify(names) !== JSON.stringify(expected)) console.log("on page:", names, "\nin db  :", expected);
