/**
 * The reopen fix, proved.
 *
 * Before: a paid run refused to reopen and said "void those ledger entries
 * first" — and voiding them changed nothing, because the guard read the run's
 * status rather than the ledger. Now the guard asks the ledger, so following
 * the instruction actually works.
 *
 * Cleanup here targets the rows this script created, by id. The last version
 * deleted "everything carrying a payroll_run_id" and took a demo row with it.
 */
import fs from "node:fs";

import { dropPayrollRun, makePayrollRun } from "./payroll-fixture.mjs";
import pg from "pg";

const API = process.env.API;
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const H = { "content-type": "application/json", authorization: `Bearer ${TOK.SUPER_ADMIN}`, "x-requested-with": "finance-web" };
const api = async (p, init) => {
  const r = await fetch(`${API}${p}`, { headers: H, ...init });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const send = (p, m, b) => api(p, { method: m, body: JSON.stringify(b ?? {}) });

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

const baseline = (await db.query("select count(*)::int n from transactions")).rows[0].n;

console.log("\nT4c — REOPEN AFTER VOIDING\n");

const runs = (await api("/payroll/runs")).body;
// The demo used to leave a draft run to borrow. It does not any more, so
// the suite builds its own rather than skipping and calling that a pass.
const fixture = await makePayrollRun(send, api);
const draft = { id: fixture.runId, periodYear: 2026, periodMonth: 9 };
const account = ((await api("/accounts")).body ?? [])[0];

// Remember exactly which ledger rows existed before, so cleanup can tell
// this script's rows from everybody else's.
const rowsBefore = new Set(
  (await db.query("select id from transactions")).rows.map((r) => r.id),
);

if (!draft || !account) meh("fixture", "no draft run or no account");
else {
  await send(`/payroll/runs/${draft.id}/finalize`, "POST");
  const paid = await send(`/payroll/runs/${draft.id}/pay`, "POST", { accountId: account.id, paymentDate: "2026-08-14" });
  if (paid.status !== 200 && paid.status !== 201) bad("pay", `HTTP ${paid.status}`);
  else {
    ok("paid", "a ledger entry now exists for the run");

    const refused = await send(`/payroll/runs/${draft.id}/reopen`, "POST");
    refused.status === 403
      ? ok("reopen refuses while the money is out", `"${refused.body?.message}"`)
      : bad("reopen refuses while the money is out", `HTTP ${refused.status}`);

    // Now do exactly what the message says.
    const live = await db.query(
      "select id from transactions where payroll_run_id = $1 and voided_at is null", [draft.id]);
    for (const row of live.rows) {
      await send(`/transactions/${row.id}/void`, "POST", { reason: "Undoing a test payroll run" });
    }
    ok("voided what the message named", `${live.rows.length} entry/entries`);

    const allowed = await send(`/payroll/runs/${draft.id}/reopen`, "POST");
    allowed.status === 200 || allowed.status === 201
      ? ok("reopen now works — the instruction is true", `HTTP ${allowed.status}`)
      : bad("reopen now works", `HTTP ${allowed.status} "${allowed.body?.message}"`);

    const [{ status }] = (await db.query("select status from payroll_runs where id = $1", [draft.id])).rows;
    status === "draft"
      ? ok("the run is editable again", "back to draft")
      : bad("the run is editable again", `status is ${status}`);

    const balanceMoved = Number((await db.query(
      "select coalesce(sum(signed_amount),0)::numeric s from transactions where payroll_run_id = $1 and voided_at is null", [draft.id])).rows[0].s);
    balanceMoved === 0
      ? ok("no money is out any more", "every entry for the run is voided")
      : bad("no money is out any more", `${balanceMoved} still live`);

    /* ------------------------------------------------------------------ *
     * And the reopened run must be payable.
     *
     * Reopening once moved only the run's status and left every line flagged
     * paid, so the run came back as a draft that could never be paid again —
     * `pay` counted the unpaid lines, found none, and refused. Correcting a
     * salary after a mistaken payment was impossible from the screen. This is
     * the half of "reopen" that matters: not that the badge says draft, but
     * that the run can go out again once it is right.
     * ------------------------------------------------------------------ */
    const lines = (await db.query(
      "select count(*) filter (where is_paid)::int paid, count(*)::int n, count(paid_on)::int dated from payroll_lines where payroll_run_id = $1",
      [draft.id])).rows[0];
    lines.paid === 0 && lines.dated === 0
      ? ok("the lines forget the payment too", `0 of ${lines.n} still flagged paid`)
      : bad("the lines forget the payment", `${lines.paid} of ${lines.n} still flagged paid, ${lines.dated} still carrying a date`);

    const [runRow] = (await db.query(
      "select payment_date, account_id from payroll_runs where id = $1", [draft.id])).rows;
    !runRow.payment_date && !runRow.account_id
      ? ok("and so does the run", "no payment date, no account")
      : bad("the run forgets the payment", `paid ${runRow.payment_date} from ${runRow.account_id}`);

    await send(`/payroll/runs/${draft.id}/finalize`, "POST");
    const payAgain = await send(`/payroll/runs/${draft.id}/pay`, "POST", {
      accountId: account.id, paymentDate: "2026-08-14",
    });
    payAgain.status === 200 || payAgain.status === 201
      ? ok("the corrected run can be paid again", `HTTP ${payAgain.status} — reopening is a way forward, not a dead end`)
      : bad("the corrected run can be paid again", `HTTP ${payAgain.status} "${payAgain.body?.message}"`);

    // Undo that second payment the same way a person would.
    const secondLive = (await db.query(
      "select id from transactions where payroll_run_id = $1 and voided_at is null", [draft.id])).rows;
    for (const row of secondLive) {
      await send(`/transactions/${row.id}/void`, "POST", { reason: "Undoing a test payment" });
    }
    await send(`/payroll/runs/${draft.id}/reopen`, "POST");
  }
}

/* ------------------------------------------------------- cleanup, by id */
const mine = (await db.query("select id from transactions")).rows
  .map((r) => r.id).filter((id) => !rowsBefore.has(id));

if (mine.length) {
  await db.query("delete from audit_logs where entity_id = any($1::text[])", [mine]);
  const gone = await db.query("delete from transactions where id = any($1::uuid[])", [mine]);
  ok("removed only what this script made", `${gone.rowCount} row(s)`);
}
// The run and its two people were made by this suite; they go with it.
const dropped = await dropPayrollRun(db, draft?.id);
ok("removed the run and the people it was for", `${dropped} fixture person/people`);

const after = (await db.query("select count(*)::int n from transactions")).rows[0].n;
after === baseline ? ok("transaction count back to baseline", `${after}`) : bad("transaction count", `was ${baseline}, now ${after}`);

const balances = await db.query(
  `select name, (opening_balance::numeric + coalesce((select sum(signed_amount) from transactions t
     where t.account_id = a.id and t.voided_at is null), 0)) b from accounts a order by name`);
balances.rows.forEach((r) => console.log(`        ${r.name.padEnd(26)} ${r.b}`));

await db.end();
console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
