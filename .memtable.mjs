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
page.on("console", (m) => { if (m.type()==="error") console.log("  [console]", m.text().slice(0,160)); });
await page.setViewport({width:1440,height:950});
for (const route of process.argv.slice(2)) {
  await page.goto("http://localhost:3000"+route,{waitUntil:"networkidle0",timeout:120000}).catch((e)=>console.log("  [goto]", e.message.slice(0,120)));
  await new Promise(r=>setTimeout(r,2500));
  console.log("\n=== " + route + "  ->  " + page.url() + " ===");
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g," ").slice(0,240));
  console.log("  text:", text);
  const out = await page.evaluate(() => {
    const res=[];
    for (const t of document.querySelectorAll(".table-data")) {
      const heads=[...t.querySelectorAll("thead th")].map(th=>th.textContent.trim()).filter(Boolean);
      const first=t.querySelector("tbody tr");
      res.push({heads:heads.length, list:heads.join(" | "), cells:first?first.querySelectorAll("td").length:0, rows:t.querySelectorAll("tbody tr").length});
    }
    return {tables:res, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth};
  });
  console.log("  sideways:", out.sideways);
  for (const t of out.tables) console.log(`  ${t.heads} heads / ${t.cells} cells / ${t.rows} rows\n    ${t.list}`);
}
await browser.close();
