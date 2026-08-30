import fs from "node:fs"; import pg from "pg";
const env=Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/)
 .filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");
 return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s)=>(await c.query(s)).rows;
console.log("  rows the tooling figure counts in Aug 2026:");
for (const r of await q(`
  select t.description, t.amount::text, a.name account, a.type, a.currency,
         (t.transfer_group_id is not null) is_transfer
    from transactions t
    left join vendors v on t.vendor_id = v.id
    left join accounts a on t.account_id = a.id
   where t.txn_date between '2026-08-01' and '2026-08-31'
     and t.voided_at is null and t.direction='out'
     and (coalesce(v.type in ('ai_tool','subscription','hosting'), false)
          or coalesce(a.currency <> 'BDT' and a.type = 'card', false))
   order by t.amount desc`))
  console.log(`    ${String(r.amount).padStart(12)}  ${r.account} (${r.type}/${r.currency})  ${r.is_transfer?"<-- TRANSFER":""}  ${r.description}`);
const tot=async(extra)=>(await q(`
  select coalesce(sum(t.amount),0)::text v from transactions t
   left join vendors v on t.vendor_id = v.id
   left join accounts a on t.account_id = a.id
  where t.txn_date between '2026-08-01' and '2026-08-31'
    and t.voided_at is null and t.direction='out'
    and (coalesce(v.type in ('ai_tool','subscription','hosting'), false)
         or coalesce(a.currency <> 'BDT' and a.type = 'card', false)) ${extra}`))[0].v;
const withT=await tot(""), withoutT=await tot("and t.transfer_group_id is null");
console.log(`\n  tooling total as reported : ${Number(withT).toFixed(2)}`);
console.log(`  with transfers excluded   : ${Number(withoutT).toFixed(2)}`);
console.log(withT===withoutT ? "\n  no difference on this data" :
  `\n  DIFFERENCE ${(Number(withT)-Number(withoutT)).toFixed(2)} — own-money movement counted as tooling spend`);
await c.end();
