import fs from "node:fs"; import path from "node:path"; import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const {rows}=await c.query(`select r.period_year, r.period_month, r.status, count(*) filter (where l.tds_amount>0)::int as taxed
  from payroll_runs r join payroll_lines l on l.payroll_run_id=r.id
 where r.status <> 'draft' group by 1,2,3 order by 1 desc,2 desc limit 12`);
console.table(rows);
await c.end();
