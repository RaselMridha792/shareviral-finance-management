/* What colour does each clickable reference actually paint, and on which element? */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";
const WEB = "http://localhost:3000";
const env = Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/)
  .filter(l=>l&&!l.trim().startsWith("#")&&l.includes("="))
  .map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = new pg.Client({connectionString: env.DATABASE_URL_UNPOOLED||env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
await db.connect();
const p = (await db.query(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1`)).rows[0];
const token = jwt.sign({sub:p.id, role:p.role, tv:p.token_version}, env.JWT_ACCESS_SECRET, {expiresIn:"1h"});
const b = await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe", headless:"new", args:["--no-sandbox"]});
await b.setCookie({name:"sfm_access", value:token, domain:"localhost", path:"/"});
const page = await b.newPage(); await page.setViewport({width:1600,height:1100});
for (const route of ["/transactions", "/expenses/other", "/accounts/cash-in", "/transfers"]) {
  await page.goto(WEB+route, {waitUntil:"networkidle0", timeout:120000});
  await new Promise(r=>setTimeout(r,2500));
  const seen = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")].slice(0, 4);
    const out = [];
    for (const r of rows) for (const el of r.querySelectorAll("a,button")) {
      const t = (el.textContent ?? "").trim();
      if (!t || t.length > 30) continue;
      if (!/^(INV|TXN|FT|REF|[A-Z]{2,}-)/i.test(t) && !/\d/.test(t)) continue;
      const s = getComputedStyle(el);
      out.push({ t: t.slice(0,20), tag: el.tagName, cls: el.className.split(" ").filter(c=>/link|underline|warn|text-/.test(c)).join(" "), color: s.color, ul: s.textDecorationLine });
    }
    return out;
  });
  console.log("== " + route);
  for (const s of seen) console.log("   " + JSON.stringify(s));
}
await b.close(); await db.end();
