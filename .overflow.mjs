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
await page.goto("http://localhost:3000"+process.argv[2],{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
await new Promise(r=>setTimeout(r,2500));
const chain = await page.evaluate(() => {
  const de=document.documentElement;
  const out=[`baseline ${de.scrollWidth}`];
  const scroller=[...document.querySelectorAll(".overflow-x-auto")].find(e=>e.scrollWidth>e.clientWidth);
  const card=scroller.closest(".rounded-xl");
  const cardBody=scroller.parentElement.parentElement;
  const tries=[
    ["scroller width:100%", ()=>{scroller.style.width="100%";}],
    ["scroller max-width:100%", ()=>{scroller.style.maxWidth="100%";}],
    ["scroller contain:paint", ()=>{scroller.style.contain="paint";}],
    ["scroller position:relative", ()=>{scroller.style.position="relative";}],
    ["cardBody overflow:hidden", ()=>{cardBody.style.overflow="hidden";}],
    ["card contain:paint", ()=>{card.style.contain="paint";}],
    ["card isolation:isolate", ()=>{card.style.isolation="isolate";}],
    ["card transform:translateZ(0)", ()=>{card.style.transform="translateZ(0)";}],
  ];
  for (const [label, apply] of tries) {
    const snapshot = [scroller.getAttribute("style"), card.getAttribute("style"), cardBody.getAttribute("style")];
    apply();
    out.push(`${label} -> ${de.scrollWidth}`);
    scroller.setAttribute("style", snapshot[0]||"");
    card.setAttribute("style", snapshot[1]||"");
    cardBody.setAttribute("style", snapshot[2]||"");
  }
  return out;
});
for (const n of chain) console.log(n);
await browser.close();
