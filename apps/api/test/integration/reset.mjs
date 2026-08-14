/**
 * Puts the demo books back exactly as `db:demo` leaves them.
 *
 * The suites that move real money — paying a payroll run, committing an import
 * — clean up after themselves, but a suite that fails early can exit before its
 * cleanup runs. That once left August's run paid, its ৳3,95,000 out of petty
 * cash, and petty cash showing a negative balance; the next suite then found no
 * draft run and reported nothing rather than failing. A silent skip is worse
 * than a failure, so the runner resets between suites instead of trusting each
 * one to unwind itself.
 *
 * Everything here is keyed off what the demo seed writes, so it is safe to run
 * at any point and does nothing when the books are already clean.
 */
import fs from "node:fs";
import pg from "pg";

/** The last reference number the demo seed issues. Anything above it is a test's. */
const LAST_DEMO_REF = "TXN-2026-000021";

export function loadEnv() {
  return Object.fromEntries(
    fs
      .readFileSync(new URL("../../.env", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [
          l.slice(0, i).trim(),
          l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

export async function openDb(env = loadEnv()) {
  const db = new pg.Client({
    connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  return db;
}

export async function resetDemoBooks(db) {
  const undone = [];

  // 1. Ledger rows no demo seed wrote.
  const extra = (
    await db.query("select id, ref_no from transactions where ref_no > $1", [
      LAST_DEMO_REF,
    ])
  ).rows;
  if (extra.length) {
    const ids = extra.map((r) => r.id);
    await db.query("delete from audit_logs where entity_id = any($1::text[])", [
      ids,
    ]);
    await db.query("delete from transactions where id = any($1::uuid[])", [ids]);
    undone.push(`${extra.length} stray ledger row(s)`);
  }

  // 2. A voided demo row is a test's doing — the seed voids nothing.
  const unvoided = await db.query(
    `update transactions set voided_at = null, voided_by = null, void_reason = null
      where ref_no <= $1 and voided_at is not null`,
    [LAST_DEMO_REF],
  );
  if (unvoided.rowCount) undone.push(`${unvoided.rowCount} voided demo row(s)`);

  // 3. July is paid, August is a draft. That is the demo's whole point: one
  //    month closed, one month waiting.
  const [july] = (
    await db.query(
      "select id from payroll_runs where period_year = 2026 and period_month = 7",
    )
  ).rows;
  const [august] = (
    await db.query(
      "select id from payroll_runs where period_year = 2026 and period_month = 8",
    )
  ).rows;

  if (august) {
    const [{ status }] = (
      await db.query("select status from payroll_runs where id = $1", [
        august.id,
      ])
    ).rows;
    if (status !== "draft") {
      await db.query(
        "update payroll_lines set is_paid = false, paid_on = null where payroll_run_id = $1",
        [august.id],
      );
      await db.query(
        `update payroll_runs set status = 'draft', finalized_at = null, finalized_by = null,
           payment_date = null, account_id = null where id = $1`,
        [august.id],
      );
      undone.push(`August's run (was ${status})`);
    }
  }
  if (july) {
    const [{ status }] = (
      await db.query("select status from payroll_runs where id = $1", [july.id])
    ).rows;
    if (status !== "paid") {
      await db.query("update payroll_runs set status = 'paid' where id = $1", [
        july.id,
      ]);
      undone.push(`July's run (was ${status})`);
    }
  }

  // 4. Import batches a test committed.
  const batches = await db.query(
    "delete from import_batches where created_at > now() - interval '2 hours' returning id",
  );
  if (batches.rowCount) undone.push(`${batches.rowCount} import batch(es)`);

  // 5. Accounts the suites created and any test user left behind.
  const users = await db.query(
    "delete from users where email like 't1%.%@shareviral.cash' returning email",
  );
  if (users.rowCount) undone.push(`${users.rowCount} test account(s)`);

  // 6. The financial year is a setting a suite flips and must put back.
  await db.query(
    "update app_settings set fiscal_year_mode = 'bd_july_june' where id = 1 and fiscal_year_mode <> 'bd_july_june'",
  );

  return undone;
}

/** What the books must look like: the numbers `db:demo` produces. */
export async function booksState(db) {
  const [{ n }] = (
    await db.query("select count(*)::int n from transactions")
  ).rows;
  const runs = (
    await db.query(
      "select period_month, status from payroll_runs order by period_month",
    )
  ).rows;
  const balances = (
    await db.query(
      `select name, (opening_balance::numeric + coalesce((select sum(signed_amount) from transactions t
         where t.account_id = a.id and t.voided_at is null), 0))::text b
       from accounts a order by name`,
    )
  ).rows;
  return { transactions: n, runs, balances };
}

// Runnable on its own: `node test/integration/reset.mjs`
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const db = await openDb();
  const undone = await resetDemoBooks(db);
  const state = await booksState(db);
  await db.end();
  console.log(undone.length ? `Undone: ${undone.join(", ")}` : "Already clean");
  console.log(`transactions: ${state.transactions}`);
  for (const r of state.runs)
    console.log(`  run 2026-${String(r.period_month).padStart(2, "0")}: ${r.status}`);
  for (const b of state.balances) console.log(`  ${b.name.padEnd(26)} ${b.b}`);
}
