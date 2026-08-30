import fs from "node:fs"; import pg from "pg";
const env = Object.fromEntries(fs.readFileSync("apps/api/.env","utf8").split(/\r?\n/)
  .filter(l=>l&&!l.trim().startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");
  return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = new pg.Client({connectionString: env.DATABASE_URL_UNPOOLED||env.DATABASE_URL, ssl:{rejectUnauthorized:false}});
await db.connect();
const R = ["2026-08-01","2026-08-31"];
const q = async (s,p)=> (await db.query(s,p)).rows;
const totals = (await q(`select
   coalesce(sum(case when direction='out' then amount else 0 end),0)::text out_
 from transactions
 where transfer_group_id is null and txn_date between $1 and $2 and voided_at is null`, R))[0];
const cats = await q(`select coalesce(c.parent_id,c.id)::text id, sum(t.amount)::text total
 from transactions t left join categories c on t.category_id = c.id
 where t.txn_date between $1 and $2 and t.direction='out' and t.voided_at is null
 group by 1 order by 2 desc`, R);
const sum = cats.reduce((a,r)=>a+Number(r.total),0);
console.log("  totalsFor  moneyOut      ", Number(totals.out_).toFixed(2));
console.log("  byCategory sums to       ", sum.toFixed(2));
cats.forEach(c=>console.log(`     ${(c.id??"Uncategorised (NULL)").padEnd(40)} ${Number(c.total).toFixed(2)}  ${((Number(c.total)/sum)*100).toFixed(1)}%`));
console.log(sum === Number(totals.out_) ? "\n  AGREE" : `\n  DISAGREE by ${(sum-Number(totals.out_)).toFixed(2)} — one payload, two different months of spending`);
await db.end();
