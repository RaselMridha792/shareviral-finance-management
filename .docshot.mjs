import fs from "node:fs"; import jwt from "jsonwebtoken"; import pg from "pg"; import puppeteer from "puppeteer-core";
const env = Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = new pg.Client({connectionString: env.DATABASE_URL_UNPOOLED||env.DATABASE_URL, ssl:{rejectUnauthorized:false}}); await db.connect();
const p = (await db.query(`select id,role,token_version from users where role='super_admin' and deleted_at is null limit 1`)).rows[0];
const token = jwt.sign({sub:p.id,role:p.role,tv:p.token_version}, env.JWT_ACCESS_SECRET, {expiresIn:"1h"});
await db.query(`delete from files where team_member_id in (select id from team_members where full_name like 'SHOTDOC%')`);
await db.query("delete from team_members where full_name like 'SHOTDOC%'");
const m = (await db.query(`insert into team_members (full_name, engagement_type, designation, status, joined_on, created_by, updated_by) values ('SHOTDOC Person','employee','Tester','active','2026-01-01',$1,$1) returning id`,[p.id])).rows[0].id;
const PDF = Buffer.from(`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 260]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 70>>stream
BT /F1 28 Tf 50 140 Td (APPOINTMENT LETTER) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`);
const form = new FormData();
form.append("file", new Blob([PDF], {type:"application/pdf"}), "appointment letter.pdf");
form.append("kind", "appointment_letter");
await fetch(`http://localhost:4001/api/files/team-member/${m}`, {method:"POST", headers:{Authorization:"Bearer "+token}, body: form});
await db.end();
const b = await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe", headless:"new", args:["--no-sandbox"]});
await b.setCookie({name:"sfm_access", value:token, domain:"localhost", path:"/"});
const page = await b.newPage(); await page.setViewport({width:1500,height:1050});
await page.goto(`http://localhost:3000/team/${m}`, {waitUntil:"networkidle0", timeout:120000});
await new Promise(r=>setTimeout(r,2500));
await page.evaluate(() => document.querySelector('button[aria-label="View appointment letter.pdf"]')?.click());
await new Promise(r=>setTimeout(r,4000));
await page.screenshot({path:"docview.png"});
await b.close();
console.log("shot", m);
