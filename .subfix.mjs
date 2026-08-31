import fs from "node:fs"; import jwt from "jsonwebtoken"; import pg from "pg";
const env=Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/)
 .filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");
 return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();
const p=(await db.query(`select id,role,token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1`)).rows[0];
const t=jwt.sign({sub:p.id,role:p.role,tv:p.token_version},env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const call=async(m,path,body)=>{const r=await fetch("http://localhost:4001/api"+path,{method:m,
  headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},
  body:body===undefined?undefined:JSON.stringify(body)});
  return {s:r.status, b:await r.json().catch(()=>null)};};
await db.query("delete from vendors where name like 'SUBFIX%'");
const made = await call("POST","/vendors",{
  name:"SUBFIX Claude", type:"ai_tool", billingCycle:"monthly",
  billingAmount:"2450.00", billingCurrency:"BDT"
});
console.log("create:", made.s, JSON.stringify(made.b?.errors ?? made.b?.message ?? "").slice(0,200));
if (made.b?.id) {
  for (const [label, body] of [
    ["rename only", {name:"SUBFIX Claude 2"}],
    ["notes only", {notes:"just test"}],
    ["reference only", {reference:"REF-1"}],
    ["invoiceNo only", {invoiceNo:"Inv"}],
    ["nextRenewalOn", {nextRenewalOn:"2026-07-13"}],
    ["billingAmount", {billingAmount:"2500.00"}],
  ]) {
    const r = await call("PATCH","/vendors/"+made.b.id, body);
    console.log(String(r.s).padEnd(4), label.padEnd(18), JSON.stringify(r.b?.errors ?? r.b?.message ?? "").slice(0,170));
  }
}
await db.query("delete from vendors where name like 'SUBFIX%'");
await db.end();
