/**
 * Finalising a payroll run, which is the largest single movement this app makes.
 *
 * A run holds a line per person; finalising freezes it and paying it moves the
 * whole net out of an account. The figures that matter are the run's own totals
 * — gross, TDS, net — and they have to be the sum of the lines rather than
 * anything stored separately and allowed to drift.
 *
 * Read-only. It does not finalise or pay anything: that is a state change on a
 * whole month's salary and not something to try on a whim, even locally. What
 * it does check is that the totals a person would be finalising *are* the lines
 * they can see, because that is what makes the button safe to press.
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const runs = (
  await c.query(`
    select r.id, r.label, r.status,
           r.total_gross::numeric      as stored_gross,
           r.total_tds::numeric        as stored_tds,
           r.total_net::numeric        as stored_net,
           count(l.id)::int            as lines,
           coalesce(sum(l.gross_amount::numeric), 0)     as sum_gross,
           coalesce(sum(l.tds_amount::numeric), 0)       as sum_tds,
           coalesce(sum(l.gross_amount::numeric
                      + l.bonus_amount::numeric
                      + l.other_additions::numeric
                      - l.tds_amount::numeric
                      - l.other_deductions::numeric), 0) as sum_net
      from payroll_runs r
      left join payroll_lines l on l.payroll_run_id = r.id
     group by r.id
     order by r.period_year desc, r.period_month desc
     limit 6`)
).rows;
await c.end();

const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.02;

console.log(
  "run".padEnd(18) +
    "status".padEnd(12) +
    "lines".padStart(6) +
    "  gross".padStart(10) +
    "   tds".padStart(10) +
    "   net".padStart(10),
);

let wrong = 0;
for (const r of runs) {
  const g = near(r.stored_gross, r.sum_gross);
  const t = near(r.stored_tds, r.sum_tds);
  const n = near(r.stored_net, r.sum_net);
  console.log(
    r.label.padEnd(18) +
      r.status.padEnd(12) +
      String(r.lines).padStart(6) +
      (g ? "        ok" : "     WRONG") +
      (t ? "        ok" : "     WRONG") +
      (n ? "        ok" : "     WRONG"),
  );
  if (!g)
    console.log(
      `      gross: stored ${Number(r.stored_gross).toFixed(2)}, lines add to ${Number(r.sum_gross).toFixed(2)}`,
    );
  if (!t)
    console.log(
      `      tds:   stored ${Number(r.stored_tds).toFixed(2)}, lines add to ${Number(r.sum_tds).toFixed(2)}`,
    );
  if (!n)
    console.log(
      `      net:   stored ${Number(r.stored_net).toFixed(2)}, lines add to ${Number(r.sum_net).toFixed(2)}`,
    );
  if (!g || !t || !n) wrong += 1;
}

console.log(
  "\n" +
    (wrong === 0
      ? `every one of ${runs.length} runs stores totals that equal its own lines`
      : `${wrong} run(s) store a total that does not equal their lines`),
);
