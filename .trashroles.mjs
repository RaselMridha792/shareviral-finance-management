/**
 * Does each role's reach into the trash match its reach into the app?
 *
 * The rule under test: deleting a thing needs the same permission as writing
 * it, and the trash lists only what your role could have deleted. Checked by
 * doing, not by reading the matrix.
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = "http://localhost:4001/api";
const env = Object.fromEntries(
  fs.readFileSync("apps/api/.env", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; }));

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const people = (await db.query(
  `select distinct on (role) id, email, role, token_version from users
    where status='active' and deleted_at is null order by role, created_at`)).rows;

const tokenFor = (p) =>
  jwt.sign({ sub: p.id, role: p.role, tv: p.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

const call = async (p, method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(p)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/*
 * One deletable transaction to aim at — and a wipe first.
 *
 * `ref_no` is unique, so a row left behind by a run that died mid-way (the
 * local API restarting under it is enough, and it has happened twice) makes
 * the next run fail at the INSERT rather than at a check. The failure then
 * reads as a broken app instead of as debris.
 */
await db.query("delete from transactions where ref_no = 'TXN-ROLE-QA'");
const account = (await db.query("select id from accounts where deleted_at is null limit 1")).rows[0];
const admin = people.find((p) => p.role === "super_admin");
const tx = (await db.query(
  `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, description, created_by, updated_by)
   values ('TXN-ROLE-QA', $1, 'out', '2026-08-11', '10.00', 'BDT', 'role QA target', $2, $2) returning id`,
  [account.id, admin.id])).rows[0];

let bad = 0;
for (const p of people.sort((a, b) => a.role.localeCompare(b.role))) {
  const summary = await call(p, "GET", "/trash/summary");
  const kinds = summary.status === 200 ? summary.body.map((k) => k.kind) : [];

  const canTxn = (await call(p, "POST", `/trash/transaction/${tx.id}`, { reason: "role QA" }));
  // put it straight back if it went through
  if (canTxn.status < 400) await call(p, "POST", `/trash/transaction/${tx.id}/restore`);
  const canUser = await call(p, "POST", `/trash/user/${crypto.randomUUID()}`, { reason: "role QA" });

  console.log(
    `  ${p.role.padEnd(13)} summary ${String(summary.status).padEnd(4)} kinds=${String(kinds.length).padEnd(3)} ` +
    `del-txn ${String(canTxn.status).padEnd(4)} del-user ${canUser.status}`);

  // the expectations that matter
  // transactions.write sits with super_admin, admin, cfo and finance;
  // ceo reads, hr never touches money.
  const expectTxn = ["super_admin", "admin", "cfo", "finance"].includes(p.role);
  const gotTxn = canTxn.status < 400;
  if (expectTxn !== gotTxn) { console.log(`      WRONG: ${p.role} txn delete should be ${expectTxn}`); bad++; }
  // users.manage is super_admin alone: everybody else gets 403 before the
  // id is even looked up, and super_admin gets 404 for a made-up id.
  if (p.role === "super_admin") {
    if (canUser.status !== 404) { console.log(`      WRONG: super_admin expected 404, got ${canUser.status}`); bad++; }
  } else if (canUser.status !== 403) {
    console.log(`      WRONG: ${p.role} expected 403 on user delete, got ${canUser.status}`); bad++;
  }
  // and the trash listing should not name kinds the role cannot touch
  if (p.role === "hr" && kinds.some((k) => ["transaction", "user", "fx-rate"].includes(k))) {
    console.log("      WRONG: hr sees money kinds in the trash"); bad++;
  }
}

await db.query("delete from transactions where id = $1", [tx.id]);
await db.end();
console.log(bad === 0 ? "\n  the matrix holds" : `\n  ${bad} mismatch(es)`);
process.exit(bad === 0 ? 0 : 1);
