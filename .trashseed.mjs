/**
 * Four entries and a heading, so the trash can be tested against real sums.
 *
 * Local only — this reaches the Neon database in apps/api/.env, which is not
 * the one the live site uses.
 */
import fs from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  fs.readFileSync("apps/api/.env", "utf8").split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")]; }));

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const [admin] = (await db.query(
  "select id from users where role='super_admin' and deleted_at is null order by created_at limit 1")).rows;
const [account] = (await db.query(
  "select id, name from accounts where deleted_at is null order by created_at limit 1")).rows;
if (!admin || !account) { console.log("need a super admin and an account"); process.exit(1); }

const [cat] = (await db.query(
  `insert into categories (name, slug, kind, color, created_by, updated_by)
   values ('Office rent','office-rent-test','out','#8b5cf6',$1,$1)
   on conflict do nothing returning id`, [admin.id])).rows
  ?? [];
const catId = cat?.id ?? (await db.query("select id from categories limit 1")).rows[0].id;

const rows = [
  ["in",  "120000.00", "Funding from CEO",  "2026-08-01"],
  ["out", "85000.00",  "Office rent August","2026-08-03"],
  ["out", "20400.00",  "Electricity",       "2026-08-05"],
  ["out", "6200.00",   "Internet",          "2026-08-06"],
];
const ids = [];
for (const [dir, amt, desc, date] of rows) {
  const r = await db.query(
    `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency,
                               category_id, description, created_by, updated_by)
     values ($1,$2,$3,$4,$5,'BDT',$6,$7,$8,$8) returning id`,
    [`TXN-TEST-${ids.length + 1}`, account.id, dir, date, amt, catId, desc, admin.id]);
  ids.push(r.rows[0].id);
}

console.log(`account   ${account.name} (${account.id})`);
console.log(`category  ${catId}`);
console.log(`seeded    ${ids.length} entries`);
const [sum] = (await db.query(
  "select sum(signed_amount)::text as net from transactions where voided_at is null and deleted_at is null")).rows;
console.log(`net now   ${sum.net}`);
await db.end();
