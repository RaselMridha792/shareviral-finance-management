// Throwaway: does the API actually send employmentType, and for whom?
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs.readFileSync(REPO + "/apps/api/.env", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows } = await db.query(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);
await db.end();
const token = jwt.sign({ sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });

const res = await fetch("http://localhost:4001/api/team-members?page=1&pageSize=100", { headers: { cookie: `sfm_access=${token}` } });
const body = await res.json();
const items = body.items ?? [];
console.log("status      :", res.status, "items:", items.length, "total:", body.total);
console.log("field present:", items.length ? "employmentType" in items[0] : "n/a");
const tally = {};
for (const m of items) {
  const k = `${m.engagementType} / ${m.employmentType ?? "null"}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
console.log("tally       :", JSON.stringify(tally));
console.log("sample      :", JSON.stringify(items.slice(0, 3).map((m) => ({ n: m.fullName, e: m.engagementType, t: m.employmentType }))));
