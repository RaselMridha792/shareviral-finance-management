/**
 * A dollar CARD's balance, and every way money reaches it.
 *
 * The owner, on the Accounts screen, pointing at the Payoneer card reading
 * `~$1,500.00`:
 *
 *   *"ekhane money add korle change hoyna dollar ammount ta. also jodi ami kono
 *    kichu khoroco kori amount change hoyna. eta diye ai subscription kinlam
 *    tao dekhi 1500 dollar e thake."*
 *
 * Three routes, one figure. A foreign account's balance ON SCREEN is stated in
 * its own currency, and `AccountsService.ownCurrencyBalance` builds it from
 * each row's `original_amount`, or failing that from the row's own rate — a row
 * carrying NEITHER contributes exactly zero and the figure stands still while
 * the taka underneath it moves. So this drives all three doors and reads the
 * SCREEN's own balances endpoint after each, rather than summing anything
 * itself.
 *
 * The `~` on his card is the other half of the report: it is the app saying
 * the dollar figure is an estimate. That is `ownBalanceExact`, and it is
 * checked here too — a figure that is right by accident is not right.
 *
 *     node .carddollarqa.mjs      (local only — writes and deletes)
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
const call = async (method, path_, body) => {
  const res = await fetch(API + path_, {
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

const MARK = "CDQA";
const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;

const wipe = async () => {
  await db.query(
    "delete from transactions where subscription_id in (select id from subscriptions where tool_name like $1)",
    [`${MARK}%`],
  );
  await db.query("delete from subscriptions where tool_name like $1", [`${MARK}%`]);
  await db.query(
    "delete from transactions where charge_for_id in (select id from transactions where description like $1)",
    [`%${MARK}%`],
  );
  await db.query("delete from transactions where description like $1", [`%${MARK}%`]);
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
  await db.query(
    "delete from fx_rates where rate_date = '2026-01-01' and rate = '122.770000'",
  );
};
await wipe();

/* His card, as the screen describes it: a USD CARD opened at nothing. */
const card = (
  await call("POST", "/accounts", {
    name: `${MARK} Payoneer`,
    type: "card",
    currency: "USD",
    openingBalance: "0.00",
    openingBalanceUsd: "0.00",
    openingBalanceOn: "2026-06-01",
  })
).body;
check(
  "a dollar card exists, opened at nothing",
  card?.currency === "USD" && card?.type === "card",
  `${card?.type} in ${card?.currency}`,
);

const shown = async () => {
  const b = await call("GET", "/accounts/balances");
  const row = (b.body?.accounts ?? []).find((a) => a.id === card.id);
  return {
    usd: Number(row?.ownBalance ?? 0),
    bdt: Number(row?.balance ?? 0),
    exact: row?.ownBalanceExact,
  };
};

const outCat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/*
 * A rate on file, because the live system has one and this database did not.
 *
 * The last-resort branch of the balance reads the rate in force on a row's own
 * day, so with an EMPTY fx_rates table it correctly contributes nothing — and
 * the first run of this reported the fix not working when what was missing was
 * the rate. Seeded here and removed with the rest of the fixtures.
 */
const seededRate = (
  await db.query(
    `insert into fx_rates (base_currency, quote_currency, rate, rate_date, source, created_by)
     values ('USD','BDT','122.770000', $1, 'manual', $2)
     returning id`,
    ["2026-01-01", person.id],
  )
).rows[0];
check(
  "the company has a rate on file, as the live one does",
  Boolean(seededRate?.id),
  "USD/BDT 122.77 from 2026-01-01",
);

/* ------------------------------------------- 1. money in, through Cash In */

const a = await shown();
const wire = await call("POST", "/transactions/cash-in", {
  txnDate: TODAY,
  accountId: card.id,
  amount: "245540.00",
  usdSent: "2000.00",
  usdRate: "122.77",
  description: `${MARK} funding onto the card`,
  paymentMethod: "bank_transfer",
});
const b = await shown();
check(
  "money in: the taka moves",
  (b.bdt - a.bdt).toFixed(2) === "245540.00",
  `৳${a.bdt} → ৳${b.bdt} (HTTP ${wire.status})`,
);
check(
  "money in: the DOLLAR figure moves too",
  (b.usd - a.usd).toFixed(2) === "2000.00",
  `$${a.usd} → $${b.usd}`,
);

/* ------------------------------------------------- 2. an ordinary expense */

const spend = await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: card.id,
  amount: "12277.00",
  categoryId: outCat.id,
  description: `${MARK} an expense on the card`,
  paymentMethod: "card",
  originalAmount: "100.00",
  originalCurrency: "USD",
  fxRate: "122.77",
});
const c = await shown();
check(
  "spending with its dollars recorded moves the dollar figure",
  (b.usd - c.usd).toFixed(2) === "100.00",
  `$${b.usd} → $${c.usd} (HTTP ${spend.status})`,
);

/*
 * The same expense with NO dollars and NO rate — which is what a row typed on
 * any screen that does not ask for them looks like.
 */
const bare = await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: card.id,
  amount: "6138.50",
  categoryId: outCat.id,
  description: `${MARK} an expense with no dollars stated`,
  paymentMethod: "card",
});
const d = await shown();
check(
  "an expense with no dollars still moves the taka",
  (c.bdt - d.bdt).toFixed(2) === "6138.50",
  `৳${c.bdt} → ৳${d.bdt} (HTTP ${bare.status})`,
);
/* THE COMPLAINT. ৳6,138.50 at the rate in force that day is $50.00. */
check(
  "THE COMPLAINT: an expense with no dollars still moves the dollar figure",
  (c.usd - d.usd).toFixed(2) === "50.00",
  `$${c.usd} → $${d.usd} — moved by ${(c.usd - d.usd).toFixed(2)}, expected 50.00 at 122.77`,
);
check(
  "and the app says whether the figure is a record or an estimate",
  d.exact === false,
  `exact ${d.exact}`,
);

/* ------------------------------------------ 3. an AI subscription payment */

const planWithRate = (
  await call("POST", "/subscriptions", {
    toolName: `${MARK} Claude with a rate`,
    planName: "Max",
    category: "ai_tool",
    status: "active",
    costUsd: "100.00",
    usdRate: "122.77",
    costBdt: "12277.00",
    billingCycle: "monthly",
    startDate: TODAY,
    accountId: card.id,
    paymentMethod: "card",
  })
).body;
/* Creating a plan does not move money — the FORM takes the first payment as a
   second call. Driven the same way here, or the check measures nothing. */
await call("POST", `/subscriptions/${planWithRate.id}/pay`, { txnDate: TODAY });
const e = await shown();
check(
  "buying a plan takes its first payment out in taka",
  (d.bdt - e.bdt).toFixed(2) === "12277.00",
  `৳${d.bdt} → ৳${e.bdt}`,
);
check(
  "and out of the DOLLAR figure as well",
  (d.usd - e.usd).toFixed(2) === "100.00",
  `$${d.usd} → $${e.usd}`,
);

/*
 * A plan with NO rate on it. `payForSubscription` needs one to state the
 * dollars, so this is the case where a subscription payment could still leave
 * the card's dollar figure standing still.
 */
const planNoRate = (
  await call("POST", "/subscriptions", {
    toolName: `${MARK} Tool with no rate`,
    planName: "Basic",
    category: "ai_tool",
    status: "active",
    costUsd: "50.00",
    costBdt: "6138.50",
    billingCycle: "monthly",
    startDate: TODAY,
    accountId: card.id,
    paymentMethod: "card",
  })
).body;
await call("POST", `/subscriptions/${planNoRate.id}/pay`, { txnDate: TODAY });
const f = await shown();
check(
  "a plan with no rate on it is still created",
  Boolean(planNoRate?.id),
  planNoRate?.id ? `rate ${JSON.stringify(planNoRate?.usdRate)}` : JSON.stringify(planNoRate).slice(0, 140),
);
check(
  "its payment takes taka out",
  (e.bdt - f.bdt).toFixed(2) === "6138.50",
  `৳${e.bdt} → ৳${f.bdt}`,
);
check(
  "THE OTHER HALF: does a rate-less plan move the dollar figure?",
  (e.usd - f.usd).toFixed(2) !== "0.00",
  `$${e.usd} → $${f.usd} — moved by ${(e.usd - f.usd).toFixed(2)}`,
);

/* ------------------------------------ 4. a bank charge, which we write ---- */

await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: card.id,
  amount: "1000.00",
  categoryId: outCat.id,
  description: `${MARK} an expense that carried a bank charge`,
  paymentMethod: "card",
  originalAmount: "8.15",
  originalCurrency: "USD",
  fxRate: "122.77",
  chargeAmount: "245.54",
});
const g = await shown();
check(
  "a bank charge takes taka out",
  (f.bdt - g.bdt).toFixed(2) === "1245.54",
  `৳${f.bdt} → ৳${g.bdt}`,
);
check(
  "and the charge moves the dollar figure too, not only the expense it sat on",
  (f.usd - g.usd).toFixed(2) !== "8.15",
  `$${f.usd} → $${g.usd} — moved by ${(f.usd - g.usd).toFixed(2)}, the expense alone was 8.15`,
);

/* What the rows actually carry, which is the whole explanation. */
const rows = (
  await db.query(
    `select description, amount::text, original_amount::text, original_currency,
            fx_rate::text, usd_rate::text
       from transactions
      where account_id=$1 and deleted_at is null
      order by created_at`,
    [card.id],
  )
).rows;
console.log("\n  what each row carries:");
for (const r of rows) {
  console.log(
    `    ${String(r.description).padEnd(44).slice(0, 44)} ৳${String(r.amount).padStart(11)}  ` +
      `usd=${r.original_amount ?? "-"}  fx=${r.fx_rate ?? "-"}  ref=${r.usd_rate ?? "-"}`,
  );
}

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
