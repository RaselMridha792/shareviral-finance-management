/**
 * Can an account be taken below zero — through any door?
 *
 * The claim is "never", and the doors are eleven: typing an entry, editing
 * one, voiding one, transferring, importing, paying payroll, paying tax,
 * recording a challan, deleting to the trash, restoring from it, and editing
 * the account's own opening balance. This drives the ones that can be driven
 * without building a payroll run, and checks the refusals name the account.
 *
 * Also here, because they share the fixtures: recreating a deleted payroll
 * month, re-setting a deleted day's rate, recreating a deleted category, and
 * the dashboard's rule that untouched zero accounts stay off it.
 *
 *     node .overdraftqa.mjs      (local only — writes and deletes)
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
const msgOf = (r) =>
  String(r.body?.message ?? "") +
  " " +
  Object.values(r.body?.errors ?? {})
    .flat()
    .join(" ");

/* ------------------------------------------------------------- fixtures */

// A fresh account with 1,000 in it, born on the 1st.
await db.query(`delete from transactions where account_id in (select id from accounts where name like 'QA Overdraft%')`);
await db.query(`delete from accounts where name like 'QA Overdraft%'`);

const made = await call("POST", "/accounts", {
  name: "QA Overdraft Bank",
  type: "bank",
  currency: "BDT",
  openingBalance: "1000.00",
  openingBalanceOn: "2026-08-01",
});
check("an account opens", made.status === 201, `HTTP ${made.status} ${msgOf(made)}`);
const acct = made.body.id;

const negative = await call("POST", "/accounts", {
  name: "QA Overdraft Negative",
  type: "bank",
  currency: "BDT",
  openingBalance: "-500.00",
  openingBalanceOn: "2026-08-01",
});
check(
  // The money schema refuses the minus sign before the service's own check
  // does — two nets, either is a refusal.
  "a negative opening balance is refused",
  negative.status === 400,
  msgOf(negative).slice(0, 70),
);

const catId = (await db.query("select id from categories where kind='out' and deleted_at is null limit 1"))
  .rows[0].id;
const inCatId = (await db.query("select id from categories where kind='in' and deleted_at is null limit 1"))
  .rows[0].id;

const entry = (direction, amount, txnDate, description) =>
  call("POST", "/transactions", {
    direction,
    amount,
    txnDate,
    accountId: acct,
    categoryId: direction === "out" ? catId : inCatId,
    description,
    paymentMethod: "bank_transfer",
  });

/* ------------------------------------------------- the eleven doors, driven */

const ok300 = await entry("out", "300.00", "2026-08-05", "QA within means");
check("spending within the balance is allowed", ok300.status === 201, `HTTP ${ok300.status} ${msgOf(ok300)}`);

const over = await entry("out", "800.00", "2026-08-06", "QA beyond means");
check(
  "spending past the balance is refused, naming the account",
  over.status === 400 && /QA Overdraft Bank/.test(msgOf(over)) && /below zero/i.test(msgOf(over)),
  msgOf(over).slice(0, 90),
);

const in500 = await entry("in", "500.00", "2026-08-10", "QA funding");
check("money in is always allowed", in500.status === 201, `HTTP ${in500.status}`);

const backdated = await entry("out", "1100.00", "2026-08-08", "QA backdated dip");
check(
  "a backdated entry that dips a past day below zero is refused",
  backdated.status === 400 && /2026-08-08/.test(msgOf(backdated)),
  msgOf(backdated).slice(0, 90),
);

const exact = await entry("out", "1200.00", "2026-08-12", "QA to exactly zero");
check("spending to exactly zero is allowed", exact.status === 201, `HTTP ${exact.status} ${msgOf(exact)}`);
const exactId = exact.body?.id;

// Void the 500 in — the spending that followed it becomes impossible.
const in500Id = in500.body?.id;
const voidIn = await call("POST", `/transactions/${in500Id}/void`, { reason: "QA void" });
check(
  "voiding an in-entry that later spending relied on is refused",
  voidIn.status === 400 && /below zero/i.test(msgOf(voidIn)),
  msgOf(voidIn).slice(0, 90),
);

const delIn = await call("POST", `/trash/transaction/${in500Id}`, { reason: "QA" });
check(
  "deleting that in-entry to the trash is refused the same way",
  delIn.status === 400 && /below zero/i.test(msgOf(delIn)),
  msgOf(delIn).slice(0, 90),
);

// Delete the 1,200 out; then spend some; then the restore must be refused.
const delOut = await call("POST", `/trash/transaction/${exactId}`, { reason: "QA" });
check("deleting an out-entry is fine", delOut.status < 400, `HTTP ${delOut.status}`);
const spend900 = await entry("out", "900.00", "2026-08-20", "QA spent meanwhile");
check("the freed money can be spent", spend900.status === 201, `HTTP ${spend900.status}`);
const restoreOut = await call("POST", `/trash/transaction/${exactId}/restore`);
check(
  "restoring the out-entry is refused now the money is spent",
  restoreOut.status === 400 && /below zero/i.test(msgOf(restoreOut)),
  msgOf(restoreOut).slice(0, 90),
);

// A transfer past the balance.
const acct2 = (
  await call("POST", "/accounts", {
    name: "QA Overdraft Second",
    type: "bank",
    currency: "BDT",
    openingBalance: "0.00",
    openingBalanceOn: "2026-08-01",
  })
).body.id;
const bigTransfer = await call("POST", "/transactions/transfer", {
  fromAccountId: acct,
  toAccountId: acct2,
  amount: "5000.00",
  txnDate: "2026-08-21",
  description: "QA transfer beyond means",
  paymentMethod: "bank_transfer",
});
check(
  "a transfer past the balance is refused",
  bigTransfer.status === 400 && /below zero/i.test(msgOf(bigTransfer)),
  msgOf(bigTransfer).slice(0, 80),
);

// Editing an amount upward past the balance.
const editUp = await call("PATCH", `/transactions/${ok300.body.id}`, {
  amount: "9000.00",
});
check(
  "editing an amount up past the balance is refused",
  editUp.status === 400 && /below zero/i.test(msgOf(editUp)),
  msgOf(editUp).slice(0, 80),
);

// Lowering the opening balance below what has been spent.
const lowerOpening = await call("PATCH", `/accounts/${acct}`, {
  openingBalance: "100.00",
});
check(
  "lowering the opening balance below spending is refused",
  lowerOpening.status === 400 && /below zero/i.test(msgOf(lowerOpening)),
  msgOf(lowerOpening).slice(0, 80),
);

// A TDS challan whose ledger row would overdraw.
const challan = await call("POST", "/tds/deposits", {
  challanNumber: "QA-OVER-1",
  challanDate: "2026-08-22",
  depositDate: "2026-08-22",
  amount: "99999.00",
  periodYear: 2026,
  periodMonth: 7,
  depositType: "salary",
  accountId: acct,
});
check(
  "a challan whose ledger row would overdraw is refused",
  challan.status === 400 && /below zero/i.test(msgOf(challan)),
  `HTTP ${challan.status} ${msgOf(challan).slice(0, 70)}`,
);

/* -------------------------------- a legacy-negative account still functions */

await db.query(
  `update accounts set opening_balance = '-200.00' where id = $1`,
  [acct2],
);
const legacyIn = await call("POST", "/transactions", {
  direction: "in",
  amount: "50.00",
  txnDate: "2026-08-23",
  accountId: acct2,
  categoryId: inCatId,
  description: "QA legacy deposit",
  paymentMethod: "bank_transfer",
});
check(
  "an account negative from before the rule still accepts deposits",
  legacyIn.status === 201,
  `HTTP ${legacyIn.status} ${msgOf(legacyIn)}`,
);
const legacyOut = await call("POST", "/transactions", {
  direction: "out",
  amount: "10.00",
  txnDate: "2026-08-24",
  accountId: acct2,
  categoryId: catId,
  description: "QA legacy spend",
  paymentMethod: "bank_transfer",
});
check(
  "but spending that digs it deeper is refused",
  legacyOut.status === 400,
  `HTTP ${legacyOut.status} ${msgOf(legacyOut).slice(0, 70)}`,
);

/* --------------------------------------------- the deleted-twin situations */

// Payroll: a deleted month names the trash; a purged one frees the month.
await db.query("delete from payroll_runs where period_year = 2032");
const run = await call("POST", "/payroll/runs", { periodYear: 2032, periodMonth: 5 });
await call("POST", `/trash/payroll-run/${run.body.id}`, { reason: "QA" });
const again = await call("POST", "/payroll/runs", { periodYear: 2032, periodMonth: 5 });
check(
  "recreating a deleted payroll month says it is in the trash",
  again.status === 400 && /in the trash/i.test(msgOf(again)),
  msgOf(again).slice(0, 90),
);
await call("DELETE", `/trash/payroll-run/${run.body.id}`);
const fresh = await call("POST", "/payroll/runs", { periodYear: 2032, periodMonth: 5 });
check(
  "after purging it, the month can be started again",
  fresh.status === 201,
  `HTTP ${fresh.status} ${msgOf(fresh)}`,
);
await db.query("delete from payroll_runs where period_year = 2032");

// FX: writing a deleted day's rate revives the day.
// A past day nobody would have really recorded — the app refuses future ones.
await db.query("delete from fx_rates where rate_date = '2020-01-15'");
const set1 = await call("POST", "/fx/rates", { rateDate: "2020-01-15", rate: "111.00" });
check("a rate can be recorded", set1.status < 400, `HTTP ${set1.status} ${msgOf(set1)}`);
const rateRow = (
  await db.query("select id from fx_rates where rate_date = '2020-01-15'")
).rows[0];
if (rateRow) {
  await call("POST", `/trash/fx-rate/${rateRow.id}`, { reason: "QA" });
  await call("POST", "/fx/rates", { rateDate: "2020-01-15", rate: "222.00" });
}
const revived = (
  await db.query(
    "select rate, deleted_at from fx_rates where rate_date = '2020-01-15'",
  )
).rows[0];
check(
  "setting a deleted day's rate revives the day with the new figure",
  revived && !revived.deleted_at && Number(revived.rate) === 222,
  `rate ${revived?.rate}, deleted_at ${revived?.deleted_at ? "still set" : "clear"}`,
);
await db.query("delete from fx_rates where rate_date = '2020-01-15'");

// Categories: a deleted name says so.
await db.query("delete from categories where slug = 'qa-trash-twin'");
const cat = await call("POST", "/categories", { name: "QA Trash Twin", kind: "out" });
await call("POST", `/trash/category/${cat.body.id}`, { reason: "QA" });
const catAgain = await call("POST", "/categories", { name: "QA Trash Twin", kind: "out" });
check(
  "recreating a deleted category names the trash",
  catAgain.status === 400 && /trash/i.test(msgOf(catAgain)),
  msgOf(catAgain).slice(0, 90),
);
await db.query("delete from categories where slug = 'qa-trash-twin'");

/* ------------------------------------------------------- the dashboard rule */

const overview = await call(
  "GET",
  "/reports/overview?granularity=month&fiscalYear=2026&index=8",
);
const groups = overview.body?.groups ?? [];
const zeroShown = groups.find(
  (g) =>
    Number(g.opening) === 0 && Number(g.moneyIn) === 0 && Number(g.moneyOut) === 0,
);
const activeShown = groups.find((g) => g.label === "QA Overdraft Bank");
check(
  "the dashboard hides untouched zero accounts",
  !zeroShown,
  zeroShown ? `"${zeroShown.label}" is still shown` : "",
);
check(
  "and still shows the accounts that moved, with the bank line",
  Boolean(activeShown) && "bankName" in (activeShown ?? {}),
  activeShown ? `bankName: ${JSON.stringify(activeShown.bankName)}` : "the active account is missing",
);

/* ---------------------------------------------------------------- tidy up */

await db.query(`delete from transactions where account_id in (select id from accounts where name like 'QA Overdraft%')`);
await db.query(`delete from accounts where name like 'QA Overdraft%'`);
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
