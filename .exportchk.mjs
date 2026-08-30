import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const u=(await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1")).rows[0];
const acc=(await c.query("select id, name from accounts order by name limit 1")).rows[0];
await c.end();
const token=jwt.sign({sub:u.id,role:u.role,tv:u.token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"10m"});
const Y=new Date().getFullYear();
const targets=[
 ["All transactions",      `transactions?from=2026-01-01&to=2026-12-31`],
 ["One account's register",`register/${acc.id}?from=2026-01-01&to=2026-12-31`],
 ["Accounts",              `accounts`],
 ["AI tools",              `subscriptions`],
 ["Team",                  `team-members`],
 ["TDS liability",         `tds/liability?year=${Y}`],
 ["TDS challans",          `tds/deposits?year=${Y}`],
 ["Withholding returns",   `tds/returns?fiscalYear=${Y}`],
 ["Income tax",            `income-tax`],
];
for (const [name, q] of targets) {
  const r = await fetch(`http://localhost:4001/api/exports/${q}`, {headers:{cookie:`sfm_access=${token}`}});
  const cd = r.headers.get("content-disposition") || "";
  const len = r.headers.get("content-length") || "?";
  const name2 = (cd.match(/filename="?([^";]+)/) || [,"-"])[1];
  let note = "";
  if (!r.ok) note = " <- " + (await r.text()).slice(0,90);
  console.log(`${String(r.status).padEnd(4)} ${name.padEnd(24)} ${String(len).padStart(7)}b  ${name2}${note}`);
}
