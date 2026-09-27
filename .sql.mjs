import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// The folder this script sits in — the repository root — wherever it is
// checked out. It named one machine's path, and failed on every other.
const REPO = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "");
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const dir = path.join(REPO, "deploy/sql");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  try {
    await client.query(sql);
    console.log("ok   ", file);
  } catch (error) {
    console.log("SKIP ", file, "—", String(error.message).slice(0, 90));
  }
}
await client.end();
