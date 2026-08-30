// The edges: one row only, clearing, and coming back.
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO, "apps/api/.env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const { rows: users } = await db.query(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);
const token = jwt.sign({ sub: users[0].id, role: users[0].role, tv: users[0].token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });

const API = "http://localhost:4001/api";
const headers = { cookie: `sfm_access=${token}`, "X-Requested-With": "finance-web" };
const call = async (p, init = {}) => {
  const res = await fetch(`${API}${p}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const t = await res.text();
  let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 300); }
  return { status: res.status, body: b };
};
const patch = (id, body) => call(`/tds/salary-deductions/${id}/challan`, {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const july = () => call("/tds/salary-deductions?granularity=month&fiscalYear=2026&index=1");

const start = await july();
const rows = start.body.rows;
const [a, b] = rows;

// 1. one row only
const one = await patch(b.payrollLineId, { challanNumber: "A-ONLY-ONE", applyToMonth: false });
console.log("single row:", one.status, JSON.stringify(one.body));
let now = (await july()).body.rows;
console.log("  carrying A-ONLY-ONE:", now.filter((r) => r.challanNumber === "A-ONLY-ONE").length,
  "| still on the month's number:", now.filter((r) => r.challanNumber === "A-TEST-2026071142").length,
  "| that row's file link:", now.find((r) => r.payrollLineId === b.payrollLineId).challanFileLineId);

// 2. clear the whole month
const cleared = await patch(a.payrollLineId, { challanNumber: "", applyToMonth: true });
console.log("clear month:", cleared.status, JSON.stringify(cleared.body));
now = (await july()).body.rows;
console.log("  rows still carrying anything:", now.filter((r) => r.challanNumber).length,
  "| file rows still stored:", (await db.query(`select count(*)::int as n from files where payroll_line_id is not null and deleted_at is null`)).rows[0].n);

// 3. write it back — the scan returns with it
const back = await patch(a.payrollLineId, { challanNumber: "A-2026071142", applyToMonth: true });
console.log("write back:", back.status, JSON.stringify(back.body));
now = (await july()).body.rows;
console.log("  rows carrying it:", now.filter((r) => r.challanNumber === "A-2026071142").length,
  "| rows whose scan resolves:", now.filter((r) => r.challanFileLineId).length);

// 4. a draft run is refused
const { rows: draft } = await db.query(
  `select l.id, r.status from payroll_lines l join payroll_runs r on r.id = l.payroll_run_id
    where r.status = 'draft' and l.tds_amount > 0 limit 1`);
if (draft[0]) {
  const no = await patch(draft[0].id, { challanNumber: "A-DRAFT", applyToMonth: false });
  console.log("draft run:", no.status, no.body?.message);
} else {
  console.log("draft run: no draft line in this database to try");
}

// 5. a made-up id
const missing = await patch("00000000-0000-4000-8000-000000000000", { challanNumber: "X", applyToMonth: false });
console.log("unknown row:", missing.status, missing.body?.message);

// 6. too long, and the strict body
const long = await patch(a.payrollLineId, { challanNumber: "A".repeat(61), applyToMonth: false });
console.log("61 characters:", long.status, JSON.stringify(long.body?.fieldErrors ?? long.body?.message));

await db.end();
