/**
 * One row of each kind, so the sweep has something to press a button on.
 *
 * An empty screen has no delete button, which the sweep reports as a missing
 * one — the false alarm this codebase produces more often than a real fault.
 * Local Neon only.
 */
import fs from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  fs.readFileSync("apps/api/.env", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; }));

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const admin = (await db.query("select id from users where role='super_admin' and deleted_at is null limit 1")).rows[0];

const made = [];

const rate = await db.query(
  `insert into fx_rates (base_currency, quote_currency, rate, rate_date, source, created_by, updated_by)
   values ('USD','BDT','118.750000','2026-08-01','manual',$1,$1)
   on conflict do nothing returning id`, [admin.id]);
if (rate.rows[0]) made.push("fx rate");

const member = await db.query(
  `insert into team_members (full_name, engagement_type, designation, status, joined_on, created_by, updated_by)
   values ('QA Sweep Person','employee','Tester','active','2026-01-01',$1,$1) returning id`, [admin.id]);
made.push("team member");

const vendor = await db.query(
  `insert into vendors (name, type, created_by, updated_by)
   values ('QA Sweep Vendor','ai_tool',$1,$1) returning id`, [admin.id]);

await db.query(
  `insert into subscriptions (vendor_id, tool_name, plan_name, category, status, cost_usd, cost_bdt, usd_rate,
                              billing_cycle, start_date, next_renewal_on, created_by, updated_by)
   values ($1,'QA Sweep Tool','Team','ai_tool','active','20.00','2375.00','118.750000','monthly','2026-01-01','2026-09-01',$2,$2)`,
  [vendor.rows[0].id, admin.id]);
made.push("subscription");

await db.query(
  `insert into payroll_runs (period_year, period_month, label, status, total_gross, total_additions,
                             total_tds, total_deductions, total_net, created_by, updated_by)
   values (2026, 8, 'August 2026', 'draft', '0.00','0.00','0.00','0.00','0.00',$1,$1)`, [admin.id]);
made.push("payroll run (draft)");

console.log("  seeded: " + made.join(", "));
await db.end();
