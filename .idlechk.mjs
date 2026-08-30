/* Does the screen really sign out at twenty minutes? Fast-forward the clock it reads. */
import fs from "node:fs"; import jwt from "jsonwebtoken"; import pg from "pg"; import puppeteer from "puppeteer-core";
const WEB = "http://localhost:3000";
const env = Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = new pg.Client({connectionString: env.DATABASE_URL_UNPOOLED||env.DATABASE_URL, ssl:{rejectUnauthorized:false}}); await db.connect();
const p=(await db.query(`select id,role,token_version from users where role='super_admin' and deleted_at is null limit 1`)).rows[0];
const token=jwt.sign({sub:p.id,role:p.role,tv:p.token_version},env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
await db.end();
const b=await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:"new",args:["--no-sandbox"]});
await b.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await b.newPage(); await page.setViewport({width:1400,height:900});
const settle=(ms)=>new Promise(r=>setTimeout(r,ms));
const KEY = "sfm.last-activity.v1";

for (const minutes of [10, 19.5, 21]) {
  await page.goto(WEB+"/", {waitUntil:"networkidle0", timeout:120000});
  await settle(2000);
  await page.evaluate((k, ago) => window.localStorage.setItem(k, String(Date.now() - ago)), KEY, minutes*60000);
  await settle(7000);                       // one slow tick is 5s
  const state = await page.evaluate(() => ({
    url: location.pathname + location.search,
    warning: [...document.querySelectorAll('[role="alertdialog"]')].some(d => /Still there\?/.test(d.textContent ?? "")),
    countdown: (document.querySelector('[role="alertdialog"]')?.textContent ?? "").match(/(\d+)s/)?.[1] ?? null,
  }));
  console.log(`idle ${minutes} min ->`, JSON.stringify(state));
}
await b.close();
