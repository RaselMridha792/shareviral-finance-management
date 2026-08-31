/**
 * A challan in the trash must stop counting as tax paid.
 *
 * The register that lists challans filters `deleted_at`. The figures that add
 * them up did not — they only asked whether the linked payment had been
 * voided. So trashing a challan took it off the screen and left its money in
 * the totals, and an unpaid tax obligation read as settled: the month showed
 * `outstanding 0.00`, the Reports overview showed it deposited, and the
 * dashboard's "not yet deposited" warning never fired.
 *
 * The sharpest of those is the last one, so it is the test that matters most:
 * trash the challan and the warning must appear.
 *
 *     node .challanqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
// The same three helpers the nightly sweep decides with. Read from the built
// `dist`, exactly as the API reads them, so the month this file drives can
// never disagree with the month the product looks at.
import {
  deadlineStatus,
  tdsDepositDeadlineForMonth,
  todayInDhaka,
} from "@finance/shared";

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
const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const person = (
  await db.query(
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
const call = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */
/*
 * October 2026: ৳4,000 withheld from one salary, and a challan for exactly
 * that. Deducted equals deposited, so the month starts settled — which is what
 * makes the trashed-challan case visible: everything below should move.
 */
const YEAR = 2026;
const MONTH = 10;

const wipe = async () => {
  await db.query(
    `delete from tds_allocations where deposit_id in
       (select id from tds_deposits where challan_number like 'CQA-%')`,
  );
  await db.query("delete from tds_deposits where challan_number like 'CQA-%'");
  await db.query(
    `delete from tds_deposits where period_year = $1 and period_month = $2`,
    [YEAR, MONTH],
  );
  await db.query(
    `delete from payroll_lines where payroll_run_id in
       (select id from payroll_runs where label like 'CQA %'
          or (period_year = $1 and period_month = $2))`,
    [YEAR, MONTH],
  );
  await db.query(
    `delete from payroll_runs where label like 'CQA %'
       or (period_year = $1 and period_month = $2)`,
    [YEAR, MONTH],
  );
  // The reminder fixture at the foot of this file hangs its line off whatever
  // run already owns the month the sweep is reading — which is usually a real
  // one, because `payroll_runs` is unique per period and a real month already
  // has its run. Such a line cannot be found by run label, so it is cleared by
  // its person instead; without this a crashed run left a line behind and the
  // `team_members` delete below failed on the foreign key.
  await db.query(
    `delete from tds_allocations where payroll_line_id in
       (select l.id from payroll_lines l
          join team_members t on t.id = l.team_member_id
         where t.full_name like 'CQA %')`,
  );
  await db.query(
    `delete from payroll_lines where team_member_id in
       (select id from team_members where full_name like 'CQA %')`,
  );
  await db.query("delete from team_members where full_name like 'CQA %'");
};
await wipe();

const account = (
  await db.query("select id from accounts where deleted_at is null limit 1")
).rows[0];
if (!account) {
  console.log("no account to hang a challan on — seed one first");
  process.exit(1);
}

const member = (
  await db.query(
    `insert into team_members (full_name, engagement_type, designation, status, joined_on, created_by, updated_by)
     values ('CQA Taxed Person', 'employee', 'Tester', 'active', '2020-01-01', $1, $1) returning id`,
    [person.id],
  )
).rows[0].id;
const run = (
  await db.query(
    `insert into payroll_runs (period_year, period_month, label, status, total_gross, total_additions, total_tds, total_deductions, total_net, created_by, updated_by)
     values ($1, $2, 'CQA October', 'finalized', '80000.00','0.00','4000.00','0.00','76000.00', $3, $3) returning id`,
    [YEAR, MONTH, person.id],
  )
).rows[0].id;
const line = (
  await db.query(
    `insert into payroll_lines (payroll_run_id, team_member_id, gross_amount, tds_amount, updated_by)
     values ($1, $2, '80000.00', '4000.00', $3) returning id`,
    [run, member, person.id],
  )
).rows[0].id;
const challan = (
  await db.query(
    `insert into tds_deposits (challan_number, challan_date, deposit_date, amount, bank_name, period_year, period_month, deposit_type, account_id, created_by, updated_by)
     values ('CQA-2026-10', $1, $1, '4000.00', 'Sonali Bank', $2, $3, 'salary', $4, $5, $5) returning id`,
    [`${YEAR}-${String(MONTH).padStart(2, "0")}-20`, YEAR, MONTH, account.id, person.id],
  )
).rows[0].id;
await db.query(
  `insert into tds_allocations (deposit_id, payroll_line_id, amount) values ($1, $2, '4000.00')`,
  [challan, line],
);

/* ------------------------------------------------------------- readings */

const monthRow = async () => {
  const res = await call("GET", `/tds/liability?year=${YEAR}`);
  return (res.body?.months ?? []).find((r) => Number(r.month) === MONTH) ?? null;
};
const overview = async () => {
  const res = await call(
    "GET",
    `/reports/overview?granularity=month&fiscalYear=${YEAR}&index=4`,
  );
  const b = res.body?.totals ?? res.body;
  return {
    period: res.body?.period?.label ?? null,
    taxDeposited: b?.taxDeposited ?? null,
    taxOutstanding: b?.taxOutstanding ?? null,
  };
};
const pendingHasOctober = async () => {
  const res = await call("GET", "/tds/pending");
  const items = res.body?.items ?? res.body ?? [];
  return (Array.isArray(items) ? items : []).some(
    (i) => i.kind === "tds_deposit" && /October 2026/.test(i.title ?? ""),
  );
};

const before = await monthRow();
check(
  "October starts settled — deducted 4,000, deposited 4,000",
  before?.totalDeducted === "4000.00" && before?.deposited === "4000.00",
  JSON.stringify({
    deducted: before?.totalDeducted,
    deposited: before?.deposited,
    outstanding: before?.outstanding,
  }),
);
const overviewBefore = await overview();
check(
  "and the Reports overview counts it as deposited",
  Number(overviewBefore.taxDeposited) >= 4000,
  JSON.stringify(overviewBefore),
);
check(
  "so nothing is pending for October",
  (await pendingHasOctober()) === false,
  "",
);
const outstandingBefore = Number(overviewBefore.taxOutstanding ?? 0);

/* ------------------------------------------------- the challan is trashed */

const trashed = await call("POST", `/trash/tds-deposit/${challan}`, {
  reason: "Challan QA",
});
check("the challan moves to the trash", trashed.status === 201, `HTTP ${trashed.status}`);

const listed = await call("GET", "/tds/deposits");
check(
  "it leaves the challan register, as it always did",
  !((listed.body?.items ?? listed.body ?? []).some?.((d) => d.id === challan) ?? false),
  "",
);

const after = await monthRow();
check(
  "the month no longer counts it as deposited",
  after?.deposited === "0.00",
  JSON.stringify({ deposited: after?.deposited, outstanding: after?.outstanding }),
);
check(
  "and October is owed again",
  after?.outstanding === "4000.00",
  `outstanding ${after?.outstanding}`,
);

const overviewAfter = await overview();
check(
  "the Reports overview stops counting it",
  Number(overviewAfter.taxDeposited) === Number(overviewBefore.taxDeposited) - 4000,
  JSON.stringify({
    was: overviewBefore.taxDeposited,
    now: overviewAfter.taxDeposited,
  }),
);
check(
  "and what is still owed goes up by the same 4,000",
  Number(overviewAfter.taxOutstanding) === outstandingBefore + 4000,
  JSON.stringify({ was: outstandingBefore, now: overviewAfter.taxOutstanding }),
);
check(
  "the dashboard now warns that October's tax is not deposited",
  (await pendingHasOctober()) === true,
  "this is the one that matters: an unpaid obligation must not read as settled",
);

/* ---------------------------------------------------------- and restored */

const restored = await call("POST", `/trash/tds-deposit/${challan}/restore`);
check("the challan restores", restored.status === 201, `HTTP ${restored.status}`);
const back = await monthRow();
check(
  "and every figure comes back",
  back?.deposited === "4000.00" && back?.outstanding === "0.00",
  JSON.stringify({ deposited: back?.deposited, outstanding: back?.outstanding }),
);
check(
  "the warning goes away again",
  (await pendingHasOctober()) === false,
  "",
);

/* ---------------- the reminder that is supposed to chase unpaid tax ----- */
/*
 * The other surface a trashed challan reaches, and the quietest one: the
 * nightly sweep sums *allocations*, not challans, so a trashed challan went on
 * covering its payroll lines and the bell said nothing about tax nobody had
 * paid. Driven rather than asserted, which means using a month the sweep
 * actually looks at.
 *
 * WAS: July 2026, written down as a constant "against a clock sitting in
 * August". The sweep reads last month and this one, so at midnight on 1
 * September July fell out of the window entirely: "stays quiet" then passed
 * for the wrong reason — nobody was looking at July at all — and "chases the
 * unpaid tax" failed with the product perfectly correct. The month is now
 * computed from the same helpers the sweep computes it with, so it moves with
 * the clock instead of rotting once a month.
 *
 * The sweep has a second gate the fixture cannot argue with, and it is a rule
 * in its own right: it looks at a period only once that period's deposit
 * deadline is within seven days or already past, so that a bell nobody needs
 * yet does not teach people to ignore the one that matters. A month's deadline
 * is the 14th of the month after it, which means that on the 1st to the 6th
 * neither month the sweep reads is due yet and no data of any shape can make
 * it ring. On those days the expectation flips — trash the challan and the
 * bell must *hold* — which is the same rule read from the other side, and is
 * asserted rather than skipped.
 */
const pad = (n) => String(n).padStart(2, "0");
const dhakaToday = todayInDhaka();
const [nowYear, nowMonth] = dhakaToday.split("-").map(Number);
// Exactly the two periods NotificationEventsService.tdsDeadline() walks.
const sweepWindow = [
  nowMonth === 1 ? { y: nowYear - 1, m: 12 } : { y: nowYear, m: nowMonth - 1 },
  { y: nowYear, m: nowMonth },
];
const seasonOf = (p) =>
  deadlineStatus(tdsDepositDeadlineForMonth(p.y, p.m), 7, dhakaToday);
// The month the sweep will actually act on today; last month when neither is
// due yet, because that is the one whose deadline arrives first.
const period = sweepWindow.find((p) => seasonOf(p) !== "upcoming") ?? sweepWindow[0];
const deadline = tdsDepositDeadlineForMonth(period.y, period.m);
const inSeason = seasonOf(period) !== "upcoming";
const KEY = `tds:${period.y}-${pad(period.m)}`;
const SWEEP_CHALLAN = `CQA-SWEEP-${period.y}-${pad(period.m)}`;
const SWEEP_LABEL = `CQA sweep ${period.y}-${pad(period.m)}`;

console.log(
  `\n  the sweep is reading ${deadline.periodLabel} (due ${deadline.dueOn}, ` +
    `${seasonOf(period)} on ${dhakaToday})`,
);
if (!inSeason) {
  console.log(
    "  OUT OF SEASON — nothing in the sweep's window is due within seven days,\n" +
      "  so the bell cannot ring for any data today. The trashed-challan case\n" +
      `  returns on ${nowYear}-${pad(nowMonth)}-07, seven days before ${deadline.dueOn}; until then\n` +
      "  the sweep's half of the rule is held by the source check at the foot of this file.",
  );
}

/*
 * A period may hold only one payroll run (`payroll_runs_period_idx`), and a
 * real month already has its run — so the fixture line joins whatever run owns
 * the month and is removed again afterwards, rather than inserting a second
 * one and failing on the unique index. Its own person is what keeps it
 * separable from every real line in that run, and from the October fixture
 * above when the two land in the same month.
 */
const sweepMember = (
  await db.query(
    `insert into team_members (full_name, engagement_type, designation, status, joined_on, created_by, updated_by)
     values ('CQA Sweep Person', 'employee', 'Tester', 'active', '2020-01-01', $1, $1) returning id`,
    [person.id],
  )
).rows[0].id;

const wipeSweep = async () => {
  await db.query(
    `delete from tds_allocations where deposit_id in
       (select id from tds_deposits where challan_number = $1)`,
    [SWEEP_CHALLAN],
  );
  await db.query("delete from tds_deposits where challan_number = $1", [SWEEP_CHALLAN]);
  await db.query(
    `delete from tds_allocations where payroll_line_id in
       (select id from payroll_lines where team_member_id = $1)`,
    [sweepMember],
  );
  await db.query("delete from payroll_lines where team_member_id = $1", [sweepMember]);
  await db.query("delete from payroll_runs where label = $1", [SWEEP_LABEL]);
  await db.query("delete from notifications where dedupe_key = $1", [KEY]);
};
await wipeSweep();

let lastSweepStatus = null;
const sweepRings = async () => {
  // The sweep raises one notification per period and then dedupes, so the
  // previous verdict is cleared before asking again.
  await db.query("delete from notifications where dedupe_key = $1", [KEY]);
  lastSweepStatus = (await call("POST", "/notifications/run")).status;
  const rows = await db.query(
    "select count(*)::int as n from notifications where dedupe_key = $1",
    [KEY],
  );
  return rows.rows[0].n > 0;
};

/*
 * The month is a real one now rather than a made-up one, so it has to be asked
 * whether it is quiet before anything is added to it: a period that already
 * owes tax of its own would ring on every reading below and the trashed
 * challan would prove nothing. A failure here is the fixture month, not the
 * product.
 */
check(
  `the sweep's month starts with nothing outstanding of its own`,
  (await sweepRings()) === false,
  `${deadline.periodLabel} — if this fails, that month has undeposited tax already`,
);
// Every reading below is "the bell said nothing", and a job that never ran
// says nothing too. So the job is made to prove it ran at all.
check(
  "and the nightly job actually ran when asked",
  lastSweepStatus === 200,
  `POST /notifications/run — HTTP ${lastSweepStatus}`,
);

const existingRun = (
  await db.query(
    "select id from payroll_runs where period_year = $1 and period_month = $2 limit 1",
    [period.y, period.m],
  )
).rows[0];
const sweepRun =
  existingRun?.id ??
  (
    await db.query(
      `insert into payroll_runs (period_year, period_month, label, status, total_gross, total_additions, total_tds, total_deductions, total_net, created_by, updated_by)
       values ($1, $2, $3, 'finalized', '90000.00','0.00','5000.00','0.00','85000.00', $4, $4) returning id`,
      [period.y, period.m, SWEEP_LABEL, person.id],
    )
  ).rows[0].id;
const sweepLine = (
  await db.query(
    `insert into payroll_lines (payroll_run_id, team_member_id, gross_amount, tds_amount, updated_by)
     values ($1, $2, '90000.00', '5000.00', $3) returning id`,
    [sweepRun, sweepMember, person.id],
  )
).rows[0].id;
const sweepChallan = (
  await db.query(
    `insert into tds_deposits (challan_number, challan_date, deposit_date, amount, bank_name, period_year, period_month, deposit_type, account_id, created_by, updated_by)
     values ($1, $2, $2, '5000.00', 'Sonali Bank', $3, $4, 'salary', $5, $6, $6) returning id`,
    [SWEEP_CHALLAN, deadline.dueOn, period.y, period.m, account.id, person.id],
  )
).rows[0].id;
await db.query(
  `insert into tds_allocations (deposit_id, payroll_line_id, amount) values ($1, $2, '5000.00')`,
  [sweepChallan, sweepLine],
);

check(
  `with ${deadline.periodLabel}'s challan in place the reminder stays quiet`,
  (await sweepRings()) === false,
  "",
);

await call("POST", `/trash/tds-deposit/${sweepChallan}`, { reason: "Challan QA" });
const rangAfterTrash = await sweepRings();
if (inSeason) {
  check(
    "trash it and the reminder chases the unpaid tax",
    rangAfterTrash === true,
    `${deadline.periodLabel} is ${seasonOf(period)} — due ${deadline.dueOn}`,
  );
} else {
  // The same rule from the other side, on the days the deadline gate is shut:
  // 5,000 is undeposited and the sweep must still say nothing, because the
  // deadline decides whether to look before the ledger decides what to say.
  check(
    "out of season — trash it and the reminder holds until the deadline is near",
    rangAfterTrash === false,
    `${deadline.periodLabel} is not due until ${deadline.dueOn}; nothing in the sweep's window is within seven days of ${dhakaToday}`,
  );
}

await call("POST", `/trash/tds-deposit/${sweepChallan}/restore`);
check(
  "restore it and the reminder goes quiet again",
  (await sweepRings()) === false,
  "",
);
await wipeSweep();
await db.query("delete from team_members where id = $1", [sweepMember]);

/* ------------------------------ the rule lives in one place, not six ---- */

const sources = [
  "apps/api/src/modules/tds/tds.service.ts",
  "apps/api/src/modules/reports/overview.service.ts",
  "apps/api/src/modules/ai-intake/ai-tools.ts",
  "apps/api/src/modules/notifications/notification-events.service.ts",
];
const missing = sources.filter(
  (f) => !/CHALLAN_COUNTS|ALLOCATION_COUNTS/.test(fs.readFileSync(f, "utf8")),
);
check(
  "every file that adds challans up reads the one shared rule",
  missing.length === 0,
  missing.length ? `no CHALLAN_COUNTS in: ${missing.join(", ")}` : "",
);

await wipe();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
