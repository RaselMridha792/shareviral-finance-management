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
await page.setViewport({width:1600,height:950});
await page.goto("http://localhost:3000/subscriptions",{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
await new Promise(r=>setTimeout(r,2500));
const out = await page.evaluate(() => {
  const t=document.querySelector(".table-data");
  if(!t) return {error:"no table"};
  const heads=[...t.querySelectorAll("thead th")].map(x=>x.textContent.trim());
  const col=heads.indexOf("Billing Cycle");
  const vals=[...t.querySelectorAll("tbody tr")].map(r=>r.children[col]?.textContent.trim()).filter(Boolean);
  return {col, seen:[...new Set(vals)], old:document.body.innerText.includes("Every month")||document.body.innerText.includes("Every year")};
});
console.log("Billing Cycle column index:", out.col);
console.log("values on the page:", JSON.stringify(out.seen));
console.log('any "Every month"/"Every year" left anywhere on the page:', out.old);
// now the drawer
await page.evaluate(() => {
  const b=[...document.querySelectorAll("button")].find(x=>/Add a subscription/i.test(x.textContent||""));
  if (b) b.click();
});
await new Promise(r=>setTimeout(r,1500));
const drawer = await page.evaluate(() => {
  const sels=[...document.querySelectorAll("select")];
  for (const s of sels) {
    const opts=[...s.options].map(o=>o.textContent.trim());
    if (opts.some(o=>/month|year|quarter|recurring/i.test(o))) return opts;
  }
  return null;
});
console.log("drawer billing-cycle options:", JSON.stringify(drawer));
await browser.close();
