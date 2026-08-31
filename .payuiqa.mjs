/**
 * The button that makes a plan cost money.
 *
 * The API was proven by .subpayqa.mjs; this proves the half a person touches —
 * that the control is on the screen, that it opens pre-filled, and that going
 * through with it moves the card's balance. The owner's report was "ekhane
 * kichu kinle eta taka katena", and an endpoint nobody can reach is the same
 * complaint with extra steps.
 */
import fs from "node:fs"; import jwt from "jsonwebtoken"; import pg from "pg"; import puppeteer from "puppeteer-core";
const env=Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/)
 .filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");
 return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await db.connect();
const p=(await db.query(`select id,role,token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1`)).rows[0];
const t=jwt.sign({sub:p.id,role:p.role,tv:p.token_version},env.JWT_ACCESS_SECRET,{expiresIn:"2h"});
const call=async(m,path,body)=>{const r=await fetch("http://localhost:4001/api"+path,{method:m,
  headers:{Authorization:"Bearer "+t,"Content-Type":"application/json"},
  body:body===undefined?undefined:JSON.stringify(body)});return {s:r.status,b:await r.json().catch(()=>null)};};
const results=[]; const check=(n,pass,d)=>{results.push({n,pass}); console.log(`  ${pass?"ok  ":"FAIL"}  ${n}${d?" — "+d:""}`);};
const money=(x)=>Number(x??0).toFixed(2);

const wipe=async()=>{
  await db.query("delete from transactions where vendor_id in (select id from vendors where name like 'PAYUI%')");
  await db.query("delete from vendors where name like 'PAYUI%'");
  await db.query("delete from accounts where name like 'PAYUI %'");
};
await wipe();
const TODAY=(await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")).rows[0].d;
const card=(await call("POST","/accounts",{name:"PAYUI Card",type:"card",currency:"BDT",
  openingBalance:"50000.00",openingBalanceOn:TODAY.slice(0,8)+"01"})).b;
const cat=(await db.query("select id from categories where kind='out' and deleted_at is null limit 1")).rows[0];
const plan=await call("POST","/vendors",{name:"PAYUI Claude",type:"ai_tool",billingCycle:"monthly",
  billingAmount:"2450.00",billingCurrency:"BDT",billingAccountId:card.id,defaultCategoryId:cat.id,nextRenewalOn:TODAY});
check("a plan exists to pay for", plan.s===201, "HTTP "+plan.s);

const chrome="C:/Program Files/Google/Chrome/Application/chrome.exe";
const b=await puppeteer.launch({executablePath:fs.existsSync(chrome)?chrome:"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",headless:"new",args:["--no-sandbox"]});
await b.setCookie({name:"sfm_access",value:t,domain:"localhost",path:"/"});
const pg2=await b.newPage(); await pg2.setViewport({width:1700,height:1200});
/* ?status=all: a freshly created plan is not necessarily "Active" by the
   screen's own reckoning, and looking only at that tab found no row and
   reported the button as missing when it was on the page. */
await pg2.goto("http://localhost:3000/subscriptions?status=all",{waitUntil:"networkidle0",timeout:120000});
await new Promise(r=>setTimeout(r,2800));

const found=await pg2.evaluate(()=>{
  const row=[...document.querySelectorAll("tbody tr")].find(r=>(r.textContent??"").includes("PAYUI Claude"));
  const btn=[...(row?.querySelectorAll("button")??[])].find(x=>/record payment/i.test(x.textContent??""));
  if(btn){btn.click();return true;} return false;
});
check("THE ASK: the row offers Record payment", found, found?"":"no such button");
await new Promise(r=>setTimeout(r,1800));

const drawer=await pg2.evaluate(()=>{
  const d=[...document.querySelectorAll('[role="dialog"]')].find(x=>/Record a payment/i.test(x.textContent??""));
  return {open:Boolean(d), names:[...(d?.querySelectorAll("input[name]")??[])].map(i=>i.getAttribute("name"))};
});
check("the drawer opens", drawer.open, drawer.names?.join(", "));

await pg2.evaluate((today)=>{
  const d=[...document.querySelectorAll('[role="dialog"]')].find(x=>/Record a payment/i.test(x.textContent??""));
  const el=d?.querySelector('[name="txnDate"]');
  if(!el) return;
  /* The setter has to come from the element's OWN prototype: a date input is
     an HTMLInputElement, but calling a descriptor lifted from the base class
     on a different element throws "Illegal invocation". */
  const set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),"value")?.set
    ?? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value")?.set;
  set?.call(el,today);
  el.dispatchEvent(new Event("input",{bubbles:true}));
  el.dispatchEvent(new Event("change",{bubbles:true}));
}, TODAY);
await new Promise(r=>setTimeout(r,700));
await pg2.evaluate(()=>{
  const d=[...document.querySelectorAll('[role="dialog"]')].find(x=>/Record a payment/i.test(x.textContent??""));
  [...(d?.querySelectorAll("button")??[])].find(x=>/^Record it$/i.test((x.textContent??"").trim()))?.click();
});
await new Promise(r=>setTimeout(r,3500));

const after=(await call("GET","/accounts?includeInactive=true")).b.find(a=>a.id===card.id);
check("THE ASK: clicking it takes the money out of the card",
  money(after?.balance)==="47550.00", "50000.00 -> "+money(after?.balance)+" (expected 47550.00)");

const entry=(await db.query("select ref_no, amount from transactions where vendor_id=$1 and deleted_at is null",[plan.b.id])).rows[0];
check("and there is a ledger entry for it", entry?.amount==="2450.00", entry?.ref_no+" "+entry?.amount);

await b.close(); await wipe(); await db.end();
const failed=results.filter(r=>!r.pass);
console.log("\n"+"=".repeat(70));
console.log(failed.length===0?`all ${results.length} checks passed`:`${failed.length} of ${results.length} failed`);
process.exit(failed.length===0?0:1);
