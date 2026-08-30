// End to end, through the API the browser talks to: write a challan on one
// salary row, attach a file to it, and read the register back.
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
const call = async (path, init = {}) => {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body };
};

// --- the register as the screen asks for it -------------------------------
const reg = await call("/tds/salary-deductions?granularity=month&fiscalYear=2026&index=1");
console.log("register:", reg.status, reg.body?.period?.label, "rows:", reg.body?.rows?.length);
if (reg.status !== 200) { console.log(reg.body); process.exit(1); }
const first = reg.body.rows[0];
console.log("row 0:", first.fullName, "challanNumber:", first.challanNumber, "challanFileLineId:", first.challanFileLineId);

// --- write it on the whole month ------------------------------------------
const number = "A-TEST-2026071142";
const wrote = await call(`/tds/salary-deductions/${first.payrollLineId}/challan`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ challanNumber: number, applyToMonth: true }),
});
console.log("PATCH:", wrote.status, JSON.stringify(wrote.body));

// --- what the database actually holds -------------------------------------
const { rows: check } = await db.query(
  `select count(*)::int as taxed_rows,
          count(*) filter (where l.tds_challan_number = $1)::int as with_challan,
          count(*) filter (where l.tds_challan_number is null)::int as without
     from payroll_lines l
     join payroll_runs r on r.id = l.payroll_run_id
    where r.period_year = 2026 and r.period_month = 7 and l.tds_amount > 0`, [number]);
console.log("db, July 2026 taxed rows:", check[0]);
const { rows: zeroes } = await db.query(
  `select count(*)::int as zero_rows_touched from payroll_lines l
     join payroll_runs r on r.id = l.payroll_run_id
    where r.period_year = 2026 and r.period_month = 7 and l.tds_amount = 0
      and l.tds_challan_number is not null`);
console.log("zero-tax rows that got a number (must be 0):", zeroes[0].zero_rows_touched);

// --- attach the scan, which is what the old constraint made impossible ----
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "challan-july.png");
form.append("kind", "challan");
const up = await call(`/files/payroll-line/${first.payrollLineId}`, { method: "POST", body: form });
console.log("upload:", up.status, up.body?.originalName ?? up.body);

// --- the register again: everybody that month points at that one file -----
const after = await call("/tds/salary-deductions?granularity=month&fiscalYear=2026&index=1");
const rows = after.body.rows ?? [];
const numbered = rows.filter((r) => r.challanNumber === number).length;
const linked = rows.filter((r) => r.challanFileLineId === first.payrollLineId).length;
console.log(`register after: ${rows.length} rows, ${numbered} carry the number, ${linked} point at the row holding the file`);

// --- the file reads back through the owner permission ---------------------
if (up.status === 201 || up.status === 200) {
  const list = await call(`/files/payroll-line/${first.payrollLineId}`);
  console.log("list on the line:", list.status, (list.body ?? []).map((f) => `${f.kind}:${f.originalName}`));
  const bytes = await fetch(`${API}/files/${up.body.id}/content?inline=1`, { headers });
  console.log("content:", bytes.status, bytes.headers.get("content-type"), (await bytes.arrayBuffer()).byteLength, "bytes");
}

// --- a quarter, so the file resolves across months too --------------------
const quarter = await call("/tds/salary-deductions?granularity=quarter&fiscalYear=2026&index=1");
const qrows = quarter.body.rows ?? [];
console.log("quarter:", quarter.body?.period?.label, qrows.length, "rows,",
  qrows.filter((r) => r.challanNumber).length, "with a challan");

await db.end();
