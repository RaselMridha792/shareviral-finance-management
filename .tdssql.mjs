// Read-only: build the exact query the service builds and print its SQL.
import { and, eq, gt, sql, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "./apps/api/dist/db/schema/index.js";
const { payrollLines, payrollRuns, teamMembers } = pkg.default ?? pkg;
const db = drizzle.mock ? null : null;
import pg from "pg";
const client = new pg.Client({ connectionString: "postgres://x@localhost/x" });
const d = drizzle(client, { schema: pkg.default ?? pkg });
const FINALISED_OR_LATER = sql`${payrollRuns.status} <> 'draft' and ${payrollRuns.deletedAt} is null`;
for (const [label, fromM, toM] of [["Aug 2026 (month)", 2026*12+8, 2026*12+8], ["Q1 (quarter)", 2026*12+7, 2026*12+9]]) {
  const inPeriod = sql`(${payrollRuns.periodYear} * 12 + ${payrollRuns.periodMonth}) between ${fromM} and ${toM}`;
  const q = d.select({ id: payrollLines.id })
    .from(payrollLines)
    .innerJoin(payrollRuns, eq(payrollLines.payrollRunId, payrollRuns.id))
    .innerJoin(teamMembers, eq(payrollLines.teamMemberId, teamMembers.id))
    .where(and(inPeriod, FINALISED_OR_LATER, gt(payrollLines.tdsAmount, "0")))
    .orderBy(asc(payrollRuns.periodYear), asc(payrollRuns.periodMonth), asc(teamMembers.fullName));
  const s = q.toSQL();
  console.log("##", label);
  console.log(s.sql);
  console.log("params:", JSON.stringify(s.params));
}
