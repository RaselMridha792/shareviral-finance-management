import fs from "node:fs"; import jwt from "jsonwebtoken"; import pg from "pg"; import puppeteer from "puppeteer-core";
const env = Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = new pg.Client({connectionString: env.DATABASE_URL_UNPOOLED||env.DATABASE_URL, ssl:{rejectUnauthorized:false}}); await db.connect();
const p=(await db.query(`select id,role,token_version from users where role='super_admin' and deleted_at is null limit 1`)).rows[0];
const token=jwt.sign({sub:p.id,role:p.role,tv:p.token_version},env.JWT_ACCESS_SECRET,{expiresIn:"1h"});
const b=await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:"new",args:["--no-sandbox"]});
await b.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await b.newPage(); await page.setViewport({width:1600,height:1100});
await page.goto("http://localhost:3000/transactions",{waitUntil:"networkidle0",timeout:120000});
await new Promise(r=>setTimeout(r,2500));
const dump = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map(h=>(h.textContent??"").trim());
  const row = document.querySelector("tbody tr");
  if (!row) return { heads, cells: [] };
  const cells = [...row.querySelectorAll("td")].map((td,i)=>({
    i, head: heads[i] ?? "?",
    text: (td.textContent??"").trim().slice(0,40),
    html: td.innerHTML.replace(/\s+/g," ").slice(0,1200),
  }));
  return { heads, cells };
});
console.log("HEADS:", JSON.stringify(dump.heads));
for (const c of dump.cells) console.log(`\n[${c.i}] ${c.head} = ${JSON.stringify(c.text)}\n     ${c.html}`);
await b.close(); await db.end();
