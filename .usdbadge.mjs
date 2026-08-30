/** Is the "USD 39.00 @ 122.043217" chip gone from every description cell? */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";
const env=Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await db.connect();
const {rows:u}=await db.query(`select id,role,token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);
const {rows:fx}=await db.query(`select count(*)::int as n from transactions where original_amount is not null and voided_at is null`);
await db.end();
console.log(`transactions recorded in a foreign currency: ${fx[0].n}`);
const token=jwt.sign({sub:u[0].id,role:u[0].role,tv:u[0].token_version},env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe", edge="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:edge,headless:"new",args:["--no-sandbox"]});
await browser.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await browser.newPage();
await page.setViewport({width:1600,height:1000});
for (const route of ["/transactions","/expenses/technology","/accounts"]) {
  await page.goto(`http://localhost:3000${route}`,{waitUntil:"networkidle0",timeout:90000});
  await new Promise(r=>setTimeout(r,700));
  const found = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("td.cell-prose")];
    const hits = cells.map((c) => c.textContent || "").filter((t) => /\b(USD|BDT|EUR|GBP)\s[\d,]+(\.\d+)?\s@\s/.test(t));
    const usdCol = [...document.querySelectorAll("table th")].map((t) => t.textContent.trim()).filter((t) => /USD/i.test(t));
    return { cells: cells.length, hits: hits.length, sample: hits[0] || null, usdCol };
  });
  console.log(`${route.padEnd(24)} description cells=${found.cells}  "CUR n @ rate" chips=${found.hits}  columns=${found.usdCol.join(" / ") || "(none)"}${found.sample ? `  sample="${found.sample}"` : ""}`);
}
await browser.close();
