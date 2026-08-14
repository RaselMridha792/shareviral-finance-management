/**
 * T2 (ledger CRUD), T4 (payroll) and T10 (audit) in one pass, because they
 * share a fixture: a run touches the ledger, and every one of those writes
 * must leave an audit row.
 *
 * Everything created here is removed at the end and the books are counted back
 * to where they started.
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
const H = { "content-type": "application/json", authorization: `Bearer ${TOK.SUPER_ADMIN}`, "x-requested-with": "finance-web" };
const api = async (path, init) => {
  const r = await fetch(`${API}${path}`, { headers: H, ...init });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const send = (path, method, body) => api(path, { method, body: JSON.stringify(body) });

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

const before = {
  txns: (await db.query("select count(*)::int n from transactions")).rows[0].n,
  audit: (await db.query("select count(*)::int n from audit_logs")).rows[0].n,
};

const accounts = (await api("/accounts")).body ?? [];
const account = accounts[0];
const other = accounts[1];
const tree = (await api("/categories/tree")).body ?? [];
const leafFor = (want) => (function find(nodes) {
  for (const n of nodes ?? []) {
    if (n.children?.length) { const hit = find(n.children); if (hit) return hit; }
    else if (n.kind === want || n.kind === "both") return n;
  }
  return null;
})(tree);
const outCat = leafFor("out");

const made = [];

/* ========================================================== T2 — the ledger */
console.log("\nT2 — THE LEDGER\n");

if (!account || !outCat) {
  meh("fixtures", "no account or category to work with");
} else {
  const created = await send("/transactions", "POST", {
    txnDate: "2026-08-14", amount: "5000.00", direction: "out",
    description: "T2 rent check", accountId: account.id, categoryId: outCat.id,
    receiptUrl: "https://drive.google.com/file/d/T2CHECK/view",
  });
  if (created.status !== 201) bad("create", `HTTP ${created.status} ${JSON.stringify(created.body?.errors ?? "")}`);
  else {
    made.push(created.body.id);
    ok("create", `${created.body.refNo}, receipt kept`);
    /^TXN-\d{4}-\d{6}$/.test(created.body.refNo)
      ? ok("reference number shape", created.body.refNo)
      : bad("reference number shape", created.body.refNo);
  }

  // Edit: a PATCH must change only what it names.
  const id = made[0];
  if (id) {
    const patched = await send(`/transactions/${id}`, "PATCH", { description: "T2 rent check — corrected" });
    if (patched.status !== 200) bad("edit", `HTTP ${patched.status}`);
    else {
      const row = (await api(`/transactions/${id}`)).body;
      row.description === "T2 rent check — corrected" && row.amount === "5000.00" && row.receiptUrl?.includes("T2CHECK")
        ? ok("edit changes only what it names", "description moved, amount and receipt untouched")
        : bad("edit changes only what it names", `amount ${row.amount}, receipt ${row.receiptUrl}`);
    }
  }

  // Tax withheld needs a gross bill beside it, and only on money going out.
  const noBill = await send("/transactions", "POST", {
    txnDate: "2026-08-14", amount: "9000.00", direction: "out",
    description: "T2 withheld without a bill", accountId: account.id, categoryId: outCat.id,
    withheldTaxAmount: "1000.00",
  });
  noBill.status === 400
    ? ok("tax withheld demands a gross bill", "refused, as the schema says")
    : bad("tax withheld demands a gross bill", `HTTP ${noBill.status} — it was accepted`);

  const withBill = await send("/transactions", "POST", {
    txnDate: "2026-08-14", amount: "9000.00", direction: "out",
    description: "T2 withheld with a bill", accountId: account.id, categoryId: outCat.id,
    withheldTaxAmount: "1000.00", billAmount: "10000.00",
  });
  if (withBill.status === 201) { made.push(withBill.body.id); ok("tax withheld with a bill", `${withBill.body.refNo}, bill 10000 = paid 9000 + tax 1000`); }
  else bad("tax withheld with a bill", `HTTP ${withBill.status} ${JSON.stringify(withBill.body?.errors ?? "")}`);

  // A transfer is a linked pair, not two entries that happen to match.
  if (other) {
    const transfer = await send("/transactions/transfer", "POST", {
      txnDate: "2026-08-14", amount: "2500.00",
      fromAccountId: account.id, toAccountId: other.id,
      description: "T2 transfer check",
    });
    if (transfer.status !== 201 && transfer.status !== 200) bad("transfer", `HTTP ${transfer.status} ${JSON.stringify(transfer.body?.errors ?? transfer.body?.message ?? "")}`);
    else {
      const pair = await db.query(
        "select id, direction, account_id, transfer_group_id from transactions where description = 'T2 transfer check' and voided_at is null");
      made.push(...pair.rows.map((r) => r.id));
      const groups = new Set(pair.rows.map((r) => r.transfer_group_id));
      pair.rows.length === 2 && groups.size === 1 && [...groups][0]
        ? ok("transfer is one linked pair", `2 rows sharing group ${String([...groups][0]).slice(0, 8)}…`)
        : bad("transfer is one linked pair", `${pair.rows.length} rows, ${groups.size} group(s)`);
    }
  } else meh("transfer", "only one account exists");
}

/* ========================================================= T4 — the payroll */
console.log("\nT4 — PAYROLL\n");

const runs = (await api("/payroll/runs")).body ?? [];
const runList = runs.items ?? runs;
if (!Array.isArray(runList) || !runList.length) meh("payroll", "no runs exist to inspect");
else {
  const run = (await api(`/payroll/runs/${runList[0].id}`)).body;
  const lines = run.lines ?? [];
  if (!lines.length) meh("payroll lines", "the run has no lines");
  else {
    ok("a run opens with its lines", `${lines.length} line(s), status ${run.run?.status ?? run.status}`);

    // Net must be gross minus what was withheld, computed by the database.
    const wrong = lines.filter((l) => {
      const net = Number(l.netAmount), gross = Number(l.grossAmount), tds = Number(l.tdsAmount ?? 0);
      const bonus = Number(l.bonusAmount ?? 0), other = Number(l.otherAdditions ?? 0), ded = Number(l.otherDeductions ?? 0);
      return Math.abs(net - (gross + bonus + other - tds - ded)) > 0.005;
    });
    wrong.length
      ? bad("net = gross + additions − tax − deductions", `${wrong.length} line(s) disagree, e.g. ${wrong[0].fullName}`)
      : ok("net = gross + additions − tax − deductions", `all ${lines.length} lines agree`);

    // Contractors are never on a salary sheet.
    const people = await db.query("select full_name from team_members where engagement_type = 'contractor' and deleted_at is null");
    const names = new Set(lines.map((l) => l.fullName));
    const onSheet = people.rows.filter((p) => names.has(p.full_name));
    people.rows.length === 0
      ? meh("contractors stay off the sheet", "no contractors exist to check")
      : onSheet.length
        ? bad("contractors stay off the sheet", `${onSheet.map((p) => p.full_name).join(", ")} is on it`)
        : ok("contractors stay off the sheet", `${people.rows.length} contractor(s), none on the sheet`);

    // A paid run must have put its money in the ledger.
    const status = run.run?.status ?? run.status;
    if (status === "paid") {
      const net = lines.reduce((t, l) => t + Number(l.netAmount), 0);
      const posted = await db.query(
        "select coalesce(sum(amount),0)::numeric as total from transactions where payroll_run_id = $1 and voided_at is null",
        [runList[0].id]);
      Math.abs(Number(posted.rows[0].total) - net) < 0.005
        ? ok("a paid run posted exactly its net", `${net.toFixed(2)} in the ledger`)
        : bad("a paid run posted exactly its net", `ledger has ${posted.rows[0].total}, the sheet nets ${net.toFixed(2)}`);
    } else meh("a paid run posts its net", `this run is ${status}, not paid`);

    const slip = await api(`/payroll/lines/${lines[0].id}/payslip`);
    slip.status === 200 && slip.body.fullName
      ? ok("payslip", `${slip.body.fullName}, net ${slip.body.netAmount}`)
      : bad("payslip", `HTTP ${slip.status}`);
  }
}

/* ============================================================ T10 — audit */
console.log("\nT10 — THE AUDIT TRAIL\n");

if (!made.length) meh("audit", "nothing was written to audit");
else {
  for (const id of made.slice(0, 2)) {
    const rows = await db.query(
      "select action, summary, before, after, changed_fields from audit_logs where entity_id = $1 order by occurred_at", [id]);
    if (!rows.rows.length) { bad("every write is audited", `nothing recorded for ${id}`); continue; }

    const create = rows.rows.find((r) => r.action === "create");
    create
      ? ok("create is audited", `"${String(create.summary).slice(0, 62)}"`)
      : bad("create is audited", `only ${rows.rows.map((r) => r.action).join(", ")}`);

    const update = rows.rows.find((r) => r.action === "update");
    if (update) {
      update.before && update.after
        ? ok("an edit records before and after", `changed: ${(update.changed_fields ?? []).join(", ") || "(not listed)"}`)
        : bad("an edit records before and after", `before=${Boolean(update.before)} after=${Boolean(update.after)}`);
    }
  }

  /**
   * A sensitive row is redacted, not hidden — the entry stays so you can see
   * THAT a compensation record changed and who changed it, while before/after
   * are blanked. Admin holds team.compensation.read, so admin sees the figures.
   */
  const sensitive = await db.query("select count(*)::int n from audit_logs where is_sensitive = true");
  if (!sensitive.rows[0].n) meh("sensitive audit rows", "none exist to check");
  else {
    const asAdmin = await fetch(`${API}/audit?page=1&pageSize=200`, {
      headers: { authorization: `Bearer ${TOK.ADMIN}`, "x-requested-with": "finance-web" },
    }).then((r) => r.json());
    const rows = (asAdmin.items ?? asAdmin.data ?? []).filter((r) => r.isSensitive);
    if (!rows.length) meh("admin sees compensation history", "none came back on this page");
    else {
      rows.every((r) => r.redacted === false)
        ? ok("admin sees compensation figures", `${rows.length} sensitive row(s), none redacted — admin holds team.compensation.read`)
        : bad("admin sees compensation figures", "some were redacted from a role that holds the permission");
    }

    /**
     * The redaction itself cannot be exercised: every role that can open the
     * audit log (super_admin, ceo, admin) also holds team.compensation.read,
     * and the two that lack it (finance, hr) are refused the log outright. So
     * this branch has never run against a real request. Saying so is the point
     * — a guard nobody can reach is a guard nobody has tested.
     */
    meh("redaction for a role without the permission",
      "unreachable today: every role with audit.read also has team.compensation.read");
  }
}

/* ============================================================== cleanup */
console.log("\nPutting the books back\n");
if (made.length) {
  await db.query("delete from audit_logs where entity_id = any($1::text[])", [made]);
  const gone = await db.query("delete from transactions where id = any($1::uuid[])", [made]);
  ok("test rows removed", `${gone.rowCount} deleted`);
}
const after = {
  txns: (await db.query("select count(*)::int n from transactions")).rows[0].n,
};
after.txns === before.txns
  ? ok("transaction count back to baseline", `${after.txns}`)
  : bad("transaction count back to baseline", `was ${before.txns}, now ${after.txns}`);

await db.end();
console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
