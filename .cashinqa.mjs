/**
 * The account first, and no typing over the arithmetic.
 *
 * Two asks, and a third thing that had to survive both:
 *
 *   - "recieved bank name er opore tai ekhane revieved bank name field take
 *     opore diba" — which account it landed in decides whether the form asks
 *     for dollars at all, so it cannot be the last question on the page;
 *   - "je field ta auto fill hobe rate bosanor por oi field ta edit kora jawa
 *     ucit na karon oita calculation korei to asteche" — the taka box says it
 *     is worked out, and used to accept typing anyway;
 *   - a LOCAL receipt has no dollars, so there is nothing to work out and the
 *     box must still be typeable. Locking it outright would have made the form
 *     unusable for half the receipts it exists for, which is why this file
 *     checks the ordinary case as hard as the asked-for one.
 *
 *     node .cashinqa.mjs      (local only — reads; writes nothing)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
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
const person = (
  await db.query(
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
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
await page.setViewport({ width: 1600, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/accounts/cash-in`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2400);
await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  [...main.querySelectorAll("button, a")]
    .find((b) => /^Add cash$/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await settle(1600);

/* ---------------------------- 1. the order ----------------------------- */

const order = await page.evaluate(() => {
  const drawer = [...document.querySelectorAll('[role="dialog"], aside, form')].find(
    (d) => /Received Bank Name/i.test(d.textContent ?? ""),
  );
  if (!drawer) return { found: false };
  const names = [...drawer.querySelectorAll("input, select, textarea, button")]
    .map((el) => el.getAttribute("name"))
    .filter(Boolean);
  return {
    found: true,
    accountAt: names.indexOf("accountId"),
    usdAt: names.indexOf("usdSent"),
    rateAt: names.indexOf("usdRate"),
    amountAt: names.indexOf("amount"),
    names,
  };
});
check("the Add cash drawer opens", order.found, "");
check(
  "THE ASK: the account comes before the amounts",
  order.accountAt >= 0 &&
    order.usdAt >= 0 &&
    order.accountAt < order.usdAt &&
    order.accountAt < order.amountAt,
  `account ${order.accountAt}, usd ${order.usdAt}, rate ${order.rateAt}, taka ${order.amountAt}`,
);

/* ------------- 2. with no dollars, the taka box is the person's --------- */

const blank = await page.evaluate(() => {
  const el = document.querySelector('input[name="amount"]');
  return { readOnly: el?.readOnly ?? null, value: el?.value ?? null };
});
check(
  "with no dollars typed, the taka box can still be filled in",
  blank.readOnly === false,
  `readOnly ${blank.readOnly}`,
);

const typed = await page.evaluate(() => {
  const el = document.querySelector('input[name="amount"]');
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, "45000");
  el?.dispatchEvent(new Event("input", { bubbles: true }));
  return el?.value ?? null;
});
await settle(500);
const stuck = await page.evaluate(
  () => document.querySelector('input[name="amount"]')?.value ?? null,
);
check(
  "and what is typed there stays typed",
  stuck === "45000" || stuck === typed,
  `typed ${typed}, reads back ${stuck}`,
);

/* ------------- 3. once dollars and a rate are there, it locks ---------- */

await page.evaluate(() => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  for (const [name, value] of [
    ["usdSent", "14000"],
    ["usdRate", "122.77"],
  ]) {
    const el = document.querySelector(`input[name="${name}"]`);
    setter?.call(el, value);
    el?.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await settle(900);

const derived = await page.evaluate(() => {
  const el = document.querySelector('input[name="amount"]');
  return { readOnly: el?.readOnly ?? null, value: el?.value ?? null };
});
check(
  "THE ASK: once the dollars and the rate are there, the taka box is worked out",
  derived.value === (14000 * 122.77).toFixed(2),
  `${derived.value} (expected ${(14000 * 122.77).toFixed(2)})`,
);
check(
  "THE ASK: and cannot be typed over",
  derived.readOnly === true,
  `readOnly ${derived.readOnly}`,
);

/* Changing the rate must move it, since that is the honest correction. */
await page.evaluate(() => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  const el = document.querySelector('input[name="usdRate"]');
  setter?.call(el, "120.00");
  el?.dispatchEvent(new Event("input", { bubbles: true }));
});
await settle(800);
const moved = await page.evaluate(
  () => document.querySelector('input[name="amount"]')?.value ?? null,
);
check(
  "changing the rate moves it, which is the correction that is left",
  moved === (14000 * 120).toFixed(2),
  `${moved}`,
);

/* Clearing the dollars hands the box back. */
await page.evaluate(() => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  const el = document.querySelector('input[name="usdSent"]');
  setter?.call(el, "");
  el?.dispatchEvent(new Event("input", { bubbles: true }));
});
await settle(800);
const handedBack = await page.evaluate(
  () => document.querySelector('input[name="amount"]')?.readOnly ?? null,
);
check(
  "and clearing the dollars hands the box back to the person",
  handedBack === false,
  `readOnly ${handedBack}`,
);

await browser.close();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
