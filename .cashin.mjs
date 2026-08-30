/**
 * Cash In: the month picker is a dropdown, and it sits beside "Add cash".
 *
 * Loads the running page, reads the select's options, checks it is on the
 * header row rather than in a filter row of its own, and picks a month to see
 * the screen re-scope. Throwaway — untracked, like the other probes here.
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, "apps/api/.env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);
await db.end();
const token = jwt.sign({ sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({ executablePath: fs.existsSync(chrome) ? chrome : edge, headless: "new", args: ["--no-sandbox"] });
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.goto("http://localhost:3000/accounts/cash-in", { waitUntil: "networkidle0", timeout: 90000 });
await new Promise((r) => setTimeout(r, 1200));

const shot = process.argv[2] || "cashin.png";
await page.screenshot({ path: shot, fullPage: true });

const probe = await page.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Month"]');
  const oldInput = document.querySelector('input[type="month"]');
  const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().toLowerCase().includes("add cash"));
  const h1 = document.querySelector("h1");
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
  const strip = document.body.innerText.match(/RECEIVED IN [A-Z]+ \d{4}/i)?.[0] ?? null;
  return {
    hasSelect: Boolean(sel),
    stillHasMonthInput: Boolean(oldInput),
    options: sel ? [...sel.options].map((o) => ({ label: o.textContent.trim(), value: o.value, disabled: o.disabled })) : [],
    selected: sel ? sel.value : null,
    select: r(sel), button: r(btn), h1: r(h1),
    strip,
    firstRowDate: document.querySelector("tbody tr td:nth-child(2)")?.textContent.trim() ?? null,
    rowCount: document.querySelectorAll("tbody tr").length,
  };
});

console.log("select present            :", probe.hasSelect);
console.log("old <input type=month>    :", probe.stillHasMonthInput ? "STILL THERE" : "gone");
console.log("options                   :", probe.options.map((o) => o.label + (o.disabled ? " (disabled)" : "")).join(" | "));
console.log("any disabled              :", probe.options.some((o) => o.disabled));
console.log("selected                  :", probe.selected);
console.log("select box                :", JSON.stringify(probe.select));
console.log("Add cash box              :", JSON.stringify(probe.button));
console.log("h1 box                    :", JSON.stringify(probe.h1));
if (probe.select && probe.button) {
  console.log("same row as Add cash      :", Math.abs(probe.select.bottom - probe.button.bottom) <= 2, `(gap ${probe.button.x - probe.select.right}px, heights ${probe.select.h}/${probe.button.h})`);
  console.log("left of Add cash          :", probe.select.right <= probe.button.x);
}
if (probe.select && probe.h1) {
  console.log("on the title's row        :", Math.abs(probe.select.y - probe.h1.y) < 60, `(h1 y=${probe.h1.y}, select y=${probe.select.y})`);
}
console.log("strip heading             :", probe.strip);
console.log("rows on page              :", probe.rowCount, "| first row date:", probe.firstRowDate);

// Pick the next month down and see the screen follow it.
const target = probe.options[1];
if (target) {
  await page.select('select[aria-label="Month"]', target.value);
  await new Promise((r) => setTimeout(r, 1500));
  const after = await page.evaluate(() => ({
    strip: document.body.innerText.match(/RECEIVED IN [A-Z]+ \d{4}/i)?.[0] ?? null,
    selected: document.querySelector('select[aria-label="Month"]').value,
    rowCount: document.querySelectorAll("tbody tr").length,
    firstRowDate: document.querySelector("tbody tr td:nth-child(2)")?.textContent.trim() ?? null,
  }));
  console.log("\npicked                    :", target.label, `(${target.value})`);
  console.log("select now says           :", after.selected);
  console.log("strip now says            :", after.strip);
  console.log("rows now                  :", after.rowCount, "| first row date:", after.firstRowDate);
  await page.screenshot({ path: shot.replace(".png", "-picked.png"), fullPage: true });
}
await browser.close();
