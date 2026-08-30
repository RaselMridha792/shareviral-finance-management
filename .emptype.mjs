// Throwaway: does the employment_type column exist, and did the backfill land?
import fs from "node:fs";
import pg from "pg";
const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs.readFileSync(REPO + "/apps/api/.env", "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const c = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (label, sql) => console.log(label, JSON.stringify((await c.query(sql)).rows));
await q("enum values :", "select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='employment_type' order by e.enumsortorder");
await q("column     :", "select column_name, udt_name, is_nullable from information_schema.columns where table_name='team_members' and column_name='employment_type'");
await q("split      :", "select engagement_type, employment_type, count(*)::int from team_members group by 1,2 order by 1,2");
await c.end();
