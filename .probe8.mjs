import fs from "node:fs"; import jwt from "jsonwebtoken"; import pg from "pg"; import puppeteer from "puppeteer-core";
const env=Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/)
 .filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");
 return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();
const p=(await db.query(`select id,role,token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1`)).rows[0];
const t=jwt.sign({sub:p.id,role:p.role,tv:p.token_version},env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";
const b=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:"new",args:["--no-sandbox"]});
await b.setCookie({name:"sfm_access",value:t,domain:"localhost",path:"/"});
const pg2=await b.newPage(); await pg2.setViewport({width:1700,height:1200});
pg2.on("console",m=>{if(m.type()==="error")console.log("  console:",m.text().slice(0,140));});
await pg2.goto("http://localhost:3000/subscriptions?status=all",{waitUntil:"networkidle0",timeout:120000});
await new Promise(r=>setTimeout(r,3000));
console.log(await pg2.evaluate(()=>{
  const heads=[...document.querySelectorAll("thead th")].map(h=>(h.textContent??"").trim());
  const rows=[...document.querySelectorAll("tbody tr")].map(r=>(r.textContent??"").replace(/\s+/g," ").slice(0,120));
  const btns=[...document.querySelectorAll("tbody button")].map(x=>(x.textContent??"").trim()).filter(Boolean);
  return JSON.stringify({heads, rowCount:rows.length, rows:rows.slice(0,3), btns:btns.slice(0,8)},null,1);
}));
await b.close(); await db.end();
