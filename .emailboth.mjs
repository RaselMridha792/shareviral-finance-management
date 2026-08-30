import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const u=(await c.query("select id, email, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1")).rows[0];
console.log("signed in as:", u.email);
const token=jwt.sign({sub:u.id,role:u.role,tv:u.token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"10m"});
const h={cookie:`sfm_access=${token}`,"content-type":"application/json","x-requested-with":"finance-web"};
const post=(p,b)=>fetch("http://localhost:4001/api"+p,{method:"POST",headers:h,body:b?JSON.stringify(b):undefined});
const get=(p)=>fetch("http://localhost:4001/api"+p,{headers:h});

await post("/email/key",{apiKey:"re_local_only_not_a_real_key"});
await post("/email/settings",{from:"finance@hellonizam.com", adminAddress:"info@exprovia.com", enabled:true});
console.log("status:", JSON.stringify(await (await get("/email/status")).json(), (k,v)=>k==="recent"?undefined:v));
const t = await post("/email/test");
console.log("test:", t.status, await t.text());
console.log("--- now with staff off ---");
await post("/email/settings",{toStaff:false});
const s2 = await (await get("/email/status")).json();
console.log("toStaff:", s2.toStaff);
// clean up
await c.query("update app_settings set resend_api_key=null, resend_key_set_at=null, resend_key_set_by=null, email_enabled=false, email_to_staff=true where id=1");
console.log("local settings cleared");
await c.end();
