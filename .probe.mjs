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
page.on("response", r => { if (r.status()>=400) console.log("   " + r.status() + "  " + r.url().replace("http://localhost:3000","").slice(0,110)); });
page.on("pageerror", e => console.log("   pageerror: " + String(e).slice(0,200)));
for (const route of process.argv.slice(2)) {
  console.log("=== " + route);
  await page.goto("http://localhost:3000"+route,{waitUntil:"networkidle0",timeout:120000}).catch(e=>console.log("   goto: "+e.message.slice(0,80)));
  await new Promise(r=>setTimeout(r,2000));
  const msg = await page.evaluate(() => {
    const el=[...document.querySelectorAll("p,div,h1,h2")].map(e=>e.textContent.trim()).filter(t=>/couldn|error|failed|digest/i.test(t)).slice(0,3);
    return el;
  });
  for (const m of msg) console.log("   page says: " + m.slice(0,140));
}
await browser.close();
