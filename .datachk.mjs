import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";import puppeteer from "puppeteer-core";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const {rows}=await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1");
await c.end();
const token=jwt.sign({sub:rows[0].id,role:rows[0].role,tv:rows[0].token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:"new",args:["--no-sandbox"]});
await browser.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await browser.newPage();
await page.setViewport({width:1440,height:1000});

await page.goto("http://localhost:3000/import?batch=abc",{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
console.log("/import?batch=abc  ->  " + page.url());

await page.goto("http://localhost:3000/data",{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
await new Promise(r=>setTimeout(r,1500));
const head = await page.evaluate(() => ({
  title: document.querySelector("h1")?.textContent?.trim(),
  tabs: [...document.querySelectorAll('[role="tab"]')].map(t=>t.textContent.trim()),
  rail: [...document.querySelectorAll("nav a, aside a")].map(a=>a.textContent.trim()).filter(t=>/import/i.test(t)),
  steps: [...document.querySelectorAll("ol li")].map(l=>l.textContent.trim()).slice(0,4),
}));
console.log("heading:", JSON.stringify(head.title));
console.log("tabs:", JSON.stringify(head.tabs));
console.log("rail entry:", JSON.stringify(head.rail));
console.log("import steps visible:", JSON.stringify(head.steps));

await page.evaluate(() => {
  const t=[...document.querySelectorAll('[role="tab"]')].find(x=>x.textContent.trim()==="Export");
  if (t) t.click();
});
await new Promise(r=>setTimeout(r,1200));
const exp = await page.evaluate(() => {
  const btns=[...document.querySelectorAll('button[aria-pressed]')].map(b=>b.querySelector("span")?.textContent?.trim());
  const dl=[...document.querySelectorAll("button")].find(b=>/^Download/.test(b.textContent.trim()));
  return {datasets:btns, download:dl?dl.textContent.trim():null,
    sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth};
});
console.log("datasets offered:", exp.datasets.length);
for (const d of exp.datasets) console.log("   -", d);
console.log("download button:", JSON.stringify(exp.download));
console.log("sideways scroll:", exp.sideways);
await browser.close();
