/**
 * #125 — money moves when finance says it moves.
 *
 * The owner, 30 Sep 2026: a raise sent from the HR portal landed in a month's
 * payroll that nobody in finance had approved — "eta kora jabena". Every
 * money request from HR now waits for the CFO or the Super Admin, and only an
 * approval moves anything. Driven through the API as the roles themselves,
 * every write read back from the database; then the page in a browser.
 *
 *   A. HR's door: HR can no longer set a salary; a pay change is stored and
 *      applies nothing; a repeat amends; the bell rings; the status HR reads
 *      back has the agreed shape;
 *   B. the payroll gate: a sheet cannot be started, built or finalised while
 *      a pay change or one-off for its month waits — held included — and the
 *      refusal names the people, each with a link to its row;
 *   C. deciding: only the CFO and the Super Admin; a hold and a rejection
 *      need a note; a resend after a hold goes back to waiting; a rejection
 *      is final to HR; an approval writes the salary through the one door
 *      that writes salaries, and cannot be taken back;
 *   D. budgets and spends in the same queue: held, resent, approved, paid;
 *   E. the list: waiting by default, counts, filters;
 *   F. pay applied before approvals existed reads as such, and is final;
 *   G. the page: the rail's count, a row's pop-up, deciding from the pop-up
 *      and the row, the old HR Budget address, the salary sheet's pop-up
 *      naming the person, the CEO reading only, no sideways scroll.
 *
 *     node .hrrequestsqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .hrrequestsqa.mjs   also saves screenshots
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const API = "http://localhost:4001/api";
const SHOTS = process.env.SHOT_DIR || null;
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
const as = (user) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const hr = as(users.hr);
const decider = users.cfo ?? users.super_admin;
const fin = as(decider);
const admin = as(users.super_admin);

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const msg = (r) => `${r.status} ${r.body?.message ?? ""} ${JSON.stringify(r.body?.errors ?? "")}`.slice(0, 300);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await settle(250);
  }
};

const MARK = `HRRQ${Date.now().toString(36)}`;
const YEAR = 2033;
const P1 = crypto.randomUUID();
const P2 = crypto.randomUUID();
const PB = crypto.randomUUID();
const SP = crypto.randomUUID();
const O1 = crypto.randomUUID();
const txnIds = [];

async function wipe() {
  const members = (await q(`select id from team_members where full_name like $1`, [`${MARK} %`])).map((r) => r.id);
  const runs = (await q(`select id from payroll_runs where notes = $1`, [MARK])).map((r) => r.id);
  const reqIds = members.length ? (await q(`select id::text from compensation_requests where team_member_id = any($1::uuid[])`, [members])).map((r) => r.id) : [];
  const ooIds = members.length ? (await q(`select id::text from payroll_one_offs where team_member_id = any($1::uuid[])`, [members])).map((r) => r.id) : [];
  const budgetIds = (await q(`select id::text from hr_budget_periods where category_name like $1 union all select id::text from hr_budget_spends where purpose like $1`, [`${MARK}%`])).map((r) => r.id);
  const ids = [...members, ...runs, ...reqIds, ...ooIds, ...budgetIds];
  if (ids.length) await q(`delete from audit_logs where entity_id::text = any($1)`, [ids]);
  await q(`delete from notifications where title like $1 or body like $1`, [`%${MARK}%`]);
  if (members.length) {
    await q(`delete from compensation_requests where team_member_id = any($1::uuid[])`, [members]);
    await q(`delete from payroll_one_offs where team_member_id = any($1::uuid[])`, [members]);
  }
  await q(`delete from hr_budget_spends where purpose like $1`, [`${MARK}%`]);
  await q(`delete from hr_budget_periods where category_name like $1`, [`${MARK}%`]);
  if (runs.length) {
    await q(`delete from payroll_lines where payroll_run_id = any($1::uuid[])`, [runs]);
    await q(`delete from payroll_runs where id = any($1::uuid[])`, [runs]);
  }
  if (members.length) {
    await q(`delete from payroll_lines where team_member_id = any($1::uuid[])`, [members]);
    await q(`delete from compensation_history where team_member_id = any($1::uuid[])`, [members]);
    await q(`delete from team_members where id = any($1::uuid[])`, [members]);
  }
}

const payChange = (externalId, teamMemberId, over = {}) => ({
  externalId,
  teamMemberId,
  grossAmount: "75000.00",
  effectiveFrom: `${YEAR}-03-01`,
  changeReason: "Promotion to team lead",
  hrNote: `${MARK} Took over the design team in February`,
  requestedByName: "Nusrat (HR)",
  hrApprovedByName: "Karim (HR head)",
  hrApprovedAt: "2033-02-20T11:00:00+06:00",
  ...over,
});
const reqRow = async (externalId) => (await q(`select id::text, status, gross_amount::text amt, send_count, status_note note, decided_by::text by, applied_at, compensation_id::text comp from compensation_requests where external_id = $1`, [externalId]))[0];
const comp = async (memberId) => q(`select gross_amount::text g, effective_from::text f, effective_to::text t, created_by::text by from compensation_history where team_member_id = $1 and deleted_at is null order by effective_from`, [memberId]);

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, url, width = 1440) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Encountered two children|status of 409/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  return { page, context };
};

try {
  await wipe();
  const clash = await q(`select period_month from payroll_runs where period_year = $1 and deleted_at is null`, [YEAR]);
  if (clash.length) throw new Error(`${YEAR} already has sheets — not touching them`);
  const add = async (name, joiningSalary) => {
    const r = await fin("POST", "/team-members", { fullName: `${MARK} ${name}`, joinedOn: `${YEAR}-01-01`, joiningSalary });
    if (r.status !== 201) throw new Error(`member: ${msg(r)}`);
    return r.body.id;
  };
  const A = await add("Anika Rahman", "60000");
  const B = await add("Bashir Ahmed", "40000");
  const compA = JSON.stringify(await comp(A));
  check("a joining salary still goes straight in (the owner's choice)", (await comp(A)).length === 1 && (await comp(A))[0].g === "60000.00", compA);

  /* ------------------------------------------------------------------ */
  console.log("\nA. HR's door");
  const direct = await hr("POST", `/team-members/${A}/compensation`, { grossAmount: "99000", effectiveFrom: `${YEAR}-03-01` });
  check("HR can no longer set a salary directly (403), and nothing moved", direct.status === 403 && JSON.stringify(await comp(A)) === compA, msg(direct));
  const first = await hr("POST", "/hr-requests/pay-changes", payChange(P1, A));
  let row = await reqRow(P1);
  check("a pay change: 201, pending, stored — and the salary untouched", first.status === 201 && first.body?.state === "pending" && row?.status === "received" && JSON.stringify(await comp(A)) === compA, msg(first));
  const again = await hr("POST", "/hr-requests/pay-changes", payChange(P1, A, { grossAmount: "76000.00" }));
  row = await reqRow(P1);
  check("a repeat amends: 200, the new figure, send_count 2, one row", again.status === 200 && row?.amt === "76000.00" && row?.send_count === 2 && (await q(`select count(*)::int n from compensation_requests where external_id = $1`, [P1]))[0].n === 1, msg(again));
  const bell = await q(`select kind, href, title from notifications where dedupe_key = $1`, [`hr-pay_change:${row.id}`]);
  check("the bell rang once per decider, linking to its kind", bell.length > 0 && bell.every((b) => b.kind === "hr_request" && b.href === "/hr-requests?kind=pay_change") && /Anika/.test(bell[0].title), `${bell.length} ${bell[0]?.href}`);
  for (const [label, body, code] of [
    ["HR's approver without a time", payChange(crypto.randomUUID(), A, { hrApprovedAt: null }), 400],
    ["a zero salary", payChange(crypto.randomUUID(), A, { grossAmount: "0" }), 400],
    ["an unknown key", { ...payChange(crypto.randomUUID(), A), bonus: "1" }, 400],
    ["an unknown person", payChange(crypto.randomUUID(), crypto.randomUUID()), 404],
  ]) {
    const r = await hr("POST", "/hr-requests/pay-changes", body);
    check(`${code}: ${label}`, r.status === code, msg(r));
  }
  const status = await hr("GET", `/hr-requests/pay-changes/status?externalIds=${P1},${crypto.randomUUID()}`);
  const s0 = status.body?.[0];
  check(
    "the status HR reads: one entry, unknown ids left out, the agreed shape",
    status.status === 200 && status.body?.length === 1 && JSON.stringify(Object.keys(s0).sort()) === JSON.stringify(["appliedAt", "decidedAt", "decidedByName", "externalId", "note", "state"]) && s0.state === "pending" && s0.note === null && s0.decidedByName === null && s0.appliedAt === null,
    JSON.stringify(status.body),
  );

  /* ------------------------------------------------------------------ */
  console.log("\nB. The payroll gate");
  const blocked = await fin("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: 3, notes: MARK });
  const lines = blocked.body?.errors?.hrRequests ?? [];
  const links = blocked.body?.errors?.hrRequestLinks ?? [];
  check(
    "March cannot be started: 409, naming Anika and the new figure, with a link to her row",
    blocked.status === 409 && lines.some((l) => l.includes("Anika Rahman") && l.includes("76,000.00") && l.includes("waiting")) && links[0] === `/hr-requests?kind=pay_change&open=${row.id}` && (await q(`select count(*)::int n from payroll_runs where notes = $1`, [MARK]))[0].n === 0,
    `${blocked.status} ${lines.join(" | ")}`,
  );
  const april = await fin("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: 4, notes: MARK });
  check("April too — the raise from 1 March is undecided in April as well", april.status === 409, msg(april));
  const feb = await fin("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: 2, notes: MARK });
  check("February is not held up: the raise starts after it", feb.status === 201, msg(feb));

  /* ------------------------------------------------------------------ */
  console.log("\nC. Deciding");
  const hrDecide = await hr("POST", `/hr-requests/pay_change/${row.id}/decision`, { decision: "approved" });
  check("HR cannot decide what HR sent (403)", hrDecide.status === 403, msg(hrDecide));
  if (users.ceo) {
    const ceo = as(users.ceo);
    const read = await ceo("GET", "/hr-requests");
    const act = await ceo("POST", `/hr-requests/pay_change/${row.id}/decision`, { decision: "approved" });
    check("the CEO reads the queue (200) and decides nothing (403)", read.status === 200 && act.status === 403, `${read.status}/${act.status}`);
  }
  const bareHold = await fin("POST", `/hr-requests/pay_change/${row.id}/decision`, { decision: "held" });
  check("a hold without a note is refused, under the note", bareHold.status === 400 && Boolean(bareHold.body?.errors?.note), msg(bareHold));
  const hold = await fin("POST", `/hr-requests/pay_change/${row.id}/decision`, { decision: "held", note: "Send the signed promotion letter" });
  row = await reqRow(P1);
  const heldStatus = (await hr("GET", `/hr-requests/pay-changes/status?externalIds=${P1}`)).body?.[0];
  check("held: stored with the note and who; HR reads held, the note, a name", hold.status === 200 && row?.status === "held" && row?.by === decider.id && heldStatus?.state === "held" && heldStatus?.note === "Send the signed promotion letter" && heldStatus?.decidedByName === decider.full_name && Boolean(heldStatus?.decidedAt), JSON.stringify(heldStatus));
  const stillBlocked = await fin("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: 3, notes: MARK });
  check("a hold blocks March too — holding is not deciding", stillBlocked.status === 409 && (stillBlocked.body?.errors?.hrRequests ?? []).some((l) => l.includes("on hold")), msg(stillBlocked));
  const resent = await hr("POST", "/hr-requests/pay-changes", payChange(P1, A, { grossAmount: "76000.00" }));
  row = await reqRow(P1);
  check("HR sends it again after the hold: 200, back to waiting, the note cleared", resent.status === 200 && row?.status === "received" && row?.note === null && row?.send_count === 3, msg(resent));
  const reject = await fin("POST", `/hr-requests/pay_change/${row.id}/decision`, { decision: "refused", note: "Not in this year's budget" });
  row = await reqRow(P1);
  const lateSend = await hr("POST", "/hr-requests/pay-changes", payChange(P1, A, { grossAmount: "80000.00" }));
  check("rejected: nothing moved; a resend is 409 carrying the rejection", reject.status === 200 && row?.status === "refused" && JSON.stringify(await comp(A)) === compA && lateSend.status === 409 && lateSend.body?.state?.state === "rejected" && lateSend.body?.state?.note === "Not in this year's budget" && row?.amt === "76000.00", `${reject.status} ${row?.status} ${lateSend.status} ${JSON.stringify(lateSend.body?.state)}`);
  const march = await fin("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: 3, notes: MARK });
  const MARCH = march.body?.id;
  await fin("POST", `/payroll/runs/${MARCH}/members`, { teamMemberIds: [A, B] });
  check("with it rejected, March can be started and built", march.status === 201 && Boolean((await q(`select id from payroll_lines where payroll_run_id = $1 and team_member_id = $2`, [MARCH, A]))[0]), msg(march));
  const back = await fin("POST", `/hr-requests/pay_change/${row.id}/decision`, { decision: "received" });
  check("a rejection can be put back to waiting (nothing had moved)", back.status === 200 && (await reqRow(P1)).status === "received", msg(back));
  const finalise = await fin("POST", `/payroll/runs/${MARCH}/finalize`);
  check("…and waiting again, it blocks finalising the March sheet", finalise.status === 409 && (finalise.body?.errors?.hrRequests ?? []).some((l) => l.includes("Anika")), msg(finalise));
  const approve = await fin("POST", `/hr-requests/pay_change/${row.id}/decision`, { decision: "approved", note: "Agreed with the CEO" });
  row = await reqRow(P1);
  const after = await comp(A);
  check(
    "approved: the salary is written from HR's date, by the approver, and the request points at it",
    approve.status === 200 && row?.status === "approved" && Boolean(row?.applied_at) && after.length === 2 && after[0].t === `${YEAR}-02-28` && after[1].g === "76000.00" && after[1].f === `${YEAR}-03-01` && after[1].by === decider.id && row?.comp === (await q(`select id::text from compensation_history where team_member_id = $1 and effective_from = $2`, [A, `${YEAR}-03-01`]))[0]?.id,
    JSON.stringify(after),
  );
  check("…and says March was built at the old figure", /March 2033 was built at the old figure/.test(approve.body?.notice ?? ""), approve.body?.notice);
  const takeBack = await fin("POST", `/hr-requests/pay_change/${row.id}/decision`, { decision: "received" });
  check("an applied approval cannot be taken back (409)", takeBack.status === 409 && /cannot be taken back/.test(takeBack.body?.message ?? ""), msg(takeBack));
  const approvedStatus = (await hr("GET", `/hr-requests/pay-changes/status?externalIds=${P1}`)).body?.[0];
  console.log(`   (the status HR reads, as it stands: ${JSON.stringify(approvedStatus)})`);
  check("HR reads approved: note, name, when decided, when applied", approvedStatus?.state === "approved" && approvedStatus?.note === "Agreed with the CEO" && approvedStatus?.decidedByName === decider.full_name && /Z$/.test(approvedStatus?.decidedAt ?? "") && /Z$/.test(approvedStatus?.appliedAt ?? ""), JSON.stringify(approvedStatus));
  const audit = await q(`select summary from audit_logs where entity_table = 'compensation_requests' and entity_id = $1 order by occurred_at`, [row.id]);
  check("each step is in the request's history", audit.length >= 6 && audit.some((a) => /approved .*Anika Rahman's pay change/.test(a.summary)) && audit.some((a) => /put on hold/.test(a.summary)), `${audit.length} rows`);

  /* ------------------------------------------------------------------ */
  console.log("\nD. Budgets and spends, in the same queue");
  const period = await hr("POST", "/hr-budget/periods", { externalId: PB, categoryName: `${MARK} Training`, startsOn: `${YEAR}-03-01`, endsOn: `${YEAR}-06-30`, amount: "100000", note: null, recordedByName: "Nusrat (HR)" });
  const spend = await hr("POST", "/hr-budget/spends", { externalId: SP, budgetExternalId: PB, spentOn: `${YEAR}-03-10`, amount: "12000.50", purpose: `${MARK} Course fees`, teamMemberId: null, employeeName: "Anika Rahman", hrStatus: "approved", hrApprovedByName: "Karim (HR head)", hrApprovedAt: "2033-03-10T10:00:00+06:00", recordedByName: "Nusrat (HR)", hasReceipt: true });
  const spendId = (await q(`select id::text from hr_budget_spends where external_id = $1`, [SP]))[0]?.id;
  const pbId = (await q(`select id::text from hr_budget_periods where external_id = $1`, [PB]))[0]?.id;
  check("a budget and a spend arrive (201s)", period.status === 201 && spend.status === 201, `${period.status}/${spend.status}`);
  const noBlock = await fin("POST", `/payroll/runs/${MARCH}/generate-lines`);
  check("…and do not hold up the salary sheet", noBlock.status === 200 || noBlock.status === 201, msg(noBlock));
  await fin("POST", `/hr-requests/spend/${spendId}/decision`, { decision: "held", note: "Which course?" });
  const oldRoute = (await hr("GET", `/hr-budget/spends/status?externalIds=${SP}`)).body?.[0];
  const spendResend = await hr("POST", "/hr-budget/spends", { externalId: SP, budgetExternalId: PB, spentOn: `${YEAR}-03-10`, amount: "12000.50", purpose: `${MARK} Course fees (UX course)`, teamMemberId: null, employeeName: "Anika Rahman", hrStatus: "approved", hrApprovedByName: "Karim (HR head)", hrApprovedAt: "2033-03-10T10:00:00+06:00", recordedByName: "Nusrat (HR)", hasReceipt: true });
  check("a held spend: the #121 route reads held; HR's resend puts it back to waiting", oldRoute?.status === "held" && spendResend.status === 200 && (await q(`select status from hr_budget_spends where id = $1`, [spendId]))[0].status === "received", `${oldRoute?.status} ${spendResend.status}`);
  await fin("POST", `/hr-requests/budget/${pbId}/decision`, { decision: "approved" });
  await fin("POST", `/hr-requests/spend/${spendId}/decision`, { decision: "approved" });
  const account = (await q(`select id::text from accounts where deleted_at is null and type in ('bank','cash') order by created_at limit 1`))[0]?.id;
  const category = (await q(`select c.id::text from categories c where c.is_active and c.parent_id is not null and c.kind in ('out','both') limit 1`))[0]?.id;
  const paid = await fin("POST", `/hr-budget/spends/${spendId}/pay`, { accountId: account, categoryId: category, txnDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date()), usdRate: "121.50", description: `HR: ${MARK} Course fees`, notes: null });
  if (paid.body?.transactionId) txnIds.push(paid.body.transactionId);
  const spendStatus = (await hr("GET", `/hr-requests/spends/status?externalIds=${SP}`)).body?.[0];
  const budgetStatus = (await hr("GET", `/hr-requests/budgets/status?externalIds=${PB}`)).body?.[0];
  check("approved and paid: HR reads approved, with when the money moved; the budget approved", paid.status === 200 && spendStatus?.state === "approved" && Boolean(spendStatus?.appliedAt) && budgetStatus?.state === "approved" && budgetStatus?.appliedAt === null, `${msg(paid)} ${JSON.stringify(spendStatus)}`);
  const paidAgain = await fin("POST", `/hr-requests/spend/${spendId}/decision`, { decision: "refused", note: "x" });
  const paidDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka" }).format(new Date());
  check("a paid spend cannot be decided again (409), and says the Dhaka day it was paid", paidAgain.status === 409 && (paidAgain.body?.message ?? "").includes(`applied on ${paidDay}`), msg(paidAgain));

  /* ------------------------------------------------------------------ */
  console.log("\nE. The list");
  await hr("POST", "/hr-requests/pay-changes", payChange(P2, B, { grossAmount: "45000.00", effectiveFrom: `${YEAR}-05-01`, changeReason: "Annual review", hrApprovedByName: null, hrApprovedAt: null }));
  await hr("POST", "/payroll/one-offs", { externalId: O1, teamMemberId: B, periodYear: YEAR, periodMonth: 3, amount: "5000.00", note: `${MARK} Spot award` });
  const waiting = await fin("GET", `/hr-requests?q=${encodeURIComponent(MARK.slice(0, 4))}&pageSize=100`);
  const ours = (waiting.body?.items ?? []).filter((r) => r.subject.startsWith(MARK) || (r.detail ?? "").includes(MARK) || (r.hrNote ?? "").includes(MARK));
  const all = await fin("GET", `/hr-requests?state=all&pageSize=100&q=${MARK}`);
  check("waiting by default: B's pay change and one-off, nothing decided", waiting.status === 200 && ours.length >= 1 && ours.every((r) => r.state === "pending" || r.state === "held"), `${ours.map((r) => `${r.kind}:${r.state}`).join(",")}`);
  const byKind = await fin("GET", `/hr-requests?state=all&kind=one_off&pageSize=100`);
  const byMonth = await fin("GET", `/hr-requests?state=all&month=${YEAR}-05&pageSize=100`);
  check("the kind and month filters", (byKind.body?.items ?? []).every((r) => r.kind === "one_off") && (byMonth.body?.items ?? []).every((r) => r.monthKey === `${YEAR}-05`) && (byMonth.body?.items ?? []).some((r) => r.subject === `${MARK} Bashir Ahmed`), `${byKind.body?.items?.length} ${byMonth.body?.items?.length}`);
  check("counts come with the list", typeof waiting.body?.counts?.waiting === "number" && waiting.body.counts.all >= waiting.body.counts.waiting && all.status === 200, JSON.stringify(waiting.body?.counts));
  const oneOffHeld = (await q(`select payroll_line_id from payroll_one_offs where external_id = $1`, [O1]))[0];
  const lineB = (await q(`select bonus_amount::text b from payroll_lines where payroll_run_id = $1 and team_member_id = $2`, [MARCH, B]))[0];
  check("a one-off waits: not on the March sheet", oneOffHeld?.payroll_line_id === null && lineB?.b === "0.00", `${oneOffHeld?.payroll_line_id} ${lineB?.b}`);

  /* ------------------------------------------------------------------ */
  console.log("\nF. Applied before approvals existed");
  const earlier = (await q(`insert into compensation_requests (team_member_id, gross_amount, effective_from, requested_by_name, status, applied_at, before_approvals) values ($1, 41000, $2, 'Nusrat (HR)', 'approved', now(), true) returning id::text`, [B, `${YEAR}-01-15`]))[0].id;
  const listed = (await fin("GET", `/hr-requests?state=approved&kind=pay_change&pageSize=100`)).body?.items?.find((r) => r.id === earlier);
  const touch = await fin("POST", `/hr-requests/pay_change/${earlier}/decision`, { decision: "refused", note: "x" });
  check("listed as approved by nobody, marked so, and final", listed?.beforeApprovals === true && listed?.decidedByName === null && touch.status === 409, `${JSON.stringify(listed?.beforeApprovals)} ${touch.status}`);

  /* ------------------------------------------------------------------ */
  console.log("\nG. The page");
  {
    const { page, context } = await open(decider, "/hr-requests");
    const rail = await until(() => page.evaluate(() => {
      const link = [...document.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/hr-requests");
      return link ? { text: link.textContent, badge: link.querySelector("[data-hrr-waiting]")?.textContent ?? null } : null;
    }));
    check("People → HR Requests on the rail, with the waiting count", Boolean(rail) && /HR Requests/.test(rail.text) && Number(rail.badge) >= 2, JSON.stringify(rail));
    await page.type("input[placeholder^='Person']", `${MARK} Bashir`);
    const rowId = (await reqRow(P2)).id;
    await page.waitForSelector(`tr[data-hrr-row='${rowId}']`, { timeout: 15000 });
    await page.click(`tr[data-hrr-row='${rowId}'] td:nth-child(3)`);
    await page.waitForFunction(() => document.querySelector("[data-popup]")?.textContent.includes("What HR asked"), { timeout: 10000 });
    await until(() => page.evaluate(() => document.querySelector("[data-popup]")?.textContent.includes("History")));
    const popup = await page.evaluate(() => document.querySelector("[data-popup]").textContent);
    check("a row opens everything: what HR asked, the salary before, where it lands, history", /Salary before/.test(popup) && /40,000\.00/.test(popup) && /Annual review/.test(popup) && /History/.test(popup), popup.slice(0, 160));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "hrr-popup.png") });
    await page.click("[data-popup] [data-hrr-action='reject']");
    await page.waitForSelector("[data-hrr-submit]", { timeout: 10000 });
    await page.click("[data-hrr-submit]");
    await settle(600);
    const stillOpen = await page.evaluate(() => Boolean(document.querySelector("[data-hrr-submit]")));
    await page.type("[data-hrr-field='note']", "Review is in June");
    await page.click("[data-hrr-submit]");
    const refused = await until(async () => (await reqRow(P2)).status === "refused" ? await reqRow(P2) : null);
    check("Reject from the pop-up asks why first; then rejected with the note (read back)", stillOpen && refused?.note === "Review is in June", JSON.stringify(refused));
    // The one-off, approved from its row.
    await page.evaluate(() => { const box = document.querySelector("input[placeholder^='Person']"); box.value = ""; });
    const ooId = (await q(`select id::text from payroll_one_offs where external_id = $1`, [O1]))[0].id;
    await page.goto(`${WEB}/hr-requests?kind=one_off&open=${ooId}`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.querySelector("[data-popup]")?.textContent.includes("Spot award"), { timeout: 15000 });
    check("a link with ?open= opens that request's pop-up", true);
    await page.click("[data-popup] [data-hrr-action='approve']");
    await page.waitForSelector("[data-hrr-submit]", { timeout: 10000 });
    await page.click("[data-hrr-submit]");
    const toast = await until(() => page.evaluate(() => document.body.textContent.match(/Approved\. Added to [^.]+\./)?.[0] ?? null));
    const onSheet = await until(async () => (await q(`select bonus_amount::text b from payroll_lines where payroll_run_id = $1 and team_member_id = $2`, [MARCH, B]))[0]?.b === "5000.00");
    const ooNow = (await q(`select status, payroll_line_id::text l from payroll_one_offs where external_id = $1`, [O1]))[0];
    const drawerError = await page.evaluate(() => document.querySelector("[data-hrr-error]")?.textContent ?? null);
    check("approved from the pop-up: in Bashir's bonus on the March draft at once, and it says so", Boolean(onSheet) && Boolean(toast), `${toast ?? ""} ${JSON.stringify(ooNow)} ${drawerError ?? ""}`);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check("nothing scrolls sideways at 1440", fits);
    await page.goto(`${WEB}/hr-budget`, { waitUntil: "networkidle0" });
    check("the old HR Budget address lands on HR Requests' spends", page.url().includes("/hr-requests?kind=spend"), page.url());
    await context.close();
  }
  {
    /* The salary sheet's pop-up: a one-off for March waits, and Build list is pressed. */
    const O2 = crypto.randomUUID();
    await hr("POST", "/payroll/one-offs", { externalId: O2, teamMemberId: A, periodYear: YEAR, periodMonth: 3, amount: "3000.00", note: `${MARK} Referral` });
    const { page, context } = await open(decider, `/payroll/${MARCH}`);
    const buildButton = await until(() => page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /(Re)?[Bb]uild list/.test(b.textContent)) ? true : null));
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /(Re)?[Bb]uild list/.test(b.textContent)).click());
    const shown = await until(() => page.evaluate(() => document.querySelector("[data-blocked-list]")?.textContent ?? null));
    const link = await page.evaluate(() => document.querySelector("[data-blocked-list] a")?.getAttribute("href"));
    check("Build list on the March sheet: a pop-up names Anika's one-off, with a link to decide it", Boolean(buildButton) && /Anika Rahman — one-off/.test(shown ?? "") && /^\/hr-requests\?kind=one_off&open=/.test(link ?? ""), `${shown} ${link}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "hrr-blocked.png") });
    await context.close();
  }
  if (users.ceo) {
    const { page, context } = await open(users.ceo, "/hr-requests?state=all");
    await until(() => page.evaluate(() => document.querySelectorAll("tr[data-hrr-row]").length > 0));
    const buttons = await page.evaluate(() => document.querySelectorAll("tr[data-hrr-row] button").length);
    check("the CEO reads the queue with no buttons to press", buttons === 0, String(buttons));
    await context.close();
  }
  {
    const { page, context } = await open(decider, "/hr-requests?state=all", 390);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check("at 390px nothing scrolls sideways", fits);
    await context.close();
  }

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const id of txnIds) {
    await admin("POST", `/trash/transaction/${id}`, { reason: "harness" });
    await admin("DELETE", `/trash/transaction/${id}`);
  }
  await wipe();
  const left = await q(`select (select count(*) from team_members where full_name like $1)::int m, (select count(*) from payroll_runs where notes = $2)::int r, (select count(*) from hr_budget_spends where purpose like $3)::int s`, [`${MARK} %`, MARK, `${MARK}%`]);
  check("cleaned up", left[0].m === 0 && left[0].r === 0 && left[0].s === 0, JSON.stringify(left[0]));
  await db.end();
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
