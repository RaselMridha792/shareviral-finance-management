import fs from "node:fs"; import path from "node:path"; import jwt from "jsonwebtoken"; import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();
const {rows:u}=await db.query(`select id, role, token_version from users where status='active' and deleted_at is null order by created_at limit 1`);
console.log("user:", u[0]?.role);
const token=jwt.sign({sub:u[0].id, role:u[0].role, tv:u[0].token_version}, env.JWT_ACCESS_SECRET, {expiresIn:"2h"});
const API="http://localhost:4001/api";
const call=async(p)=>{const r=await fetch(`${API}${p}`,{headers:{cookie:`sfm_access=${token}`,"X-Requested-With":"finance-web"}});const t=await r.text();let b;try{b=JSON.parse(t)}catch{b=t.slice(0,200)}return{status:r.status,body:b}};
for (const qs of [
  "",
  "?granularity=month&fiscalYear=2026&index=1",
  "?granularity=month&fiscalYear=2026&index=2",
  "?granularity=quarter&fiscalYear=2026&index=1",
  "?granularity=quarter&fiscalYear=2026&index=2",
  "?granularity=half&fiscalYear=2026&index=1",
  "?granularity=year&fiscalYear=2026&index=1",
  "?granularity=year&fiscalYear=2025&index=1",
]) {
  const r = await call(`/tds/salary-deductions${qs}`);
  const p = r.body?.period;
  console.log(qs.padEnd(44), r.status, p ? `${p.granularity} idx=${p.index} fy=${p.fiscalYear} ${p.start}..${p.end} "${p.label}" rows=${r.body.rows.length} total=${r.body.periodTotal} lines=${r.body.linesInPeriod}` : JSON.stringify(r.body));
}
await db.end();
