/**
 * The dollar equivalents are ADDED UP, never divided out of taka.
 *
 * The owner, on the cards and the tables: *"aigula kono fx rate theke hobena.
 * prottekta transaction er usd amount o save hoy oitai jog hobe."*
 *
 * The failure this is built to catch is the one that looks perfect: a screen
 * showing a plausible dollar figure that came from a RATE. It reads correctly
 * on the day and then moves on its own the moment somebody edits the rate, and
 * a figure on a filed month changes with nobody touching that month.
 *
 * So the test is arithmetic, not appearance. Two receipts carrying $1,000 and
 * $500 at DELIBERATELY DIFFERENT rates:
 *
 *     $1,000 at 100.00  ->  ৳100,000
 *     $  500 at 200.00  ->  ৳100,000
 *
 * Added up, the dollars are $1,500. Divided out of ৳200,000, they are $2,000 at
 * one rate and $1,000 at the other — and NEITHER is 1,500. A screen reading
 * 1,500 cannot have divided anything.
 *
 * Then the same rates are moved in Settings, and every figure must be identical.
 *
 *     node .ownusdqa.mjs      (local only — writes and deletes)
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
  await db.query("delete from transactions where description like 'USDQA%'");
  await db.query("delete from accounts where name like 'USDQA %'");
};
await wipe();

const account = (
  await call("POST", "/accounts", {
    name: "USDQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "0.00",
    openingBalanceOn: month + "01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/* Two receipts, same taka, wildly different rates. */
const a = await call("POST", "/transactions/cash-in", {
  txnDate: month + "05",
  accountId: account.id,
  amount: "100000.00",
  description: "USDQA a thousand dollars at a hundred",
  usdRate: "100.00",
  usdSent: "1000.00",
});
const b = await call("POST", "/transactions/cash-in", {
  txnDate: month + "06",
  accountId: account.id,
  amount: "100000.00",
  description: "USDQA five hundred dollars at two hundred",
  usdRate: "200.00",
  usdSent: "500.00",
});
/* And one expense carrying its own dollars. */
const out = await call("POST", "/transactions", {
  direction: "out",
  txnDate: month + "07",
  accountId: account.id,
  amount: "24000.00",
  categoryId: cat.id,
  description: "USDQA an expense worth two hundred dollars",
  paymentMethod: "card",
  originalAmount: "200.00",
  originalCurrency: "USD",
  fxRate: "120.00",
});
check(
  "two receipts at different rates, and one expense, all carrying dollars",
  a.status === 201 && b.status === 201,
  `HTTP ${a.status}/${b.status}, expense ${out.status}`,
);

const stored = (
  await db.query(
    `select coalesce(sum(original_amount) filter (where direction='in'), 0)::text i,
            coalesce(sum(original_amount) filter (where direction='out'), 0)::text o
       from transactions
      where description like 'USDQA%' and original_currency='USD'
        and deleted_at is null and voided_at is null`,
  )
).rows[0];
check(
  "the rows themselves hold the dollars",
  Number(stored.i) === 1500,
  `in $${stored.i}, out $${stored.o}`,
);

/* ------------------------- the summary, on the wire -------------------- */

const summary = (
  await call(
    "GET",
    `/transactions/summary?from=${month}01&to=${month}28&accountId=${account.id}`,
  )
).body;
check(
  "the summary sums the dollars rather than dividing the taka",
  summary?.usd?.moneyIn === "1500.00",
  `usd.moneyIn ${summary?.usd?.moneyIn} — dividing ৳200,000 gives 2000 at 100 or 1000 at 200, never 1500`,
);
check(
  "and its net is the dollars in minus the dollars out",
  summary?.usd?.net === "1300.00",
  `net ${summary?.usd?.net}, out ${summary?.usd?.moneyOut}`,
);

/* -------------------------------- the screens -------------------------- */

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
await page.setViewport({ width: 1800, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const read = async (url) => {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(3000);
  return page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const text = (main.textContent ?? "").replace(/\s+/g, " ");
    return { text, dollars: text.match(/\$[\d,]+\.\d\d/g) ?? [] };
  });
};

const txns = await read(`${WEB}/transactions?accountId=${account.id}`);
check(
  "the transactions cards show a dollar figure at all",
  txns.dollars.length > 0,
  txns.dollars.slice(0, 5).join(" ") || "none on the page",
);
check(
  "and it is $1,500.00 — the sum, not either division",
  txns.dollars.some((d) => d === "$1,500.00"),
  `saw ${txns.dollars.slice(0, 6).join(" ")}; $2,000.00 or $1,000.00 would mean a rate was used`,
);

const dash = await read(`${WEB}/`);
check(
  "the dashboard's account cards show their dollars too",
  dash.dollars.length > 0,
  dash.dollars.slice(0, 6).join(" ") || "none on the page",
);

/* ------------- THE TEST: move the rate, nothing may change ------------- */

const before = { txns: txns.dollars, dash: dash.dollars };
const originalRate = (
  await db.query("select fx_fixed_usd_bdt::text r from app_settings limit 1")
).rows[0]?.r ?? null;
await db.query("update app_settings set fx_fixed_usd_bdt = 999");

const txnsAfter = await read(`${WEB}/transactions?accountId=${account.id}`);
const dashAfter = await read(`${WEB}/`);
check(
  "MOVING THE SETTINGS RATE CHANGES NOTHING on the transactions cards",
  JSON.stringify(txnsAfter.dollars) === JSON.stringify(before.txns),
  `${before.txns.slice(0, 4).join(" ")} -> ${txnsAfter.dollars.slice(0, 4).join(" ")}`,
);
check(
  "nor on the dashboard",
  JSON.stringify(dashAfter.dollars) === JSON.stringify(before.dash),
  `${before.dash.slice(0, 4).join(" ")} -> ${dashAfter.dollars.slice(0, 4).join(" ")}`,
);
await db.query("update app_settings set fx_fixed_usd_bdt = $1", [originalRate]);

/* --------------------- and a taka-only view shows none ----------------- */

const bare = (
  await call("POST", "/accounts", {
    name: "USDQA Taka Only",
    type: "bank",
    currency: "BDT",
    openingBalance: "0.00",
    openingBalanceOn: month + "01",
  })
).body;
await call("POST", "/transactions", {
  direction: "out",
  txnDate: month + "08",
  accountId: bare.id,
  amount: "5000.00",
  categoryId: cat.id,
  description: "USDQA taka only, no dollars recorded",
  paymentMethod: "bank_transfer",
});
const bareSummary = (
  await call(
    "GET",
    `/transactions/summary?from=${month}01&to=${month}28&accountId=${bare.id}`,
  )
).body;
check(
  "a view whose rows carry no dollars gets NO dollar figure, not $0.00",
  bareSummary?.usd === null,
  `usd ${JSON.stringify(bareSummary?.usd)}`,
);

await browser.close();
await db.query("delete from transactions where description like 'USDQA%'");
await db.query("delete from accounts where name like 'USDQA %'");
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
