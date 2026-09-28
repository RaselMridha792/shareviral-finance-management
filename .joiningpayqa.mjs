/**
 * A joining salary is the first pay figure, automatically.
 *
 * The owner, 28 Sep 2026, on a profile reading "Joining Salary ৳1,18,000.00"
 * above a Current gross card that said nothing was recorded: *"karo jodi
 * joining salary dewa thake setai surute current salary howa ucit and eta auto
 * set hote hobe. pore eta change hole update record thakbe and update hobe eta
 * alada bepar."*
 *
 * Through the API, on members made for the purpose and removed after:
 *   - added with a joining salary: one pay row, that gross, from the joining
 *     date, the rule's reason, the Settings split, a sensitive audit row;
 *   - added with an explicit current salary: that wins, no automatic row;
 *   - added with no joining salary: nothing; a contractor: nothing, until
 *     they are made an employee;
 *   - a joining salary added later: the row appears on that save;
 *   - a corrected joining salary or date: the automatic row follows while it
 *     is the only one — and an untouched "Current salary" box (the drawer
 *     sends it pre-filled) does not stop it;
 *   - once a real change is recorded — a later raise, or an amendment on the
 *     joining date itself — correcting the joining salary no longer moves pay;
 *   - an explicit current salary in the same save wins over the correction;
 *   - a joining salary corrected to zero leaves the row alone;
 *   - the current-pay endpoint and the profile's history return the figure;
 *   - a newly built salary sheet carries it, split and all;
 *   - the salary sheet's one-off button still writes the same row;
 *   - hr (which holds team.compensation.write since 2026-08-15) and ceo
 *     (which holds neither team.write nor it): what each can do.
 *
 *     node .joiningpayqa.mjs     (needs the api on :4001; local DB only)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import { DEFAULT_SALARY_SPLIT, splitSalary } from "./packages/shared/dist/index.js";

const API = "http://localhost:4001/api";
const MARK = "JPQA";
const REASON = "Set from the salary agreed at joining";
// A payroll month nothing else uses; checked empty before it is touched.
const YEAR = 2039;
const MONTH = 11;

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

const mint = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const admin = (
  await q(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`)
)[0];
const caller = (token) => async (method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const call = caller(mint(admin));
const msgOf = (r) => String(r.body?.message ?? "") + " " + Object.values(r.body?.errors ?? {}).flat().join(" ");

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- cleanup */
const THROWAWAY = [`jpqa-hr@demo.sharevirals.test`, `jpqa-ceo@demo.sharevirals.test`];
async function wipe() {
  const members = (await q(`select id from team_members where full_name like $1`, [`${MARK} %`])).map((r) => r.id);
  const runs = (await q(`select id from payroll_runs where period_year = $1 and period_month = $2 and notes = $3`, [YEAR, MONTH, MARK])).map((r) => r.id);
  const ids = [...members, ...runs];
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::text[])`, [ids]);
  if (runs.length) {
    await q(`delete from payroll_lines where payroll_run_id = any($1::uuid[])`, [runs]);
    await q(`delete from payroll_runs where id = any($1::uuid[])`, [runs]);
  }
  if (members.length) {
    await q(`delete from payroll_lines where team_member_id = any($1::uuid[])`, [members]);
    await q(`delete from compensation_history where team_member_id = any($1::uuid[])`, [members]);
    await q(`delete from team_members where id = any($1::uuid[])`, [members]);
  }
  const users = (await q(`select id from users where email = any($1::text[])`, [THROWAWAY])).map((r) => r.id);
  if (users.length) {
    await q(`delete from audit_logs where actor_user_id = any($1::uuid[])`, [users]);
    await q(`delete from users where id = any($1::uuid[])`, [users]);
  }
}
await wipe();

/* ------------------------------------------------------------- helpers */
const rows = (memberId) =>
  q(
    `select id, gross_amount::text gross, effective_from::text "from", effective_to::text "to", change_reason reason, components
       from compensation_history where team_member_id = $1 and deleted_at is null order by effective_from, created_at`,
    [memberId],
  );
const compAudits = (memberId) =>
  q(
    `select summary, is_sensitive from audit_logs where entity_table = 'compensation_history' and entity_id = $1 order by occurred_at, id`,
    [memberId],
  );
const sameSplit = (components, gross) =>
  JSON.stringify(components) === JSON.stringify(splitSalary(gross, DEFAULT_SALARY_SPLIT));
const settingsSplit = (await q(`select salary_split from app_settings limit 1`))[0]?.salary_split;
const splitNote = settingsSplit && settingsSplit.length ? " (Settings has its own split — compared against the default, may differ)" : "";

const base = (name, extra = {}) => ({ fullName: `${MARK} ${name}`, joinedOn: "2026-03-01", ...extra });
async function add(name, extra, as = call) {
  const r = await as("POST", "/team-members", base(name, extra));
  return r;
}

try {
  /* ----- 1. added with a joining salary --------------------------------- */
  const a = await add("Abdullah", { joiningSalary: "118000" });
  check("an employee added with a joining salary is saved", a.status === 201, `HTTP ${a.status} ${a.status >= 300 ? msgOf(a) : ""}`);
  const A = a.body?.id;
  let ra = await rows(A);
  check("…and has exactly one pay row", ra.length === 1, `${ra.length} rows`);
  check(
    "…at the joining salary, from the joining date, open-ended",
    ra[0]?.gross === "118000.00" && ra[0]?.from === "2026-03-01" && ra[0]?.to === null,
    JSON.stringify({ gross: ra[0]?.gross, from: ra[0]?.from, to: ra[0]?.to }),
  );
  check("…with the rule's reason", ra[0]?.reason === REASON, ra[0]?.reason);
  check("…and the split frozen with it, exactly as create() does it" + splitNote, sameSplit(ra[0]?.components, "118000.00"), JSON.stringify(ra[0]?.components));
  let aa = await compAudits(A);
  check(
    "…with one sensitive audit row naming the amount",
    aa.length === 1 && aa[0].is_sensitive === true && aa[0].summary.includes("1,18,000.00") && aa[0].summary.includes("2026-03-01"),
    aa.map((x) => x.summary).join(" | "),
  );

  const current = await call("GET", "/team-members/compensation/current");
  const mine = (current.body ?? []).find((x) => x.teamMemberId === A);
  check("the current-pay endpoint returns the figure", mine?.grossAmount === "118000.00", JSON.stringify(mine));
  const hist = await call("GET", `/team-members/${A}/compensation`);
  check(
    "the profile's pay history (what the Current gross card reads) has it, open-ended",
    hist.status === 200 && hist.body?.length === 1 && hist.body[0].grossAmount === "118000.00" && hist.body[0].effectiveTo === null,
    `HTTP ${hist.status} ${JSON.stringify(hist.body?.map((h) => [h.grossAmount, h.effectiveFrom, h.effectiveTo]))}`,
  );

  /* ----- 2. explicit current salary wins -------------------------------- */
  const b = await add("Explicit", { joiningSalary: "90000", currentSalary: "95000" });
  const rb = await rows(b.body?.id);
  check(
    "added with an explicit current salary: that figure, and no automatic row",
    b.status === 201 && rb.length === 1 && rb[0].gross === "95000.00" && rb[0].reason === "Set when they were added",
    JSON.stringify(rb.map((r) => [r.gross, r.from, r.reason])),
  );

  /* ----- 3. no joining salary ------------------------------------------- */
  const c = await add("Nosalary", {});
  const C = c.body?.id;
  check("added with no joining salary: no pay row, no pay audit", c.status === 201 && (await rows(C)).length === 0 && (await compAudits(C)).length === 0);

  /* ----- 4. joining salary added later ---------------------------------- */
  const cLater = await call("PATCH", `/team-members/${C}`, { joiningSalary: "70000" });
  const rc = await rows(C);
  check(
    "a joining salary added by a later edit writes the row on that save",
    cLater.status === 200 && rc.length === 1 && rc[0].gross === "70000.00" && rc[0].from === "2026-03-01" && rc[0].reason === REASON,
    `HTTP ${cLater.status} ${JSON.stringify(rc.map((r) => [r.gross, r.from, r.reason]))}`,
  );
  const ca = await compAudits(C);
  check("…audited as set on a save", ca.length === 1 && ca[0].is_sensitive && ca[0].summary.includes("when their record was saved"), ca.map((x) => x.summary).join(" | "));

  /* ----- 5. contractors -------------------------------------------------- */
  const d = await add("Contractor", { engagementType: "contractor", joiningSalary: "50000" });
  const D = d.body?.id;
  check("a contractor added with a joining salary gets no pay row (not on any salary sheet)", d.status === 201 && (await rows(D)).length === 0);
  const dSame = await call("PATCH", `/team-members/${D}`, { designation: "Designer" });
  check("…nor on a later save while still a contractor", dSame.status === 200 && (await rows(D)).length === 0);
  const dEmp = await call("PATCH", `/team-members/${D}`, { engagementType: "employee" });
  const rd = await rows(D);
  check(
    "…and gets one on the save that makes them an employee",
    dEmp.status === 200 && rd.length === 1 && rd[0].gross === "50000.00" && rd[0].reason === REASON,
    JSON.stringify(rd.map((r) => [r.gross, r.from, r.reason])),
  );

  /* ----- 6. the automatic row follows a corrected joining salary -------- */
  const rowId = ra[0]?.id;
  const fix1 = await call("PATCH", `/team-members/${A}`, { joiningSalary: "120000" });
  ra = await rows(A);
  check(
    "correcting the joining salary moves the automatic row — same row, new gross, re-split",
    fix1.status === 200 && ra.length === 1 && ra[0].id === rowId && ra[0].gross === "120000.00" && ra[0].from === "2026-03-01" && sameSplit(ra[0].components, "120000.00"),
    `HTTP ${fix1.status} ${JSON.stringify(ra.map((r) => [r.gross, r.from]))}`,
  );
  aa = await compAudits(A);
  check("…with a sensitive audit row saying from what to what", aa.length === 2 && aa[1].is_sensitive && aa[1].summary.includes("1,18,000.00") && aa[1].summary.includes("1,20,000.00"), aa[1]?.summary);

  const fix2 = await call("PATCH", `/team-members/${A}`, { joinedOn: "2026-02-15" });
  ra = await rows(A);
  check("correcting the joining date moves its date", fix2.status === 200 && ra.length === 1 && ra[0].from === "2026-02-15" && ra[0].gross === "120000.00", JSON.stringify(ra.map((r) => [r.gross, r.from])));

  const auditsBefore = (await compAudits(A)).length;
  const other = await call("PATCH", `/team-members/${A}`, { designation: "Engineer" });
  ra = await rows(A);
  check(
    "a save that changes neither leaves pay and its audit trail alone",
    other.status === 200 && ra.length === 1 && ra[0].gross === "120000.00" && (await compAudits(A)).length === auditsBefore,
  );

  // The edit drawer sends "Current salary" pre-filled with what they are on.
  const drawer = await call("PATCH", `/team-members/${A}`, { joiningSalary: "121000", currentSalary: "120000" });
  ra = await rows(A);
  check(
    "an untouched Current salary box (sent equal to today's figure) does not stop it following",
    drawer.status === 200 && ra.length === 1 && ra[0].gross === "121000.00",
    `HTTP ${drawer.status} ${JSON.stringify(ra.map((r) => [r.gross, r.from, r.reason]))}`,
  );

  /* ----- 7. once a real change is recorded, it never follows again ------ */
  const raise = await call("POST", `/team-members/${A}/compensation`, { grossAmount: "130000", effectiveFrom: "2026-06-01", changeReason: "Raise" });
  check("a real change is recorded through the existing endpoint", raise.status === 201, `HTTP ${raise.status} ${raise.status >= 300 ? msgOf(raise) : ""}`);
  const fix3 = await call("PATCH", `/team-members/${A}`, { joiningSalary: "125000" });
  ra = await rows(A);
  check(
    "after it, correcting the joining salary changes no pay row",
    fix3.status === 200 && ra.length === 2 && ra[0].gross === "121000.00" && ra[0].from === "2026-02-15" && ra[1].gross === "130000.00",
    JSON.stringify(ra.map((r) => [r.gross, r.from, r.reason])),
  );
  const fix4 = await call("PATCH", `/team-members/${A}`, { joinedOn: "2026-01-10" });
  ra = await rows(A);
  check("…nor does correcting the joining date", fix4.status === 200 && ra[0].from === "2026-02-15", JSON.stringify(ra.map((r) => [r.gross, r.from])));
  const cur2 = (await call("GET", "/team-members/compensation/current")).body?.find((x) => x.teamMemberId === A);
  check("…and current pay is the raise", cur2?.grossAmount === "130000.00", JSON.stringify(cur2));

  // An amendment ON the joining date rewrites the automatic row in place.
  const e = await add("Amended", { joiningSalary: "60000", joinedOn: "2026-04-01" });
  const E = e.body?.id;
  const amend = await call("POST", `/team-members/${E}/compensation`, { grossAmount: "65000", effectiveFrom: "2026-04-01" });
  let re = await rows(E);
  check("an amendment on the joining date replaces the automatic figure in place", amend.status === 201 && re.length === 1 && re[0].gross === "65000.00", JSON.stringify(re.map((r) => [r.gross, r.from, r.reason])));
  const fixE = await call("PATCH", `/team-members/${E}`, { joiningSalary: "61000" });
  re = await rows(E);
  check("…and a corrected joining salary does not undo it", fixE.status === 200 && re.length === 1 && re[0].gross === "65000.00", JSON.stringify(re.map((r) => [r.gross, r.from, r.reason])));

  // An explicit, changed figure in the same save as the correction wins.
  const f = await add("Both", { joiningSalary: "40000" });
  const F = f.body?.id;
  const both = await call("PATCH", `/team-members/${F}`, { joiningSalary: "42000", currentSalary: "45000" });
  const rf = await rows(F);
  check(
    "a changed Current salary in the same save wins: the automatic row stays, the new figure is added",
    both.status === 200 && rf.length === 2 && rf[0].gross === "40000.00" && rf[0].reason === REASON && rf[1].gross === "45000.00",
    `HTTP ${both.status} ${JSON.stringify(rf.map((r) => [r.gross, r.from, r.reason]))}`,
  );

  // Zero: nothing to follow, and pay is not removed by a profile edit.
  const z = await add("Zero", { joiningSalary: "30000" });
  const Z = z.body?.id;
  const zero = await call("PATCH", `/team-members/${Z}`, { joiningSalary: "0" });
  const rz = await rows(Z);
  check("a joining salary corrected to zero leaves the automatic row where it is", zero.status === 200 && rz.length === 1 && rz[0].gross === "30000.00", `HTTP ${zero.status} ${JSON.stringify(rz.map((r) => r.gross))}`);
  const z0 = await add("Zeroed", { joiningSalary: "0" });
  check("…and a joining salary of zero writes nothing", z0.status === 201 && (await rows(z0.body?.id)).length === 0);

  /* ----- 8. the salary sheet picks it up -------------------------------- */
  const clash = await q(`select id from payroll_runs where period_year = $1 and period_month = $2`, [YEAR, MONTH]);
  if (clash.length) {
    check(`payroll: ${YEAR}-${MONTH} is free to use`, false, "a run already exists for that month — not touching it");
  } else {
    const run = await call("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: MONTH, notes: MARK });
    check("payroll: a draft run for a month after the join date", run.status === 201, `HTTP ${run.status} ${run.status >= 300 ? msgOf(run) : ""}`);
    const RUN = run.body?.id;
    const built = await call("POST", `/payroll/runs/${RUN}/generate-lines`);
    const lineC = (await q(`select gross_amount::text gross, earnings_breakdown from payroll_lines where payroll_run_id = $1 and team_member_id = $2`, [RUN, C]))[0];
    const lineD = (await q(`select gross_amount::text gross from payroll_lines where payroll_run_id = $1 and team_member_id = $2`, [RUN, D]))[0];
    check(
      "…Build list puts the member fixed by the rule on the sheet at that figure",
      built.status === 200 && lineC?.gross === "70000.00" && !(built.body?.skipped ?? []).includes(`${MARK} Nosalary`),
      `HTTP ${built.status} line ${JSON.stringify(lineC?.gross)} skipped ${JSON.stringify(built.body?.skipped)}`,
    );
    check("…with the split the row froze", JSON.stringify(lineC?.earnings_breakdown) === JSON.stringify(splitSalary("70000.00", DEFAULT_SALARY_SPLIT)) || Boolean(splitNote), JSON.stringify(lineC?.earnings_breakdown));
    check("…and the contractor-turned-employee too", lineD?.gross === "50000.00", JSON.stringify(lineD));
  }

  /* ----- 9. the salary sheet's one-off button, with this in place -------- */
  // Somebody already on the books, whom nothing has saved since: made as a
  // contractor through the API (no row), then turned into an employee in SQL
  // so no save runs the rule.
  const h = await add("Onbooks", { engagementType: "contractor", joiningSalary: "55000", joinedOn: "2026-01-05" });
  const Hid = h.body?.id;
  await q(`update team_members set engagement_type = 'employee' where id = $1`, [Hid]);
  const strangers = await q(
    `select m.full_name from team_members m
      where m.deleted_at is null and m.engagement_type = 'employee' and m.full_name not like $1
        and not exists (select 1 from compensation_history c where c.team_member_id = m.id and c.deleted_at is null)
        and m.joining_salary > 0`,
    [`${MARK} %`],
  );
  if (strangers.length) {
    console.log(`  skip  the one-off button — it would also touch ${strangers.length} real local member(s); not pressing it`);
  } else {
    const press = await call("POST", "/team-members/compensation/from-joining-salary");
    const rh = await rows(Hid);
    check(
      "the salary sheet's 'Set their pay from the joining salary' still sets the missing figure",
      press.status === 200 && press.body?.created === 1 && press.body?.names?.includes(`${MARK} Onbooks`) && rh.length === 1 && rh[0].gross === "55000.00" && rh[0].from === "2026-01-05" && rh[0].reason === REASON,
      `HTTP ${press.status} ${JSON.stringify(press.body)} ${JSON.stringify(rh.map((r) => [r.gross, r.from]))}`,
    );
    check("…now with the split, like the automatic row", sameSplit(rh[0]?.components, "55000.00") || Boolean(splitNote), JSON.stringify(rh[0]?.components));
    const ha = await compAudits(Hid);
    check("…and its audit row as before", ha.length === 1 && ha[0].is_sensitive && ha[0].summary.endsWith("taken from their joining salary"), ha.map((x) => x.summary).join(" | "));
    const again = await call("POST", "/team-members/compensation/from-joining-salary");
    check("…pressed twice, it writes nothing more", again.status === 200 && again.body?.created === 0 && (await rows(Hid)).length === 1, JSON.stringify(again.body));
    const follow = await call("PATCH", `/team-members/${Hid}`, { joiningSalary: "56000" });
    const rh2 = await rows(Hid);
    check("…and the row it wrote follows a corrected joining salary like the automatic one", follow.status === 200 && rh2.length === 1 && rh2[0].gross === "56000.00", JSON.stringify(rh2.map((r) => r.gross)));
  }

  /* ----- 10. roles -------------------------------------------------------- */
  const makeUser = async (email, role) => {
    await q(
      `insert into users (email, full_name, password_hash, role, status)
       values ($1, $2, '$2b$12$0000000000000000000000000000000000000000000000000000', $3, 'active')`,
      [email, `${MARK} ${role}`, role],
    );
    return (await q(`select id, role, token_version from users where email = $1`, [email]))[0];
  };
  const hr = caller(mint(await makeUser(THROWAWAY[0], "hr")));
  const ceo = caller(mint(await makeUser(THROWAWAY[1], "ceo")));

  const g = await add("Byhr", { joiningSalary: "80000" }, hr);
  const G = g.body?.id;
  const rg = await rows(G);
  check(
    "hr adds a member with a joining salary: saved, and the joining salary becomes the first pay figure",
    g.status === 201 && rg.length === 1 && rg[0].gross === "80000.00" && rg[0].reason === REASON,
    `HTTP ${g.status} ${JSON.stringify(rg.map((r) => [r.gross, r.reason]))}`,
  );
  check("…the create response carries no pay figure", g.body && !("currentSalary" in g.body) && !("grossAmount" in g.body));
  const hrCur = await add("Byhrcur", { joiningSalary: "80000", currentSalary: "82000" }, hr);
  console.log(`  info  hr sending currentSalary on create: HTTP ${hrCur.status} (hr holds team.compensation.write)`);
  const hrRaise = await hr("POST", `/team-members/${G}/compensation`, { grossAmount: "85000", effectiveFrom: "2026-07-01" });
  console.log(`  info  hr recording a pay change: HTTP ${hrRaise.status}`);
  if (!strangers.length) {
    const hrBackfill = await hr("POST", "/team-members/compensation/from-joining-salary");
    console.log(`  info  hr pressing the one-off button: HTTP ${hrBackfill.status}`);
  }
  const hrRun = await hr("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: 12, notes: MARK });
  check("hr still cannot start a payroll run (payroll.write)", hrRun.status === 403, `HTTP ${hrRun.status}`);
  if (hrRun.status < 300) await q(`delete from payroll_runs where id = $1`, [hrRun.body?.id]);

  const ceoAdd = await add("Byceo", { joiningSalary: "80000" }, ceo);
  check("ceo (no team.write, no team.compensation.write) cannot add a member at all", ceoAdd.status === 403, `HTTP ${ceoAdd.status}`);
  const ceoEdit = await ceo("PATCH", `/team-members/${G}`, { joiningSalary: "99000" });
  check("…nor edit a joining salary", ceoEdit.status === 403 && (await rows(G))[0]?.gross === "80000.00", `HTTP ${ceoEdit.status}`);
  const ceoPay = await ceo("POST", `/team-members/${G}/compensation`, { grossAmount: "99000", effectiveFrom: "2026-08-01" });
  check("…nor record pay", ceoPay.status === 403, `HTTP ${ceoPay.status}`);
  const ceoBackfill = await ceo("POST", "/team-members/compensation/from-joining-salary");
  check("…nor press the one-off button", ceoBackfill.status === 403, `HTTP ${ceoBackfill.status}`);
} finally {
  await wipe();
  const left = await q(`select count(*)::int n from team_members where full_name like $1`, [`${MARK} %`]);
  const leftRuns = await q(`select count(*)::int n from payroll_runs where period_year = $1 and period_month in ($2, 12) and notes = $3`, [YEAR, MONTH, MARK]);
  const leftUsers = await q(`select count(*)::int n from users where email = any($1::text[])`, [THROWAWAY]);
  check("cleanup: no member, run or user left behind", left[0].n === 0 && leftRuns[0].n === 0 && leftUsers[0].n === 0, `${left[0].n} members, ${leftRuns[0].n} runs, ${leftUsers[0].n} users`);
  await db.end();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
