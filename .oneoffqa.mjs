/**
 * One-off amounts — a bonus — sent by the HR portal for a month's salary
 * sheet (#121). Driven through the API as the HR role, read back from the
 * database every time: the one-off's row, the line's bonus, the sheet's
 * totals — and compensation_history, which must never move.
 *
 * Since #125 a one-off is a REQUEST: stored, waiting for the CFO or the
 * Super Admin, and on a sheet only once approved.
 *
 * On two throwaway people and a throwaway month years ahead:
 *   1. no sheet yet: 201, waiting and pending; a repeat amends (200,
 *      send_count 2);
 *   2. the month's sheet cannot be started while it waits - the refusal
 *      names the person; approved, it can;
 *   3. the sheet built with them on it: into the bonus, on_sheet;
 *   4. a second one-off while the sheet is a draft: NOT in the bonus, and
 *      Build list and Finalise are refused; approved, it is added at once;
 *      Build list again keeps both;
 *   5. taken off the sheet: off it; put back: in again;
 *   6. decided is final to HR: a resend is 409 with the decision; an
 *      applied approval cannot be put back; HR cannot decide;
 *   7. the sheet finalised: a first send for that month is 409, nothing
 *      stored; a paid sheet reads as paid;
 *   8-10. refusals, who, and compensation_history untouched.
 *
 *     node .oneoffqa.mjs      (needs the API: npm run dev, :4001)
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
  (await q(`select id, role, token_version from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role]))[0];
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
const finance = as(users.cfo ?? users.super_admin);

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const msg = (r) => `${r.status} ${r.body?.message ?? ""} ${JSON.stringify(r.body?.errors ?? "")}`;

const MARK = `OOQA${Date.now().toString(36)}`;
const YEAR = 2031;
const MONTH = 9;
const O1 = crypto.randomUUID();
const O2 = crypto.randomUUID();

async function wipe() {
  const members = (await q(`select id from team_members where full_name like $1`, [`${MARK} %`])).map((r) => r.id);
  const runs = (await q(`select id from payroll_runs where notes = $1`, [MARK])).map((r) => r.id);
  const ooIds = members.length ? (await q(`select id::text from payroll_one_offs where team_member_id = any($1::uuid[])`, [members])).map((r) => r.id) : [];
  const ids = [...members, ...runs, ...ooIds];
  if (ids.length) await q(`delete from audit_logs where entity_id::text = any($1)`, [ids]);
  if (members.length) await q(`delete from payroll_one_offs where team_member_id = any($1::uuid[])`, [members]);
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

const oneOff = (externalId, teamMemberId, over = {}) => ({ externalId, teamMemberId, periodYear: YEAR, periodMonth: MONTH, amount: "15000.00", note: "Festival bonus", ...over });
const ooRow = async (externalId) => (await q(`select id::text, status, amount::text amt, payroll_line_id::text line, applied_amount::text applied, send_count, period_month from payroll_one_offs where external_id = $1`, [externalId]))[0];
const lineOf = async (runId, memberId) => (await q(`select id::text, bonus_amount::text bonus, gross_amount::text gross, net_amount::text net, net_amount_override::text override from payroll_lines where payroll_run_id = $1 and team_member_id = $2`, [runId, memberId]))[0];
const comp = async (ids) => (await q(`select team_member_id::text m, gross_amount::text g, effective_from::text f, effective_to::text t from compensation_history where team_member_id = any($1::uuid[]) order by 1, 3`, [ids]));

try {
  await wipe();
  const clash = await q(`select id from payroll_runs where period_year = $1 and period_month = $2 and deleted_at is null`, [YEAR, MONTH]);
  if (clash.length) throw new Error(`${YEAR}-${MONTH} already has a sheet — not touching it`);

  const add = async (name, joiningSalary) => {
    const r = await finance("POST", "/team-members", { fullName: `${MARK} ${name}`, joinedOn: "2031-01-01", joiningSalary });
    if (r.status !== 201) throw new Error(`member: ${msg(r)}`);
    return r.body.id;
  };
  const A = await add("Anika", "60000");
  const B = await add("Bashir", "40000");
  const compBefore = JSON.stringify(await comp([A, B]));

  /* ------------------------------------------------------------------ */
  console.log("\n1. No sheet for that month yet");
  const first = await hr("POST", "/payroll/one-offs", oneOff(O1, A));
  let row = await ooRow(O1);
  check("201, waiting and pending, no sheet", first.status === 201 && first.body?.state === "waiting" && first.body?.decision === "pending" && first.body?.sheetStatus === null && first.body?.amount === "15000.00", msg(first));
  check("…the row as sent, on no line", row?.amt === "15000.00" && row?.line === null && row?.send_count === 1 && row?.status === "received", JSON.stringify(row));
  const again = await hr("POST", "/payroll/one-offs", oneOff(O1, A, { amount: "18000", note: null }));
  row = await ooRow(O1);
  check("a repeat amends: 200, one row, the new amount, send_count 2", again.status === 200 && row?.amt === "18000.00" && row?.send_count === 2 && (await q(`select count(*)::int n from payroll_one_offs where external_id = $1`, [O1]))[0].n === 1, msg(again));
  const noNote = await hr("POST", "/payroll/one-offs", (({ note, ...rest }) => rest)(oneOff(O1, A, { amount: "18000" })));
  check("a note left out is the same as null", noNote.status === 200, msg(noNote));

  /* ------------------------------------------------------------------ */
  console.log("\n2. The month waits for the decision");
  const early = await finance("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: MONTH, notes: MARK });
  check("the sheet cannot be started while it waits: 409, naming Anika", early.status === 409 && (early.body?.errors?.hrRequests ?? []).some((l) => l.includes("Anika") && l.includes("one-off")), msg(early));
  const o1Id = (await ooRow(O1)).id;
  const ok1 = await finance("POST", `/hr-requests/one_off/${o1Id}/decision`, { decision: "approved" });
  check("approved with no sheet yet: it goes on when the sheet is built", ok1.status === 200 && /when that sheet is built/.test(ok1.body?.notice ?? "") && (await ooRow(O1)).line === null, `${ok1.status} ${ok1.body?.notice}`);

  /* ------------------------------------------------------------------ */
  console.log("\n3. The sheet built with them on it");
  const run = await finance("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: MONTH, notes: MARK });
  const RUN = run.body?.id;
  await finance("POST", `/payroll/runs/${RUN}/members`, { teamMemberIds: [A, B] });
  let la = await lineOf(RUN, A);
  row = await ooRow(O1);
  check("the approved one-off is in A's bonus; the line's net counts it", run.status === 201 && la?.bonus === "18000.00" && row?.line === la?.id && row?.applied === "18000.00" && Number(la?.net) === Number(la?.gross) + 18000 - Number((await q(`select tds_amount::text t from payroll_lines where id = $1`, [la?.id]))[0].t), JSON.stringify(la));
  const lb = await lineOf(RUN, B);
  check("…and nowhere else — B's bonus is nothing", lb?.bonus === "0.00", lb?.bonus);
  let st = (await hr("GET", `/payroll/one-offs?externalIds=${O1}`)).body?.[0];
  check("state on_sheet, approved, sheet draft", st?.state === "on_sheet" && st?.decision === "approved" && st?.sheetStatus === "draft", JSON.stringify(st));
  const totals = (await q(`select total_additions::text a from payroll_runs where id = $1`, [RUN]))[0];
  check("the sheet's totals count it", totals?.a === "18000.00", totals?.a);

  /* ------------------------------------------------------------------ */
  console.log("\n4. A second one-off while the sheet is a draft");
  const second = await hr("POST", "/payroll/one-offs", oneOff(O2, A, { amount: "5000.50", note: "Spot award" }));
  la = await lineOf(RUN, A);
  check("201, pending — and NOT in the bonus", second.status === 201 && second.body?.decision === "pending" && la?.bonus === "18000.00", `${second.status} ${la?.bonus}`);
  const rebuildBlocked = await finance("POST", `/payroll/runs/${RUN}/generate-lines`);
  const finaliseBlocked = await finance("POST", `/payroll/runs/${RUN}/finalize`);
  check("Build list and Finalise are refused while it waits", rebuildBlocked.status === 409 && finaliseBlocked.status === 409, `${rebuildBlocked.status}/${finaliseBlocked.status}`);
  await finance("PATCH", `/payroll/lines/${la.id}`, { netAmount: "1.00" });
  const o2Id = (await ooRow(O2)).id;
  const ok2 = await finance("POST", `/hr-requests/one_off/${o2Id}/decision`, { decision: "approved" });
  la = await lineOf(RUN, A);
  check("approved: added to the draft at once, a typed net cleared", ok2.status === 200 && la?.bonus === "23000.50" && la?.override === null && /Added to/.test(ok2.body?.notice ?? ""), `${ok2.status} ${la?.bonus} ${ok2.body?.notice}`);
  await finance("POST", `/payroll/runs/${RUN}/generate-lines`);
  la = await lineOf(RUN, A);
  const both = await q(`select payroll_line_id::text l from payroll_one_offs where external_id = any($1::uuid[])`, [[O1, O2]]);
  check("Build list again: the new line carries both", la?.bonus === "23000.50" && both.every((b) => b.l === la?.id), `${la?.bonus} ${JSON.stringify(both)}`);

  /* ------------------------------------------------------------------ */
  console.log("\n5. Off the sheet, and back");
  await finance("POST", `/payroll/runs/${RUN}/members`, { teamMemberIds: [B] });
  st = (await hr("GET", `/payroll/one-offs?externalIds=${O1},${O2}`)).body ?? [];
  check("taken off the sheet: both off it, still approved", st.length === 2 && st.every((s) => s.state === "waiting" && s.decision === "approved"), JSON.stringify(st.map((s) => `${s.state}/${s.decision}`)));
  await finance("POST", `/payroll/runs/${RUN}/members`, { teamMemberIds: [A, B] });
  la = await lineOf(RUN, A);
  check("put back: in the bonus again, once", la?.bonus === "23000.50", la?.bonus);

  /* ------------------------------------------------------------------ */
  console.log("\n6. Decided is final to HR");
  const resend = await hr("POST", "/payroll/one-offs", oneOff(O1, A, { amount: "99999" }));
  row = await ooRow(O1);
  check("a resend after approval: 409 with the decision; nothing moves", resend.status === 409 && resend.body?.state?.decision === "approved" && row?.amt === "18000.00" && (await lineOf(RUN, A))?.bonus === "23000.50", `${resend.status} ${JSON.stringify(resend.body?.state?.decision)}`);
  const takeBack = await finance("POST", `/hr-requests/one_off/${o1Id}/decision`, { decision: "received" });
  check("an applied one-off cannot be put back (409)", takeBack.status === 409, msg(takeBack));
  const hrDecides = await hr("POST", `/hr-requests/one_off/${o2Id}/decision`, { decision: "refused", note: "x" });
  check("HR cannot decide a one-off (403)", hrDecides.status === 403, msg(hrDecides));

  /* ------------------------------------------------------------------ */
  console.log("\n7. A settled sheet");
  const fin = await finance("POST", `/payroll/runs/${RUN}/finalize`);
  check("the sheet finalised", fin.status === 200 || fin.status === 201, msg(fin));
  const fresh = crypto.randomUUID();
  const firstLate = await hr("POST", "/payroll/one-offs", oneOff(fresh, B, { amount: "1000" }));
  check("a first send for that month: 409, state null, nothing stored", firstLate.status === 409 && firstLate.body?.state === null && firstLate.body?.sheetStatus === "finalized" && (await q(`select count(*)::int n from payroll_one_offs where external_id = $1`, [fresh]))[0].n === 0, msg(firstLate));
  const moved = await hr("POST", "/payroll/one-offs", oneOff(fresh, B, { amount: "1000", periodMonth: 10 }));
  check("…sent for the next month instead: 201, waiting, pending", moved.status === 201 && moved.body?.state === "waiting" && moved.body?.decision === "pending" && moved.body?.periodMonth === 10, msg(moved));
  await q(`update payroll_runs set status = 'paid' where id = $1`, [RUN]);
  st = (await hr("GET", `/payroll/one-offs?externalIds=${O1}`)).body?.[0];
  check("a paid sheet reads as paid", st?.state === "paid" && st?.sheetStatus === "paid", JSON.stringify(st));
  await q(`update payroll_runs set status = 'finalized' where id = $1`, [RUN]);

  /* ------------------------------------------------------------------ */
  console.log("\n8. Refusals");
  for (const [label, body, code] of [
    ["the amount as a JSON number", oneOff(crypto.randomUUID(), B, { amount: 1000, periodMonth: 11 }), 400],
    ["month 13", oneOff(crypto.randomUUID(), B, { periodMonth: 13 }), 400],
    ["an unknown key", { ...oneOff(crypto.randomUUID(), B, { periodMonth: 11 }), reason: "x" }, 400],
    ["a zero amount", oneOff(crypto.randomUUID(), B, { amount: "0", periodMonth: 11 }), 400],
    ["an unknown person", oneOff(crypto.randomUUID(), crypto.randomUUID(), { periodMonth: 11 }), 404],
  ]) {
    const r = await hr("POST", "/payroll/one-offs", body);
    check(`${code}: ${label}`, r.status === code, msg(r));
  }

  /* ------------------------------------------------------------------ */
  console.log("\n9. Who");
  if (users.ceo) {
    const c = as(users.ceo);
    const s = await c("POST", "/payroll/one-offs", oneOff(crypto.randomUUID(), B, { periodMonth: 11 }));
    const g = await c("GET", `/payroll/one-offs?externalIds=${O1}`);
    check("the CEO: cannot send or read one-offs (403)", s.status === 403 && g.status === 403, `${s.status}/${g.status}`);
  }
  const hrLine = await hr("PATCH", `/payroll/lines/${la.id}`, { bonusAmount: "1" });
  check("HR still cannot change a salary line itself (403)", hrLine.status === 403, String(hrLine.status));
  const unknown = await hr("GET", `/payroll/one-offs?externalIds=${O1},${crypto.randomUUID()}`);
  check("state by ids, unknown ones left out", unknown.body?.length === 1, String(unknown.body?.length));

  /* ------------------------------------------------------------------ */
  console.log("\n10. The salary itself");
  check("compensation_history never moved", JSON.stringify(await comp([A, B])) === compBefore, compBefore);
  const audit = await q(`select summary, is_sensitive from audit_logs where entity_table = 'payroll_one_offs' and entity_id::text in (select id::text from payroll_one_offs where external_id = any($1::uuid[]))`, [[O1, O2]]);
  check("an audit row per send, sensitive", audit.length >= 5 && audit.every((a) => a.is_sensitive), `${audit.length} rows`);
} finally {
  await wipe();
  const left = await q(`select (select count(*) from team_members where full_name like $1)::int m, (select count(*) from payroll_runs where notes = $2)::int r`, [`${MARK} %`, MARK]);
  check("cleaned up", left[0].m === 0 && left[0].r === 0, JSON.stringify(left[0]));
  await db.end();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
