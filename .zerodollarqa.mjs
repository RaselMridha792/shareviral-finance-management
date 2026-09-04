/**
 * ৳56.70 in the account, $0.00 beside it.
 *
 * The owner, on the Exprovia LLC card — a USD account:
 *
 *   *"ekhane 56 taka dekhacche dollar er ghor 0 keno? etato right hiseb holona
 *    taina. ami hisebe 1 poysaro gormil caina."*
 *
 * ৳56.70 at any plausible rate is about $0.46, so a zero is not a rounding.
 * `ownCurrencyBalance` reads a row's STATED dollars before it reads any rate —
 * and a stated zero is still a statement, so a row carrying
 * `original_currency = 'USD'` with `original_amount = 0.00` adds nothing while
 * its taka adds everything. #64's fallback cannot reach it: that one only
 * catches rows stating NOTHING.
 *
 * The row carries a rate as well, because `transactions_fx_complete` refuses
 * dollars without one — which is what makes the zero so wasteful. Everything
 * needed to read the figure is on the row; the expression simply prefers the
 * zero to the rate sitting beside it.
 *
 * So this builds exactly that row and asks the SCREEN's own balances endpoint
 * what it makes of it, rather than reasoning about the SQL.
 *
 *     node .zerodollarqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = "http://localhost:4001/api";
const env = Object.fromEntries(
  fs
    .readFileSync("apps/api/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const person = (
  await db.query(
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
const call = async (method, path_, body) => {
  const res = await fetch(API + path_, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const MARK = "ZDQA";
const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;

const wipe = async () => {
  await db.query("delete from transactions where description like $1", [`%${MARK}%`]);
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
  await db.query(
    "delete from fx_rates where rate_date = '2026-01-01' and rate = '123.260000'",
  );
};
await wipe();

/* A rate on file, as the live system has. */
await db.query(
  `insert into fx_rates (base_currency, quote_currency, rate, rate_date, source, created_by)
   values ('USD','BDT','123.260000', '2026-01-01', 'manual', $1)`,
  [person.id],
);

const account = (
  await call("POST", "/accounts", {
    name: `${MARK} Exprovia`,
    type: "bank",
    currency: "USD",
    openingBalance: "0.00",
    openingBalanceUsd: "0.00",
    openingBalanceOn: "2026-06-01",
  })
).body;
check(
  "a dollar account opened at nothing",
  account?.currency === "USD",
  `${account?.type} in ${account?.currency}`,
);

const shown = async () => {
  const b = await call("GET", "/accounts/balances");
  const row = (b.body?.accounts ?? []).find((a) => a.id === account.id);
  return {
    usd: Number(row?.ownBalance ?? 0),
    bdt: Number(row?.balance ?? 0),
    exact: row?.ownBalanceExact,
  };
};

const outCat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/* ------------------- the row that says "zero dollars" ------------------- */

/*
 * Written straight to the table on purpose. The question is what the BALANCE
 * makes of a row in this shape, not which screen can be talked into writing
 * one — and rows in this shape are already on the live system.
 */
await db.query(
  `insert into transactions (ref_no, account_id, direction, txn_date, amount,
     currency, category_id, description, original_amount, original_currency,
     fx_rate, created_by, updated_by)
   values ('TXN-ZDQA-' || floor(random()*100000)::int, $1, 'in', $2, '56.70',
     'BDT', $3, '${MARK} a receipt that states zero dollars', '0.00', 'USD',
     '123.260000', $4, $4)`,
  [account.id, TODAY, outCat.id, person.id],
);

const seen = await shown();
check(
  "the taka is there",
  seen.bdt.toFixed(2) === "56.70",
  `৳${seen.bdt}`,
);
/* THE COMPLAINT, in one line. */
check(
  "and the dollars beside it are NOT zero",
  seen.usd !== 0,
  `$${seen.usd} — ৳56.70 at 123.26 is about $0.46`,
);
check(
  "the figure is read at the rate on file, to the paisa",
  seen.usd.toFixed(2) === (56.7 / 123.26).toFixed(2),
  `$${seen.usd} vs ${(56.7 / 123.26).toFixed(2)}`,
);
/*
 * Still a record, and rightly: the app's own rule is "its dollars OR its own
 * rate", and this row carries a rate it was written with. The figure is read
 * at the rate recorded on the day, not guessed at today's, so there is nothing
 * approximate about it.
 */
check(
  "and it is still a record, because the row carries its own rate",
  seen.exact === true,
  `exact ${seen.exact}`,
);

/* ------------- what must NOT change: a real zero cannot exist ---------- */

/*
 * There is no such thing as a row worth taka and zero dollars, and the
 * database is what says so: `transactions_amount_positive` is
 * `CHECK (amount > 0)`, so a row that moved nothing cannot be written at all.
 * That is the whole licence for reading a stated zero as a missing figure
 * rather than as a fact — asserted here so the licence is checked rather than
 * remembered.
 */
const refusedZero = await db
  .query(
    `insert into transactions (ref_no, account_id, direction, txn_date, amount,
       currency, category_id, description, created_by, updated_by)
     values ('TXN-ZDQA-' || floor(random()*100000)::int, $1, 'in', $2, '0.00',
       'BDT', $3, '${MARK} a row for nothing at all', $4, $4)`,
    [account.id, TODAY, outCat.id, person.id],
  )
  .then(() => "allowed")
  .catch((e) => (e.code === "23514" ? "refused" : `refused (${e.code})`));
check(
  "the ledger refuses a row that moved nothing",
  refusedZero.startsWith("refused"),
  refusedZero,
);
const withNothing = seen;

/* --------------- and a real stated figure still wins ------------------- */

await db.query(
  `insert into transactions (ref_no, account_id, direction, txn_date, amount,
     currency, category_id, description, original_amount, original_currency,
     fx_rate, created_by, updated_by)
   values ('TXN-ZDQA-' || floor(random()*100000)::int, $1, 'in', $2, '12326.00',
     'BDT', $3, '${MARK} a receipt that states its dollars', '100.00', 'USD',
     '123.260000', $4, $4)`,
  [account.id, TODAY, outCat.id, person.id],
);
const stated = await shown();
check(
  "a row that states its dollars is still taken at its word",
  (stated.usd - withNothing.usd).toFixed(2) === "100.00",
  `$${withNothing.usd} → $${stated.usd}`,
);

const rows = (
  await db.query(
    `select description, amount::text, original_amount::text, original_currency,
            fx_rate::text, usd_rate::text
       from transactions where account_id=$1 and deleted_at is null
      order by created_at`,
    [account.id],
  )
).rows;
console.log("\n  what each row carries:");
for (const r of rows) {
  console.log(
    `    ${String(r.description).replace(MARK + " ", "").padEnd(38).slice(0, 38)} ৳${String(r.amount).padStart(10)}  ` +
      `usd=${r.original_amount ?? "-"}  fx=${r.fx_rate ?? "-"}  ref=${r.usd_rate ?? "-"}`,
  );
}

await wipe();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
