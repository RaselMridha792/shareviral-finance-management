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
await page.setViewport({width:1500,height:1200,deviceScaleFactor:2});
await page.goto("http://localhost:3000/settings?tab=tax",{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
await new Promise(r=>setTimeout(r,2000));
await page.evaluate(() => {
  const t=[...document.querySelectorAll('[role="tab"],button')].find(b=>/salary tds/i.test(b.textContent));
  if(t) t.click();
});
await new Promise(r=>setTimeout(r,2500));
const out = await page.evaluate(() => {
  const m=document.querySelector("main")||document.body;
  return { text:m.innerText.split("\n").filter(Boolean).slice(0,20),
    inputs:[...m.querySelectorAll("input,select")].filter(e=>e.offsetParent!==null).length,
    save:[...m.querySelectorAll("button")].some(b=>/save/i.test(b.textContent)) };
});
console.log("visible fields: " + out.inputs + " | a save button: " + out.save);
console.log("--- what it says ---");
for (const l of out.text) console.log("   " + l.slice(0,96));
await page.screenshot({path:process.argv[2], fullPage:false});
await browser.close();
