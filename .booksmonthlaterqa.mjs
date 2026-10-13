/**
 * A later books month, written — piece 3b of
 * docs/briefs/2026-10-13-books-month-and-bank-status.md.
 *
 *   1. An entry dated 22 June with books month July is accepted.
 *   2. It counts in July, not June, on the Dashboard, Accounts, Expenses and
 *      the Statement (and Accounts ▸ Bank status).
 *   3. The overdraft rule still judges it on 22 June: a second one that July
 *      could afford but 22 June could not is refused.
 *
 * WRITES ENTRIES AND AN ACCOUNT. Run it on a copy, never on Neon or live, so
 * BM_DB has no default:
 *
 *   BM_DB=postgres://postgres:copy@localhost:55433/sfm \
 *   BM_API=http://localhost:4096/api node .booksmonthlaterqa.mjs
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = process.env.BM_API ?? "http://localhost:4096/api";
if (!process.env.BM_DB) {
  console.error("BM_DB is required: the connection string of a COPY of the database.");
  process.exit(2);
}
const MARK = "BMQA3B";

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
const db = new pg.Client({ connectionString: process.env.BM_DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const person = (
  await q(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`)
)[0];
const token = jwt.sign({ sub: person.id, role: person.role, tv: person.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });
const H = { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" };
const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (path) => {
  const r = await call("GET", path);
  if (r.status !== 200) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
};
const msgOf = (r) => String(r.body?.message ?? "") + " " + Object.values(r.body?.errors ?? {}).flat().join(" ");

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
};
const eq2 = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

/* Fiscal year July-June: June 2026 is FY 2025's 12th, July FY 2026's 1st. */
const JUNE = { key: "2026-06", from: "2026-06-01", to: "2026-06-30", qs: "granularity=month&fiscalYear=2025&index=12" };
const JULY = { key: "2026-07", from: "2026-07-01", to: "2026-07-31", qs: "granularity=month&fiscalYear=2026&index=1" };
{
  const p = await get(`/reports/overview?${JULY.qs}`);
  if (p.period.start !== JULY.from) throw new Error(`period mapping is wrong: ${p.period.start}`);
}

const snapshot = async () => {
  const out = {};
  for (const mo of [JUNE, JULY]) {
    const ov = await get(`/reports/overview?${mo.qs}`);
    const ex = await get(`/expenses/overview?from=${mo.from}&to=${mo.to}`);
    const su = await get(`/expenses/summary?from=${mo.from}&to=${mo.to}`);
    out[mo.key] = { moneyOut: ov.totals.moneyOut, expenseTotal: ex.total, summaryTotal: su.total };
  }
  return out;
};
const before = await snapshot();

const [category] = await q(
  `select c.id, p.slug from categories c join categories p on p.id = c.parent_id
    where c.kind='out' and c.deleted_at is null and c.parent_id is not null
      and c.slug not in ('bank-charges','office-rent') and p.slug <> 'office-premises'
    order by c.name limit 1`,
);

const acct = await call("POST", "/accounts", {
  name: `${MARK} later`,
  type: "bank",
  bankName: `${MARK} bank`,
  currency: "BDT",
  openingBalance: "0",
  openingBalanceOn: "2026-01-01",
});
check("a fresh account, opened at 0", acct.status === 201, `${acct.status} ${msgOf(acct)}`);
const accountId = acct.body?.id;

for (const [day, amount] of [["2026-06-05", "1000.00"], ["2026-07-05", "2000.00"]]) {
  const r = await call("POST", "/transactions/cash-in", {
    txnDate: day,
    accountId,
    amount,
    usdRate: "122.00",
    description: `${MARK} cash in ${day}`,
  });
  check(`cash in ৳${amount} on ${day}`, r.status === 201, `${r.status} ${msgOf(r)}`);
}

const expense = (extra) => ({
  direction: "out",
  accountId,
  amount: "600.00",
  categoryId: category.id,
  usdRate: "122.00",
  ...extra,
});

/* ------------------------------------------------------------------------ */
console.log("1. accepted");
const july = await call("POST", "/transactions", expense({ txnDate: "2026-06-22", booksMonth: "2026-07-01", description: `${MARK} July books, paid 22 June` }));
check("৳600 dated 22 June, books July: saved", july.status === 201, `${july.status} ${msgOf(july)}`);
const julyId = july.body?.id;
const [stored] = await q(`select books_month::text as bm, txn_date::text as d from transactions where id=$1`, [julyId]);
check("  stored: books 2026-07-01, dated 2026-06-22", stored?.bm === "2026-07-01" && stored?.d === "2026-06-22", JSON.stringify(stored));
check("  the DTO carries it", july.body?.booksMonth === "2026-07-01", july.body?.booksMonth);

/* ------------------------------------------------------------------------ */
console.log("3. the overdraft rule judges the day");
const tooMuch = await call("POST", "/transactions", expense({ txnDate: "2026-06-22", booksMonth: "2026-07-01", amount: "500.00", description: `${MARK} too much on 22 June` }));
check(
  "৳500 more dated 22 June, books July: refused (22 June holds 400; July could afford it)",
  tooMuch.status >= 400 && tooMuch.status < 500,
  `${tooMuch.status} ${msgOf(tooMuch).slice(0, 140)}`,
);

/* ------------------------------------------------------------------------ */
console.log("2. it counts in July");
console.log("  Dashboard");
const group = async (mo) => (await get(`/reports/overview?${mo.qs}`)).groups.find((g) => g.key === accountId);
const gJune = await group(JUNE);
const gJuly = await group(JULY);
check("June: opening 0, in 1000, out 0, closing 1000", gJune && eq2(gJune.opening, 0) && eq2(gJune.moneyIn, 1000) && eq2(gJune.moneyOut, 0) && eq2(gJune.closing, 1000), JSON.stringify(gJune && [gJune.opening, gJune.moneyIn, gJune.moneyOut, gJune.closing]));
check("July: opening 1000, in 2000, out 600, closing 2400", gJuly && eq2(gJuly.opening, 1000) && eq2(gJuly.moneyIn, 2000) && eq2(gJuly.moneyOut, 600) && eq2(gJuly.closing, 2400), JSON.stringify(gJuly && [gJuly.opening, gJuly.moneyIn, gJuly.moneyOut, gJuly.closing]));
const after = await snapshot();
const delta = (mo, field) => Number(after[mo.key][field]) - Number(before[mo.key][field]);
check("company money out: June +0, July +600", eq2(delta(JUNE, "moneyOut"), 0) && eq2(delta(JULY, "moneyOut"), 600), `${delta(JUNE, "moneyOut")} / ${delta(JULY, "moneyOut")}`);

console.log("  Accounts");
const held = async (asOf) => (await get(`/accounts?includeInactive=true&asOf=${asOf}`)).find((a) => a.id === accountId)?.balance;
const h22 = await held("2026-06-22");
const hJune = await held("2026-06-30");
const hJuly = await held("2026-07-31");
check("as at 22 June: 1000 (July's entry not yet counted)", eq2(h22, 1000), h22);
check("as at the end of June: 1000", eq2(hJune, 1000), hJune);
check("as at the end of July: 2400", eq2(hJuly, 2400), hJuly);

console.log("  Bank status");
const bs = async (month) => (await get(`/accounts/bank-status?month=${month}`)).rows?.find((r) => r.accountId === accountId);
const bJune = await bs(JUNE.from);
const bJuly = await bs(JULY.from);
const num = (v) => (v && typeof v === "object" ? v.bdt : v);
check("June: out 0, closing 1000", bJune && eq2(num(bJune.moneyOut), 0) && eq2(num(bJune.closing), 1000), JSON.stringify(bJune && [num(bJune.moneyOut), num(bJune.closing)]));
check("July: opening 1000, out 600, closing 2400", bJuly && eq2(num(bJuly.opening), 1000) && eq2(num(bJuly.moneyOut), 600) && eq2(num(bJuly.closing), 2400), JSON.stringify(bJuly && [num(bJuly.opening), num(bJuly.moneyOut), num(bJuly.closing)]));

console.log("  Expenses");
check("overview total: June +0, July +600", eq2(delta(JUNE, "expenseTotal"), 0) && eq2(delta(JULY, "expenseTotal"), 600), `${delta(JUNE, "expenseTotal")} / ${delta(JULY, "expenseTotal")}`);
check("summary (the category grid): June +0, July +600", eq2(delta(JUNE, "summaryTotal"), 0) && eq2(delta(JULY, "summaryTotal"), 600), `${delta(JUNE, "summaryTotal")} / ${delta(JULY, "summaryTotal")}`);
const listHas = async (mo, flag) => {
  const r = await get(`/transactions?from=${mo.from}&to=${mo.to}&accountId=${accountId}&pageSize=200${flag ? "&byBooksMonth=true" : ""}`);
  return r.items.some((t) => t.id === julyId);
};
check("a category page's rows (byBooksMonth): in July, not in June", (await listHas(JULY, true)) && !(await listHas(JUNE, true)));
check("All transactions (the date filter): in June, not in July", (await listHas(JUNE, false)) && !(await listHas(JULY, false)));

console.log("  Statement (Reports)");
const ledger = async (mo) => (await get(`/reports/statement?${mo.qs}`)).ledgers.find((l) => l.accountId === accountId);
const lJune = await ledger(JUNE);
const lJuly = await ledger(JULY);
check("June: closing 1000, the entry not listed", lJune && eq2(lJune.closing.bdt, 1000) && !lJune.rows.some((r) => r.id === julyId), JSON.stringify(lJune && [lJune.opening.bdt, lJune.closing.bdt]));
check("July: opening 1000, closing 2400, the entry listed", lJuly && eq2(lJuly.opening.bdt, 1000) && eq2(lJuly.closing.bdt, 2400) && lJuly.rows.some((r) => r.id === julyId), JSON.stringify(lJuly && [lJuly.opening.bdt, lJuly.closing.bdt]));

console.log("  What stays on the day");
const reg = await get(`/accounts/${accountId}/register?from=${JUNE.from}&to=${JUNE.to}`);
const row = reg.rows.find((r) => r.id === julyId);
check("the register lists it on 22 June, running balance 400", row && row.txnDate === "2026-06-22" && eq2(row.runningBalance, 400), JSON.stringify(row && [row.txnDate, row.runningBalance]));

/* ------------------------------------------------------------------------ */
await q(`delete from transactions where account_id = $1`, [accountId]);
await q(`delete from accounts where id = $1`, [accountId]);

await db.end();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
