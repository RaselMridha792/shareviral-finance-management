import fs from "node:fs";
import pg from "pg";
const env = Object.fromEntries(
  fs.readFileSync("apps/api/.env", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; }));
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const cols = (await db.query(
  `select table_name, count(*) filter (where column_name in ('deleted_at','deleted_by','delete_reason')) n
     from information_schema.columns where table_schema='public'
    group by table_name having count(*) filter (where column_name in ('deleted_at','deleted_by','delete_reason')) > 0
    order by table_name`)).rows;
console.log("\ntables that can now hold a deletion:");
for (const r of cols) console.log(`  ${r.table_name.padEnd(24)} ${r.n}/3 columns`);
const idx = (await db.query(
  `select count(*) n from pg_indexes where schemaname='public' and indexname like '%_deleted_idx'`)).rows[0];
console.log(`\n  ${idx.n} partial indexes for the trash listing`);
const gen = (await db.query(
  `select column_name, is_generated from information_schema.columns
    where table_name='transactions' and column_name in ('signed_amount','voided_at','deleted_at')`)).rows;
console.log("\ntransactions, the one that matters:");
for (const r of gen) console.log(`  ${r.column_name.padEnd(16)} generated=${r.is_generated}`);
await db.end();
