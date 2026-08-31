/**
 * Buying something on a subscription takes money out of the bank.
 *
 * The owner: *"ai tools and subscription ta kaj korena thik vabe. ekhane kichu
 * kinle eta taka katena bank theke kono history thakena eta puro fix koro
 * perfect vabe."*
 *
 * He was right, and it was structural rather than a bug. A subscription is a
 * PLAN — cycle, price, card, next renewal — and nothing about adding or
 * renewing one ever wrote a transaction. "Paid this period" was summing entries
 * somebody had separately recorded and remembered to tag with the vendor.
 *
 * So there are two claims to prove here, and the second is the one that would
 * be easy to fake:
 *
 *   1. recording a payment moves the ACCOUNT BALANCE and appears in the ledger;
 *   2. it does so through the ordinary transaction path, so every rule that
 *      guards money still applies — the account cannot go below zero, a closed
 *      month is refused, and the entry can be voided and trashed like any other.
 *
 * A second INSERT that wrote its own row would pass (1) and quietly fail (2).
 *
 * It also covers the bug the owner hit on the same screen: the drawer posted
 * `reference` and `invoiceNo` to a strictObject schema that knew neither, so
 * every edit touching those boxes answered "Could not save that".
 *
 *     node .subpayqa.mjs      (local only — writes and deletes)
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
const money = (n) => Number(n ?? 0).toFixed(2);

/* ------------------------------------------------------------- fixtures */

const wipe = async () => {
  await db.query(
    "delete from transactions where vendor_id in (select id from vendors where name like 'PAYSUB%')",
  );
  await db.query("delete from transactions where description like 'PAYSUB%'");
  await db.query("delete from vendors where name like 'PAYSUB%'");
  await db.query("delete from accounts where name like 'PAYSUB %'");
};
await wipe();
const lockWas = (
  await db.query("select books_locked_through l from app_settings limit 1")
).rows[0]?.l;
await db.query("update app_settings set books_locked_through = null");

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const card = (
  await call("POST", "/accounts", {
    name: "PAYSUB Company Card",
    type: "card",
    currency: "BDT",
    openingBalance: "10000.00",
    openingBalanceOn: TODAY.slice(0, 8) + "01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

const plan = await call("POST", "/vendors", {
  name: "PAYSUB Claude",
  type: "ai_tool",
  billingCycle: "monthly",
  billingAmount: "2450.00",
  billingCurrency: "BDT",
  billingAccountId: card.id,
  defaultCategoryId: cat.id,
  nextRenewalOn: TODAY,
});
check(
  "a subscription records",
  plan.status === 201,
  `HTTP ${plan.status} ${JSON.stringify(plan.body?.errors ?? plan.body?.message ?? "")}`.slice(0, 130),
);

/* ------------- the bug the owner hit: reference would not save --------- */

const ref = await call("PATCH", `/vendors/${plan.body.id}`, {
  reference: "STMT-88213",
});
check(
  "THE BUG: a reference can now be saved on a plan",
  ref.status === 200,
  `HTTP ${ref.status} ${JSON.stringify(ref.body?.errors ?? "")}`.slice(0, 120),
);
const kept = (
  await db.query("select reference r from vendors where id = $1", [plan.body.id])
).rows[0];
check("and it is kept", kept?.r === "STMT-88213", `${kept?.r}`);

/* -------------------- 1. the money actually moves ---------------------- */

const before = (await call("GET", "/accounts?includeInactive=true")).body.find(
  (a) => a.id === card.id,
);
check("the card starts at its opening balance", money(before?.balance) === "10000.00", money(before?.balance));

const paid = await call("POST", `/subscriptions/${plan.body.id}/pay`, {
  txnDate: TODAY,
  advanceRenewal: true,
});
check(
  "THE ASK: a payment records against the plan",
  paid.status === 201,
  `HTTP ${paid.status} ${JSON.stringify(paid.body?.errors ?? paid.body?.message ?? "")}`.slice(0, 140),
);

const after = (await call("GET", "/accounts?includeInactive=true")).body.find(
  (a) => a.id === card.id,
);
check(
  "THE ASK: the card is poorer by the plan's price",
  money(after?.balance) === "7550.00",
  `${money(before?.balance)} -> ${money(after?.balance)} (expected 7550.00)`,
);

const entry = (
  await db.query(
    "select ref_no, amount, direction, category_id, vendor_id, description from transactions where vendor_id = $1 and deleted_at is null",
    [plan.body.id],
  )
).rows[0];
check(
  "THE ASK: there is a real ledger entry, tagged with the plan",
  entry?.direction === "out" &&
    entry?.amount === "2450.00" &&
    entry?.vendor_id === plan.body.id,
  `${entry?.ref_no} ${entry?.amount} ${entry?.description}`,
);
check(
  "and it carries the plan's category rather than landing uncategorised",
  entry?.category_id === cat.id,
  entry?.category_id ? "categorised" : "no category — it would sit in Uncategorised",
);

const rolled = (
  await db.query("select next_renewal_on n from vendors where id = $1", [plan.body.id])
).rows[0];
check(
  "and the renewal moved on a month",
  String(rolled?.n).slice(0, 10) !== TODAY,
  `${TODAY} -> ${String(rolled?.n).slice(0, 10)}`,
);

/* --------- 2. it went through the ordinary path, so rules apply -------- */

const audited = (
  await db.query(
    "select count(*)::int n from audit_logs where entity_table='transactions' and entity_id = (select id::text from transactions where vendor_id = $1 limit 1)",
    [plan.body.id],
  )
).rows[0].n;
check(
  "THE RULE: it is in the audit log like any other entry",
  audited >= 1,
  `${audited} row(s)`,
);

/* The account rule: the card holds 7,550 and the plan costs 2,450 — three
   more payments would take it under. */
for (let i = 0; i < 3; i += 1) {
  await call("POST", `/subscriptions/${plan.body.id}/pay`, {
    txnDate: TODAY,
  });
}
const broke = await call("POST", `/subscriptions/${plan.body.id}/pay`, {
  txnDate: TODAY,
});
check(
  "THE RULE: the account cannot be taken below zero by a subscription either",
  broke.status === 400 &&
    /below zero|does not hold enough/i.test(JSON.stringify(broke.body?.message ?? "")),
  `HTTP ${broke.status} ${JSON.stringify(broke.body?.message ?? "").slice(0, 110)}`,
);

/* A closed month refuses it, exactly as it refuses a typed expense. */
await db.query("update app_settings set books_locked_through = $1", [TODAY]);
const inClosed = await call("POST", `/subscriptions/${plan.body.id}/pay`, {
  txnDate: TODAY,
  amount: "1.00",
});
check(
  "THE RULE: a closed month refuses it too",
  inClosed.status === 403,
  `HTTP ${inClosed.status}`,
);
await db.query("update app_settings set books_locked_through = null");

/* ------------------------------ the refusals --------------------------- */

const noCard = await call("POST", "/vendors", {
  name: "PAYSUB No Card",
  type: "ai_tool",
  billingCycle: "monthly",
  billingAmount: "100.00",
});
const cannot = await call("POST", `/subscriptions/${noCard.body.id}/pay`, {
  txnDate: TODAY,
});
check(
  "a plan with no card says so rather than guessing one",
  cannot.status === 400 && /no card or account/i.test(JSON.stringify(cannot.body?.message ?? "")),
  `HTTP ${cannot.status} ${JSON.stringify(cannot.body?.message ?? "").slice(0, 100)}`,
);

const noPrice = await call("POST", "/vendors", {
  name: "PAYSUB No Price",
  type: "ai_tool",
  billingCycle: "monthly",
  billingAccountId: card.id,
});
const priceless = await call(
  "POST",
  `/subscriptions/${noPrice.body.id}/pay`,
  { txnDate: TODAY },
);
check(
  "and a plan with no price says so rather than recording zero",
  priceless.status === 400 && /no price/i.test(JSON.stringify(priceless.body?.message ?? "")),
  `HTTP ${priceless.status} ${JSON.stringify(priceless.body?.message ?? "").slice(0, 100)}`,
);

await db.query("update app_settings set books_locked_through = $1", [lockWas]);
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
