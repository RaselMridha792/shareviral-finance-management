import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";import puppeteer from "puppeteer-core";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const {rows}=await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1");
const token=jwt.sign({sub:rows[0].id,role:rows[0].role,tv:rows[0].token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:"new",args:["--no-sandbox"]});
await browser.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await browser.newPage();
await page.setViewport({width:1440,height:1000});
page.on("response", r => { if (r.url().includes("/email/")) console.log("  ->", r.request().method(), r.url().replace(/.*\/api/,""), r.status(), "| sent content-type:", JSON.stringify(r.request().headers()["content-type"])); });
await page.goto("http://localhost:3000/settings",{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
// the Email tab
const clicked = await page.evaluate(() => {
  const tab=[...document.querySelectorAll("button,a")].find(b=>b.textContent.trim()==="Email");
  if(!tab) return false; tab.click(); return true;
});
console.log("Email tab clicked:", clicked);
await new Promise(r=>setTimeout(r,2500));
await page.evaluate(() => {
  const input=document.querySelector('input[type="password"]');
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
  setter.call(input,"re_local_verification_key_0001");
  input.dispatchEvent(new Event("input",{bubbles:true}));
});
await new Promise(r=>setTimeout(r,400));
console.log("clicking Save...");
await page.evaluate(() => {
  const save=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Save");
  save.click();
});
await new Promise(r=>setTimeout(r,3500));
const toast = await page.evaluate(() => document.body.innerText.split("\n").map(s=>s.trim()).filter(s=>/saved|error|not saved|re_|wrong|did not/i.test(s)).slice(0,6));
console.log("on screen:", JSON.stringify(toast));
const row = await c.query("select resend_api_key is not null as saved, left(resend_api_key,3) as head, resend_key_set_at from app_settings where id=1");
console.log("in the database:", JSON.stringify(row.rows[0]));
await c.end();
await browser.close();
