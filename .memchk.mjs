import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const u=(await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1")).rows[0];
const m=(await c.query("select distinct team_member_id from subscription_users limit 1")).rows[0];
await c.end();
const token=jwt.sign({sub:u.id,role:u.role,tv:u.token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"10m"});
const r=await fetch(`http://localhost:4001/api/subscriptions/for-member/${m.team_member_id}`,{headers:{cookie:`sfm_access=${token}`}});
const rows=await r.json();
console.log("status",r.status,"rows",rows.length);
if(rows.length){const k=Object.keys(rows[0]);console.log("fields:",k.length);console.log(k.join(", "));
console.log("\nsample:", JSON.stringify({toolName:rows[0].toolName,costBdt:rows[0].costBdt,usdRate:rows[0].usdRate,invoiceNo:rows[0].invoiceNo,status:rows[0].status,seatStatus:rows[0].seatStatus,users:rows[0].users?.length}));}
