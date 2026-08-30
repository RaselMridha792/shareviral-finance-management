import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const {rows}=await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1");
await c.end();
const token=jwt.sign({sub:rows[0].id,role:rows[0].role,tv:rows[0].token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"10m"});
const res = await fetch("http://localhost:4001/api/email/key", {
  method:"POST",
  headers:{ cookie:`sfm_access=${token}`, "content-type":"application/json", "x-requested-with":"finance-web" },
  body: JSON.stringify({ apiKey: "re_test_not_a_real_key_0123456789" }),
});
console.log("status:", res.status);
console.log(await res.text());
