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
await page.setViewport({width:1440,height:950});
await page.goto("http://localhost:3000/",{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
await new Promise(r=>setTimeout(r,2500));
const badge = await page.evaluate(() => {
  const b=[...document.querySelectorAll("button")].find(x=>/Notifications/i.test(x.getAttribute("aria-label")||""));
  return b ? {label:b.getAttribute("aria-label"), badge:b.innerText.trim()} : null;
});
console.log("bell:", JSON.stringify(badge));
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find(x=>/Notifications/i.test(x.getAttribute("aria-label")||"")).click();
});
await new Promise(r=>setTimeout(r,900));
const panel = await page.evaluate(() => {
  const p=[...document.querySelectorAll("div")].find(d=>d.className.includes("w-[22rem]"));
  if(!p) return null;
  const r=p.getBoundingClientRect();
  return {right:Math.round(r.right), width:Math.round(r.width), rows:p.querySelectorAll("a,button").length, text:p.innerText.replace(/\s+/g," ").slice(0,260)};
});
console.log("panel:", JSON.stringify(panel, null, 1));
console.log("sideways:", document ? await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth) : "?");
await browser.close();
