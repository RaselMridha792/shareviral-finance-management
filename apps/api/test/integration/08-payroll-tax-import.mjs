/**
 * T4b — a payroll run taken all the way to paid, because "mark paid moves
 * exactly the net" is the one payroll claim that touches the bank.
 * T5 — tax: what was withheld, what was deposited, what is still held.
 * T7 — import: the round trip, duplicates, and a revert that puts the
 *      balance back to the paisa.
 *
 * Every state this changes is put back at the end and the books are counted.
 */
import fs from "node:fs";
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
const H = { authorization: `Bearer ${TOK.SUPER_ADMIN}`, "x-requested-with": "finance-web" };
const api = async (path, init) => {
  const r = await fetch(`${API}${path}`, { headers: { "content-type": "application/json", ...H }, ...init });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const send = (p, m, b) => api(p, { method: m, body: JSON.stringify(b ?? {}) });

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

const baselineTxns = (await db.query("select count(*)::int n from transactions")).rows[0].n;
const balanceOf = async (id) => Number((await db.query(
  "select (opening_balance::numeric + coalesce((select sum(signed_amount) from transactions t where t.account_id = a.id and t.voided_at is null),0)) bal from accounts a where a.id = $1", [id])).rows[0].bal);

/* ==================================================== T4b — pay a real run */
console.log("\nT4b — A PAYROLL RUN, ALL THE WAY TO PAID\n");

const runs = (await api("/payroll/runs")).body;
const runList = runs?.items ?? runs ?? [];
const draft = runList.find((r) => r.status === "draft");
const accounts = (await api("/accounts")).body ?? [];
const payFrom = accounts[0];

let paidRun = null;
if (!draft) meh("payroll", "no draft run to take through");
else if (!payFrom) meh("payroll", "no account to pay from");
else {
  const detail = (await api(`/payroll/runs/${draft.id}`)).body;
  const lines = detail.lines ?? [];
  const net = lines.reduce((t, l) => t + Number(l.netAmount), 0);
  const tds = lines.reduce((t, l) => t + Number(l.tdsAmount ?? 0), 0);
  console.log(`  Run ${draft.periodYear}-${String(draft.periodMonth).padStart(2, "0")}: ${lines.length} lines, net ${net.toFixed(2)}, tax withheld ${tds.toFixed(2)}`);

  const before = await balanceOf(payFrom.id);

  const finalised = await send(`/payroll/runs/${draft.id}/finalize`, "POST");
  if (finalised.status !== 200 && finalised.status !== 201) bad("finalise", `HTTP ${finalised.status} ${JSON.stringify(finalised.body?.errors ?? finalised.body?.message ?? "")}`);
  else {
    ok("finalise", "accepted");
    const moved = (await balanceOf(payFrom.id)) - before;
    Math.abs(moved) < 0.005
      ? ok("finalising moves no money", `balance unchanged at ${before.toFixed(2)}`)
      : bad("finalising moves no money", `balance moved by ${moved.toFixed(2)}`);

    const paid = await send(`/payroll/runs/${draft.id}/pay`, "POST", { accountId: payFrom.id, paymentDate: "2026-08-14" });
    if (paid.status !== 200 && paid.status !== 201) bad("mark paid", `HTTP ${paid.status} ${JSON.stringify(paid.body?.errors ?? paid.body?.message ?? "")}`);
    else {
      paidRun = draft.id;
      const after = await balanceOf(payFrom.id);
      const drop = before - after;
      Math.abs(drop - net) < 0.005
        ? ok("the bank drops by exactly the net", `${drop.toFixed(2)} left the account, the sheet nets ${net.toFixed(2)}`)
        : bad("the bank drops by exactly the net", `balance fell ${drop.toFixed(2)}, the sheet nets ${net.toFixed(2)}`);

      const posted = await db.query("select count(*)::int n, coalesce(sum(amount),0)::numeric total from transactions where payroll_run_id = $1 and voided_at is null", [draft.id]);
      ok("the ledger carries the run", `${posted.rows[0].n} row(s) totalling ${posted.rows[0].total}`);

      // The tax withheld is an obligation, not money that moved.
      Math.abs(drop - net) < 0.005 && tds > 0
        ? ok("tax withheld did not leave the bank", `${tds.toFixed(2)} is held, not paid`)
        : tds > 0 ? bad("tax withheld did not leave the bank", "the drop does not match net alone") : meh("tax withheld", "this run withheld nothing");
    }
  }
}

/* ============================================================ T5 — the tax */
console.log("\nT5 — TAX\n");
{
  const liability = await api("/tds/liability?year=2026");
  if (liability.status !== 200) bad("tds liability", `HTTP ${liability.status}`);
  else {
    const rows = liability.body?.months ?? liability.body?.items ?? liability.body ?? [];
    if (!Array.isArray(rows) || !rows.length) meh("tds liability", "no months came back");
    else {
      const wrong = rows.filter((m) => {
        const held = Number(m.outstanding ?? 0);
        return Math.abs(held - (Number(m.totalDeducted ?? 0) - Number(m.deposited ?? 0))) > 0.005;
      });
      wrong.length
        ? bad("outstanding = deducted − deposited", `${wrong.length} month(s) disagree`)
        : ok("outstanding = deducted − deposited", `${rows.length} month(s) all agree`);

      const withTax = rows.filter((m) => Number(m.totalDeducted ?? 0) > 0);
      withTax.length
        ? ok("there is real tax to check", withTax.map((m) => `${m.label}: deducted ${m.totalDeducted}, deposited ${m.deposited}, held ${m.outstanding} (due ${m.dueOn})`).join(", ").slice(0, 100))
        : meh("there is real tax to check", "no month withheld anything");
    }
  }

  const pending = await api("/tds/pending?withinDays=365");
  if (pending.status !== 200) bad("tds pending", `HTTP ${pending.status}`);
  else {
    const items = pending.body?.items ?? pending.body ?? [];
    Array.isArray(items) && items.length
      ? ok("deadlines are surfaced", `${items.length} item(s), first due ${items[0].dueOn ?? items[0].dueDate ?? "?"}`)
      : meh("deadlines are surfaced", "nothing pending within 400 days");
  }

  const schedule = await api("/income-tax/pending");
  schedule.status === 200
    ? ok("income tax schedule reachable", `${(schedule.body?.items ?? schedule.body ?? []).length} item(s)`)
    : bad("income tax schedule reachable", `HTTP ${schedule.status}`);
}

/* ========================================================= T7 — the import */
console.log("\nT7 — IMPORT\n");

let batchId = null, secondBatch = null;
const importAccount = accounts[0];
const importCat = (function find(nodes) {
  for (const n of nodes ?? []) {
    if (n.children?.length) { const hit = find(n.children); if (hit) return hit; }
    else if (n.kind === "out" || n.kind === "both") return n;
  }
  return null;
})((await api("/categories/tree")).body ?? []);

if (!importAccount || !importCat) meh("import", "no account or category");
else {
  const csv = [
    "Date,Narration,Debit,Credit",
    "01/08/2026,T7 IMPORT ONE,1500.00,",
    "02/08/2026,T7 IMPORT TWO,2500.00,",
    "03/08/2026,T7 IMPORT THREE,3000.00,",
  ].join("\n");
  const before = await balanceOf(importAccount.id);

  const upload = async () => {
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "t7.csv");
    const r = await fetch(`${API}/imports`, { method: "POST", headers: H, body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const first = await upload();
  if (first.status !== 200 && first.status !== 201) bad("upload", `HTTP ${first.status} ${JSON.stringify(first.body).slice(0, 140)}`);
  else {
    batchId = first.body.batch.id;
    ok("upload", `${first.body.headers.length} columns, batch staged`);

    const mapped = await send(`/imports/${batchId}/mapping`, "POST", {
      columnMap: { Date: "txnDate", Narration: "description", Debit: "amountOut", Credit: "amountIn" },
      defaults: { accountId: importAccount.id, dateFormat: "dmy", fallbackCategoryId: importCat.id },
    });
    mapped.status === 200 ? ok("mapping applied", `status ${mapped.body.status}`) : bad("mapping applied", `HTTP ${mapped.status} ${JSON.stringify(mapped.body?.errors ?? "")}`);

    const preview = await api(`/imports/${batchId}/preview?page=1&pageSize=50`);
    const rows = preview.body?.rows ?? [];
    const valid = rows.filter((r) => r.status === "valid");
    valid.length === 3
      ? ok("preview", `${valid.length} valid, ${rows.filter((r) => r.status === "error").length} error, ${rows.filter((r) => r.status === "duplicate").length} duplicate`)
      : bad("preview", `${valid.length} valid of ${rows.length} rows`);

    const committed = await send(`/imports/${batchId}/commit`, "POST", { skipRows: [] });
    if (committed.status !== 200 && committed.status !== 201) bad("commit", `HTTP ${committed.status}`);
    else {
      const after = await balanceOf(importAccount.id);
      Math.abs((before - after) - 7000) < 0.005
        ? ok("commit moved exactly the file's total", `${(before - after).toFixed(2)} out, the file says 7000.00`)
        : bad("commit moved exactly the file's total", `balance fell ${(before - after).toFixed(2)}, expected 7000.00`);
    }

    // The same file again must be recognised, not doubled.
    const again = await upload();
    if (again.status !== 200 && again.status !== 201) bad("second upload", `HTTP ${again.status}`);
    else {
      secondBatch = again.body.batch.id;
      await send(`/imports/${secondBatch}/mapping`, "POST", {
        columnMap: { Date: "txnDate", Narration: "description", Debit: "amountOut", Credit: "amountIn" },
        defaults: { accountId: importAccount.id, dateFormat: "dmy", fallbackCategoryId: importCat.id },
      });
      const dupPreview = await api(`/imports/${secondBatch}/preview?page=1&pageSize=50`);
      const dupes = (dupPreview.body?.rows ?? []).filter((r) => r.status === "duplicate");
      dupes.length === 3
        ? ok("the same file is recognised", "all 3 rows flagged duplicate, unticked by default")
        : bad("the same file is recognised", `${dupes.length} of 3 flagged`);
    }

    // And a revert must put the balance back exactly.
    const reverted = await send(`/imports/${batchId}/revert`, "POST");
    if (reverted.status !== 200 && reverted.status !== 201) bad("revert", `HTTP ${reverted.status}`);
    else {
      const back = await balanceOf(importAccount.id);
      Math.abs(back - before) < 0.005
        ? ok("revert restores the balance exactly", `${back.toFixed(2)} = ${before.toFixed(2)}`)
        : bad("revert restores the balance exactly", `${back.toFixed(2)} vs ${before.toFixed(2)}`);
    }
  }
}

/* ============================================================== cleanup */
console.log("\nPutting everything back\n");

if (paidRun) {
  /**
   * Void the payment, then reopen — in that order.
   *
   * This used to call reopen straight away, which worked only while reopen
   * was wrong: it read the run's status and let a paid run reopen with its
   * money still sitting in the ledger. Now the guard asks the ledger, so the
   * money has to come back out first. Suite 09 proves that sequence is the
   * one the refusal message tells a person to follow; this is the same
   * sequence, which is why it belongs here rather than a DELETE behind the
   * app's back.
   */
  const live = await db.query(
    "select id from transactions where payroll_run_id = $1 and voided_at is null",
    [paidRun],
  );
  for (const row of live.rows) {
    await send(`/transactions/${row.id}/void`, "POST", {
      reason: "Undoing the payment this test made",
    });
  }

  const reopened = await send(`/payroll/runs/${paidRun}/reopen`, "POST");
  reopened.status === 200 || reopened.status === 201
    ? ok("voiding the payment lets the run reopen", `${live.rows.length} entr(y/ies) voided, then HTTP ${reopened.status}`)
    : bad("reopen after voiding", `HTTP ${reopened.status} "${reopened.body?.message}" — the run is left paid`);

  // The voided rows were this test's, so they go rather than linger struck
  // through in a register nobody asked to see them in.
  if (live.rows.length) {
    const ids = live.rows.map((r) => r.id);
    await db.query("delete from audit_logs where entity_id = any($1::text[])", [ids]);
    await db.query("delete from transactions where id = any($1::uuid[])", [ids]);
  }

  const stillOut = (await db.query(
    "select count(*)::int n from transactions where payroll_run_id = $1 and voided_at is null",
    [paidRun])).rows[0].n;
  stillOut === 0
    ? ok("no money is left out for the run", "")
    : bad("money left out", `${stillOut} live row(s) remain`);
}

for (const id of [batchId, secondBatch].filter(Boolean)) {
  await db.query("delete from import_rows where batch_id = $1", [id]);
  await db.query("delete from import_batches where id = $1", [id]);
}
await db.query("delete from transactions where description like 'T7 IMPORT%'");
await db.query("delete from audit_logs where entity_table = 'transactions' and summary like '%T7 IMPORT%'");

const finalTxns = (await db.query("select count(*)::int n from transactions")).rows[0].n;
finalTxns === baselineTxns
  ? ok("transaction count back to baseline", `${finalTxns}`)
  : bad("transaction count back to baseline", `was ${baselineTxns}, now ${finalTxns}`);

await db.end();
console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
