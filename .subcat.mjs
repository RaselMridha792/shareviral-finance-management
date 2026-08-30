import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";
const env = Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await db.connect();
const {rows}=await db.query(`select id,role,token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);await db.end();
const token=jwt.sign({sub:rows[0].id,role:rows[0].role,tv:rows[0].token_version},env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe", edge="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:edge,headless:"new",args:["--no-sandbox"]});
await browser.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await browser.newPage();
for (const s of ["technology","domains","hosting-servers"]) {
  const res=await page.goto(`http://localhost:3000/expenses/${s}`,{waitUntil:"networkidle0",timeout:90000});
  await new Promise(r=>setTimeout(r,400));
  const h1=await page.evaluate(()=>document.querySelector("h1,h2")?.textContent?.trim()||"(none)");
  const body=await page.evaluate(()=>(document.body.textContent||"").slice(0,120).replace(/\s+/g," "));
  console.log(`/expenses/${s.padEnd(22)} status=${res.status()}  h1="${h1}"  body="${body}"`);
}
await browser.close();
