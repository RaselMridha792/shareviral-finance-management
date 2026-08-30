import fs from "node:fs"; import jwt from "jsonwebtoken"; import pg from "pg";
const env = Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/)
  .filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");
  return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();
const p=(await db.query(`select id,role,token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1`)).rows[0];
const t=jwt.sign({sub:p.id,role:p.role,tv:p.token_version},env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const get=async(u)=>{const r=await fetch("http://localhost:4001/api"+u,{headers:{Authorization:"Bearer "+t}});return {s:r.status,b:await r.json().catch(()=>null)};};
for (const u of ["/reports/period?granularity=month&fiscalYear=2026&index=2","/reports/overview"]) {
  const {s,b}=await get(u);
  console.log("\n==",u,s);
  console.log("   top-level keys:", Object.keys(b??{}).join(", "));
  for (const k of ["period","range","moneyIn","moneyOut","net","entries","totals"])
    if (b && k in b) console.log(`   ${k}:`, typeof b[k]==="object"?JSON.stringify(b[k]).slice(0,140):b[k]);
  for (const k of ["spendByCategory","incomeByCategory"])
    if (b && b[k]) console.log(`   ${k}: ${b[k].length} line(s) ->`, b[k].map(l=>`${l.name}=${l.total}`).join(" | ").slice(0,180));
}
await db.end();
