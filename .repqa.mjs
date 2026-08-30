import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";import puppeteer from "puppeteer-core";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const u=(await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1")).rows[0];
const month=(await c.query("select to_char(now() at time zone 'Asia/Dhaka','YYYY-MM') m")).rows[0].m;
const t=(await c.query(`select
   coalesce(sum(amount::numeric) filter (where direction='in'),0) as inn,
   coalesce(sum(amount::numeric) filter (where direction='out'),0) as outt
 from transactions where voided_at is null and to_char(txn_date,'YYYY-MM')=$1`,[month])).rows[0];
await c.end();
const token=jwt.sign({sub:u.id,role:u.role,tv:u.token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:"new",args:["--no-sandbox"]});
await browser.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await browser.newPage();
await page.setViewport({width:1600,height:1400});
await page.goto("http://localhost:3000/reports",{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
await new Promise(r=>setTimeout(r,3000));
const text = await page.evaluate(() => (document.querySelector("main")||document.body).innerText);
const amount=(s)=>{const neg=/[-\u2212]/.test(String(s));const n=Number(String(s).replace(/[^0-9.]/g,""));return neg?-n:n;};
const figures=(text.match(/[-\u2212]?[\u09f3][\d,]+\.\d\d/g)||[]).map(amount);
const near=(w)=>figures.some(f=>Math.abs(f-w)<0.02);
console.log("period on screen (default): the current month, " + month);
console.log("  money in   ledger " + Number(t.inn).toFixed(2)  + "   on the page: " + (near(Number(t.inn))?"found":"NOT FOUND"));
console.log("  money out  ledger " + Number(t.outt).toFixed(2) + "   on the page: " + (near(Number(t.outt))?"found":"NOT FOUND"));
console.log("  net        ledger " + (Number(t.inn)-Number(t.outt)).toFixed(2) + "   on the page: " + (near(Number(t.inn)-Number(t.outt))?"found":"NOT FOUND"));
console.log("  (" + figures.length + " money figures on the page)");
await browser.close();
