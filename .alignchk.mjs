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
await page.setViewport({width:1600,height:1000});
for (const route of process.argv.slice(2)) {
  await page.goto("http://localhost:3000"+route,{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
  await new Promise(r=>setTimeout(r,2000));
  const out = await page.evaluate(() => {
    const res=[];
    document.querySelectorAll(".table-data").forEach((t,ti)=>{
      const ths=[...t.querySelectorAll("thead th")];
      ths.forEach((th,i)=>{
        const cell=t.querySelector(`tbody tr td:nth-child(${i+1})`);
        if(!cell) return;
        const a=getComputedStyle(th).textAlign, b=getComputedStyle(cell).textAlign;
        if((a==="right")!==(b==="right")) res.push({table:ti+1, col:i+1,
          head:th.textContent.trim()||"(blank)", headAlign:a, cellAlign:b,
          sample:(cell.textContent||"").trim().slice(0,22)});
      });
    });
    return res;
  });
  console.log("\n=== " + route);
  if (!out.length) console.log("   every heading sits over its column");
  for (const r of out) console.log(`   col ${r.col} "${r.head}"  heading:${r.headAlign}  cells:${r.cellAlign}   e.g. "${r.sample}"`);
}
await browser.close();
