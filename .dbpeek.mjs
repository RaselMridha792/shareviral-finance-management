/**
 * A read-only look at the local database: one query, printed as a table.
 *
 *     node .dbpeek.mjs "select id, name from accounts"
 *
 * Read-only by construction: the query runs inside a transaction that is
 * set READ ONLY and rolled back. For looking before a harness is written.
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
try {
  await db.query("begin transaction read only");
  for (const sql of process.argv.slice(2)) {
    const result = await db.query(sql);
    console.table(result.rows);
  }
} finally {
  await db.query("rollback").catch(() => undefined);
  await db.end();
}
