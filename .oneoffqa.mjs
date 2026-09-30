/**
 * One-off amounts — a bonus — sent by the HR portal for a month's salary
 * sheet (#121). Driven through the API as the HR role, read back from the
 * database every time: the one-off's row, the line's bonus, the sheet's
 * totals — and compensation_history, which must never move.
 *
 * On two throwaway people and a throwaway month years ahead:
 *   1. no sheet yet: 201, waiting; a repeat amends (200, send_count 2);
 *   2. the sheet built with them on it: into the bonus, on_sheet;
 *   3. an amend while it is a draft moves the bonus by the difference;
 *      a second one-off adds to it; Build list again keeps both;
 *   4. taken off the sheet: back to waiting; put back: in again;
 *   5. the sheet finalised: a repeat is 409 with the state and the sheet's
 *      status, nothing moves; a first send for that month is 409, nothing
 *      stored; a paid sheet reads as paid;
 *   6. refusals: a number for the amount, month 13, an unknown person;
 *   7. who: HR sends and reads; the CEO cannot;
 *   8. compensation_history untouched throughout.
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
const ooRow = async (externalId) => (await q(`select amount::text amt, payroll_line_id::text line, applied_amount::text applied, send_count, period_month from payroll_one_offs where external_id = $1`, [externalId]))[0];
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
  check("201, waiting, no sheet", first.status === 201 && first.body?.state === "waiting" && first.body?.sheetStatus === null && first.body?.amount === "15000.00", msg(first));
  check("…the row as sent, on no line", row?.amt === "15000.00" && row?.line === null && row?.send_count === 1, JSON.stringify(row));
  const again = await hr("POST", "/payroll/one-offs", oneOff(O1, A, { amount: "18000", note: null }));
  row = await ooRow(O1);
  check("a repeat amends: 200, one row, the new amount, send_count 2", again.status === 200 && row?.amt === "18000.00" && row?.send_count === 2 && (await q(`select count(*)::int n from payroll_one_offs where external_id = $1`, [O1]))[0].n === 1, msg(again));
  const noNote = await hr("POST", "/payroll/one-offs", (({ note, ...rest }) => rest)(oneOff(O1, A, { amount: "18000" })));
  check("a note left out is the same as null", noNote.status === 200, msg(noNote));

  /* ------------------------------------------------------------------ */
  console.log("\n2. The sheet built with them on it");
  const run = await finance("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: MONTH, notes: MARK });
  const RUN = run.body?.id;
  await finance("POST", `/payroll/runs/${RUN}/members`, { teamMemberIds: [A, B] });
  let la = await lineOf(RUN, A);
  row = await ooRow(O1);
  check("the one-off is in A's bonus; the line's net counts it", la?.bonus === "18000.00" && row?.line === la?.id && row?.applied === "18000.00" && Number(la?.net) === Number(la?.gross) + 18000 - Number((await q(`select tds_amount::text t, other_additions::text a, other_deductions::text d from payroll_lines where id = $1`, [la?.id]))[0].t), JSON.stringify(la));
  const lb = await lineOf(RUN, B);
  check("…and nowhere else — B's bonus is nothing", lb?.bonus === "0.00", lb?.bonus);
  let st = (await hr("GET", `/payroll/one-offs?externalIds=${O1}`)).body?.[0];
  check("state on_sheet, sheet draft", st?.state === "on_sheet" && st?.sheetStatus === "draft", JSON.stringify(st));
  const totals = (await q(`select total_additions::text a from payroll_runs where id = $1`, [RUN]))[0];
  check("the sheet's totals count it", totals?.a === "18000.00", totals?.a);

  /* ------------------------------------------------------------------ */
  console.log("\n3. Amend, add, rebuild");
  await finance("PATCH", `/payroll/lines/${la.id}`, { netAmount: "1.00" });
  const amend = await hr("POST", "/payroll/one-offs", oneOff(O1, A, { amount: "20000" }));
  la = await lineOf(RUN, A);
  check("an amend on a draft sheet moves the bonus by the difference, and clears a typed net", amend.status === 200 && la?.bonus === "20000.00" && la?.override === null && (await ooRow(O1)).applied === "20000.00", `${amend.status} ${la?.bonus} override ${la?.override}`);
  const second = await hr("POST", "/payroll/one-offs", oneOff(O2, A, { amount: "5000.50", note: "Spot award" }));
  la = await lineOf(RUN, A);
  check("a second one-off for the same month adds to it", second.status === 201 && second.body?.state === "on_sheet" && la?.bonus === "25000.50", `${second.status} ${la?.bonus}`);
  await finance("POST", `/payroll/runs/${RUN}/generate-lines`);
  la = await lineOf(RUN, A);
  const both = await q(`select payroll_line_id::text l from payroll_one_offs where external_id = any($1::uuid[])`, [[O1, O2]]);
  check("Build list again: the new line carries both", la?.bonus === "25000.50" && both.every((b) => b.l === la?.id), `${la?.bonus} ${JSON.stringify(both)}`);

  /* ------------------------------------------------------------------ */
  console.log("\n4. Off the sheet, and back");
  await finance("POST", `/payroll/runs/${RUN}/members`, { teamMemberIds: [B] });
  st = (await hr("GET", `/payroll/one-offs?externalIds=${O1},${O2}`)).body ?? [];
  check("taken off the sheet: both back to waiting", st.length === 2 && st.every((s) => s.state === "waiting"), JSON.stringify(st.map((s) => s.state)));
  await finance("POST", `/payroll/runs/${RUN}/members`, { teamMemberIds: [A, B] });
  la = await lineOf(RUN, A);
  check("put back: in the bonus again, once", la?.bonus === "25000.50", la?.bonus);

  /* ------------------------------------------------------------------ */
  console.log("\n5. A settled sheet");
  const fin = await finance("POST", `/payroll/runs/${RUN}/finalize`);
  check("the sheet finalised", fin.status === 200 || fin.status === 201, msg(fin));
  const late = await hr("POST", "/payroll/one-offs", oneOff(O1, A, { amount: "99999" }));
  la = await lineOf(RUN, A);
  row = await ooRow(O1);
  check("a repeat now: 409 with the state and the sheet's status; nothing moves", late.status === 409 && late.body?.sheetStatus === "finalized" && late.body?.state?.state === "on_sheet" && row?.amt === "20000.00" && la?.bonus === "25000.50", `${late.status} ${JSON.stringify(late.body?.state)} ${row?.amt} ${la?.bonus}`);
  const fresh = crypto.randomUUID();
  const firstLate = await hr("POST", "/payroll/one-offs", oneOff(fresh, B, { amount: "1000" }));
  check("a first send for that month: 409, state null, nothing stored", firstLate.status === 409 && firstLate.body?.state === null && firstLate.body?.sheetStatus === "finalized" && (await q(`select count(*)::int n from payroll_one_offs where external_id = $1`, [fresh]))[0].n === 0, msg(firstLate));
  const moved = await hr("POST", "/payroll/one-offs", oneOff(fresh, B, { amount: "1000", periodMonth: 10 }));
  check("…sent for the next month instead: 201, waiting", moved.status === 201 && moved.body?.state === "waiting" && moved.body?.periodMonth === 10, msg(moved));
  await q(`update payroll_runs set status = 'paid' where id = $1`, [RUN]);
  st = (await hr("GET", `/payroll/one-offs?externalIds=${O1}`)).body?.[0];
  check("a paid sheet reads as paid", st?.state === "paid" && st?.sheetStatus === "paid", JSON.stringify(st));
  await q(`update payroll_runs set status = 'finalized' where id = $1`, [RUN]);

  /* ------------------------------------------------------------------ */
  console.log("\n6. Refusals");
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
  console.log("\n7. Who");
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
  console.log("\n8. The salary itself");
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
