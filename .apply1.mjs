import fs from "node:fs"; import path from "node:path"; import pg from "pg";
const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const file = process.argv[2];
const c = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const sql = fs.readFileSync(path.join(REPO, "deploy/sql", file), "utf8");
const r = await c.query(sql);
const last = Array.isArray(r) ? r[r.length - 1] : r;
console.table(last.rows ?? []);
await c.end();
