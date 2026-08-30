import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";import puppeteer from "puppeteer-core";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const u=(await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1")).rows[0];
const run=(await c.query("select id from payroll_runs order by period_year desc, period_month desc limit 1")).rows[0];
await c.end();
const token=jwt.sign({sub:u.id,role:u.role,tv:u.token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:"new",args:["--no-sandbox"]});
await browser.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await browser.newPage();
await page.setViewport({width:1600,height:1100});
await page.goto("http://localhost:3000/payroll/"+run.id,{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
await new Promise(r=>setTimeout(r,2500));
const out = await page.evaluate(() => {
  const ink = (el) => { const r=document.createRange(); r.selectNodeContents(el); const b=r.getBoundingClientRect(); return b.width?b.right:null; };
  const t=document.querySelector(".table-data");
  const ths=[...t.querySelectorAll("thead th")];
  const row=[...t.querySelectorAll("tbody tr")].find(r=>!r.querySelector("td[colspan]"));
  return ths.map((th,i)=>{
    const cell=row.children[i];
    if(!cell||!th.textContent.trim()) return null;
    const cs=getComputedStyle(cell), hs=getComputedStyle(th);
    const inner=cell.firstElementChild;
    return { head:th.textContent.trim(),
      cellRight:Math.round(cell.getBoundingClientRect().right),
      headInk:Math.round(ink(th)), cellInk:Math.round(ink(cell)),
      thPad:hs.paddingRight, tdPad:cs.paddingRight,
      inner: inner ? inner.tagName.toLowerCase()+"."+String(inner.className).slice(0,28) : "(text)",
      innerRight: inner ? Math.round(inner.getBoundingClientRect().right) : null };
  }).filter(Boolean);
});
console.log("head".padEnd(10)+"cellRight".padStart(10)+"headInk".padStart(9)+"cellInk".padStart(9)+"  thPad tdPad  inner");
for (const r of out) console.log(r.head.padEnd(10)+String(r.cellRight).padStart(10)+String(r.headInk).padStart(9)+String(r.cellInk).padStart(9)+"  "+r.thPad.padEnd(6)+r.tdPad.padEnd(6)+" "+r.inner+(r.innerRight?" right="+r.innerRight:""));
await browser.close();
