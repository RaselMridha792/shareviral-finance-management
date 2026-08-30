import fs from "node:fs"; import path from "node:path"; import jwt from "jsonwebtoken"; import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();
const {rows:u}=await db.query(`select id, role, token_version from users where status='active' and deleted_at is null order by created_at limit 1`);
const token=jwt.sign({sub:u[0].id, role:u[0].role, tv:u[0].token_version}, env.JWT_ACCESS_SECRET, {expiresIn:"2h"});
await db.end();
const call=async(p)=>{const r=await fetch(`http://localhost:4001/api${p}`,{headers:{cookie:`sfm_access=${token}`,"X-Requested-With":"finance-web"}});return {status:r.status, body:await r.json()}};
for (const i of [1,5,6,7,8,12]) {
  const r=await call(`/tds/salary-deductions?granularity=month&fiscalYear=2026&index=${i}`);
  const p=r.body.period;
  console.log(`index=${String(i).padEnd(2)} -> ${p.label.padEnd(15)} start=${p.start} echoed period.fiscalYear=${p.fiscalYear}  (asked fiscalYear=2026)`);
}
for (const g of ["quarter","half","year"]) {
  const r=await call(`/tds/salary-deductions?granularity=${g}&fiscalYear=2026&index=${g==="quarter"?3:g==="half"?2:1}`);
  const p=r.body.period;
  console.log(`${g.padEnd(8)} -> ${p.label.padEnd(15)} start=${p.start} echoed period.fiscalYear=${p.fiscalYear}`);
}
