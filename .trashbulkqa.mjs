/**
 * Undoing a mistaken bulk delete should not take forty clicks.
 *
 * The bulk delete shipped without a bulk undo, which made it more dangerous
 * than it needed to be: forty rows went in one click and came back in forty.
 *
 * The trash is also the one table in this app whose rows are not all the same
 * kind of thing — a transaction, a person and an exchange rate sit in it
 * together — so this checks the part most likely to be wrong: that a selection
 * SPANNING KINDS is grouped correctly on the way out, since the API's guards
 * and permissions are per kind.
 *
 * And it checks the asymmetry deliberately built in: a bulk DELETE refuses the
 * whole request if any row cannot go, while a bulk RESTORE reports what
 * happened. A half-delete reads as success; a half-restore looks like a
 * half-restore, and what did not come back is still visibly in the trash.
 *
 *     node .trashbulkqa.mjs      (local only — writes and deletes)
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
  await db.query("delete from transactions where description like 'TBQA%'");
  await db.query("delete from accounts where name like 'TBQA %'");
  await db.query("delete from team_members where full_name like 'TBQA %'");
};
await wipe();

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const account = (
  await call("POST", "/accounts", {
    name: "TBQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "500000.00",
    openingBalanceOn: TODAY.slice(0, 8) + "01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

const txns = [];
for (let i = 1; i <= 3; i += 1) {
  const r = await call("POST", "/transactions", {
    direction: "out",
    txnDate: TODAY,
    accountId: account.id,
    amount: "500.00",
    categoryId: cat.id,
    description: `TBQA expense ${i}`,
    paymentMethod: "bank_transfer",
  });
  txns.push(r.body?.id);
}
const people = [];
for (const n of [1, 2]) {
  const r = (
    await db.query(
      `insert into team_members
         (full_name, engagement_type, designation, status, joined_on, created_by, updated_by)
       values ($1, 'employee', 'Tester', 'active', '2024-01-01', $2, $2) returning id`,
      [`TBQA Person ${n}`, person.id],
    )
  ).rows[0];
  people.push(r.id);
}
check(
  "three expenses and two people to work with",
  txns.every(Boolean) && people.length === 2,
  `${txns.length} txns, ${people.length} people`,
);

/* Everything into the trash, in one go per kind. */
const binTxns = await call("POST", "/trash/transaction/bulk", {
  ids: txns,
  reason: "TBQA",
});
const binPeople = await call("POST", "/trash/team-member/bulk", {
  ids: people,
  reason: "TBQA",
});
check(
  "all five go to the trash",
  binTxns.status === 201 && binPeople.status === 201,
  `${JSON.stringify(binTxns.body)} ${JSON.stringify(binPeople.body)}`,
);

/* ------------------------- bulk restore, per kind ---------------------- */

const backTxns = await call("POST", "/trash/transaction/bulk-restore", {
  ids: txns.slice(0, 2),
});
check(
  "THE ASK: two can be restored in one request",
  backTxns.status === 201 &&
    backTxns.body?.done === 2 &&
    backTxns.body?.failed?.length === 0,
  JSON.stringify(backTxns.body),
);

const live = (
  await db.query(
    "select count(*)::int n from transactions where description like 'TBQA expense%' and deleted_at is null",
  )
).rows[0].n;
check("and they are back on the ledger", live === 2, `${live} of 3 live`);

/* Restoring something that is not in the trash is reported, not fatal. */
const mixed = await call("POST", "/trash/transaction/bulk-restore", {
  ids: [txns[0], txns[2]],
});
check(
  "THE RULE: a restore reports what it could not do rather than refusing the lot",
  mixed.status === 201 && mixed.body?.done === 1 && mixed.body?.failed?.length === 1,
  JSON.stringify(mixed.body),
);
const allBack = (
  await db.query(
    "select count(*)::int n from transactions where description like 'TBQA expense%' and deleted_at is null",
  )
).rows[0].n;
check(
  "so the one that COULD be restored still was",
  allBack === 3,
  `${allBack} of 3 live`,
);

/* The other kind, untouched by any of that. */
const stillBinned = (
  await db.query(
    "select count(*)::int n from team_members where full_name like 'TBQA %' and deleted_at is not null",
  )
).rows[0].n;
check(
  "the people are still in the trash — one kind's batch does not touch another",
  stillBinned === 2,
  `${stillBinned} of 2 still deleted`,
);

/* ---------------------------- bulk purge ------------------------------- */

const gone = await call("POST", "/trash/team-member/bulk-purge", {
  ids: people,
});
check(
  "THE ASK: two can be deleted for good in one request",
  gone.status === 201 && gone.body?.done === 2,
  JSON.stringify(gone.body),
);
const remaining = (
  await db.query(
    "select count(*)::int n from team_members where full_name like 'TBQA %'",
  )
).rows[0].n;
check("and they are really gone", remaining === 0, `${remaining} row(s) left`);

/* ------------------------------- the edges ----------------------------- */

const empty = await call("POST", "/trash/transaction/bulk-restore", { ids: [] });
check("an empty selection is refused", empty.status === 400, `HTTP ${empty.status}`);

const unknown = await call("POST", "/trash/nonsense/bulk-restore", {
  ids: [txns[0]],
});
check(
  "an unknown kind is refused",
  unknown.status === 404 || unknown.status === 400,
  `HTTP ${unknown.status}`,
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
