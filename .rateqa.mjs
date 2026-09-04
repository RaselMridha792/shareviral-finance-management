/**
 * A rate on every entry, everywhere.
 *
 * The owner, after finding a dollar card whose balance had not moved in a
 * month:
 *
 *   *"baddhotamulok all transactions er jonne rate bosate hobe. puro
*    application a joto dhoroner transaction a hok na keno manually
 *    prottekbar rate bosate hobe."*
*
 * A row with no rate cannot be read in dollars at all, so it contributes
 * nothing to the account it sits in — which is how ৳56.70 came to sit beside
 * $0.00. The fix is not another fallback; it is that no row is written without
 * one.
 *
 * Nine paths write a ledger row. This drives every one of them through the
 * API and reads the ROW BACK OUT OF THE DATABASE, because a 201 says the
 * request was accepted and says nothing about what landed in the column.
 *
 *     node .rateqa.mjs      (local only — writes and cleans up)
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

const MARK = "RATEQA";
const RATE = "121.50";
const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;

const wipe = async () => {
  await db.query(
    `delete from transactions where description like $1 or notes like $1`,
    [`%${MARK}%`],
  );
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
};
await wipe();

const rateOf = async (like) =>
  (
    await db.query(
      `select description, usd_rate::text r, direction from transactions
        where description like $1 and deleted_at is null order by created_at`,
      [`%${like}%`],
    )
  ).rows;

/* ------------------------------------------------------------- fixtures */

const bank = (
  await call("POST", "/accounts", {
    name: `${MARK} Bank`,
    type: "bank",
    openingBalance: "5000000.00",
    openingBalanceOn: "2026-01-01",
  })
).body;
const bank2 = (
  await call("POST", "/accounts", {
    name: `${MARK} Second`,
    type: "bank",
    openingBalance: "1000000.00",
    openingBalanceOn: "2026-01-01",
  })
).body;
const outCat = (
  await db.query(
    `select id from categories where kind='out' and parent_id is not null
       and is_active and deleted_at is null limit 1`,
  )
).rows[0];

check("two accounts to move money between", Boolean(bank?.id && bank2?.id));

/* ------------------------------- 1. the transaction form (create) ------ */

const noRate = await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: bank.id,
  amount: "1000.00",
  categoryId: outCat.id,
  description: `${MARK} an expense with no rate`,
});
check(
  "an expense with NO rate is refused",
  noRate.status === 400,
  `${noRate.status} ${JSON.stringify(noRate.body?.message ?? "").slice(0, 90)}`,
);

const withRate = await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: bank.id,
  amount: "1000.00",
  categoryId: outCat.id,
  usdRate: RATE,
  description: `${MARK} an expense that states its rate`,
});
check("and one that states it goes through", withRate.status === 201, String(withRate.status));
const expenseRows = await rateOf("an expense that states its rate");
check(
  "the rate is on the row, not only in the request",
  expenseRows[0]?.r === "121.500000",
  `usd_rate=${expenseRows[0]?.r}`,
);

/* ------------------------------- 2. a bank charge inherits ------------- */

await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: bank.id,
  amount: "2000.00",
  categoryId: outCat.id,
  usdRate: RATE,
  chargeAmount: "25.00",
  description: `${MARK} an expense with a bank charge`,
});
const charged = await rateOf("an expense with a bank charge");
check(
  "its bank charge row inherits the same rate",
  charged.length === 2 && charged.every((r) => r.r === "121.500000"),
  charged.map((r) => r.r).join(" / "),
);

/* ------------------------------- 3. money transfer -------------------- */

const transferNoRate = await call("POST", "/transactions/transfer", {
  txnDate: TODAY,
  fromAccountId: bank.id,
  toAccountId: bank2.id,
  amount: "5000.00",
  description: `${MARK} a transfer with no rate`,
  paymentMethod: "bank_transfer",
});
check(
  "a taka-to-taka transfer with NO rate is refused",
  transferNoRate.status === 400,
  String(transferNoRate.status),
);

const transfer = await call("POST", "/transactions/transfer", {
  txnDate: TODAY,
  fromAccountId: bank.id,
  toAccountId: bank2.id,
  amount: "5000.00",
  usdRate: RATE,
  description: `${MARK} a transfer that states its rate`,
  paymentMethod: "bank_transfer",
});
check("and one that states it goes through", transfer.status === 201, String(transfer.status));
const transferRows = await rateOf("a transfer that states its rate");
check(
  "BOTH halves carry it — the paying side and the receiving side",
  transferRows.length === 2 && transferRows.every((r) => r.r === "121.500000"),
  transferRows.map((r) => `${r.direction}=${r.r}`).join(" "),
);

/* ------------------------------- 4. cash in --------------------------- */

const cashIn = await call("POST", "/transactions/cash-in", {
  txnDate: TODAY,
  accountId: bank.id,
  amount: "10000.00",
  usdRate: RATE,
  description: `${MARK} funding that states its rate`,
});
check("cash in still goes through", cashIn.status === 201, String(cashIn.status));
const cashRows = await rateOf("funding that states its rate");
check(
  "and the funding row carries the rate",
  cashRows[0]?.r === "121.500000",
  `usd_rate=${cashRows[0]?.r}`,
);

/* ------------------------------- 5. a subscription payment ------------ */

/*
 * A plan states the rate its dollar price was struck at, so this payment is
 * the one place a rate is pre-filled rather than typed from nothing. What
 * matters is that the ROW carries one either way — before this change the
 * stamp was conditional, and a plan without a rate wrote a rateless expense.
 */
const plan = (
  await call("POST", "/subscriptions", {
    toolName: `${MARK} Tool`,
    planName: "Team",
    category: "ai_tool",
    costUsd: "20.00",
    costBdt: "2430.00",
    usdRate: "121.500000",
    billingCycle: "monthly",
    startDate: TODAY,
    accountId: bank.id,
    status: "active",
  })
).body;
check("a plan to pay for", Boolean(plan?.id), plan?.id ? "created" : JSON.stringify(plan).slice(0, 140));

if (plan?.id) {
  const paid = await call("POST", `/subscriptions/${plan.id}/pay`, {
    txnDate: TODAY,
    note: `${MARK} a subscription payment`,
  });
  check("paying a plan goes through on the plan's own rate", paid.status === 201,
    String(paid.status));
  const subRows = (
    await db.query(
      `select usd_rate::text r from transactions
        where subscription_id = $1 and deleted_at is null`,
      [plan.id],
    )
  ).rows;
  check(
    "and the expense it wrote carries that rate",
    subRows.length > 0 && subRows.every((r) => r.r === "121.500000"),
    subRows.map((r) => r.r ?? "MISSING").join(" ") || "no row",
  );

  const typed = await call("POST", `/subscriptions/${plan.id}/pay`, {
    txnDate: TODAY,
    usdRate: "130.00",
    note: `${MARK} a payment at another rate`,
  });
  const typedRow = (
    await db.query(
      `select usd_rate::text r from transactions
        where subscription_id = $1 and description like $2 and deleted_at is null`,
      [plan.id, `%another rate%`],
    )
  ).rows[0];
  check(
    "a rate typed on the drawer beats the plan's",
    typed.status === 201 && typedRow?.r === "130.000000",
    `${typed.status} usd_rate=${typedRow?.r}`,
  );
}

/* ------------------------------- 6. paying a payroll run -------------- */

/*
 * No run is built here — that needs a month of staff and a finalised sheet.
 * What is asserted is the thing this change added: the CONTRACT refuses a
 * payment that does not state a rate, and it refuses it before it ever looks
 * up the run, so the refusal does not depend on the fixture.
 */
const runPayNoRate = await call(
  "POST",
  "/payroll/runs/00000000-0000-0000-0000-000000000000/pay",
  {
    paymentDate: TODAY,
    accountId: bank.id,
    paymentMode: "consolidated",
  },
);
check(
  "paying a run with NO rate is refused by the contract",
  runPayNoRate.status === 400,
  `${runPayNoRate.status} ${JSON.stringify(runPayNoRate.body?.errors ?? "").slice(0, 80)}`,
);

/* ------------------------------- 5. what the SCREENS now demand ------- */

console.log("\n  and the forms behind them:");
const forms = [
  ["apps/web/src/components/ledger/transaction-form.tsx", 'name="usdRate"'],
  ["apps/web/src/components/ledger/transfer-form.tsx", "usdRate: usdRate.trim()"],
  ["apps/web/src/components/accounts/cash-in-form.tsx", 'name="usdRate"'],
  ["apps/web/src/components/subscriptions/pay-dialog.tsx", 'name="usdRate"'],
  ["apps/web/src/components/payroll/salary-sheet-screen.tsx", 'name="usdRate"'],
  ["apps/web/src/components/imports/import-screen.tsx", 'name="usdRate"'],
];
for (const [file, needle] of forms) {
  const src = fs.readFileSync(file, "utf8");
  const has = src.includes(needle);
  /* `required` on the input itself, not merely on the Field's asterisk. */
  const NAME = 'name=' + JSON.stringify("usdRate");
  const idx = src.indexOf(NAME);
  const requiredNearby =
    idx >= 0 && src.slice(idx, idx + 220).includes("required");
  const wantsBox = needle.startsWith("name");
  check(
    `${file.split("/").pop()} asks for a rate${wantsBox ? ", required" : ""}`,
    has && (wantsBox ? requiredNearby : true),
    has ? (wantsBox ? `required=${requiredNearby}` : "sends it") : "no box",
  );
}

/* ------------------------------- 7. nothing is left rateless ---------- */

const written = (
  await db.query(
    `select count(*)::int n from transactions
      where description like $1 and deleted_at is null and usd_rate is null`,
    [`%${MARK}%`],
  )
).rows[0].n;
check("not one row this run wrote is missing its rate", written === 0, `${written} rateless`);

const all = (
  await db.query(
    `select description, direction, amount::text, usd_rate::text r
       from transactions where description like $1 and deleted_at is null
      order by created_at`,
    [`%${MARK}%`],
  )
).rows;
console.log("\n  every row this run wrote:");
for (const r of all) {
  console.log(
    `    ${r.description.replace(MARK + " ", "").padEnd(40).slice(0, 40)} ${r.direction.padEnd(3)} ` +
      `${String(r.amount).padStart(11)}   rate=${r.r ?? "MISSING"}`,
  );
}

await wipe();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n  " + "=".repeat(72));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
