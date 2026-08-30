import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";import puppeteer from "puppeteer-core";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const u=(await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1")).rows[0];
await c.end();
const token=jwt.sign({sub:u.id,role:u.role,tv:u.token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:"new",args:["--no-sandbox"]});
await browser.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await browser.newPage();
await page.setViewport({width:1600,height:1100});
await page.goto("http://localhost:3000"+process.argv[2],{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
// Wait for the fonts. A measurement taken while a face is still swapping is
// a measurement of the fallback, and the two differ by tens of pixels.
await page.evaluate(() => document.fonts.ready);
await new Promise(r=>setTimeout(r,2500));
const out = await page.evaluate(() => {
  // Where the ink actually sits, measured with a Range so we get the text box
  // rather than the element box.
  const inkRight = (el) => {
    const r=document.createRange(); r.selectNodeContents(el);
    const b=r.getBoundingClientRect(); return b.width ? b.right : null;
  };
  const t=document.querySelector(".table-data");
  const ths=[...t.querySelectorAll("thead th")];
  const row=t.querySelector("tbody tr");
  return ths.map((th,i)=>{
    const cell=row.children[i];
    if(!cell || !th.textContent.trim()) return null;
    const cb=cell.getBoundingClientRect();
    const hi=inkRight(th), ci=inkRight(cell);
    return { col:i+1, head:th.textContent.trim(),
      headGap: hi===null?null:Math.round(cb.right - hi),
      cellGap: ci===null?null:Math.round(cb.right - ci) };
  }).filter(Boolean);
});
console.log("column".padEnd(14)+"heading right-gap".padStart(18)+"cell right-gap".padStart(16)+"   verdict");
for (const r of out) {
  const same = r.headGap!==null && r.cellGap!==null && Math.abs(r.headGap - r.cellGap) < 14;
  console.log(r.head.padEnd(14)+String(r.headGap).padStart(18)+String(r.cellGap).padStart(16)+"   "+(same?"lined up":"OUT OF LINE by "+Math.abs(r.headGap-r.cellGap)+"px"));
}
await browser.close();
