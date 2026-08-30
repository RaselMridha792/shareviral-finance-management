import fs from "node:fs"; import path from "node:path"; import pg from "pg";
const REPO="d:/codes/Finance-Management-software";
const env=Object.fromEntries(fs.readFileSync(path.join(REPO,"apps/api/.env"),"utf8").split(/\r?\n/).filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c=new pg.Client({connectionString:env.DATABASE_URL_UNPOOLED||env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(l,s)=>{try{const r=await c.query(s);console.log("##",l);console.table(r.rows);}catch(e){console.log("##",l,"ERR",e.message);}};

// ---- 1 totalsFor 2026-08 (has the rule) vs same without
await q("1 totalsFor 2026-08",`select
 coalesce(sum(case when direction='in' then amount else 0 end),0)::text in_with_rule,
 coalesce(sum(case when direction='out' then amount else 0 end),0)::text out_with_rule,
 count(*)::int entries_with_rule
 from transactions where transfer_group_id is null and txn_date>='2026-08-01' and txn_date<='2026-08-31' and voided_at is null`);

// ---- 2 byCategory out, 2026-08, with and without
await q("2 byCategory out 2026-08 WITHOUT rule (old)",`select coalesce(c.parent_id,c.id)::text id, coalesce(p.name,c.name,'Uncategorised') name, sum(t.amount)::text total
 from transactions t left join categories c on t.category_id=c.id left join categories p on p.id=coalesce(c.parent_id,c.id)
 where t.txn_date>='2026-08-01' and t.txn_date<='2026-08-31' and t.direction='out' and t.voided_at is null group by 1,2 order by 3 desc`);
await q("2 byCategory out 2026-08 WITH rule (now)",`select coalesce(c.parent_id,c.id)::text id, coalesce(p.name,c.name,'Uncategorised') name, sum(t.amount)::text total
 from transactions t left join categories c on t.category_id=c.id left join categories p on p.id=coalesce(c.parent_id,c.id)
 where t.transfer_group_id is null and t.txn_date>='2026-08-01' and t.txn_date<='2026-08-31' and t.direction='out' and t.voided_at is null group by 1,2 order by 3 desc`);
await q("2 byCategory IN 2026-08 with/without",`select
 (select coalesce(sum(amount),0) from transactions where txn_date between '2026-08-01' and '2026-08-31' and direction='in' and voided_at is null)::text in_without_rule,
 (select coalesce(sum(amount),0) from transactions where transfer_group_id is null and txn_date between '2026-08-01' and '2026-08-31' and direction='in' and voided_at is null)::text in_with_rule`);

// ---- 5 bankStats year 2026, all accounts
await q("5 bankStats 2026 ALL accounts, WITHOUT rule (current code)",`select extract(month from txn_date)::int m,
 coalesce(sum(case when direction='in' then amount else 0 end),0)::text money_in,
 coalesce(sum(case when direction='out' then amount else 0 end),0)::text money_out,
 count(*)::int entries
 from transactions where extract(year from txn_date)=2026 and voided_at is null group by 1 order by 1`);
await q("5 bankStats 2026 ALL accounts, WITH rule",`select extract(month from txn_date)::int m,
 coalesce(sum(case when direction='in' then amount else 0 end),0)::text money_in,
 coalesce(sum(case when direction='out' then amount else 0 end),0)::text money_out,
 count(*)::int entries
 from transactions where transfer_group_id is null and extract(year from txn_date)=2026 and voided_at is null group by 1 order by 1`);

// ---- 5b bankStats scoped to each account (the balance-roll risk)
await q("5b bankStats 2026 PER ACCOUNT aug, with/without",`select a.name,
 coalesce(sum(case when t.direction='in' then t.amount else 0 end),0)::text in_raw,
 coalesce(sum(case when t.direction='out' then t.amount else 0 end),0)::text out_raw,
 coalesce(sum(case when t.transfer_group_id is null and t.direction='in' then t.amount else 0 end),0)::text in_filtered,
 coalesce(sum(case when t.transfer_group_id is null and t.direction='out' then t.amount else 0 end),0)::text out_filtered,
 coalesce(sum(t.signed_amount),0)::text signed_net
 from transactions t join accounts a on a.id=t.account_id
 where extract(year from t.txn_date)=2026 and t.voided_at is null group by 1 order by 1`);

// ---- 6 funding: USD 'in' rows, with and without the rule
await q("6 funding rows WITHOUT rule (current code)",`select t.txn_date::text d, t.ref_no, t.original_amount::text usd, t.amount::text bdt, (t.transfer_group_id is not null) is_transfer, a.name acct
 from transactions t join accounts a on a.id=t.account_id
 where t.direction='in' and t.original_currency='USD' and t.original_amount>0 and t.voided_at is null order by t.txn_date`);
await q("6 funding totals with/without",`select
 (select coalesce(sum(original_amount),0) from transactions where direction='in' and original_currency='USD' and original_amount>0 and voided_at is null)::text usd_without_rule,
 (select coalesce(sum(original_amount),0) from transactions where transfer_group_id is null and direction='in' and original_currency='USD' and original_amount>0 and voided_at is null)::text usd_with_rule,
 (select count(*) from transactions where direction='in' and original_currency='USD' and original_amount>0 and voided_at is null and transfer_group_id is not null)::int transfer_legs_leaking`);

// ---- how many transfers carry a USD original at all
await q("transfers carrying USD originals",`select count(*) filter (where original_currency='USD')::int usd_legs, count(*)::int all_legs from transactions where transfer_group_id is not null`);
await c.end();
