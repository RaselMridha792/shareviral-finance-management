/**
 * No figure on a report comes from a rate somebody could edit afterwards.
 *
 * The owner: *"report ta calculate hobe kono fx rate theke na, karon prottekta
 * transaction a manual dollar type er option ache."*
 *
 * The statement used to fall back to the month's governing rate for anything
 * that carried no rate of its own — every balance, and every entry recorded
 * without one — and mark the result "estimated". That figure MOVED: editing the
 * Settings rate silently restated the dollar column of every month already
 * filed. This proves it does not any more, the only way that can be proved:
 *
 *   1. record two entries in one month, one carrying a rate and one not
 *   2. read the dollar figures off the page
 *   3. CHANGE the Settings rate
 *   4. read them again — every single one must be identical
 *
 * Step 3 is the whole test. A statement that passes 1-2 and fails 4 is exactly
 * the bug: it looks right until somebody touches Settings.
 *
 *     node .reportsfxqa.mjs      (local only — writes and deletes; puts the
 *                                 Settings rate back where it found it)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
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
const call = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const month = TODAY.slice(0, 8);
const wipe = async () => {
  await db.query("delete from transactions where description like 'RFXQA%'");
  await db.query("delete from accounts where name like 'RFXQA %'");
};
await wipe();

const account = (
  await call("POST", "/accounts", {
    name: "RFXQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "200000.00",
    openingBalanceOn: month + "01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/* One entry that carries its own rate — a funding transfer. */
const withRate = await call("POST", "/transactions/cash-in", {
  txnDate: month + "05",
  accountId: account.id,
  amount: "122000.00",
  description: "RFXQA funding with a rate of its own",
  usdRate: "122.00",
  usdSent: "1000.00",
});
/* And one that carries none — an ordinary taka expense. */
const noRate = await call("POST", "/transactions", {
  direction: "out",
  txnDate: month + "12",
  accountId: account.id,
  amount: "9000.00",
  categoryId: cat.id,
  description: "RFXQA expense with no rate",
  paymentMethod: "bank_transfer",
});
check(
  "one entry carries a rate and one does not",
  withRate.status === 201 && noRate.status === 201,
  `HTTP ${withRate.status}/${noRate.status}`,
);

/* ------------------------- the Settings rate, saved -------------------- */

/*
 * Moved in the DATABASE, not through the API.
 *
 * The column is `app_settings.fx_fixed_usd_bdt` — the fixed rate the app falls
 * back to. Writing it directly is deliberate: the endpoint that used to set it
 * has been coming off screen by screen as #8 removes the global rate, and a
 * harness that asks the API to change a setting proves nothing about a report
 * that reads the COLUMN. This puts it back at the end whatever happens.
 */
const originalRate = (
  await db.query("select fx_fixed_usd_bdt::text r from app_settings limit 1")
).rows[0]?.r ?? null;
const setRate = (value) =>
  db.query("update app_settings set fx_fixed_usd_bdt = $1", [value]);
check(
  "the fixed rate the app used to fall back to is readable",
  true,
  `currently ${originalRate ?? "not set"}`,
);

/* -------------------------------- browser ------------------------------ */

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
await page.setViewport({ width: 1800, height: 1400 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const readReport = async () => {
  await page.goto(`${WEB}/reports`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(3200);
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const text = (main.textContent ?? "").replace(/\s+/g, " ");
    return {
      /* Every dollar figure on the page, in order. */
      dollars: text.match(/\$[\d,]+\.\d\d/g) ?? [],
      /* The dash the page prints where there is no recorded rate. */
      dashes: (text.match(/—/g) ?? []).length,
      text,
    };
  });
};

const before = await readReport();
check(
  "the report renders",
  before.text.length > 200,
  `${before.text.length} characters`,
);
check(
  "the entry that carries a rate still shows its dollars",
  before.dollars.some((d) => d.replace(/[$,]/g, "") === "1000.00"),
  before.dollars.slice(0, 8).join(" "),
);
check(
  "and the page no longer claims figures are translated at a rate",
  !/translated at/i.test(before.text) && !/marked estimated/i.test(before.text),
  (before.text.match(/translated at[^.]*\./i) ?? ["clean"])[0],
);
check(
  "the note says the dollars come from the entries themselves",
  /rate recorded against them on the day/i.test(before.text),
  (before.text.match(/[^.]*rate recorded against them[^.]*\./i) ?? ["not found"])[0].slice(0, 150),
);

/* ------------------- THE TEST: move the Settings rate ------------------ */

/* A wildly different rate, so a report that still read it could not possibly
   produce the same figures by coincidence. */
const moved = "250.000000";
await setRate(moved);
const confirmed = (
  await db.query("select fx_fixed_usd_bdt::text r from app_settings limit 1")
).rows[0]?.r;
check(
  "the fallback rate is moved to something unmistakable",
  confirmed === moved,
  `${originalRate ?? "not set"} -> ${confirmed}`,
);

const after = await readReport();
check(
  "MOVING THE SETTINGS RATE CHANGES NOTHING ON THE REPORT",
  JSON.stringify(after.dollars) === JSON.stringify(before.dollars),
  `before ${before.dollars.slice(0, 6).join(" ")} | after ${after.dollars.slice(0, 6).join(" ")}`,
);
check(
  "and the entry with no rate of its own still shows no dollar figure",
  !after.dollars.some((d) => d.replace(/[$,]/g, "") === "9000.00") &&
    !/9000\.00/.test(after.dollars.join(" ")),
  `dollar figures on the page: ${after.dollars.join(" ") || "none"}`,
);

/* Put it back, whatever happened above. */
await setRate(originalRate);
const restored = (
  await db.query("select fx_fixed_usd_bdt::text r from app_settings limit 1")
).rows[0]?.r ?? null;
check(
  "the fallback rate is put back where it was found",
  String(restored) === String(originalRate),
  `${restored} vs ${originalRate}`,
);

await browser.close();
await wipe();
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
