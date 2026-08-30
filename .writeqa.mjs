/**
 * The write path, measured in the ledger rather than on the screen.
 *
 * Create an entry, change it, void it — and after each step ask the database
 * what the account is worth. A balance is `opening + Σ signed_amount` over
 * entries that are not voided, so each step has an exact expected movement and
 * anything else is a fault:
 *
 *   create ৳X out   → balance falls by exactly X
 *   edit  to ৳Y     → balance is back up by X and down by Y
 *   void            → balance returns to where it started
 *
 * The last one is the one worth having. A void that leaves the money out of the
 * total is the same bug in reverse, and both look plausible on screen — the row
 * is struck through either way.
 *
 * Everything it creates, it removes. Run against the local database only.
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";

const REPO = "d:/codes/Finance-Management-software";
const API = "http://localhost:4001/api";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const u = (
  await c.query(
    "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1",
  )
).rows[0];
const account = (
  await c.query(
    "select id, name from accounts where deleted_at is null order by name limit 1",
  )
).rows[0];
const category = (
  await c.query(
    "select id, name from categories where kind in ('out','both') and parent_id is not null limit 1",
  )
).rows[0];

const token = jwt.sign(
  { sub: u.id, role: u.role, tv: u.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "20m" },
);
const headers = {
  cookie: `sfm_access=${token}`,
  "content-type": "application/json",
  "x-requested-with": "finance-web",
};

const balance = async () => {
  const r = await c.query(
    `select a.opening_balance::numeric
              + coalesce(sum(t.signed_amount::numeric) filter (where t.voided_at is null), 0) as v
       from accounts a left join transactions t on t.account_id = a.id
      where a.id = $1 group by a.id, a.opening_balance`,
    [account.id],
  );
  return Number(r.rows[0].v);
};

const step = (label, before, after, expected) => {
  const moved = after - before;
  const ok = Math.abs(moved - expected) < 0.005;
  console.log(
    `   ${label.padEnd(28)} moved ${moved.toFixed(2).padStart(14)}   expected ${expected.toFixed(2).padStart(14)}   ${ok ? "correct" : "WRONG"}`,
  );
  return ok;
};

console.log(`account: ${account.name}`);
console.log(`category: ${category.name}\n`);

let failures = 0;
let created = null;

try {
  const start = await balance();
  console.log(`   opening position ${start.toFixed(2)}\n`);

  /* --- create ---------------------------------------------------------- */
  const body = {
    accountId: account.id,
    categoryId: category.id,
    direction: "out",
    amount: "1234.56",
    txnDate: new Date().toISOString().slice(0, 10),
    description: "QA write-path probe",
    paymentMethod: "cash",
  };
  const res = await fetch(`${API}/transactions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.log("   create failed: " + res.status + " " + (await res.text()).slice(0, 200));
    failures += 1;
  } else {
    created = (await res.json()).id;
    const afterCreate = await balance();
    if (!step("create ৳1,234.56 out", start, afterCreate, -1234.56)) failures += 1;

    /* --- edit ---------------------------------------------------------- */
    const edit = await fetch(`${API}/transactions/${created}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ amount: "2000.00" }),
    });
    if (!edit.ok) {
      console.log("   edit failed: " + edit.status + " " + (await edit.text()).slice(0, 200));
      failures += 1;
    } else {
      const afterEdit = await balance();
      if (!step("edit to ৳2,000.00", afterCreate, afterEdit, -(2000 - 1234.56)))
        failures += 1;

      /* --- void -------------------------------------------------------- */
      const rid = await fetch(`${API}/transactions/${created}/void`, {
        method: "POST",
        headers,
        body: JSON.stringify({ reason: "QA write-path probe" }),
      });
      if (!rid.ok) {
        console.log("   void failed: " + rid.status + " " + (await rid.text()).slice(0, 200));
        failures += 1;
      } else {
        const afterVoid = await balance();
        if (!step("void it", afterEdit, afterVoid, 2000)) failures += 1;
        if (!step("back where it started", start, afterVoid, 0)) failures += 1;

        /* the audit trail should carry all three */
        const audit = await c.query(
          "select action from audit_logs where entity_table='transactions' and entity_id=$1 order by occurred_at",
          [created],
        );
        const actions = audit.rows.map((r) => r.action);
        const wanted = ["create", "update", "void"];
        const complete = wanted.every((a) => actions.includes(a));
        console.log(
          `   ${"audit trail".padEnd(28)} ${actions.join(", ") || "(none)"}   ${complete ? "complete" : "MISSING " + wanted.filter((a) => !actions.includes(a)).join(", ")}`,
        );
        if (!complete) failures += 1;
      }
    }
  }
} finally {
  if (created) {
    await c.query("delete from audit_logs where entity_table='transactions' and entity_id=$1", [created]);
    await c.query("delete from transactions where id=$1", [created]);
    const back = await balance();
    console.log(`\n   probe removed; position ${back.toFixed(2)}`);
  }
  await c.end();
}

console.log(
  "\n" + (failures === 0 ? "the write path moves the ledger by exactly what it should" : `${failures} step(s) wrong`),
);
