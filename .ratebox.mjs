/**
 * Cash In: the "Rate this month" cell is gone, and the dollars it fed are not.
 *
 * The cell was the only place the month's rate was printed, but the rate also
 * decides the ~$ under the taka total and the USD column of any row that
 * carries no rate of its own. So this checks both halves: no rate cell, and
 * the dollar figures still add up. Throwaway, untracked.
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

const seen = [];
for (const month of ["August 2026", "July 2026", "June 2026", "May 2026"]) {
  if (seen.length === 0) {
    await page.goto("http://localhost:3000/accounts/cash-in", { waitUntil: "networkidle0", timeout: 90000 });
  } else {
    const value = await page.evaluate((label) => {
      const sel = document.querySelector('select[aria-label="Month"]');
      return [...sel.options].find((o) => o.textContent.trim() === label)?.value ?? null;
    }, month);
    if (!value) { console.log(month, "— not offered"); continue; }
    await page.select('select[aria-label="Month"]', value);
  }
  await new Promise((r) => setTimeout(r, 1400));

  const probe = await page.evaluate(() => {
    const text = document.body.innerText;
    const cells = [...document.querySelectorAll("main *")].map((el) => el.textContent || "");
    const usdCol = [...document.querySelectorAll("thead th")].findIndex((th) => (th.textContent || "").trim().toLowerCase() === "usd rate");
    const usdAmtCol = [...document.querySelectorAll("thead th")].findIndex((th) => (th.textContent || "").trim().toLowerCase() === "amount (usd)");
    const bdtCol = [...document.querySelectorAll("thead th")].findIndex((th) => (th.textContent || "").trim().toLowerCase() === "amount (bdt)");
    const body = [...document.querySelectorAll("tbody tr")].map((tr) => {
      const td = tr.querySelectorAll("td");
      return {
        bdt: td[bdtCol]?.textContent.trim() ?? null,
        usd: td[usdAmtCol]?.textContent.trim() ?? null,
        rate: td[usdCol]?.textContent.trim() ?? null,
      };
    });
    return {
      hasRateHeading: /rate this month/i.test(text),
      hasSetByCaption: /set by txn-/i.test(text),
      hasFxIcon: cells.some((t) => t.trim() === "currency_exchange"),
      statCells: [...document.querySelectorAll("main [class*='grid'] > *")].length,
      strip: text.match(/RECEIVED IN [A-Z]+ \d{4}[\s\S]{0,60}/i)?.[0].split("\n").slice(0, 3).join(" / ") ?? null,
      usdRateColumnPresent: usdCol >= 0,
      rows: body,
    };
  });

  const okCell = !probe.hasRateHeading && !probe.hasSetByCaption && !probe.hasFxIcon;
  console.log(`\n--- ${month} ---`);
  console.log('"Rate this month" anywhere :', probe.hasRateHeading ? "STILL THERE" : "gone");
  console.log('"Set by TXN-…" caption     :', probe.hasSetByCaption ? "STILL THERE" : "gone");
  console.log("currency_exchange icon     :", probe.hasFxIcon ? "STILL THERE" : "gone");
  console.log("strip                      :", probe.strip);
  console.log("USD rate column on rows    :", probe.usdRateColumnPresent);
  for (const r of probe.rows) console.log("   row:", r.bdt, "|", r.usd, "| rate", r.rate);
  seen.push({ month, okCell, dollars: probe.strip });
}

await page.screenshot({ path: process.argv[2] || "cashin.png", fullPage: true });
console.log("\nrate cell gone on every month:", seen.every((s) => s.okCell));
await browser.close();
