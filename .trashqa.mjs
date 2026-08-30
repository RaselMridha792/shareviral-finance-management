/**
 * Does deleting actually take the money out of the totals, and does restoring
 * put it back?
 *
 * The whole design rests on one claim — that a deleted row leaves every sum in
 * the application — and that claim is exactly the kind that reads as true in a
 * diff and is false in the database. So this asks the API rather than the code:
 * read a total, delete a row, read the total again, and check the difference is
 * the row's own amount and nothing else.
 *
 *     node .trashqa.mjs
 *
 * Local only. It writes, deletes and purges, so it must never be pointed at
 * anything but the Neon database in apps/api/.env.
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
    `select id, email, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null
      order by created_at limit 1`,
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
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text.slice(0, 200);
  }
  return { status: res.status, body: parsed };
};

/** The sum straight from the database, which is what every screen reads. */
const netFromDb = async () =>
  (
    await db.query(
      `select coalesce(sum(signed_amount), 0)::text as net from transactions
        where voided_at is null and deleted_at is null`,
    )
  ).rows[0].net;

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log(`\nsigned in as ${person.email} (${person.role})\n`);

/* ---------------------------------------------------------------- the trash */

const summary = await call("GET", "/trash/summary");
check(
  "the trash names its kinds",
  summary.status === 200 && Array.isArray(summary.body) && summary.body.length > 0,
  summary.status === 200 ? `${summary.body.length} kinds` : `HTTP ${summary.status}`,
);

const unfiltered = await call("GET", "/trash");
check(
  "the whole trash lists in one page without a kind filter",
  unfiltered.status === 200 && Array.isArray(unfiltered.body?.items),
  unfiltered.status === 200
    ? `${unfiltered.body.total} item(s) across all kinds`
    : `HTTP ${unfiltered.status} ${JSON.stringify(unfiltered.body).slice(0, 120)}`,
);

/* ------------------------------------------------- delete moves the total */

const victim = (
  await db.query(
    `select id, description, amount, direction, signed_amount::text as signed
       from transactions where deleted_at is null and voided_at is null
        and description = 'Office rent August' limit 1`,
  )
).rows[0];

if (!victim) {
  console.log("\n  the seeded entries are not there — run node .trashseed.mjs first\n");
  process.exit(1);
}

const before = await netFromDb();
const del = await call("POST", `/trash/transaction/${victim.id}`, {
  reason: "QA: checking the totals move",
});
check(
  "deleting answers 200",
  del.status === 201 || del.status === 200,
  `HTTP ${del.status}${del.status >= 400 ? ` ${JSON.stringify(del.body)}` : ""}`,
);

const after = await netFromDb();
const moved = (Number(after) - Number(before)).toFixed(2);
const expected = (-Number(victim.signed)).toFixed(2);
check(
  "the net moves by exactly the deleted amount",
  moved === expected,
  `net ${before} -> ${after}, moved ${moved}, expected ${expected}`,
);

/* ------------------------------------------- and it is gone from the list */

const list = await call("GET", "/transactions?page=1&pageSize=50");
const stillListed =
  list.status === 200 &&
  JSON.stringify(list.body).includes(victim.id);
check(
  "the deleted entry is not in the transactions list",
  !stillListed,
  list.status === 200 ? "" : `HTTP ${list.status}`,
);

/* ------------------------------------------------- and it is in the trash */

const inTrash = await call("GET", "/trash?kind=transaction");
const found = inTrash.body?.items?.find((i) => i.id === victim.id);
check(
  "it is listed in the trash, with who and why",
  Boolean(found) &&
    found.deleteReason === "QA: checking the totals move" &&
    Boolean(found.deletedByName),
  found
    ? `"${found.title}" by ${found.deletedByName}: ${found.deleteReason}`
    : `not found (HTTP ${inTrash.status})`,
);

/* ---------------------------------------------------- voided, so sums drop */

const flags = (
  await db.query(
    "select deleted_at, voided_at, (voided_at = deleted_at) as same from transactions where id = $1",
    [victim.id],
  )
).rows[0];
check(
  "a deleted money row is voided too, at the same instant",
  Boolean(flags.voided_at) && flags.same === true,
  `voided_at ${flags.voided_at ? "set" : "null"}, equal to deleted_at: ${flags.same}`,
);

/* ------------------------------------------------------------- restoring */

const restored = await call("POST", `/trash/transaction/${victim.id}/restore`);
check(
  "restoring answers 200",
  restored.status === 201 || restored.status === 200,
  `HTTP ${restored.status}`,
);

const back = await netFromDb();
check(
  "the net comes back to where it was",
  back === before,
  `net ${after} -> ${back}, was ${before}`,
);

const flagsBack = (
  await db.query(
    "select deleted_at, voided_at from transactions where id = $1",
    [victim.id],
  )
).rows[0];
check(
  "restoring clears the void it caused",
  !flagsBack.deleted_at && !flagsBack.voided_at,
  `deleted_at ${flagsBack.deleted_at ? "set" : "null"}, voided_at ${flagsBack.voided_at ? "set" : "null"}`,
);

/* ------------------------ a void that was already there survives a round trip */

await db.query(
  "update transactions set voided_at = now() - interval '1 day', voided_by = $2, void_reason = 'Voided before it was deleted' where id = $1",
  [victim.id, person.id],
);
await call("POST", `/trash/transaction/${victim.id}`, { reason: "QA: on an already-voided row" });
await call("POST", `/trash/transaction/${victim.id}/restore`);
const stillVoided = (
  await db.query("select voided_at, void_reason from transactions where id = $1", [victim.id])
).rows[0];
check(
  "a row voided before it was deleted comes back still voided",
  Boolean(stillVoided.voided_at) &&
    stillVoided.void_reason === "Voided before it was deleted",
  stillVoided.voided_at ? `reason kept: ${stillVoided.void_reason}` : "the void was wrongly cleared",
);
await db.query(
  "update transactions set voided_at = null, voided_by = null, void_reason = null where id = $1",
  [victim.id],
);

/* ----------------------------------------------------------------- guards */

const account = (await db.query("select id, name from accounts where deleted_at is null limit 1")).rows[0];
// The owner removed every business-data guard: an account with entries
// deletes freely. What the database still refuses is a PERMANENT delete of a
// row other rows point at — and that must come back as a sentence, not a 500.
const accDel = await call("POST", `/trash/account/${account.id}`, { reason: "QA" });
check(
  "an account with entries deletes freely now",
  accDel.status < 400,
  `HTTP ${accDel.status}`,
);
const accPurge = await call("DELETE", `/trash/account/${account.id}`);
check(
  "but purging it while entries point at it explains itself",
  accPurge.status === 400 && /records pointing at it/i.test(String(accPurge.body?.message)),
  `HTTP ${accPurge.status} ${String(accPurge.body?.message).slice(0, 60)}`,
);
const accBack = await call("POST", `/trash/account/${account.id}/restore`);
check("and it restores", accBack.status < 400, `HTTP ${accBack.status}`);

const lastAdmin = (
  await db.query(
    "select id from users where role='super_admin' and status='active' and deleted_at is null limit 1",
  )
).rows[0];
const admins = (
  await db.query(
    "select count(*)::int n from users where role='super_admin' and status='active' and deleted_at is null",
  )
).rows[0].n;
const adminDelete = await call("POST", `/trash/user/${lastAdmin.id}`, { reason: "QA" });
check(
  admins <= 1
    ? "the last super admin cannot be deleted"
    : `super admin deletable while ${admins} remain`,
  admins <= 1 ? adminDelete.status === 400 : adminDelete.status < 400,
  `HTTP ${adminDelete.status}`,
);
if (adminDelete.status < 400) {
  await call("POST", `/trash/user/${lastAdmin.id}/restore`);
}

/* -------------------------------------------------------------- purging */

// Made here rather than found, so the script survives its own purges.
const disposable = async (desc) =>
  (
    await db.query(
      `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, category_id, description, created_by, updated_by)
       select 'TXN-QA-' || floor(random() * 100000)::int, $2, 'out', '2026-08-10', '10.00', 'BDT',
              (select category_id from transactions where category_id is not null limit 1), $1, $3, $3
       returning id`,
      [desc, (await db.query("select account_id from transactions limit 1")).rows[0].account_id, person.id],
    )
  ).rows[0];

const spare = await disposable("QA disposable: purge target");
await call("POST", `/trash/transaction/${spare.id}`, { reason: "QA: about to be purged" });
const purge = await call("DELETE", `/trash/transaction/${spare.id}`);
check("purging answers 200", purge.status === 200, `HTTP ${purge.status}`);

const gone = (
  await db.query("select count(*)::int n from transactions where id = $1", [spare.id])
).rows[0].n;
check("the purged row is really gone from the table", gone === 0, `${gone} rows remain`);

const audited = (
  await db.query(
    `select count(*)::int n from audit_logs
      where entity_id = $1 and action = 'delete' and before is not null`,
    [spare.id],
  )
).rows[0].n;
check(
  "the audit log kept what the purged row said",
  audited > 0,
  `${audited} audit rows hold its before-image`,
);

/* --------------------------------------------------------- what it cannot do */

const nonsense = await call("POST", `/trash/audit-log/${victim.id}`, { reason: "QA" });
check(
  "there is no way to delete an audit entry",
  nonsense.status === 404,
  `HTTP ${nonsense.status}`,
);

/* --------------------------- the other kinds leave their own lists too */

/*
 * A leaf, chosen in a fixed order.
 *
 * `limit 1` with no `order by` handed back whatever Postgres felt like, and
 * when that was a heading with children underneath it the check below failed
 * for a reason that had nothing to do with deleting: the id was still in the
 * response, sitting in six children's `parentId`. The category itself had left
 * the list exactly as it should.
 */
const cat = (
  await db.query(
    `select id, name from categories c
      where deleted_at is null
        and not exists (
          select 1 from categories k
          where k.parent_id = c.id and k.deleted_at is null
        )
      order by name limit 1`,
  )
).rows[0];
if (cat) {
  // No guard any more: a category deletes whether or not entries file under
  // it — those entries then read as Uncategorised, amounts intact.
  const catDel = await call("POST", `/trash/category/${cat.id}`, { reason: "QA" });
  check("a category deletes even while holding entries", catDel.status < 400, `HTTP ${catDel.status}`);
  const cats = await call("GET", "/categories");
  // As its own row — not "the id appears nowhere in the payload", which is a
  // different and untrue claim while anything else may still refer to it.
  const listed = cats.body?.items ?? cats.body ?? [];
  check(
    "and leaves the category list",
    cats.status === 200 &&
      Array.isArray(listed) &&
      !listed.some((c) => c.id === cat.id),
    `${cat.name}`,
  );
  const catBack = await call("POST", `/trash/category/${cat.id}/restore`);
  check("and restores", catBack.status < 400, `HTTP ${catBack.status}`);
}

// A rate: delete it and the lookup that feeds conversions must stop seeing it.
const seededRate = await db.query(
  `insert into fx_rates (base_currency, quote_currency, rate, rate_date, source)
   values ('USD','BDT','999.000000','2099-01-01','manual')
   on conflict do nothing returning id`,
);
const rateId = seededRate.rows[0]?.id;
if (rateId) {
  const latestBefore = (
    await db.query(
      "select rate from fx_rates where deleted_at is null and rate_date <= '2099-06-01' order by rate_date desc limit 1",
    )
  ).rows[0];
  const delRate = await call("POST", `/trash/fx-rate/${rateId}`, { reason: "QA" });
  const latestAfter = (
    await db.query(
      "select rate from fx_rates where deleted_at is null and rate_date <= '2099-06-01' order by rate_date desc limit 1",
    )
  ).rows[0];
  check(
    "a deleted rate stops steering conversion lookups",
    delRate.status < 400 &&
      latestBefore?.rate === "999.000000" &&
      latestAfter?.rate !== "999.000000",
    `latest before ${latestBefore?.rate}, after ${latestAfter?.rate ?? "none"}`,
  );
  await call("DELETE", `/trash/fx-rate/${rateId}`);
}

/* -------------------------------------------------- emptying the trash */

const spare2 = await disposable("QA disposable: empty target");
if (spare2) {
  await call("POST", `/trash/transaction/${spare2.id}`, { reason: "QA: for the empty" });
  const emptied = await call("DELETE", "/trash");
  const remaining = await call("GET", "/trash");
  check(
    "emptying the trash purges everything and leaves it empty",
    emptied.status === 200 &&
      emptied.body?.purged >= 1 &&
      remaining.body?.total === 0,
    `purged ${emptied.body?.purged}, ${remaining.body?.total} left`,
  );
  const gone2 = (
    await db.query("select count(*)::int n from transactions where id = $1", [spare2.id])
  ).rows[0].n;
  check("the emptied row is gone from its table", gone2 === 0, "");
}

await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(66));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
