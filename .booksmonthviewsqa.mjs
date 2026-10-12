/**
 * The month views read the books month — piece 3 of
 * docs/briefs/2026-10-13-books-month-and-bank-status.md.
 *
 *   1. An entry with no books month behaves exactly as before. Every books
 *      month on the copy is set aside, and the API before piece 3 (BM_OLD_API)
 *      and the API after it (BM_API) are asked the same month questions:
 *      Dashboard, Statement, Accounts as at each month end, the Expenses
 *      overview and summary, the transactions summary, the period report and
 *      bank stats, for every month of 2026. The answers must be identical.
 *      The books months are then put back.
 *   2. An entry dated 12 June with books month May counts in May on the
 *      Dashboard, Accounts, Expenses and the Statement, and not in June. The
 *      overdraft rule still judges it on 12 June. The register (the bank
 *      statement) and All transactions still list it on 12 June.
 *
 * WRITES ENTRIES AND AN ACCOUNT. Run it on a copy, never on Neon or live, so
 * BM_DB has no default:
 *
 *   BM_DB=postgres://postgres:copy@localhost:55433/sfm \
 *   BM_API=http://localhost:4093/api BM_OLD_API=http://localhost:4094/api \
 *   node .booksmonthviewsqa.mjs
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = process.env.BM_API ?? "http://localhost:4093/api";
const OLD = process.env.BM_OLD_API;
if (!process.env.BM_DB) {
  console.error("BM_DB is required: the connection string of a COPY of the database.");
  process.exit(2);
}
const MARK = "BMQA3";

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
const callAt = async (base, method, path, body) => {
  const r = await fetch(base + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const call = (method, path, body) => callAt(API, method, path, body);
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

/* The months: fiscal year July-June, so Jan-Jun 2026 are FY 2025's 7-12. */
const MONTHS = [];
for (let m = 1; m <= 10; m++) {
  const mm = String(m).padStart(2, "0");
  const last = new Date(Date.UTC(2026, m, 0)).getUTCDate();
  MONTHS.push({
    key: `2026-${mm}`,
    from: `2026-${mm}-01`,
    to: `2026-${mm}-${last}`,
    fy: m <= 6 ? 2025 : 2026,
    index: m <= 6 ? m + 6 : m - 6,
  });
}
const MAY = MONTHS[4];
const JUNE = MONTHS[5];
const periodQs = (mo) => `granularity=month&fiscalYear=${mo.fy}&index=${mo.index}`;

{
  const p = await get(`/reports/overview?${periodQs(MAY)}`);
  if (p.period.start !== MAY.from) throw new Error(`period mapping is wrong: ${p.period.start}`);
}

/* ------------------------------------------------------------------------ */
console.log("1. no books month: the same answers as before piece 3");

const questions = [];
for (const mo of MONTHS) {
  questions.push(
    `/reports/overview?${periodQs(mo)}`,
    `/reports/statement?${periodQs(mo)}`,
    `/reports/period?${periodQs(mo)}`,
    `/accounts?includeInactive=true&asOf=${mo.to}`,
    `/expenses/overview?from=${mo.from}&to=${mo.to}`,
    `/expenses/summary?from=${mo.from}&to=${mo.to}`,
    `/transactions/summary?from=${mo.from}&to=${mo.to}`,
  );
}
questions.push(
  `/reports/overview?granularity=quarter&fiscalYear=2025&index=4`,
  `/reports/statement?granularity=year&fiscalYear=2025&index=1`,
  `/reports/bank-stats?year=2026`,
);

/*
 * Anything that is a clock reading, not a figure, goes; a float `share` is
 * rounded, because the order Postgres hands back a group-by changes the last
 * digit of a JS percentage without changing any figure.
 */
const strip = (value) =>
  JSON.parse(
    JSON.stringify(value, (k, v) =>
      k === "generatedOn" || k === "generatedAt"
        ? undefined
        : typeof v === "number" && !Number.isInteger(v)
          ? Math.round(v * 1e9) / 1e9
          : v,
    ),
  );

if (!OLD) {
  check("BM_OLD_API is set (the API before piece 3, on the same copy)", false);
} else {
  const saved = await q(`select id, books_month::text as bm from transactions where books_month is not null`);
  console.log(`  (${saved.length} books months set aside on the copy)`);
  try {
    await q(`update transactions set books_month = null where books_month is not null`);
    let same = 0;
    const differ = [];
    for (const path of questions) {
      const [a, b] = await Promise.all([callAt(OLD, "GET", path), callAt(API, "GET", path)]);
      const x = JSON.stringify(strip(a.body));
      const y = JSON.stringify(strip(b.body));
      if (a.status === 200 && b.status === 200 && x === y) same++;
      else differ.push(`${path} (${a.status}/${b.status})`);
    }
    check(
      `${questions.length} month questions, old API and new: identical`,
      same === questions.length,
      differ.length ? differ.slice(0, 5).join(", ") : `${same}/${questions.length}`,
    );
  } finally {
    for (const row of saved) await q(`update transactions set books_month = $2 where id = $1`, [row.id, row.bm]);
    const [{ n }] = await q(`select count(*)::int as n from transactions where books_month is not null`);
    check("the books months are back", n === saved.length, `${n}/${saved.length}`);
  }
}

/* ------------------------------------------------------------------------ */
console.log("2. dated 12 June, books month May");

/* What every company-wide figure reads before the fixtures, to measure deltas. */
const snapshot = async () => {
  const out = {};
  for (const mo of [MAY, JUNE]) {
    const ov = await get(`/reports/overview?${periodQs(mo)}`);
    const ex = await get(`/expenses/overview?from=${mo.from}&to=${mo.to}`);
    const su = await get(`/expenses/summary?from=${mo.from}&to=${mo.to}`);
    out[mo.key] = {
      moneyIn: ov.totals.moneyIn,
      moneyOut: ov.totals.moneyOut,
      trendOut: ov.months.find((m) => m.month === Number(mo.key.slice(5)))?.moneyOut,
      expenseTotal: ex.total,
      expenseOperational: ex.operational,
      summaryTotal: su.total,
    };
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
  name: `${MARK} views`,
  type: "bank",
  bankName: `${MARK} bank`,
  currency: "BDT",
  openingBalance: "0",
  openingBalanceOn: "2026-01-01",
});
check("a fresh account, opened at 0", acct.status === 201, `${acct.status} ${msgOf(acct)}`);
const accountId = acct.body?.id;

const cashIn = await call("POST", "/transactions/cash-in", {
  txnDate: "2026-06-05",
  accountId,
  amount: "1000.00",
  usdRate: "122.00",
  description: `${MARK} cash in 5 June`,
});
check("cash in ৳1,000 on 5 June, no books month", cashIn.status === 201, `${cashIn.status} ${msgOf(cashIn)}`);

const expense = (extra) => ({
  direction: "out",
  accountId,
  amount: "600.00",
  categoryId: category.id,
  usdRate: "122.00",
  ...extra,
});
const may = await call("POST", "/transactions", expense({ txnDate: "2026-06-12", booksMonth: "2026-05-01", description: `${MARK} May books, paid 12 June` }));
check(
  "৳600 dated 12 June, books May: saved (on 12 June the account holds ৳1,000; in May it held nothing)",
  may.status === 201,
  `${may.status} ${msgOf(may)}`,
);
const early = await call("POST", "/transactions", expense({ txnDate: "2026-06-03", booksMonth: "2026-05-01", description: `${MARK} May books, paid 3 June` }));
check(
  "৳600 dated 3 June, books May: refused, judged on 3 June when the account was empty",
  early.status >= 400 && early.status < 500,
  `${early.status} ${msgOf(early).slice(0, 140)}`,
);
const plain = await call("POST", "/transactions", expense({ txnDate: "2026-06-20", amount: "100.00", description: `${MARK} plain 20 June` }));
check("৳100 dated 20 June, no books month: saved", plain.status === 201, `${plain.status} ${msgOf(plain)}`);
const mayId = may.body?.id;

console.log("  Dashboard");
const group = async (mo) => (await get(`/reports/overview?${periodQs(mo)}`)).groups.find((g) => g.key === accountId);
const gMay = await group(MAY);
const gJune = await group(JUNE);
check("May: opening 0, in 0, out 600, closing -600", gMay && eq2(gMay.opening, 0) && eq2(gMay.moneyIn, 0) && eq2(gMay.moneyOut, 600) && eq2(gMay.closing, -600), JSON.stringify(gMay && [gMay.opening, gMay.moneyIn, gMay.moneyOut, gMay.closing]));
check("June: opening -600, in 1000, out 100, closing 300", gJune && eq2(gJune.opening, -600) && eq2(gJune.moneyIn, 1000) && eq2(gJune.moneyOut, 100) && eq2(gJune.closing, 300), JSON.stringify(gJune && [gJune.opening, gJune.moneyIn, gJune.moneyOut, gJune.closing]));

const after = await snapshot();
const delta = (mo, field) => Number(after[mo.key][field]) - Number(before[mo.key][field]);
check("money out: May +600, June +100", eq2(delta(MAY, "moneyOut"), 600) && eq2(delta(JUNE, "moneyOut"), 100), `${delta(MAY, "moneyOut")} / ${delta(JUNE, "moneyOut")}`);
check("money in: May +0, June +1000", eq2(delta(MAY, "moneyIn"), 0) && eq2(delta(JUNE, "moneyIn"), 1000), `${delta(MAY, "moneyIn")} / ${delta(JUNE, "moneyIn")}`);
check("the twelve-month trend: May out +600, June out +100", eq2(delta(MAY, "trendOut"), 600) && eq2(delta(JUNE, "trendOut"), 100), `${delta(MAY, "trendOut")} / ${delta(JUNE, "trendOut")}`);

console.log("  Accounts");
const held = async (asOf) => (await get(`/accounts?includeInactive=true&asOf=${asOf}`)).find((a) => a.id === accountId)?.balance;
const heldMay = await held("2026-05-31");
const heldJune = await held("2026-06-30");
const held4 = await held("2026-06-04");
const heldApr = await held("2026-04-30");
check("as at the end of May: -600", eq2(heldMay, -600), heldMay);
check("as at the end of June: 300", eq2(heldJune, 300), heldJune);
check("as at 4 June: -600 (May's entry counted, 5 June's cash not yet)", eq2(held4, -600), held4);
check("as at the end of April: 0", eq2(heldApr, 0), heldApr);
const now = (await get(`/accounts?includeInactive=true`)).find((a) => a.id === accountId)?.balance;
check("today: 300", eq2(now, 300), now);

console.log("  Expenses");
check("overview total: May +600, June +100", eq2(delta(MAY, "expenseTotal"), 600) && eq2(delta(JUNE, "expenseTotal"), 100), `${delta(MAY, "expenseTotal")} / ${delta(JUNE, "expenseTotal")}`);
check("operational slice: May +600, June +100", eq2(delta(MAY, "expenseOperational"), 600) && eq2(delta(JUNE, "expenseOperational"), 100));
check("summary (the category grid): May +600, June +100", eq2(delta(MAY, "summaryTotal"), 600) && eq2(delta(JUNE, "summaryTotal"), 100), `${delta(MAY, "summaryTotal")} / ${delta(JUNE, "summaryTotal")}`);
const listHas = async (mo, flag) => {
  const r = await get(`/transactions?from=${mo.from}&to=${mo.to}&accountId=${accountId}&pageSize=200${flag ? "&byBooksMonth=true" : ""}`);
  return r.items.some((t) => t.id === mayId);
};
check("a category page's rows (byBooksMonth): in May, not in June", (await listHas(MAY, true)) && !(await listHas(JUNE, true)));
check("All transactions (the date filter): in June, not in May", (await listHas(JUNE, false)) && !(await listHas(MAY, false)));
const catMay = await get(`/expenses/summary?from=${MAY.from}&to=${MAY.to}&categorySlug=${category.slug}`);
const catRowsMay = await get(`/transactions?from=${MAY.from}&to=${MAY.to}&direction=out&categorySlug=${category.slug}&byBooksMonth=true&pageSize=200`);
const rowsSum = catRowsMay.items.filter((t) => !t.voidedAt).reduce((s, t) => s + Number(t.amount), 0);
check("a category page for May: its box equals its rows, ours among them", eq2(catMay.total, rowsSum) && rowsSum >= 600 && catRowsMay.items.some((t) => t.id === mayId), `${catMay.total} vs ${rowsSum.toFixed(2)}`);

console.log("  Statement (Reports)");
const ledger = async (mo) => (await get(`/reports/statement?${periodQs(mo)}`)).ledgers.find((l) => l.accountId === accountId);
const lMay = await ledger(MAY);
const lJune = await ledger(JUNE);
check("May: opening 0, closing -600, the entry listed", lMay && eq2(lMay.opening.bdt, 0) && eq2(lMay.closing.bdt, -600) && lMay.rows.some((r) => r.id === mayId), JSON.stringify(lMay && [lMay.opening.bdt, lMay.closing.bdt]));
check("June: opening -600, closing 300, the entry not listed", lJune && eq2(lJune.opening.bdt, -600) && eq2(lJune.closing.bdt, 300) && !lJune.rows.some((r) => r.id === mayId), JSON.stringify(lJune && [lJune.opening.bdt, lJune.closing.bdt]));

console.log("  What stays on the day");
const regJune = await get(`/accounts/${accountId}/register?from=${JUNE.from}&to=${JUNE.to}`);
const regMay = await get(`/accounts/${accountId}/register?from=${MAY.from}&to=${MAY.to}`);
const row = regJune.rows.find((r) => r.id === mayId);
check("the bank statement (register) lists it in June, on 12 June", row && row.txnDate === "2026-06-12", row?.txnDate);
check("  with the running balance of that day: 400", row && eq2(row.runningBalance, 400), row?.runningBalance);
check("  June opens at 0 and closes at 300; May has no rows", eq2(regJune.openingBalance, 0) && eq2(regJune.closingBalance, 300) && regMay.rows.length === 0);

/* ------------------------------------------------------------------------ */
// Clean up our own fixtures: the copy is thrown away, but the next run should
// not find a second account with the same name.
await q(`delete from transactions where account_id = $1`, [accountId]);
await q(`delete from accounts where id = $1`, [accountId]);

await db.end();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
