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
 * actually looks at — it reads last month and this one, so July 2026 against a
 * clock sitting in August.
 */
const JULY = 7;
const wipeJuly = async () => {
  await db.query(
    `delete from tds_allocations where deposit_id in
       (select id from tds_deposits where challan_number = 'CQA-2026-07')`,
  );
  await db.query("delete from tds_deposits where challan_number = 'CQA-2026-07'");
  await db.query(
    `delete from payroll_lines where payroll_run_id in
       (select id from payroll_runs where label = 'CQA July')`,
  );
  await db.query("delete from payroll_runs where label = 'CQA July'");
  await db.query("delete from notifications where dedupe_key = 'tds:2026-07'");
};
await wipeJuly();

const julyRun = (
  await db.query(
    `insert into payroll_runs (period_year, period_month, label, status, total_gross, total_additions, total_tds, total_deductions, total_net, created_by, updated_by)
     values ($1, $2, 'CQA July', 'finalized', '90000.00','0.00','5000.00','0.00','85000.00', $3, $3) returning id`,
    [YEAR, JULY, person.id],
  )
).rows[0].id;
const julyLine = (
  await db.query(
    `insert into payroll_lines (payroll_run_id, team_member_id, gross_amount, tds_amount, updated_by)
     values ($1, $2, '90000.00', '5000.00', $3) returning id`,
    [julyRun, member, person.id],
  )
).rows[0].id;
const julyChallan = (
  await db.query(
    `insert into tds_deposits (challan_number, challan_date, deposit_date, amount, bank_name, period_year, period_month, deposit_type, account_id, created_by, updated_by)
     values ('CQA-2026-07', '2026-08-10', '2026-08-10', '5000.00', 'Sonali Bank', $1, $2, 'salary', $3, $4, $4) returning id`,
    [YEAR, JULY, account.id, person.id],
  )
).rows[0].id;
await db.query(
  `insert into tds_allocations (deposit_id, payroll_line_id, amount) values ($1, $2, '5000.00')`,
  [julyChallan, julyLine],
);

const sweepRaisesJuly = async () => {
  // The sweep raises one notification per period and then dedupes, so the
  // previous verdict is cleared before asking again.
  await db.query("delete from notifications where dedupe_key = 'tds:2026-07'");
  await call("POST", "/notifications/run");
  const rows = await db.query(
    "select count(*)::int as n from notifications where dedupe_key = 'tds:2026-07'",
  );
  return rows.rows[0].n > 0;
};

check(
  "with July's challan in place the reminder stays quiet",
  (await sweepRaisesJuly()) === false,
  "",
);
await call("POST", `/trash/tds-deposit/${julyChallan}`, { reason: "Challan QA" });
check(
  "trash it and the reminder chases the unpaid tax",
  (await sweepRaisesJuly()) === true,
  "",
);
await call("POST", `/trash/tds-deposit/${julyChallan}/restore`);
check(
  "restore it and the reminder goes quiet again",
  (await sweepRaisesJuly()) === false,
  "",
);
await wipeJuly();

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
