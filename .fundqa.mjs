import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync("d:/codes/Finance-Management-software/apps/api/.env", "utf8");
const url = env.match(/^DATABASE_URL_UNPOOLED=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const q = async (label, sqlText) => {
  const r = await client.query(sqlText);
  console.log("\n== " + label + " ==");
  console.table(r.rows);
};

await q("funding() AS WRITTEN (no transfer exclusion)", `
  select count(*)::int as rows,
         coalesce(sum(t.original_amount),0)::text as usd_sent,
         coalesce(sum(t.amount),0)::text as bdt_received,
         case when coalesce(sum(t.original_amount),0) > 0
              then round(sum(t.amount)/sum(t.original_amount),4)::text else '0' end as avg_rate
  from transactions t join accounts a on a.id = t.account_id
  where t.direction='in' and t.original_currency='USD' and t.original_amount>0 and t.voided_at is null`);

await q("funding() WITH transfer_group_id is null", `
  select count(*)::int as rows,
         coalesce(sum(t.original_amount),0)::text as usd_sent,
         coalesce(sum(t.amount),0)::text as bdt_received,
         case when coalesce(sum(t.original_amount),0) > 0
              then round(sum(t.amount)/sum(t.original_amount),4)::text else '0' end as avg_rate
  from transactions t join accounts a on a.id = t.account_id
  where t.direction='in' and t.original_currency='USD' and t.original_amount>0 and t.voided_at is null
    and t.transfer_group_id is null`);

await q("accounts: currency", `select name, currency, deleted_at is not null as deleted from accounts order by name`);

await q("transfer legs present", `
  select t.ref_no, t.direction, t.amount::text, t.original_currency,
         t.original_amount::text, t.fx_rate::text, t.transfer_group_id, t.voided_at is not null as voided,
         a.name as account, a.currency as acct_ccy
  from transactions t join accounts a on a.id=t.account_id
  where t.transfer_group_id is not null order by t.transfer_group_id, t.direction`);

await q("any USD-original rows at all", `
  select direction, count(*)::int, coalesce(sum(original_amount),0)::text as usd
  from transactions where original_currency='USD' and original_amount is not null group by direction`);

await client.end();
