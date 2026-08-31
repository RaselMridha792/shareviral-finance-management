/**
 * Ticking forty rows must be the same act as deleting one, forty times.
 *
 * The owner's ask was arithmetic — "akhon to prottekta one by one trash a
 * felte hoy" — but the danger is that a bulk path quietly becomes a SOFTER
 * delete than the single one: skipping the guards, half-succeeding, or leaving
 * an audit trail nobody can read back.
 *
 * So this proves four things about POST /trash/:kind/bulk, in order of how
 * expensive they are to get wrong:
 *
 *   1. it refuses the WHOLE request when any row cannot go, and names why —
 *      a partial delete reads as success and leaves you to find the survivors;
 *   2. it takes a transfer's other half with it, exactly as the single delete
 *      does, so two accounts never disagree;
 *   3. the audit log carries one line per row PLUS an envelope, all under one
 *      request, so "what happened to this entry" still answers;
 *   4. it obeys the account-never-below-zero rule over the whole selection.
 *
 *     node .bulktrashqa.mjs      (local only — writes and deletes)
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
  await db.query("delete from transactions where description like 'BULKQA%'");
  await db.query("delete from accounts where name like 'BULKQA %'");
};
await wipe();

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const MONTH_START = TODAY.slice(0, 8) + "01";

const mkAccount = async (name) =>
  (
    await call("POST", "/accounts", {
      name,
      type: "bank",
      currency: "BDT",
      openingBalance: "500000.00",
      openingBalanceOn: MONTH_START,
    })
  ).body;
const bank = await mkAccount("BULKQA Bank");
const other = await mkAccount("BULKQA Other Bank");
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

const spend = async (n) =>
  (
    await call("POST", "/transactions", {
      direction: "out",
      txnDate: TODAY,
      accountId: bank.id,
      amount: "1000.00",
      categoryId: cat.id,
      description: `BULKQA expense ${n}`,
      paymentMethod: "bank_transfer",
    })
  ).body;

const made = [];
for (let i = 1; i <= 5; i += 1) made.push(await spend(i));
check(
  "five expenses recorded to tick",
  made.every((m) => m?.id),
  made.map((m) => (m?.id ? "ok" : "FAILED")).join(" "),
);

/* ------------- 1. a request with one bad row deletes nothing ------------ */

await call("POST", `/trash/transaction/${made[0].id}`, { reason: "BULKQA setup" });

const mixed = await call("POST", "/trash/transaction/bulk", {
  ids: [made[0].id, made[1].id, made[2].id],
  reason: "BULKQA mixed",
});
check(
  "THE RULE: one row already in the trash refuses the whole request",
  mixed.status === 400,
  `HTTP ${mixed.status} ${JSON.stringify(mixed.body?.message ?? "").slice(0, 110)}`,
);
const survived = (
  await db.query(
    "select count(*)::int n from transactions where description in ('BULKQA expense 2','BULKQA expense 3') and deleted_at is null",
  )
).rows[0].n;
check(
  "and the good rows in that request are untouched",
  survived === 2,
  `${survived} of 2 still live`,
);
check(
  "the refusal says which row and why",
  /already in the trash/i.test(JSON.stringify(mixed.body?.message ?? "")),
  JSON.stringify(mixed.body?.message ?? "").slice(0, 140),
);

/* ------------------------- 2. the ordinary case ------------------------- */

const before = (
  await db.query(
    "select count(*)::int n from transactions where description like 'BULKQA expense%' and deleted_at is null",
  )
).rows[0].n;

const good = await call("POST", "/trash/transaction/bulk", {
  ids: [made[1].id, made[2].id, made[3].id],
  reason: "BULKQA three at once",
});
check(
  "three ticked rows go together",
  good.status === 201 && good.body?.ticked === 3,
  `HTTP ${good.status} ${JSON.stringify(good.body)}`,
);
const after = (
  await db.query(
    "select count(*)::int n from transactions where description like 'BULKQA expense%' and deleted_at is null",
  )
).rows[0].n;
check(
  "and exactly three fewer rows are live",
  before - after === 3,
  `${before} -> ${after}`,
);

/* -------------- 3. the audit log answers for each of them --------------- */

const perRow = (
  await db.query(
    `select count(*)::int n from audit_logs
      where entity_table='transactions' and action='delete'
        and entity_id = any($1::text[])`,
    [[made[1].id, made[2].id, made[3].id]],
  )
).rows[0].n;
check(
  "each deleted row has its own audit line, so its history still reads",
  perRow === 3,
  `${perRow} of 3`,
);

const envelope = (
  await db.query(
    `select summary, request_id from audit_logs
      where entity_table='transactions' and action='delete' and entity_id is null
      order by occurred_at desc limit 1`,
  )
).rows[0];
check(
  "and one envelope names the act",
  Boolean(envelope) && /Moved 3/.test(envelope.summary ?? ""),
  envelope?.summary?.slice(0, 90) ?? "no envelope row",
);

/*
 * Scoped to THIS batch's three ids and the envelope carrying their request.
 * Counting distinct request_ids over a two-minute window swept in the setup
 * delete and the refused one as well, and reported three where one was true.
 */
const batchRequests = (
  await db.query(
    `select distinct request_id from audit_logs
      where entity_table='transactions' and action='delete'
        and entity_id = any($1::text[])`,
    [[made[1].id, made[2].id, made[3].id]],
  )
).rows;
check(
  "the three per-row lines share one request",
  batchRequests.length === 1 && batchRequests[0].request_id,
  `${batchRequests.length} distinct request_id`,
);
const envelopeShares = (
  await db.query(
    `select count(*)::int n from audit_logs
      where entity_table='transactions' and action='delete'
        and entity_id is null and request_id = $1`,
    [batchRequests[0]?.request_id ?? null],
  )
).rows[0].n;
check(
  "and the envelope is under that same request, so they read as one act",
  envelopeShares === 1,
  `${envelopeShares} envelope row(s) on that request`,
);

/* ------------------ 4. a transfer goes as a whole pair ------------------ */

const moved = await call("POST", "/transactions/transfer", {
  txnDate: TODAY,
  fromAccountId: bank.id,
  toAccountId: other.id,
  amount: "25000.00",
  description: "BULKQA moving our own money",
});
check("a transfer is recorded", moved.status === 201, `HTTP ${moved.status}`);

const half = (
  await db.query(
    "select id from transactions where description like 'BULKQA moving%' and direction='out' limit 1",
  )
).rows[0];
const pair = await call("POST", "/trash/transaction/bulk", {
  ids: [half.id],
  reason: "BULKQA half a transfer",
});
check(
  "ticking one half of a transfer takes both",
  pair.status === 201 && pair.body?.ticked === 1 && pair.body?.deleted === 2,
  `${JSON.stringify(pair.body)}`,
);
const orphan = (
  await db.query(
    "select count(*)::int n from transactions where description like 'BULKQA moving%' and deleted_at is null",
  )
).rows[0].n;
check(
  "so no half of it is left behind",
  orphan === 0,
  `${orphan} live halves remain`,
);

/* ---------------- 5. the account rule survives the batch ---------------- */

/*
 * Opens at nothing, is funded, then spends nearly all of it — so pulling the
 * funding back out is what would take it below zero. The first attempt opened
 * the account at 500,000 and tried to spend 550,000, which the overdraft rule
 * refused at the moment of typing; the delete under test was never reached and
 * the check below passed on a validation error instead.
 */
const poor = (
  await call("POST", "/accounts", {
    name: "BULKQA Thin Account",
    type: "bank",
    currency: "BDT",
    openingBalance: "0.00",
    openingBalanceOn: MONTH_START,
  })
).body;
const fund = await call("POST", "/transactions/cash-in", {
  txnDate: TODAY,
  accountId: poor.id,
  amount: "100000.00",
  description: "BULKQA funding",
  usdRate: "122.77",
});
const outgoing = await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: poor.id,
  amount: "90000.00",
  categoryId: cat.id,
  description: "BULKQA big spend",
  paymentMethod: "bank_transfer",
});
check(
  "an account is funded and then spends most of it",
  fund.status === 201 && outgoing.status === 201,
  `HTTP ${fund.status}/${outgoing.status}`,
);

const takeFunding = await call("POST", "/trash/transaction/bulk", {
  ids: [fund.body.id],
  reason: "BULKQA pulling the funding out",
});
const why = JSON.stringify(
  takeFunding.body?.message ?? takeFunding.body?.errors ?? "",
);
check(
  "THE RULE: deleting money that later spending relied on is refused",
  takeFunding.status === 400 && /below zero|overdraw|BULKQA Thin/i.test(why),
  `HTTP ${takeFunding.status} ${why.slice(0, 130)}`,
);
const stillThere = (
  await db.query(
    "select count(*)::int n from transactions where description='BULKQA funding' and deleted_at is null",
  )
).rows[0].n;
check("and that row is still there", stillThere === 1, `${stillThere}`);

/* --------------------------- 6. the edges ------------------------------ */

const empty = await call("POST", "/trash/transaction/bulk", { ids: [] });
check("an empty selection is refused", empty.status === 400, `HTTP ${empty.status}`);

const tooMany = await call("POST", "/trash/transaction/bulk", {
  ids: Array.from({ length: 201 }, () => made[4].id),
});
check(
  "more than a page's worth is refused",
  tooMany.status === 400,
  `HTTP ${tooMany.status}`,
);

const twice = await call("POST", "/trash/transaction/bulk", {
  ids: [made[4].id, made[4].id],
  reason: "BULKQA the same row twice",
});
check(
  "the same row ticked twice counts once",
  twice.status === 201 && twice.body?.ticked === 1,
  JSON.stringify(twice.body),
);

/* Restore has to still work one at a time, or a mistake is unrecoverable. */
const back = await call("POST", `/trash/transaction/${made[1].id}/restore`);
check(
  "a row deleted in a batch can still be restored on its own",
  back.status === 201 || back.status === 200,
  `HTTP ${back.status}`,
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
