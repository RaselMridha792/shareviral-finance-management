// The probe uploaded a synthetic squiggle as the *company* signature, to check
// the pre-existing settings path still worked after the shared changes.
// Nothing was on file before it, so take it back out — a payslip should not
// print a test scrawl.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l.slice(i + 1).trim().replace(/^["']|["']$/g, ""),
      ];
    }),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const gone = await c.query(
  `update files set deleted_at = now()
    where kind = 'signature' and deleted_at is null
    returning id, original_name`,
);
const left = await c.query(
  `select kind, count(*)::int as live from files
    where deleted_at is null group by kind order by kind`,
);
console.log("company signatures removed:", gone.rowCount);
console.table(left.rows);
await c.end();
