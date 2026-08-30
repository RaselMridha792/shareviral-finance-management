// The page as a person sees it: the column, the pencil, the popup, the drawer.
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const OUT = process.argv[2] || "tds";
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Land on a month that actually has rows: July 2026. */
async function pickJuly() {
  const picked = await page.evaluate(() => {
    for (const select of document.querySelectorAll("select")) {
      const option = [...select.options].find((o) => o.textContent.trim() === "July 2026");
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return option.value;
      }
    }
    return null;
  });
  await wait(1600);
  return picked;
}

async function measure(label) {
  return page.evaluate((label) => {
    const table = document.querySelector("table.table-data");
    const head = [...(table?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent.trim());
    const bodyRows = [...(table?.querySelectorAll("tbody tr") ?? [])];
    const cellCounts = new Set(bodyRows.map((tr) => tr.children.length));
    const challanIndex = head.findIndex((h) => h.toLowerCase().includes("challan"));
    const cells = bodyRows.map((tr) => tr.children[challanIndex]?.textContent.trim() ?? "");
    const scroller = table?.closest("[class*='overflow']");
    const foot = [...(table?.querySelectorAll("tfoot tr") ?? [])].map((tr) =>
      [...tr.children].map((td) => `${td.textContent.trim() || "-"}(${td.colSpan})`).join(" | "));
    return {
      label,
      head,
      headCount: head.length,
      rows: bodyRows.length,
      cellCounts: [...cellCounts],
      challanIndex,
      withNumber: cells.filter((c) => /A-/.test(c)).length,
      sayingNotRecorded: cells.filter((c) => c.includes("Challan not recorded yet")).length,
      firstChallanCell: cells[0],
      pencils: document.querySelectorAll('button[aria-label^="Record the challan"]').length,
      foot,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tableOverflow: scroller ? scroller.scrollWidth - scroller.clientWidth : null,
    };
  }, label);
}

for (const [w, h, name] of [[1440, 1000, "1440"], [1024, 800, "1024"], [390, 844, "390"]]) {
  await page.setViewport({ width: w, height: h });
  await page.goto("http://localhost:3000/tax/withholding", { waitUntil: "networkidle0", timeout: 120000 });
  await wait(900);
  console.log("empty month first:", JSON.stringify(await measure(`${name}-current`)));
  await pickJuly();
  console.log(JSON.stringify(await measure(name), null, 1));
  await page.screenshot({ path: `${OUT}-${name}.png`, fullPage: true });
}

// --- the popup, opened from the number ------------------------------------
await page.setViewport({ width: 1440, height: 1000 });
await page.goto("http://localhost:3000/tax/withholding", { waitUntil: "networkidle0", timeout: 120000 });
await wait(900);
await pickJuly();
await page.evaluate(() => {
  const button = [...document.querySelectorAll("tbody button")].find((b) => /A-\d|A-TEST|A-2026/.test(b.textContent));
  button?.click();
});
await wait(1500);
console.log("popup:", await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) return "no dialog";
  return {
    label: dialog.getAttribute("aria-label"),
    title: dialog.querySelector("p")?.textContent.trim(),
    images: dialog.querySelectorAll("img").length,
    iframes: dialog.querySelectorAll("iframe").length,
    download: !!dialog.querySelector('a[download]'),
    text: dialog.textContent.replace(/\s+/g, " ").slice(0, 160),
  };
}));
await page.screenshot({ path: `${OUT}-popup.png` });

// --- the drawer, opened from the pencil -----------------------------------
await page.keyboard.press("Escape");
await wait(400);
await page.evaluate(() => document.querySelector('button[aria-label^="Record the challan"]')?.click());
await wait(700);
console.log("drawer:", await page.evaluate(() => {
  const drawer = document.querySelector('[role="dialog"], aside, [class*="fixed"][class*="right-0"]');
  const form = document.querySelector("form");
  return {
    heading: [...document.querySelectorAll("h2, h3, p")].map((n) => n.textContent.trim()).find((t) => /Challan for this deduction/i.test(t)) ?? null,
    input: document.querySelector('input[name="challanNumber"]')?.value ?? null,
    checkbox: document.querySelector('input[type="checkbox"]')?.checked ?? null,
    fileInput: !!document.querySelector('input[type="file"]'),
    text: (form?.textContent ?? drawer?.textContent ?? "").replace(/\s+/g, " ").slice(0, 260),
  };
}));
await page.screenshot({ path: `${OUT}-drawer.png` });

// --- a month with no challans at all --------------------------------------
await page.keyboard.press("Escape");
await wait(300);
await page.evaluate(() => {
  for (const select of document.querySelectorAll("select")) {
    const option = [...select.options].find((o) => o.textContent.trim() === "June 2026");
    if (option && !option.disabled) {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
  }
});
await wait(1800);
console.log("another period:", JSON.stringify(await measure("june")));
await page.screenshot({ path: `${OUT}-empty.png`, fullPage: true });

await browser.close();
