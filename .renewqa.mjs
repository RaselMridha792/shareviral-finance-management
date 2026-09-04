/**
 * A renewal is not billed at the rate the plan was signed at.
 *
 * The owner, on the Record-a-payment drawer:
 *
 *   *"renew er ekhane bank charge ane diyo. also usd bdt and usd rate sobgula
 *    field e aino. karon prottek renewal a rate soman thakena."*
 *
 * The drawer used to ask for taka and a rate. So a $100 plan signed at 120
 * and renewed three months later at 128 either went in at the old rate, or
 * somebody multiplied it in their head. Now the drawer asks for all three —
 * dollars, rate, taka — with the taka worked out from the two above it and
 * still typeable, and it carries a bank charge like every other money form.
 *
 * Every figure here is read BACK OUT OF THE TABLE. A 201 says the request was
 * accepted and says nothing about what landed in the columns.
 *
 *     node .renewqa.mjs      (local only — writes and cleans up)
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
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
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
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const MARK = "RENEWQA";
const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;

const wipe = async () => {
  /* Charge rows point at the entry that incurred them, so they go first —
     a parent deleted underneath one violates the foreign key. */
  await db.query(
    `delete from transactions where charge_for_id in
       (select id from transactions where subscription_id in
          (select id from subscriptions where tool_name like $1))`,
    [`${MARK}%`],
  );
  await db.query(
    `delete from transactions where subscription_id in
       (select id from subscriptions where tool_name like $1)`,
    [`${MARK}%`],
  );
  await db.query(
    `delete from transactions where description like $1 or notes like $1`,
    [`%${MARK}%`],
  );
  await db.query("delete from subscriptions where tool_name like $1", [
    `${MARK}%`,
  ]);
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
};
await wipe();

/* ------------------------------------------------------------- fixtures */

/* A dollar card, so the "did the card's own balance move" question is real. */
const card = (
  await call("POST", "/accounts", {
    name: `${MARK} Exprovia card`,
    type: "card",
    currency: "USD",
    /* Funded, or the overdraft guard refuses every renewal below and the
       whole run measures that guard instead of this drawer. */
    openingBalance: "500000.00",
    openingBalanceUsd: "4000.00",
    openingBalanceOn: "2026-01-01",
  })
).body;

/* $100 a month, signed at 120.00 — so the plan's taka price is 12,000. */
const plan = (
  await call("POST", "/subscriptions", {
    toolName: `${MARK} Claude`,
    planName: "Team",
    category: "ai_tool",
    costUsd: "100.00",
    costBdt: "12000.00",
    usdRate: "120.000000",
    billingCycle: "monthly",
    startDate: "2026-01-01",
    accountId: card.id,
    status: "active",
  })
).body;
check(
  "a $100 plan signed at 120, on a dollar card",
  Boolean(plan?.id) && plan?.usdRate === "120.000000",
  plan?.id ? `costBdt=${plan.costBdt} rate=${plan.usdRate}` : JSON.stringify(plan).slice(0, 180),
);

const paymentsOf = async () =>
  (
    await db.query(
      `select t.id, t.description, t.amount::text amount,
              t.original_amount::text usd, t.fx_rate::text fx,
              t.usd_rate::text rate, t.charge_for_id, c.name category
         from transactions t
         left join categories c on c.id = t.category_id
        where (t.subscription_id = $1 or t.charge_for_id in
                (select id from transactions where subscription_id = $1))
          and t.deleted_at is null
        order by t.created_at`,
      [plan.id],
    )
  ).rows;

const cardBalance = async () => {
  const b = await call("GET", "/accounts/balances");
  const row = (b.body?.accounts ?? []).find((a) => a.id === card.id);
  return { usd: Number(row?.ownBalance ?? 0), bdt: Number(row?.balance ?? 0) };
};

/* ----------------------- 1. a renewal at the usual rate ---------------- */

const plain = await call("POST", `/subscriptions/${plan.id}/pay`, {
  txnDate: TODAY,
  note: `${MARK} January, nothing typed`,
});
let rows = await paymentsOf();
check(
  "a renewal with nothing typed goes through",
  plain.status === 201,
  String(plain.status),
);
check(
  "at the plan's own price, rate and dollars",
  rows.length === 1 &&
    rows[0].amount === "12000.00" &&
    rows[0].usd === "100.00" &&
    rows[0].rate === "120.000000",
  rows[0] &&
    `৳${rows[0].amount} = $${rows[0].usd} @ ${rows[0].rate}`,
);

let bal = await cardBalance();
check(
  "and the card's own dollar balance moved by the dollars",
  bal.usd.toFixed(2) === "3900.00",
  `$${bal.usd.toFixed(2)} — opened at $4,000.00`,
);

/* --------- 2. THE COMPLAINT: a renewal at a rate that has moved -------- */

const moved = await call("POST", `/subscriptions/${plan.id}/pay`, {
  txnDate: TODAY,
  usdAmount: "100.00",
  usdRate: "128.50",
  note: `${MARK} April, the rate has moved`,
});
rows = await paymentsOf();
const atMoved = rows.find((r) => r.description.includes("the rate has moved"));
check(
  "a renewal at a different rate is accepted",
  moved.status === 201,
  String(moved.status),
);
check(
  "and the taka follows THAT rate, not the plan's",
  atMoved?.amount === "12850.00" && atMoved?.rate === "128.500000",
  `৳${atMoved?.amount} @ ${atMoved?.rate} — the plan's rate would have said 12000.00`,
);
check(
  "the dollars are still $100 — the price did not change, the rate did",
  atMoved?.usd === "100.00" && atMoved?.fx === "128.500000",
  `$${atMoved?.usd} fx=${atMoved?.fx}`,
);

/* ------------------ 3. a bank charge, as its own row ------------------- */

const charged = await call("POST", `/subscriptions/${plan.id}/pay`, {
  txnDate: TODAY,
  usdAmount: "100.00",
  usdRate: "125.00",
  chargeAmount: "230.00",
  note: `${MARK} July, with a bank fee`,
});
rows = await paymentsOf();
/*
 * By shape, not by text. The charge row's description is built from the
 * payment's — "Bank charge — Claude — … with a bank fee" — so matching on the
 * note finds the charge first and the payment never.
 */
const payment = rows.find(
  (r) => !r.charge_for_id && r.description.includes("with a bank fee"),
);
const fee = rows.find((r) => r.charge_for_id === payment?.id);
check(
  "a renewal carrying a bank charge is accepted",
  charged.status === 201,
  String(charged.status),
);
check(
  "the charge is its OWN row, tied to the payment",
  Boolean(fee) && fee?.amount === "230.00",
  fee ? `৳${fee.amount} charge_for=${fee.charge_for_id === payment.id}` : "no charge row",
);
check(
  "filed under Bank charges, not under the tool",
  /bank charge/i.test(String(fee?.category ?? "")),
  `category=${fee?.category}`,
);
check(
  "and it is NOT folded into the payment's own amount",
  payment?.amount === "12500.00",
  `৳${payment?.amount} — $100 at 125, the fee sits beside it`,
);
check(
  "the charge row inherits the payment's rate",
  fee?.rate === "125.000000",
  `usd_rate=${fee?.rate}`,
);

/* ---------------- 4. a typed taka beats the arithmetic ----------------- */

const typed = await call("POST", `/subscriptions/${plan.id}/pay`, {
  txnDate: TODAY,
  usdAmount: "100.00",
  usdRate: "125.00",
  amount: "12750.00",
  note: `${MARK} October, the card took something else`,
});
rows = await paymentsOf();
const odd = rows.find((r) => r.description.includes("took something else"));
check(
  "a typed taka figure wins over the product",
  typed.status === 201 && odd?.amount === "12750.00",
  `৳${odd?.amount} — the product would have been 12500.00`,
);
check(
  "and the dollars are still stated beside it",
  odd?.usd === "100.00" && odd?.rate === "125.000000",
  `$${odd?.usd} @ ${odd?.rate}`,
);

/* ------------------------- what the card now holds --------------------- */

bal = await cardBalance();
/*
 * Every row it wrote, the bank charge included. The charge states no dollars —
 * it is a taka fee — so the card reads it back at the rate on the row, which is
 * the rate the payment beside it was billed at. ৳230 at 125 is $1.84, and that
 * is $1.84 genuinely gone off the card.
 */
const takenInUsd = rows.reduce(
  (n, r) =>
    n + (r.usd !== null ? Number(r.usd) : Number(r.amount) / Number(r.rate)),
  0,
);
check(
  "the card's dollar balance is the opening less everything taken off it",
  bal.usd.toFixed(2) === (4000 - takenInUsd).toFixed(2),
  `$${bal.usd.toFixed(2)} vs $${(4000 - takenInUsd).toFixed(2)} — $400 of plans and ${(
    Number(fee?.amount ?? 0) / Number(fee?.rate ?? 1)
  ).toFixed(2)} of bank charge`,
);

console.log("\n  every row these renewals wrote:");
for (const r of rows) {
  console.log(
    `    ${r.description.replace(MARK + " ", "").padEnd(46).slice(0, 46)}` +
      ` ৳${String(r.amount).padStart(10)}  $${String(r.usd ?? "—").padStart(7)}` +
      `  @${String(r.rate ?? "—").padStart(11)}${r.charge_for_id ? "   (bank charge)" : ""}`,
  );
}
console.log(
  `    card: ৳${bal.bdt.toFixed(2)}   $${bal.usd.toFixed(2)}`,
);

/* ----------------------------- and the drawer -------------------------- */

const drawer = fs.readFileSync(
  "apps/web/src/components/subscriptions/pay-dialog.tsx",
  "utf8",
);
for (const [what, needle] of [
  ["a dollars box", 'name="usdAmount"'],
  ["a rate box", 'name="usdRate"'],
  ["a taka box", 'name="amount"'],
  ["a bank charge box", 'name="chargeAmount"'],
]) {
  check(`the drawer has ${what}`, drawer.includes(needle), needle);
}
check(
  "and the taka follows the two above it until it is typed in",
  drawer.includes("const shownBdt = bdtTouched ? typedBdt : derivedBdt;"),
  "derived until touched",
);

await wipe();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(76));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
      failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
