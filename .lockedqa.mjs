/**
 * A closed month can be corrected; it cannot be quietly rewritten.
 *
 * The owner was shown an inconsistency: the trash would move an entry out of a
 * CLOSED month while `void` refused the same act on the same row. Asked which
 * way to resolve it, he chose to open `void` rather than close the trash — and
 * was told at the time that after this, locking a month stops preventing
 * anything and becomes a label.
 *
 * That is not quite the whole truth, and this file is where the remainder is
 * pinned down. Three things must still be true or the lock means nothing at
 * all:
 *
 *   - a NEW entry cannot be created in a closed month;
 *   - an existing entry cannot be EDITED in one;
 *   - a void leaves the row in place, struck through, with who and why.
 *
 * So the lock still stops new money appearing in a filed month. It no longer
 * stops a mistake already in it from being marked as one.
 *
 *     node .lockedqa.mjs      (local only — writes and deletes)
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
  await db.query("delete from transactions where description like 'LOCKQA%'");
  await db.query("delete from accounts where name like 'LOCKQA %'");
};
await wipe();
/* The lock is a real setting; put it back exactly as it was. */
const lockWas = (
  await db.query("select books_locked_through l from app_settings limit 1")
).rows[0]?.l;
await db.query("update app_settings set books_locked_through = null");

const account = (
  await call("POST", "/accounts", {
    name: "LOCKQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "500000.00",
    openingBalanceOn: "2026-06-01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/* An entry inside what is about to become a closed month. */
const entry = await call("POST", "/transactions", {
  direction: "out",
  txnDate: "2026-07-15",
  accountId: account.id,
  amount: "9000.00",
  categoryId: cat.id,
  description: "LOCKQA an entry inside the month we are about to close",
  paymentMethod: "bank_transfer",
});
check("an entry records while the month is open", entry.status === 201, `HTTP ${entry.status}`);

/* Close July. */
await db.query("update app_settings set books_locked_through = '2026-07-31'");
const locked = (
  await db.query("select books_locked_through l from app_settings limit 1")
).rows[0].l;
check("July is closed", Boolean(locked), String(locked).slice(0, 10));

/* ------------------- what the lock must STILL prevent ------------------- */

const newOne = await call("POST", "/transactions", {
  direction: "out",
  txnDate: "2026-07-20",
  accountId: account.id,
  amount: "1000.00",
  categoryId: cat.id,
  description: "LOCKQA money appearing in a filed month",
  paymentMethod: "bank_transfer",
});
/*
 * 403, not 400. A closed month is a refusal of permission, not a malformed
 * request, and the app says so — the first version of this file asserted 400
 * and reported correct behaviour as broken.
 */
const refused = (res) =>
  res.status === 403 && /books are closed/i.test(JSON.stringify(res.body ?? ""));

check(
  "THE RULE: a NEW entry still cannot be created in a closed month",
  refused(newOne),
  `HTTP ${newOne.status} ${JSON.stringify(newOne.body?.message ?? "").slice(0, 100)}`,
);

const edited = await call("PATCH", `/transactions/${entry.body.id}`, {
  amount: "99999.00",
});
check(
  "THE RULE: an existing entry still cannot be EDITED in one",
  refused(edited),
  `HTTP ${edited.status} ${JSON.stringify(edited.body?.message ?? "").slice(0, 100)}`,
);

/* ---------------------- what the owner asked to open ------------------- */

const voided = await call("POST", `/transactions/${entry.body.id}/void`, {
  reason: "LOCKQA correcting a filed month",
});
check(
  "THE ASK: a void in a closed month is allowed",
  voided.status === 201 || voided.status === 200,
  `HTTP ${voided.status} ${JSON.stringify(voided.body?.message ?? "").slice(0, 110)}`,
);

const row = (
  await db.query(
    "select voided_at, void_reason, voided_by, deleted_at, amount from transactions where id = $1",
    [entry.body.id],
  )
).rows[0];
check(
  "the row is still there — voided, not erased",
  Boolean(row?.voided_at) && row?.deleted_at === null && row?.amount === "9000.00",
  `voided ${Boolean(row?.voided_at)}, deleted ${row?.deleted_at}, amount ${row?.amount}`,
);
check(
  "and it says who did it and why",
  row?.void_reason === "LOCKQA correcting a filed month" && Boolean(row?.voided_by),
  `${row?.void_reason}`,
);

const audited = (
  await db.query(
    `select count(*)::int n from audit_logs
      where entity_table='transactions' and entity_id = $1 and action = 'void'`,
    [entry.body.id],
  )
).rows[0].n;
check(
  "and the audit log carries it",
  audited >= 1,
  `${audited} void row(s) logged`,
);

/* The two ways out of a closed month now agree. */
const second = await call("POST", "/transactions", {
  direction: "out",
  txnDate: "2026-08-02",
  accountId: account.id,
  amount: "500.00",
  categoryId: cat.id,
  description: "LOCKQA an open-month entry to trash",
  paymentMethod: "bank_transfer",
});
const trashed = await call("POST", `/trash/transaction/${second.body.id}`, {
  reason: "LOCKQA",
});
check(
  "trashing still works, as it always did",
  trashed.status === 201 || trashed.status === 200,
  `HTTP ${trashed.status}`,
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
