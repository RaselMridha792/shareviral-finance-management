/**
 * Day, month, year — on the screens, not only in the helper.
 *
 * The owner's instruction was "puro system er date format ta change koro. age
 * day/month/year evabe koro", and the screenshot that came with it showed the
 * Team table printing 2026-05-14. So this loads the real screens and reads the
 * real cells: a unit test on `formatIsoDate` would pass whether or not a single
 * table had been rewired, which is exactly the kind of green that has misled
 * this codebase before.
 *
 * It also checks the pair of labels beside an account's opening balance, since
 * "As at" was banking language nobody here reads.
 *
 *     node .dateqa.mjs      (local only — reads; writes nothing)
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
await page.setViewport({ width: 1700, height: 1200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * ISO in the page body is the failure. Written as three groups rather than
 * \d{4}-\d{2}-\d{2} so an `<input type="date">` value — which the browser draws
 * and which this change deliberately does not touch — cannot be mistaken for a
 * printed cell: inputs are read separately, below.
 */
/*
 * Lookarounds, not \b. Reading a table's textContent runs the cells together
 * — "N/A01/01/2020TDSUI Person" — and there is no word boundary between "A"
 * and \"0\", so \b matched nothing and this file reported the Team table as
 * showing no dates at all while the browser was showing them correctly.
 */
const ISO = /(?<!\d)(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?!\d)/;
const DMY = /(?<!\d)(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])\/20\d{2}(?!\d)/;

const readScreen = async (url) => {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2400);
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    /* Text only — never an input's value, which the browser formats itself. */
    const clone = main.cloneNode(true);
    clone
      .querySelectorAll("input, select, textarea, script, style")
      .forEach((el) => el.remove());
    return (clone.textContent ?? "").replace(/\s+/g, " ");
  });
};

const screens = [
  ["Team", `${WEB}/team`],
  ["Accounts", `${WEB}/accounts`],
  ["Cash in", `${WEB}/accounts/cash-in`],
  ["Other expenses", `${WEB}/expenses/other`],
  ["Money transfer", `${WEB}/transfers`],
  ["AI tools and subscriptions", `${WEB}/subscriptions`],
  ["Bank statement", `${WEB}/statement`],
];

for (const [label, url] of screens) {
  const text = await readScreen(url);
  const iso = ISO.exec(text);
  check(
    `${label}: no date is printed as YYYY-MM-DD`,
    !iso,
    iso ? `found ${iso[0]}` : "",
  );
}

/* At least one screen must actually be showing a date, or the above is vacuous. */
const teamText = await readScreen(`${WEB}/team`);
check(
  "the Team table really is printing dates, day first",
  DMY.test(teamText),
  DMY.exec(teamText)?.[0] ?? "no dd/mm/yyyy found — nothing was being tested",
);

/* --------------- the label that read like a bank statement -------------- */

await page.goto(`${WEB}/accounts`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2200);
await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  [...main.querySelectorAll("button, a")]
    .find((b) => /^(Add an account|Add account|Add)$/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await settle(1600);

const labels = await page.evaluate(() => {
  const drawer = [...document.querySelectorAll('[role="dialog"], aside, form')].find(
    (d) => /Opening balance/i.test(d.textContent ?? ""),
  );
  const text = (drawer?.textContent ?? "").replace(/\s+/g, " ");
  return {
    found: Boolean(drawer),
    saysAsAt: /\bAs at\b/.test(text),
    saysOpeningBalanceDate: /Opening balance date/i.test(text),
    hint: /Entries you record start from the next day/i.test(text),
  };
});
check("the account drawer opens", labels.found, "");
check(
  'THE ASK: "As at" is gone',
  labels.found && !labels.saysAsAt,
  labels.saysAsAt ? 'the drawer still says "As at"' : "",
);
check(
  "and the day is named in plain words",
  labels.saysOpeningBalanceDate && labels.hint,
  `label ${labels.saysOpeningBalanceDate}, hint ${labels.hint}`,
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
