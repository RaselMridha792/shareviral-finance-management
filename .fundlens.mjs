import fs from "node:fs"; import path from "node:path"; import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(l,s)=>{try{const r=await c.query(s);console.log("##",l);console.table(r.rows);}catch(e){console.log("##",l,"ERR",e.message);}};

// real funding(), exactly as coded: direction in, USD original, >0, live, inner join accounts
await q("A. funding() as coded",`select count(*)::int rows, coalesce(sum(t.original_amount),0)::text usd, coalesce(sum(t.amount),0)::text bdt
 from transactions t join accounts a on a.id=t.account_id
 where t.direction='in' and t.original_currency='USD' and t.original_amount>0 and t.voided_at is null`);
await q("B. funding() + transfer_group_id is null",`select count(*)::int rows, coalesce(sum(t.original_amount),0)::text usd, coalesce(sum(t.amount),0)::text bdt
 from transactions t join accounts a on a.id=t.account_id
 where t.direction='in' and t.original_currency='USD' and t.original_amount>0 and t.voided_at is null and t.transfer_group_id is null`);

// counterfactual, read-only: what if the two live 'in' transfer legs had been entered
// against a USD-primary account (the production shape) at rate 122.00?
await q("C. COUNTERFACTUAL as coded (transfer legs stamped USD)",`
 with sim as (
   select t.*,
     case when t.transfer_group_id is not null then 'USD' else t.original_currency end as sim_ccy,
     case when t.transfer_group_id is not null then round(t.amount/122.00,2) else t.original_amount end as sim_orig
   from transactions t)
 select count(*)::int rows, coalesce(sum(sim_orig),0)::text usd, coalesce(sum(amount),0)::text bdt,
   case when coalesce(sum(sim_orig),0)>0 then round(sum(amount)/sum(sim_orig),4)::text else '0' end as avg_rate
 from sim s join accounts a on a.id=s.account_id
 where s.direction='in' and s.sim_ccy='USD' and s.sim_orig>0 and s.voided_at is null`);
await q("D. COUNTERFACTUAL + transfer_group_id is null",`
 with sim as (
   select t.*,
     case when t.transfer_group_id is not null then 'USD' else t.original_currency end as sim_ccy,
     case when t.transfer_group_id is not null then round(t.amount/122.00,2) else t.original_amount end as sim_orig
   from transactions t)
 select count(*)::int rows, coalesce(sum(sim_orig),0)::text usd, coalesce(sum(amount),0)::text bdt
 from sim s join accounts a on a.id=s.account_id
 where s.direction='in' and s.sim_ccy='USD' and s.sim_orig>0 and s.voided_at is null and s.transfer_group_id is null`);

await q("E. every transaction that has an original_currency",`select direction, original_currency, count(*)::int, coalesce(sum(original_amount),0)::text from transactions where original_currency is not null group by 1,2`);
await q("F. accounts",`select name, currency from accounts order by name`);
await c.end();
