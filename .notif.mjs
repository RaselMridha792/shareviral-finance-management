import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const u=(await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1")).rows[0];
const token=jwt.sign({sub:u.id,role:u.role,tv:u.token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"10m"});
const h={cookie:`sfm_access=${token}`,"content-type":"application/json","x-requested-with":"finance-web"};
const post=(p,b)=>fetch("http://localhost:4001/api"+p,{method:"POST",headers:h,body:b?JSON.stringify(b):undefined});
const get=(p)=>fetch("http://localhost:4001/api"+p,{headers:h});

console.log("switches:", await (await get("/notifications/settings")).text());
// turn the fourth one on so all four are exercised
await post("/notifications/settings",{significantChanges:true});
const run = await post("/notifications/run");
console.log("run:", run.status, await run.text());
const list = await (await get("/notifications")).json();
console.log("unread:", list.unread, "| rows:", list.items.length);
for (const r of list.items.slice(0,8)) console.log(`   [${r.kind}] ${r.title}  ->  ${r.href}\n      ${r.body ?? ""}`);
// idempotence: run again, nothing new
const again = await post("/notifications/run");
console.log("second run:", await again.text());
if (list.items.length) {
  const mark = await post(`/notifications/${list.items[0].id}/read`);
  console.log("mark one read:", await mark.text());
  console.log("unread now:", (await (await get("/notifications")).json()).unread);
}
await c.end();
