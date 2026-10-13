/**
 * Accounts ▸ Bank status, Check ticked by hand — piece 4d-2 of
 * docs/briefs/2026-10-13-books-month-and-bank-status.md.
 *
 *   1. Tick a row: it reads ticked, with who and when, and still does on a
 *      fresh read (the reload); the account beside it and the month beside it
 *      do not.
 *   2. Ticking twice keeps one row and writes no second audit.
 *   3. Untick: the row is gone, the next read has no tick.
 *   4. A reconciled month still reports reconciled with no tick, and
 *      unticking there leaves it reconciled.
 *   5. A reader (CEO) sees the tick and gets 403 ticking; a bad month is 400,
 *      an unknown account 404.
 *   6. The audit holds both the tick and the untick.
 *
 * WRITES TICKS AND A STATEMENT, then removes them. Run it on a copy, never on
 * Neon or live, so BS_DB has no default:
 *
 *   BS_DB=postgres://postgres:pw@localhost:55438/sfm \
 *   BS_API=http://localhost:4099/api node .bankcheckqa.mjs
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = process.env.BS_API ?? "http://localhost:4099/api";
if (!process.env.BS_DB) {
  console.error("BS_DB is required: the connection string of a COPY of the database.");
  process.exit(2);
}

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
const db = new pg.Client({ connectionString: process.env.BS_DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const tokenFor = async (role) => {
  const p = (
    await q(`select id, role, full_name, token_version from users where role=$1 and status='active' and deleted_at is null order by created_at limit 1`, [role])
  )[0];
  if (!p) throw new Error(`no active ${role} on the copy`);
  return { id: p.id, name: p.full_name, token: jwt.sign({ sub: p.id, role: p.role, tv: p.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" }) };
};
const admin = await tokenFor("super_admin");
const cfo = await tokenFor("cfo");
const ceo = await tokenFor("ceo");

const callAs = async (who, method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${who.token}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const read = async (month, who = admin) => {
  const r = await callAs(who, "GET", `/accounts/bank-status?month=${month}`);
  if (r.status !== 200) throw new Error(`read ${month}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
};
const tick = (who, accountId, month, checked) =>
  callAs(who, "PUT", "/accounts/bank-status/check", { accountId, month, checked });

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
};

const MAY = "2026-05-01";
const JUNE = "2026-06-01";
const AUG = "2026-08-01";
const may = await read(MAY);
const [a, b] = may.rows;
if (!a || !b) throw new Error("the copy needs two accounts on Bank status");
const audits = async (id) =>
  q(`select action from audit_logs where entity_table = 'account_month_checks' and entity_id = $1 order by occurred_at`, [id]);

const started = new Date();
let tickId = null;
let statementId = null;
try {
  /* ---------------------------------------------------------------------- */
  console.log("1. tick, then reload");
  check("May starts with no hand tick anywhere", may.rows.every((r) => r.check === null));
  const t = await tick(cfo, a.accountId, MAY, true);
  check("the CFO ticks it: 200", t.status === 200, t.status);
  check("the answer names who", t.body?.check?.checkedBy === cfo.name, t.body?.check?.checkedBy);
  const after = await read(MAY);
  const rowA = after.rows.find((r) => r.accountId === a.accountId);
  const rowB = after.rows.find((r) => r.accountId === b.accountId);
  check("on reload the row is ticked, by the CFO", rowA.check?.checkedBy === cfo.name, JSON.stringify(rowA.check));
  check("checkedAt is now", Math.abs(new Date(rowA.check?.checkedAt) - started) < 120_000, rowA.check?.checkedAt);
  check("the account beside it is not ticked", rowB.check === null);
  const june = await read(JUNE);
  check("the same account in June is not ticked", june.rows.find((r) => r.accountId === a.accountId)?.check === null);
  const [stored] = await q(`select id, checked_by from account_month_checks where account_id = $1 and month = $2`, [a.accountId, MAY]);
  tickId = stored?.id;
  check("one row in account_month_checks, checked_by the CFO", stored?.checked_by === cfo.id);

  /* ---------------------------------------------------------------------- */
  console.log("2. ticking twice");
  const again = await tick(admin, a.accountId, MAY, true);
  check("200, still the CFO's tick", again.status === 200 && again.body?.check?.checkedBy === cfo.name, again.body?.check?.checkedBy);
  const rows = await q(`select count(*)::int as n from account_month_checks where account_id = $1 and month = $2`, [a.accountId, MAY]);
  check("still one row", rows[0].n === 1);
  check("one audit so far (the create)", (await audits(tickId)).map((x) => x.action).join() === "create");

  /* ---------------------------------------------------------------------- */
  console.log("3. untick");
  const off = await tick(admin, a.accountId, MAY, false);
  check("200, check null", off.status === 200 && off.body?.check === null, JSON.stringify(off.body));
  check("on reload it is no longer ticked", (await read(MAY)).rows.find((r) => r.accountId === a.accountId).check === null);
  const left = await q(`select count(*)::int as n from account_month_checks where account_id = $1`, [a.accountId]);
  check("the row is deleted", left[0].n === 0);
  const offAgain = await tick(admin, a.accountId, MAY, false);
  check("unticking what is not ticked: 200, nothing written", offAgain.status === 200 && offAgain.body?.check === null);

  /* ---------------------------------------------------------------------- */
  console.log("4. a reconciled month still reads Matched with no tick");
  const [st] = await q(
    `insert into statements (period_start, period_end, status, updated_by)
     values ($1, '2026-08-31', 'reconciled', $2) returning id`,
    [AUG, admin.id],
  );
  statementId = st.id;
  const aug = await read(AUG);
  check("August reconciled, no row ticked", aug.reconciled === true && aug.rows.every((r) => r.check === null));
  await tick(cfo, b.accountId, AUG, true);
  await tick(cfo, b.accountId, AUG, false);
  const aug2 = await read(AUG);
  check("tick and untick there: still reconciled, no tick", aug2.reconciled === true && aug2.rows.find((r) => r.accountId === b.accountId).check === null);
  const augAudit = await q(
    `select action from audit_logs where entity_table = 'account_month_checks' and summary like $1 and occurred_at >= $2 order by occurred_at`,
    [`%, August 2026`, started],
  );
  check("both audited in August too", augAudit.map((x) => x.action).join() === "create,delete", augAudit.map((x) => x.action).join());

  /* ---------------------------------------------------------------------- */
  console.log("5. readers and bad input");
  await tick(cfo, a.accountId, MAY, true);
  const seen = await read(MAY, ceo);
  check("the CEO sees the tick", seen.rows.find((r) => r.accountId === a.accountId)?.check?.checkedBy === cfo.name);
  const refused = await tick(ceo, a.accountId, MAY, false);
  check("the CEO cannot untick: 403", refused.status === 403, refused.status);
  const refused2 = await tick(ceo, b.accountId, MAY, true);
  check("the CEO cannot tick: 403", refused2.status === 403, refused2.status);
  check("the tick survived the CEO", (await q(`select count(*)::int as n from account_month_checks where account_id = $1`, [a.accountId]))[0].n === 1);
  const bad = await tick(cfo, a.accountId, "2026-05-02", true);
  check("a month that is not a 1st: 400", bad.status === 400, bad.status);
  const none = await tick(cfo, "00000000-0000-4000-8000-000000000000", MAY, true);
  check("an unknown account: 404", none.status === 404, none.status);
  const notBool = await callAs(cfo, "PUT", "/accounts/bank-status/check", { accountId: a.accountId, month: MAY, checked: "yes" });
  check("checked must be true or false: 400", notBool.status === 400, notBool.status);
  await tick(cfo, a.accountId, MAY, false);

  /* ---------------------------------------------------------------------- */
  console.log("6. the audit");
  const trail = await audits(tickId);
  check("the first tick: create then delete", trail.map((x) => x.action).join() === "create,delete", trail.map((x) => x.action).join());
  const summaries = await q(
    `select summary from audit_logs where entity_table = 'account_month_checks' and occurred_at >= $1 order by occurred_at`,
    [started],
  );
  check(
    "summaries say Ticked / Unticked, the account and the month",
    summaries.length === 6 &&
      summaries.every((s) => /^(Ticked|Unticked) the Bank status check for .+, (May|August) 2026$/.test(s.summary)),
    `${summaries.length}: ${summaries[0]?.summary}`,
  );
} finally {
  await q(`delete from account_month_checks where checked_at >= $1`, [started]);
  if (statementId) await q(`delete from statements where id = $1`, [statementId]);
  await db.end();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
