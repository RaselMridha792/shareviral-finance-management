/**
 * HR Budget through the API (#121) — as the HR portal sends it, and as
 * finance decides it. Every claim is read back from the database, not the
 * response: the row after a first send, and again after a repeat.
 *
 * The shapes were settled with the HR portal's session on 30 Sep 2026; this
 * is the contract, checked:
 *   A. a budget: 201 then 200 on a repeat that amends (one row, send_count
 *      2); strict bodies; nullable keys must be present; dates real and in
 *      order; state read back by ids, unknown ones left out;
 *   B. a spend: may arrive before its budget (budgetKnown false, then true
 *      when it lands); teamMemberId null with a name is fine, an unknown one
 *      is 404; HR's approval both-or-neither; a repeat amends;
 *   C. finance: approve, refuse (with a note), put back; once decided a
 *      repeat is 409 WITH the state and the row does not move; paying an
 *      approved spend writes an expense (read back from transactions) and
 *      marks it paid; the page's lists sum in SQL;
 *   D. who: HR sends and reads state, cannot see the page or decide; the CEO
 *      reads the page, cannot send or decide; the CFO does everything.
 *
 *     node .hrbudgetqa.mjs      (needs the API: npm run dev, :4001)
 */
import crypto from "node:crypto";
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
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const who = async (role) =>
  (await q(`select id, role, token_version, full_name from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role]))[0];
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const users = { super_admin: await who("super_admin"), cfo: await who("cfo"), ceo: await who("ceo"), hr: await who("hr") };
const as = (user) => async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const hr = as(users.hr);
const cfo = as(users.cfo ?? users.super_admin);
const ceo = users.ceo ? as(users.ceo) : null;

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const msg = (r) => `${r.status} ${r.body?.message ?? ""} ${JSON.stringify(r.body?.errors ?? "")}`;

const MARK = `HRBQA-${Date.now().toString(36)}`;
const id = () => crypto.randomUUID();
const PERIOD = id();
const LATE_PERIOD = id();
const SPEND = id();
const EARLY_SPEND = id();
const period = (over = {}) => ({
  externalId: PERIOD,
  categoryName: `${MARK} Hiring`,
  startsOn: "2026-09-01",
  endsOn: "2026-11-30",
  amount: "500000.00",
  note: null,
  recordedByName: "Nusrat (HR)",
  ...over,
});
const spend = (over = {}) => ({
  externalId: SPEND,
  budgetExternalId: PERIOD,
  spentOn: "2026-09-14",
  amount: "1250.50",
  purpose: `${MARK} Two laptop bags`,
  teamMemberId: null,
  employeeName: "Rasel Sarker",
  hrStatus: "approved",
  hrApprovedByName: "Nusrat (HR)",
  hrApprovedAt: "2026-09-14T15:00:00+06:00",
  recordedByName: "Nusrat (HR)",
  hasReceipt: true,
  ...over,
});
const periodRow = async (externalId) => (await q(`select *, amount::text amt, starts_on::text s, ends_on::text e from hr_budget_periods where external_id = $1`, [externalId]))[0];
const spendRow = async (externalId) => (await q(`select *, amount::text amt, spent_on::text sp, paid_on::text po from hr_budget_spends where external_id = $1`, [externalId]))[0];

let txnId = null;
try {
  /* ------------------------------------------------------------------ */
  console.log("\nA. A budget, as HR sends it");
  const first = await hr("POST", "/hr-budget/periods", period());
  let row = await periodRow(PERIOD);
  check("a first send: 201, state received", first.status === 201 && first.body?.status === "received" && first.body?.externalId === PERIOD, msg(first));
  check("…the row holds exactly what was sent", row?.category_name === `${MARK} Hiring` && row?.s === "2026-09-01" && row?.e === "2026-11-30" && row?.amt === "500000.00" && row?.note === null && row?.recorded_by_name === "Nusrat (HR)" && row?.send_count === 1, JSON.stringify({ amt: row?.amt, s: row?.s, e: row?.e, n: row?.send_count }));
  const again = await hr("POST", "/hr-budget/periods", period({ amount: "450000", note: "Trimmed" }));
  row = await periodRow(PERIOD);
  const count = (await q(`select count(*)::int n from hr_budget_periods where external_id = $1`, [PERIOD]))[0].n;
  check("a repeat amends: 200, one row, the new amount and note, send_count 2", again.status === 200 && count === 1 && row?.amt === "450000.00" && row?.note === "Trimmed" && row?.send_count === 2, `${again.status} rows ${count} ${row?.amt} ${row?.send_count}`);

  for (const [label, body] of [
    ["an amount as a JSON number", { ...period(), amount: 450000 }],
    ["a nullable key left out", (({ note, ...rest }) => rest)(period())],
    ["an unknown key", { ...period(), colour: "red" }],
    ["an end before the start", period({ startsOn: "2026-11-30", endsOn: "2026-09-01" })],
    ["a day that does not exist", period({ startsOn: "2026-02-30" })],
    ["a zero amount", period({ amount: "0" })],
  ]) {
    const r = await hr("POST", "/hr-budget/periods", body);
    check(`refused, 400: ${label}`, r.status === 400, msg(r));
  }
  row = await periodRow(PERIOD);
  check("…and none of those moved the row", row?.amt === "450000.00" && row?.send_count === 2);

  const states = await hr("GET", `/hr-budget/periods/status?externalIds=${PERIOD},${id()}`);
  check("state read back by ids — the unknown one left out", states.status === 200 && states.body?.length === 1 && states.body[0].externalId === PERIOD && states.body[0].status === "received", JSON.stringify(states.body));
  const tooMany = await hr("GET", `/hr-budget/periods/status?externalIds=${Array.from({ length: 101 }, id).join(",")}`);
  check("more than 100 ids at once: 400", tooMany.status === 400, String(tooMany.status));

  /* ------------------------------------------------------------------ */
  console.log("\nB. Spends");
  const early = await hr("POST", "/hr-budget/spends", spend({ externalId: EARLY_SPEND, budgetExternalId: LATE_PERIOD, amount: "800" }));
  check("a spend before its budget is here: accepted, budgetKnown false", early.status === 201 && early.body?.budgetKnown === false, msg(early));
  await hr("POST", "/hr-budget/periods", period({ externalId: LATE_PERIOD, categoryName: `${MARK} Training` }));
  const linked = await hr("GET", `/hr-budget/spends/status?externalIds=${EARLY_SPEND}`);
  check("…and linked once the budget lands", linked.body?.[0]?.budgetKnown === true, JSON.stringify(linked.body?.[0]));

  const s1 = await hr("POST", "/hr-budget/spends", spend());
  let srow = await spendRow(SPEND);
  check("a spend for a person not linked yet (teamMemberId null, a name): 201", s1.status === 201 && srow?.team_member_id === null && srow?.employee_name === "Rasel Sarker", msg(s1));
  check("…the row holds what was sent — amount, day, HR's approval, receipt", srow?.amt === "1250.50" && srow?.sp === "2026-09-14" && srow?.hr_status === "approved" && srow?.hr_approved_by_name === "Nusrat (HR)" && new Date(srow?.hr_approved_at).toISOString() === "2026-09-14T09:00:00.000Z" && srow?.has_receipt === true && srow?.send_count === 1, JSON.stringify({ a: srow?.amt, at: srow?.hr_approved_at }));
  const unknownPerson = await hr("POST", "/hr-budget/spends", spend({ externalId: id(), teamMemberId: id() }));
  check("a teamMemberId that is not a team member here: 404 No such team member", unknownPerson.status === 404 && /No such team member/.test(unknownPerson.body?.message ?? ""), msg(unknownPerson));
  const half = await hr("POST", "/hr-budget/spends", spend({ externalId: id(), hrApprovedAt: null }));
  check("HR's approval half-sent: 400", half.status === 400, msg(half));
  const approvedNobody = await hr("POST", "/hr-budget/spends", spend({ externalId: id(), hrApprovedByName: null, hrApprovedAt: null }));
  check("approved with nobody named: 400", approvedNobody.status === 400, msg(approvedNobody));
  const proposed = await hr("POST", "/hr-budget/spends", spend({ externalId: id(), hrStatus: "proposed", hrApprovedByName: null, hrApprovedAt: null, amount: "300" }));
  check("proposed with neither: 201", proposed.status === 201, msg(proposed));
  const s2 = await hr("POST", "/hr-budget/spends", spend({ amount: "1300", purpose: `${MARK} Two laptop bags and a lock` }));
  srow = await spendRow(SPEND);
  check("a repeat amends the spend: 200, one row, send_count 2", s2.status === 200 && srow?.amt === "1300.00" && srow?.send_count === 2 && (await q(`select count(*)::int n from hr_budget_spends where external_id = $1`, [SPEND]))[0].n === 1, `${s2.status} ${srow?.amt}`);

  /* ------------------------------------------------------------------ */
  console.log("\nC. Finance decides");
  const pid = (await periodRow(PERIOD)).id;
  const approve = await cfo("POST", `/hr-budget/periods/${pid}/decision`, { decision: "approved", note: null });
  row = await periodRow(PERIOD);
  check("the budget approved: state and row", approve.status === 200 && approve.body?.status === "approved" && approve.body?.decidedByName && row?.status === "approved" && row?.decided_at !== null, msg(approve));
  const late = await hr("POST", "/hr-budget/periods", period({ amount: "999999" }));
  row = await periodRow(PERIOD);
  check("a repeat after the decision: 409 WITH the state, and the row does not move", late.status === 409 && late.body?.state?.status === "approved" && row?.amt === "450000.00" && row?.send_count === 2, `${late.status} ${late.body?.state?.status} ${row?.amt}`);
  const noNote = await cfo("POST", `/hr-budget/periods/${pid}/decision`, { decision: "refused", note: null });
  check("refusing without saying why: 400", noNote.status === 400, msg(noNote));
  const back = await cfo("POST", `/hr-budget/periods/${pid}/decision`, { decision: "received", note: null });
  const amendAgain = await hr("POST", "/hr-budget/periods", period({ amount: "480000" }));
  row = await periodRow(PERIOD);
  check("put back to received: HR's repeat amends again", back.status === 200 && amendAgain.status === 200 && row?.amt === "480000.00" && row?.decided_at === null && row?.send_count === 3, `${amendAgain.status} ${row?.amt}`);
  await cfo("POST", `/hr-budget/periods/${pid}/decision`, { decision: "approved", note: null });

  const sid = (await spendRow(SPEND)).id;
  const sApprove = await cfo("POST", `/hr-budget/spends/${sid}/decision`, { decision: "approved", note: null });
  check("the spend approved", sApprove.status === 200 && sApprove.body?.status === "approved", msg(sApprove));

  const accounts = (await cfo("GET", "/accounts")).body ?? [];
  const payFrom = [...accounts].filter((a) => a.type === "bank" || a.type === "cash").sort((a, b) => Number(b.balance ?? 0) - Number(a.balance ?? 0))[0];
  const heading = (await q(`select id from categories where kind in ('out','both') and is_active and parent_id is not null order by created_at limit 1`))[0];
  const today = new Date(Date.now() + 6 * 3600000).toISOString().slice(0, 10);
  const proposedId = (await q(`select id::text from hr_budget_spends where purpose like $1 and hr_status = 'proposed'`, [`${MARK}%`]))[0].id;
  const payEarly = await cfo("POST", `/hr-budget/spends/${proposedId}/pay`, { accountId: payFrom.id, categoryId: heading.id, txnDate: today, usdRate: "121.50", description: `${MARK} too early`, notes: null });
  check("paying a spend finance has not approved: refused, and nothing written", payEarly.status === 400 && /Approve the spend before paying/.test(payEarly.body?.message ?? "") && (await q(`select count(*)::int n from transactions where description = $1`, [`${MARK} too early`]))[0].n === 0, msg(payEarly));
  const paid = await cfo("POST", `/hr-budget/spends/${sid}/pay`, { accountId: payFrom.id, categoryId: heading.id, txnDate: today, usdRate: "121.50", description: `${MARK} HR spend: two laptop bags`, notes: null });
  srow = await spendRow(SPEND);
  txnId = srow?.transaction_id;
  const txn = txnId ? (await q(`select direction::text d, amount::text amt, account_id::text acc, category_id::text cat, txn_date::text dt, description, usd_rate::text rate from transactions where id = $1`, [txnId]))[0] : null;
  check("paying: the spend is paid on that day and points at its entry", paid.status === 200 && paid.body?.status === "paid" && paid.body?.paidOn === today && srow?.status === "paid" && srow?.po === today && Boolean(txnId), msg(paid));
  check("…and the entry is in the books: out, the spend's amount, the account and heading chosen", txn?.d === "out" && txn?.amt === "1300.00" && txn?.acc === payFrom.id && txn?.cat === heading.id && txn?.dt === today && txn?.rate === "121.500000", JSON.stringify(txn));
  const afterPaid = await hr("POST", "/hr-budget/spends", spend({ amount: "5" }));
  srow = await spendRow(SPEND);
  check("a repeat after paying: 409 with state paid, the row unchanged", afterPaid.status === 409 && afterPaid.body?.state?.status === "paid" && srow?.amt === "1300.00", `${afterPaid.status} ${srow?.amt}`);
  const undoPaid = await cfo("POST", `/hr-budget/spends/${sid}/decision`, { decision: "received", note: null });
  check("a paid spend cannot be put back — void its entry instead", undoPaid.status === 400, msg(undoPaid));

  const periods = await cfo("GET", `/hr-budget/periods?q=${encodeURIComponent(MARK)}`);
  const hiring = periods.body?.items?.find((p) => p.externalId === PERIOD);
  // Two spends name it: the paid 1,300 and the proposed 300.
  check("the page's budgets: spent and paid summed from the spends", hiring?.spendCount === 2 && hiring?.spentAmount === "1600.00" && hiring?.paidAmount === "1300.00" && hiring?.status === "approved", JSON.stringify(hiring && { c: hiring.spendCount, s: hiring.spentAmount, p: hiring.paidAmount }));
  const spends = await cfo("GET", `/hr-budget/spends?q=${encodeURIComponent(MARK)}`);
  const one = spends.body?.items?.find((s) => s.externalId === SPEND);
  check("the page's spends: its budget's category and period, and the entry's number", one?.categoryName === `${MARK} Hiring` && one?.budgetStartsOn === "2026-09-01" && /^TXN-/.test(one?.transactionRef ?? ""), JSON.stringify(one && { c: one.categoryName, r: one.transactionRef }));

  /* ------------------------------------------------------------------ */
  console.log("\nD. Who");
  const hrList = await hr("GET", "/hr-budget/periods");
  const hrDecide = await hr("POST", `/hr-budget/periods/${pid}/decision`, { decision: "refused", note: "x" });
  check("HR: cannot see the page or decide (403)", hrList.status === 403 && hrDecide.status === 403, `${hrList.status}/${hrDecide.status}`);
  if (ceo) {
    const ceoList = await ceo("GET", "/hr-budget/periods");
    const ceoSend = await ceo("POST", "/hr-budget/periods", period({ externalId: id() }));
    const ceoDecide = await ceo("POST", `/hr-budget/periods/${pid}/decision`, { decision: "refused", note: "x" });
    check("the CEO: reads the page; cannot send or decide (403)", ceoList.status === 200 && ceoSend.status === 403 && ceoDecide.status === 403, `${ceoList.status}/${ceoSend.status}/${ceoDecide.status}`);
  }
  const noToken = await fetch(`${API}/hr-budget/periods`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(period()) });
  check("no sign-in: 401", noToken.status === 401 || noToken.status === 403, String(noToken.status));

  const audit = await q(`select action::text a from audit_logs where entity_table in ('hr_budget_periods','hr_budget_spends') and entity_id::text in (select id::text from hr_budget_periods where external_id = $1 union select id::text from hr_budget_spends where external_id = $2)`, [PERIOD, SPEND]);
  check("an audit row for every send and decision", audit.length >= 9, `${audit.length} rows: ${[...new Set(audit.map((a) => a.a))].join(", ")}`);
} finally {
  if (txnId) {
    const admin = as(users.super_admin);
    await admin("POST", `/trash/transaction/${txnId}`, { reason: "harness" });
    await admin("DELETE", `/trash/transaction/${txnId}`);
  }
  const ids = (await q(`select id::text from hr_budget_periods where category_name like $1 union all select id::text from hr_budget_spends where purpose like $1`, [`${MARK}%`])).map((r) => r.id);
  await q(`delete from audit_logs where entity_id::text = any($1)`, [ids]);
  await q(`delete from hr_budget_spends where purpose like $1`, [`${MARK}%`]);
  await q(`delete from hr_budget_periods where category_name like $1`, [`${MARK}%`]);
  const left = (await q(`select (select count(*) from hr_budget_periods where category_name like $1)::int + (select count(*) from hr_budget_spends where purpose like $1)::int as n`, [`${MARK}%`]))[0].n;
  const txnLeft = txnId ? (await q(`select count(*)::int n from transactions where id = $1`, [txnId]))[0].n : 0;
  check("cleaned up — rows, and the test expense purged through the trash", left === 0 && txnLeft === 0, `${left} rows, ${txnLeft} entries`);
  await db.end();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
