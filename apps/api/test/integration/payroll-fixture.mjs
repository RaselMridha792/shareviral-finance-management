/**
 * A payroll run the suites own.
 *
 * They used to borrow the demo's August draft. When the demo people were
 * removed on 2026-08-14 both runs went with them, and the suites did not fail —
 * they reported "no draft run to take through" and passed, which is the worst
 * thing a test can do. So the payroll suites build their own now: two people
 * created for the purpose, given salaries, put into a run.
 *
 * Everyone it creates is tagged `[test]` in `notes`, which is what `reset.mjs`
 * looks for when it clears up, and what keeps this away from real employees.
 */
const TAG = "[test]";

/**
 * @param send  (path, method, body) — for the writes
 * @param read  (path) — a plain GET; `send` always attaches a body, and fetch
 *              refuses a GET that carries one.
 */
export async function makePayrollRun(send, read, { year = 2026, month = 9 } = {}) {
  const people = [];

  for (const [i, spec] of [
    { name: "Payroll Fixture One", salary: "50000.00", designation: "Engineer" },
    { name: "Payroll Fixture Two", salary: "35000.00", designation: "Analyst" },
  ].entries()) {
    const made = await send("/team-members", "POST", {
      fullName: spec.name,
      engagementType: "employee",
      designation: spec.designation,
      joinedOn: "2026-01-01",
      notes: `Created by the integration suite ${TAG}`,
    });
    if (made.status !== 201 && made.status !== 200) {
      throw new Error(`could not create ${spec.name}: HTTP ${made.status} ${JSON.stringify(made.body)}`);
    }

    const paid = await send(`/team-members/${made.body.id}/compensation`, "POST", {
      grossAmount: spec.salary,
      effectiveFrom: "2026-01-01",
      changeReason: "Set by the integration suite",
    });
    if (paid.status !== 201 && paid.status !== 200) {
      throw new Error(`could not set pay for ${spec.name}: HTTP ${paid.status} ${JSON.stringify(paid.body)}`);
    }

    people.push({ id: made.body.id, ...spec, index: i });
  }

  const run = await send("/payroll/runs", "POST", {
    periodYear: year,
    periodMonth: month,
    notes: `Created by the integration suite ${TAG}`,
  });
  if (run.status !== 201 && run.status !== 200) {
    throw new Error(`could not create the run: HTTP ${run.status} ${JSON.stringify(run.body)}`);
  }

  const generated = await send(`/payroll/runs/${run.body.id}/generate-lines`, "POST");
  if (generated.status !== 201 && generated.status !== 200) {
    throw new Error(`could not generate lines: HTTP ${generated.status} ${JSON.stringify(generated.body)}`);
  }

  /**
   * A tax figure typed against each line, because a run that withholds nothing
   * cannot test the claim that matters: tax withheld is an obligation, not
   * money that moved. Without this the suite reported "this run withheld
   * nothing" and passed, which proves only that the fixture was thin.
   *
   * The app never calculates these — the accountant does, and the app records
   * what they say. So the suite types them the same way a person would.
   */
  const detail = await read(`/payroll/runs/${run.body.id}`);
  const lines = detail.body?.lines ?? [];
  let withheld = 0;
  for (const [i, line] of lines.entries()) {
    const tds = i === 0 ? "2500.00" : "1200.00";
    const set = await send(`/payroll/lines/${line.id}`, "PATCH", { tdsAmount: tds });
    if (set.status !== 200) {
      throw new Error(`could not set tax on a line: HTTP ${set.status} ${JSON.stringify(set.body)}`);
    }
    withheld += Number(tds);
  }

  const gross = people.reduce((sum, p) => sum + Number(p.salary), 0);
  return {
    runId: run.body.id,
    people,
    gross,
    /** What was withheld, so a suite can assert it stayed in the account. */
    withheld,
    /** What should actually leave the bank when the run is paid. */
    net: gross - withheld,
  };
}

/**
 * Removes a fixture run and its people.
 *
 * Takes the database client rather than going through the API, because the app
 * quite rightly refuses to delete a paid run — and this has to work whatever
 * state the suite left the run in, including a failed one.
 */
export async function dropPayrollRun(db, runId) {
  if (runId) {
    const lines = (
      await db.query("select id from payroll_lines where payroll_run_id = $1", [runId])
    ).rows.map((r) => r.id);
    if (lines.length) {
      await db.query("delete from tds_allocations where payroll_line_id = any($1::uuid[])", [lines]);
    }
    await db.query("delete from transactions where payroll_run_id = $1", [runId]);
    await db.query("delete from payroll_lines where payroll_run_id = $1", [runId]);
    await db.query("delete from payroll_runs where id = $1", [runId]);
  }

  const people = (
    await db.query("select id from team_members where notes like $1", [`%${TAG}%`])
  ).rows.map((r) => r.id);
  if (people.length) {
    await db.query("delete from compensation_history where team_member_id = any($1::uuid[])", [people]);
    await db.query("delete from payroll_lines where team_member_id = any($1::uuid[])", [people]);
    await db.query("delete from audit_logs where entity_id = any($1::text[])", [people]);
    await db.query("delete from team_members where id = any($1::uuid[])", [people]);
  }
  return people.length;
}
