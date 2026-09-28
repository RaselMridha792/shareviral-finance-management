/**
 * A dollar account's opening, in dollars, from the form.
 *
 * The owner: "hea ghorta jog kore daw". A USD account whose opening was never
 * stated in dollars leads its card with "~$0.00", and the account form had no
 * box to state it in — only the API could. This drives the form itself:
 *
 *   - the box is there for a USD account and not for a taka one;
 *   - what is typed is what is stored (`opening_balance_usd`);
 *   - the card then leads with exact dollars — no "~";
 *   - editing shows the figure, and blanking it clears it back to null, so the
 *     card goes back to approximate.
 *
 *     node .usdopeningqa.mjs      (local only — creates one account and
 *                                  deletes it)
 *
 * Needs `npm run dev` running (web :3000, api :4001).
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB ?? "http://localhost:3000";
const NAME = "USDOPENQA Dollar Card";

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
const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const admin = (
  await db.query(
    `select id, role, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`,
  )
).rows[0];
const token = jwt.sign({ sub: admin.id, role: admin.role, tv: admin.token_version }, env.JWT_ACCESS_SECRET, {
  expiresIn: "1h",
});
const wipe = async () => {
  const ids = (await db.query("select id from accounts where name = $1", [NAME])).rows.map((r) => r.id);
  if (!ids.length) return;
  await db.query("delete from audit_logs where entity_id = any($1::text[])", [ids]);
  await db.query("delete from accounts where id = any($1::uuid[])", [ids]);
};
await wipe();

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const errors = [];
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));

  const field = () => page.$('[data-popup] input[name="openingBalanceUsd"]');
  const setValue = (selector, value) =>
    page.$eval(
      selector,
      (el, value) => {
        const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      value,
    );
  const card = () =>
    page.evaluate((name) => {
      const c = [...document.querySelectorAll("main .sv-card")].find(
        (el) => el.querySelector("p.truncate")?.textContent.trim() === name,
      );
      return c ? [...c.querySelectorAll(".text-right > *")].map((x) => x.textContent.trim()) : null;
    }, NAME);

  /* ------------------------------------------------ adding one */
  await page.goto(`${WEB}/accounts`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(800);
  await page.evaluate(() =>
    [...document.querySelectorAll("main button")].find((b) => b.textContent.trim() === "Add account").click(),
  );
  await page.waitForSelector("[data-popup] form", { timeout: 20000 });
  check("a taka account is not asked for dollars", !(await field()));

  await setValue('[data-popup] select[name="currency"]', "USD");
  await settle(300);
  check("a dollar account is", Boolean(await field()));

  await setValue('[data-popup] input[name="name"]', NAME);
  await setValue('[data-popup] select[name="type"]', "bank");
  await setValue('[data-popup] input[name="openingBalance"]', "12250.00");
  await setValue('[data-popup] input[name="openingBalanceOn"]', "2026-09-01");
  await setValue('[data-popup] input[name="openingBalanceUsd"]', "100.00");
  await page.evaluate(() =>
    [...document.querySelectorAll("[data-popup] button[type=submit]")].at(-1).click(),
  );
  await page.waitForFunction(() => !document.querySelector("[data-popup]"), { timeout: 20000 }).catch(() => {});
  await settle(1500);

  let stored = (await db.query("select opening_balance_usd::text as usd, currency from accounts where name = $1", [NAME])).rows[0];
  check("what was typed is what is stored", stored?.usd === "100.00" && stored?.currency === "USD", JSON.stringify(stored));

  let figures = await card();
  const dollars = figures?.find((f) => f.includes("$"));
  check("the card leads with exact dollars — no ~", Boolean(dollars) && !dollars.includes("~") && /100\.00/.test(dollars), JSON.stringify(figures));

  /* ------------------------------------------------ editing it */
  const id = (await db.query("select id from accounts where name = $1", [NAME])).rows[0].id;
  await page.goto(`${WEB}/accounts/${id}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(800);
  await page.evaluate(() =>
    [...document.querySelectorAll("main button")].find((b) => b.textContent.trim() === "Edit").click(),
  );
  await page.waitForSelector('[data-popup] input[name="openingBalanceUsd"]', { timeout: 20000 });
  const shown = await page.$eval('[data-popup] input[name="openingBalanceUsd"]', (el) => el.value);
  check("editing shows the stored figure", shown === "100.00", shown);

  await setValue('[data-popup] input[name="openingBalanceUsd"]', "");
  await page.evaluate(() =>
    [...document.querySelectorAll("[data-popup] button[type=submit]")].at(-1).click(),
  );
  await page.waitForFunction(() => !document.querySelector("[data-popup]"), { timeout: 20000 }).catch(() => {});
  await settle(1500);
  stored = (await db.query("select opening_balance_usd::text as usd from accounts where name = $1", [NAME])).rows[0];
  check("blanking it clears it", stored?.usd === null, JSON.stringify(stored));

  await page.goto(`${WEB}/accounts`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(800);
  figures = await card();
  check(
    "and the card goes back to approximate",
    Boolean(figures?.find((f) => f.includes("$") && f.includes("~"))),
    JSON.stringify(figures),
  );

  check("no errors on the way", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
  await wipe();
  await db.end();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
