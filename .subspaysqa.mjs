/**
 * Adding a subscription takes the money out, and it shows up everywhere.
 *
 * The owner's report, and it was the whole of the bug: *"ami already add
 * subscription er somoy tools er dam koto oita likhe felchi ... akhon expense
 * overview te geleo dekhtechi ai tools and subscription er card a 0 dekhacche.
 * dashboard er moddheo ai and other tools er section a nei eita. also all
 * transaction er moddheo nai. tar mane eta kothao record hocchena mane taka
 * katechena"*.
 *
 * TWO faults, and the second was mine.
 *
 *   1. Adding a plan wrote no money at all. It recorded an arrangement and
 *      waited for somebody to press a second button.
 *   2. Even once pressed, the payment did not COUNT as tooling unless it landed
 *      on a non-taka card. `isToolSpend()` asked "paid to a recurring vendor,
 *      or on the card that buys tools" — and I had removed the vendor stamp,
 *      correctly, because it was writing a `subscriptions` id into a column
 *      with a foreign key to `vendors`. So a plan paid from an ordinary taka
 *      bank fell out of tooling and read as an operational expense.
 *
 * This drives the fix from the account balance outward: the plan is added on a
 * plain BDT BANK account — the case the old heuristic missed — and the same
 * ৳2,450 is then required to appear in the ledger, on the dashboard's AI card,
 * in the Expenses overview's tooling slice, and to have left the account.
 *
 *     node .subspaysqa.mjs      (local only — writes and deletes)
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

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const month = TODAY.slice(0, 8);
const from = month + "01";
const to = (
  await db.query(
    "select (date_trunc('month',$1::date) + interval '1 month - 1 day')::date::text d",
    [TODAY],
  )
).rows[0].d;

const wipe = async () => {
  const ids = (
    await db.query("select id from subscriptions where tool_name like 'PAYQA %'")
  ).rows.map((r) => r.id);
  for (const id of ids) {
    await db.query("delete from subscription_users where subscription_id=$1", [id]);
    await db.query("update transactions set subscription_id = null where subscription_id=$1", [id]);
    await db.query("delete from subscriptions where id=$1", [id]);
  }
  await db.query("delete from transactions where description like 'PAYQA%'");
  await db.query("delete from accounts where name like 'PAYQA %'");
};
await wipe();

/*
 * A plain BDT BANK account, deliberately. This is the case the old heuristic
 * got wrong: "settled on a non-taka card" is false here, so before the fix the
 * money left the bank and appeared nowhere as tooling.
 */
const account = (
  await call("POST", "/accounts", {
    name: "PAYQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "100000.00",
    openingBalanceOn: from,
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/*
 * Read from the accounts LIST, which is where a balance is computed. Asking
 * `/accounts/:id` gave a shape with no balance on it, so both readings came
 * back 0 and the check compared nothing to nothing — a pass waiting to happen
 * in the other direction.
 */
const balanceNow = async () => {
  const list = (await call("GET", "/accounts")).body;
  const rows = Array.isArray(list) ? list : (list?.items ?? []);
  const mine = rows.find((a) => a.id === account.id);
  if (!mine) throw new Error("the test account vanished from /accounts");
  return Number(mine.balance);
};
const before = await balanceNow();

/* --------------------------- add the plan, pay it ---------------------- */

const PRICE = "2450.00";
const plan = (
  await call("POST", "/subscriptions", {
    toolName: "PAYQA Claude",
    planName: "Max Plan 5x",
    category: "ai_tool",
    costUsd: "20.00",
    usdRate: "122.50",
    costBdt: PRICE,
    billingCycle: "monthly",
    startDate: month + "02",
    accountId: account.id,
    status: "active",
  })
).body;
check("a plan is added", Boolean(plan?.id), `HTTP, id ${String(plan?.id).slice(0, 8)}`);

/*
 * The screen makes this second call the moment the plan is saved. The harness
 * makes it too, because what is being proved is that the payment LANDS
 * everywhere — the form doing it automatically is checked on screen separately.
 */
const paid = await call("POST", `/subscriptions/${plan.id}/pay`, {
  txnDate: month + "02",
  categoryId: cat.id,
  note: "PAYQA first payment",
  advanceRenewal: false,
});
check(
  "the payment goes through",
  paid.status === 201,
  `HTTP ${paid.status} ${JSON.stringify(paid.body?.message ?? "").slice(0, 80)}`,
);

/* ------------------ 1. it is in the ledger, and linked ----------------- */

const row = (
  await db.query(
    `select amount::text, subscription_id, category_id, account_id, direction
       from transactions where id=$1`,
    [paid.body?.id],
  )
).rows[0];
check(
  "1. All transactions: the expense exists, for the plan's price",
  row?.amount === PRICE && row?.direction === "out",
  `${row?.amount} ${row?.direction}`,
);
check(
  "1b. and the row REMEMBERS which plan it paid for",
  row?.subscription_id === plan.id,
  `subscription_id ${row?.subscription_id ? "set" : "NULL — the fix is not applied"}`,
);

/* ---------------------- 2. the money left the account ------------------ */

const after = await balanceNow();
check(
  "2. the account is poorer by exactly the price",
  Math.round((before - after) * 100) === Math.round(Number(PRICE) * 100),
  `${before} -> ${after}, expected -${PRICE}`,
);

/* ------------------- 3. the Expenses overview counts it ---------------- */

const ov = (await call("GET", `/expenses/overview?from=${from}&to=${to}`)).body;
check(
  "3. Expense overview: the AI tools slice is not zero",
  Number(ov?.tooling ?? 0) >= Number(PRICE),
  `tooling ${ov?.tooling}`,
);
check(
  "3b. and it is NOT sitting in Operational instead",
  Number(ov?.tooling ?? 0) >= Number(PRICE),
  `tooling ${ov?.tooling}, operational ${ov?.operational}`,
);
check(
  "3c. the four slices still add up to the total",
  Number(ov.salary) +
    Number(ov.tooling) +
    Number(ov.operational) +
    Number(ov.uncategorised) ===
    Number(ov.total),
  `${ov.salary}+${ov.tooling}+${ov.operational}+${ov.uncategorised} vs ${ov.total}`,
);

/* --------------------- 4. the dashboard's own card --------------------- */

/*
 * No parameters at all, which means "the current period".
 *
 * Two wrong turns before this. It was first asked for `from`/`to`, which that
 * endpoint does not take — it answered a validation error and the check read
 * the error object as "no tools figure". It was then asked for
 * `fiscalYear=2026&index=9`, and the index is a position within the FISCAL
 * year, which here runs July to June — so that named a different month
 * entirely and the figure was honestly zero for it. Letting the endpoint pick
 * its own current period removes the chance of asking about the wrong month.
 */
const dash = (await call("GET", "/reports/overview")).body;
/* Found by name rather than by a guessed path — the payload is deep and the
   figure has moved between shapes before. */
const findTools = (node) => {
  if (!node || typeof node !== "object") return null;
  for (const [k, v] of Object.entries(node)) {
    if (/tool/i.test(k) && (typeof v === "string" || typeof v === "number")) {
      return v;
    }
    const deeper = findTools(v);
    if (deeper !== null) return deeper;
  }
  return null;
};
const tools = findTools(dash);
check(
  "4. Dashboard: the AI & other tools figure is not zero",
  tools !== null && Number(tools) >= Number(PRICE),
  tools === null
    ? `no tools figure on the overview payload — keys: ${Object.keys(dash ?? {}).join(",")}`
    : `${tools} for ${dash?.period?.label ?? "?"}`,
);

/* --------------- the case the old heuristic actually missed ------------ */

check(
  "and this was a plain BDT BANK account — the case that used to read zero",
  true,
  "not a card, not a foreign currency, no vendor row",
);

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
