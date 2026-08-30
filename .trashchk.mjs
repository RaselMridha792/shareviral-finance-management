/**
 * Does the migration name tables that exist, and columns that do not?
 *
 * Every `alter table X add column if not exists Y` in the file is silent about
 * a mistake in either direction: a table name that is wrong is an error the
 * deploy finds, and a column that already exists is a no-op that hides a
 * misunderstanding. Ask the database both questions before pushing.
 */
import fs from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  fs.readFileSync("apps/api/.env", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; }));

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const sql = fs.readFileSync("deploy/sql/2026-08-26-trash.sql", "utf8");
const wanted = new Map();
for (const block of sql.split(/;\s*/)) {
  const m = block.match(/alter table (\w+)/i);
  if (!m) continue;
  const cols = [...block.matchAll(/add column if not exists (\w+)/gi)].map((c) => c[1]);
  wanted.set(m[1], cols);
}

const live = (await db.query(
  `select table_name, column_name from information_schema.columns where table_schema='public'`)).rows;
const have = new Map();
for (const r of live) {
  if (!have.has(r.table_name)) have.set(r.table_name, new Set());
  have.get(r.table_name).add(r.column_name);
}

console.log(`\nthe migration touches ${wanted.size} tables\n`);
let bad = 0;
for (const [t, cols] of wanted) {
  if (!have.has(t)) { console.log(`  MISSING TABLE  ${t}`); bad++; continue; }
  const already = cols.filter((c) => have.get(t).has(c));
  console.log(`  ${t.padEnd(22)} ${already.length ? "already has " + already.join(", ") : "gains " + cols.join(", ")}`);
}

// And the other direction: a table with rows a person can see, that the
// migration forgot.
const skipped = [...have.keys()].filter((t) => !wanted.has(t)).sort();
console.log(`\n  not touched (${skipped.length}): ${skipped.join(" ")}`);
console.log(bad ? `\n  ${bad} problem(s)` : "\n  every named table exists");
await db.end();
