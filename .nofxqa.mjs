/**
 * A report's dollars come from the rows, and from nothing else.
 *
 * The owner: *"report ta calculate hobe kono fx rate theke na, karon prottekta
 * transaction a manual dollar type er option ache."*
 *
 * The test that matters is not "does it show a number" — it is **does the
 * number move when the rate does**. That is what a governing rate did: a month
 * funded at 118.00 and read back at 122.50 reported dollars nobody ever had,
 * and they changed whenever somebody edited a box in Settings. So this records
 * a period, reads its dollars, moves the stored rate a long way, and reads
 * again. Anything that moved was being converted.
 *
 *     node .nofxqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = "http://localhost:4001/api";
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

const wipe = async () => {
  await db.query("delete from transactions where description like 'NOFXQA%'");
  await db.query("delete from accounts where name like 'NOFXQA %'");
};
await wipe();
const rateWas = (
  await db.query("select fx_fixed_usd_bdt r from app_settings limit 1")
).rows[0]?.r;

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const MONTH_START = TODAY.slice(0, 8) + "01";

const account = (
  await call("POST", "/accounts", {
    name: "NOFXQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "0.00",
    openingBalanceOn: MONTH_START,
  })
).body;

/* Money in, WITH the dollars typed on it — the manual figure the owner means. */
const funding = await call("POST", "/transactions/cash-in", {
  txnDate: TODAY,
  accountId: account.id,
  amount: "1180000.00",
  description: "NOFXQA funding with dollars typed",
  usdSent: "10000.00",
  usdRate: "118.00",
});
check("money in, with its dollars", funding.status === 201, `HTTP ${funding.status}`);

const overview = async () => (await call("GET", "/reports/overview")).body;

const before = await overview();
check(
  "the dollar total is what was typed on the row",
  before?.usdTotals?.moneyIn === "10000.00",
  `${before?.usdTotals?.moneyIn} (expected 10000.00)`,
);
/*
 * Checked against the database rather than assumed. The open month is not
 * empty — dev data and earlier harnesses have left rows in it — so "exact"
 * depends on whether ANY live row this month lacks a dollar figure. Asserting
 * `true` outright made this file demand a clean month it has no right to.
 */
const blindRows = (
  await db.query(
    `select count(*)::int n from transactions
      where txn_date between $1 and (date_trunc('month', $1::date) + interval '1 month - 1 day')::date
        and voided_at is null and deleted_at is null and transfer_group_id is null
        and (original_currency is distinct from 'USD' or original_amount is null)`,
    [MONTH_START],
  )
).rows[0].n;
check(
  "exact says what the data says: true only when every row carried a figure",
  before?.usdExact === (blindRows === 0),
  `usdExact ${before?.usdExact}, rows with no dollars: ${blindRows}`,
);

/* ------------- THE TEST: move the rate a long way, and look ------------- */

await db.query("update app_settings set fx_fixed_usd_bdt = '150.000000'");
const after = await overview();
check(
  "THE RULE: moving the stored rate does not move the dollars",
  after?.usdTotals?.moneyIn === before?.usdTotals?.moneyIn,
  `${before?.usdTotals?.moneyIn} -> ${after?.usdTotals?.moneyIn}`,
);
check(
  "and the taka is untouched too",
  after?.totals?.moneyIn === before?.totals?.moneyIn,
  `${before?.totals?.moneyIn} -> ${after?.totals?.moneyIn}`,
);

/* -------- a row with no dollars lowers the total and marks it ---------- */

const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];
const blind = await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: account.id,
  amount: "50000.00",
  categoryId: cat.id,
  description: "NOFXQA spend with no dollars typed",
  paymentMethod: "bank_transfer",
});
check("an expense with no dollar figure records", blind.status === 201, `HTTP ${blind.status}`);

const mixed = await overview();
check(
  "THE RULE: a row with no dollars makes the total approximate, not wrong",
  mixed?.usdExact === false,
  `usdExact ${mixed?.usdExact}`,
);
check(
  "and it contributes nothing rather than an invented figure",
  mixed?.usdTotals?.moneyOut === "0.00",
  `moneyOut ${mixed?.usdTotals?.moneyOut} (expected 0.00 — nothing was typed in dollars)`,
);

/* ------- what cannot be summed has no dollar view, rather than a made-up one ---- */

check(
  "salary has no dollar figure, because no payroll row carries one",
  mixed?.expense?.usd?.salaryPaid === null,
  `${JSON.stringify(mixed?.expense?.usd?.salaryPaid)}`,
);
check(
  "and neither does tax withheld",
  mixed?.expense?.usd?.taxWithheld === null,
  `${JSON.stringify(mixed?.expense?.usd?.taxWithheld)}`,
);

/* ---------------------- and Settings has no rate tab ------------------- */

const settingsFile = fs.readFileSync(
  "apps/web/src/components/settings/settings-screen.tsx",
  "utf8",
);
check(
  'THE ASK: Settings no longer offers an "Exchange rate" tab',
  !settingsFile.includes('label: "Exchange rate"'),
  "",
);

/* The recorded history is NOT destroyed. */
const history = (
  await db.query("select count(*)::int n from fx_rates")
).rows[0].n;
check(
  "the rates the owner recorded are still there — nothing was thrown away",
  Number.isInteger(history),
  `${history} row(s) kept in fx_rates`,
);

await db.query("update app_settings set fx_fixed_usd_bdt = $1", [rateWas]);
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
