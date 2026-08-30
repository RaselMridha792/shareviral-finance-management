/**
 * Nothing moves. Measured, not argued.
 *
 * The owner's one condition for this deploy: "Amar jate Kono kichu change na
 * hoy datay karon real data insert korechi Ami." Reading the migrations and
 * concluding they are additive is an argument. This is the measurement.
 *
 * It photographs the whole database — every table's row count, and every money
 * column's total — then REPLAYS both migrations that are about to ship, then
 * photographs it again and compares the two.
 *
 * Replaying is the point. The deploy applies a file once and records it, but
 * `deploy/sql` is written to survive being run again, and "additive" is only a
 * claim until a second run proves it changes nothing. If either file rewrote a
 * row, the second run would move a figure here.
 *
 *     node .dataintact.mjs      (local database; read-only in effect)
 */
import fs from "node:fs";
import pg from "pg";

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

/* Every table, and every numeric column in it — found, not listed, so a table
 * added later is photographed too rather than silently skipped. */
const tables = (
  await db.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  )
).rows.map((r) => r.table_name);

const moneyCols = async (t) =>
  (
    await db.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name=$1
          and data_type = 'numeric' order by column_name`,
      [t],
    )
  ).rows.map((r) => r.column_name);

const photograph = async () => {
  const shot = {};
  for (const t of tables) {
    const cols = await moneyCols(t);
    const sums = cols
      .map((c) => `coalesce(sum("${c}"), 0)::text as "sum_${c}"`)
      .join(", ");
    const row = (
      await db.query(
        `select count(*)::text as n${sums ? ", " + sums : ""} from "${t}"`,
      )
    ).rows[0];
    shot[t] = row;
  }
  return shot;
};

const before = await photograph();
const rows = Object.values(before).reduce((a, r) => a + Number(r.n), 0);
console.log(`  photographed ${tables.length} tables, ${rows} rows\n`);

/* Replay both files that are about to ship. */
const FILES = [
  "deploy/sql/2026-08-30-resignation-letter.sql",
  "deploy/sql/2026-08-30-account-opening-own-currency.sql",
];
for (const f of FILES) {
  const sql = fs.readFileSync(f, "utf8");
  try {
    await db.query(sql);
    console.log(`  replayed  ${f}`);
  } catch (err) {
    console.log(`  FAILED    ${f} — ${err.message}`);
    process.exitCode = 1;
  }
}
console.log();

const after = await photograph();

/* Compare. Every count, every total, every table. */
const moved = [];
for (const t of tables) {
  const a = before[t];
  const b = after[t];
  for (const k of Object.keys(a)) {
    if (a[k] !== b[k]) moved.push(`${t}.${k}: ${a[k]} -> ${b[k]}`);
  }
}

/* And the figures the owner actually reads, named one by one. */
const named = async (label, sql) => (await db.query(sql)).rows[0]?.v ?? "-";
const facing = {
  "live transactions": "select count(*)::text v from transactions where voided_at is null",
  "total money in": "select coalesce(sum(amount),0)::text v from transactions where direction='in' and voided_at is null",
  "total money out": "select coalesce(sum(amount),0)::text v from transactions where direction='out' and voided_at is null",
  "accounts": "select count(*)::text v from accounts where deleted_at is null",
  "opening balances (taka)": "select coalesce(sum(opening_balance),0)::text v from accounts",
  "team members": "select count(*)::text v from team_members where deleted_at is null",
  "uploaded files": "select count(*)::text v from files where deleted_at is null",
};
console.log("  what the owner reads, after the replay:");
for (const [label, sql] of Object.entries(facing)) {
  console.log(`    ${label.padEnd(26)} ${await named(label, sql)}`);
}

await db.end();

console.log("\n" + "=".repeat(70));
if (moved.length === 0) {
  console.log(
    `nothing moved — ${tables.length} tables, ${rows} rows, every count and every money total identical`,
  );
} else {
  console.log(`${moved.length} figure(s) MOVED:\n` + moved.map((m) => "  " + m).join("\n"));
  process.exitCode = 1;
}
