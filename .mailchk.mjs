import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const u=(await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1")).rows[0];
const token=jwt.sign({sub:u.id,role:u.role,tv:u.token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"10m"});
const h={cookie:`sfm_access=${token}`,"content-type":"application/json","x-requested-with":"finance-web"};
const post=(p,b)=>fetch("http://localhost:4001/api"+p,{method:"POST",headers:h,body:b?JSON.stringify(b):undefined});

// a fake key, so the job gets past config() and we can see WHICH plans it picks
await post("/email/key",{apiKey:"re_local_only_not_real"});
await post("/email/settings",{from:"finance@hellonizam.com", adminAddress:"info@exprovia.com", enabled:true, toStaff:false});
const r = await post("/email/run-reminders");
console.log("email job:", await r.text());
const rows = (await c.query("select subject_date, recipient, outcome, left(coalesce(error,''),40) err from notification_log where kind='subscription_renewal' order by subject_date")).rows;
console.log(`attempted ${rows.length} message(s) — the dates it chose:`);
for (const x of rows) console.log("   ", x.subject_date.toISOString().slice(0,10), x.recipient, "|", x.outcome, x.err);
// put local settings back
await c.query("update app_settings set resend_api_key=null, resend_key_set_at=null, resend_key_set_by=null, email_enabled=false, email_from=null, email_admin_address=null, email_to_staff=true where id=1");
await c.query("delete from notification_log where kind='subscription_renewal'");
console.log("local settings restored");
await c.end();
