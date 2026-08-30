/** Are the smallest composition-bar segments actually drawn? */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";
const env = Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await db.connect();
const {rows}=await db.query(`select id,role,token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`);await db.end();
const token=jwt.sign({sub:rows[0].id,role:rows[0].role,tv:rows[0].token_version},env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe", edge="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:edge,headless:"new",args:["--no-sandbox"]});
await browser.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await browser.newPage();
for (const width of [1440, 390]) {
  await page.setViewport({width,height:900});
  await page.goto("http://localhost:3000/expenses/office-premises",{waitUntil:"networkidle0",timeout:90000});
  await new Promise(r=>setTimeout(r,600));
  const bar = await page.evaluate(() => {
    const el = [...document.querySelectorAll("main section div")].find((d) => d.className.includes("h-2") && d.children.length > 1);
    if (!el) return null;
    return {
      container: Math.round(el.getBoundingClientRect().width),
      widths: [...el.children].map((c) => +c.getBoundingClientRect().width.toFixed(1)),
      sum: +[...el.children].reduce((s, c) => s + c.getBoundingClientRect().width, 0).toFixed(1),
    };
  });
  console.log(`${String(width).padStart(4)}px  bar container=${bar.container}px  segments=${bar.widths.join(" / ")}  sum=${bar.sum}px  invisible=${bar.widths.filter((w) => w < 1).length}`);
}
await browser.close();
