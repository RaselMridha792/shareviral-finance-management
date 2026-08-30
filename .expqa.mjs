import fs from "node:fs";import path from "node:path";import jwt from "jsonwebtoken";import pg from "pg";import puppeteer from "puppeteer-core";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const u=(await c.query("select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1")).rows[0];
const month=(await c.query("select to_char(now() at time zone 'Asia/Dhaka','YYYY-MM') m")).rows[0].m;
const cats=(await c.query(`
  -- Each transaction mapped to its top-level category once.
  --
  -- The first version joined categories to their children and then joined
  -- transactions on "parent or child", which fans out: an entry filed against
  -- the parent itself matched once per child and was counted that many times.
  -- Office & premises came out at five times its real total, and the page was
  -- right all along.
  select p.name as parent,
         coalesce(sum(t.amount::numeric),0) as spent
    from transactions t
    join categories c on c.id = t.category_id
    join categories p on p.id = coalesce(c.parent_id, c.id)
   where t.direction = 'out'
     and t.voided_at is null
     and to_char(t.txn_date,'YYYY-MM') = $1
   group by p.id, p.name
   order by p.name`,[month])).rows;
await c.end();
const token=jwt.sign({sub:u.id,role:u.role,tv:u.token_version}, env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:"new",args:["--no-sandbox"]});
await browser.setCookie({name:"sfm_access",value:token,domain:"localhost",path:"/"});
const page=await browser.newPage();
await page.setViewport({width:1600,height:1400});
await page.goto("http://localhost:3000/expenses",{waitUntil:"networkidle0",timeout:120000}).catch(()=>{});
await new Promise(r=>setTimeout(r,2500));
const text = await page.evaluate(() => (document.querySelector("main") || document.body).innerText);
const amount=(s)=>{const neg=/[-\u2212]/.test(String(s));const n=Number(String(s).replace(/[^0-9.]/g,""));return neg?-n:n;};
console.log("month on screen: " + month);
console.log("heading".padEnd(30)+"ledger".padStart(16)+"   page");
let bad=0, shown=0;
for (const c2 of cats) {
  const at=text.indexOf(c2.parent);
  if (at===-1) continue;
  shown++;
  const near=(text.slice(at, at+220).match(/[-\u2212]?[\u09f3$][\d,]+\.\d\d/g)||[]).map(amount);
  const want=Number(c2.spent);
  const hit=near.some(v=>Math.abs(v-want)<0.02);
  console.log(c2.parent.padEnd(30)+want.toFixed(2).padStart(16)+"   "+(hit?"matches":"NO MATCH — near it: "+near.slice(0,3).join(" ")));
  if(!hit) bad++;
}
console.log("\n"+(shown===0?"no category headings found on the page":bad===0?`all ${shown} heading totals match the ledger for ${month}`:`${bad} of ${shown} disagree`));
await browser.close();
