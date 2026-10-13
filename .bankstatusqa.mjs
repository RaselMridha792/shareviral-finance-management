/**
 * Accounts ▸ Bank status — piece 4 of
 * docs/briefs/2026-10-13-books-month-and-bank-status.md.
 *
 *   1. May 2026 reads the boss's sheet (the brief's table), rounding aside.
 *   2. Every month Jan–Dec 2026, every account:
 *      - Opening + IN − OUT − Fee = Closing, in taka and in dollars;
 *      - Opening less the month's revaluation is the previous month's Closing
 *        (piece 4b: an Exchange gain or loss sits in the Opening);
 *      - the revaluation is the Exchange gain less loss rows, in plain SQL;
 *      - Closing is what Accounts shows at the end of that month (asOf), and
 *        for a USD account its dollars are Accounts' own-currency balance;
 *      - IN + gain, and OUT + Fee + loss, are the Dashboard's in and out;
 *      - Fee is exactly the Bank charges rows, counted here in plain SQL.
 *   3. The totals row is the column sums.
 *   4. Check: false with nothing reconciled; Matched for a month a reconciled
 *      statement covers; not for the month beside it.
 *   5. Note: written, changed and cleared by the Super Admin, each audited;
 *      read by the CEO, refused to the CEO to write; a bad month refused.
 *   6. An archived account shows only in a month it moved money.
 *   7. Piece 4b, against the sheet: June JPMorgan opens 8,52,252 with IN 0;
 *      July Payoneer's IN is 0, its ৳525.08 in the Opening.
 *
 * Section 7 needs the boss's import on the copy (#160).
 *
 * WRITES A STATEMENT, NOTES AND AN ARCHIVED FLAG, then puts them back. Run it
 * on a copy, never on Neon or live, so BS_DB has no default:
 *
 *   BS_DB=postgres://postgres:pw@localhost:55433/sfm \
 *   BS_API=http://localhost:4095/api node .bankstatusqa.mjs
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = process.env.BS_API ?? "http://localhost:4095/api";
if (!process.env.BS_DB) {
  console.error("BS_DB is required: the connection string of a COPY of the database.");
  process.exit(2);
}

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
const db = new pg.Client({ connectionString: process.env.BS_DB });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

const tokenFor = async (role) => {
  const p = (
    await q(`select id, role, token_version from users where role=$1 and status='active' and deleted_at is null order by created_at limit 1`, [role])
  )[0];
  if (!p) throw new Error(`no active ${role} on the copy`);
  return { id: p.id, token: jwt.sign({ sub: p.id, role: p.role, tv: p.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" }) };
};
const admin = await tokenFor("super_admin");
const ceo = await tokenFor("ceo");

const callAs = async (who, method, path, body) => {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${who.token}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (path, who = admin) => {
  const r = await callAs(who, "GET", path);
  if (r.status !== 200) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
};

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail !== undefined ? ` — ${detail}` : ""}`);
};
const cents = (v) => Math.round(Number(v) * 100);
const same = (a, b, tol = 0) => Math.abs(cents(a) - cents(b)) <= tol;

const MONTHS = [];
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, "0");
  const last = new Date(Date.UTC(2026, m, 0)).getUTCDate();
  MONTHS.push({ key: `2026-${mm}`, from: `2026-${mm}-01`, to: `2026-${mm}-${last}`, fy: m <= 6 ? 2025 : 2026, index: m <= 6 ? m + 6 : m - 6 });
}
const status = {};
for (const mo of MONTHS) status[mo.key] = await get(`/accounts/bank-status?month=${mo.from}`);

/* ------------------------------------------------------------------------ */
console.log("1. May 2026 against the boss's sheet");
{
  const may = status["2026-05"];
  const byBank = (part) => may.rows.find((r) => (r.bankName ?? "").toLowerCase().includes(part));
  const expected = [
    ["jp morgan", "1708000", "854000", "4880", "849120"],
    ["bank asia", "854000", "517535.90", "120", "336344.10"],
    ["standard chartered", "0", "0", "0", "0"],
    ["payoneer", "26277.90", "26277.58", "0", "0.32"],
  ];
  for (const [bank, inn, out, fee, close] of expected) {
    const row = byBank(bank);
    check(
      `May, ${bank}: IN ${inn}, OUT ${out}, Fee ${fee}, Closing ${close}`,
      row && same(row.moneyIn.bdt, inn) && same(row.moneyOut.bdt, out) && same(row.fee.bdt, fee) && same(row.closing.bdt, close),
      row ? `${row.moneyIn.bdt} / ${row.moneyOut.bdt} / ${row.fee.bdt} / ${row.closing.bdt}` : "no row",
    );
  }
  check("May opens on 0 for every account (the books start 1 May)", may.rows.every((r) => same(r.opening.bdt, 0)));
  console.log("     USD:", may.rows.map((r) => `${r.bankName}: ${r.opening.usd} + ${r.moneyIn.usd} - ${r.moneyOut.usd} - ${r.fee.usd} = ${r.closing.usd}${r.usdExact ? "" : " (~)"}`).join("; "));
}

/* ------------------------------------------------------------------------ */
console.log("2. every month, every account, against Accounts and the Dashboard");
{
  let ties = 0, carries = 0, revals = 0, accts = 0, accUsd = 0, dash = 0, fees = 0, cells = 0;
  const bad = [];
  let prev = null;
  for (const mo of MONTHS) {
    const s = status[mo.key];
    const accounts = await get(`/accounts?includeInactive=true&asOf=${mo.to}`);
    const overview = await get(`/reports/overview?granularity=month&fiscalYear=${mo.fy}&index=${mo.index}`);
    const groups = new Map((overview.groups ?? []).map((g) => [g.key, g]));
    const feeRows = new Map(
      (
        await q(
          `select t.account_id, coalesce(sum(t.amount),0)::text as fee
             from transactions t left join categories c on c.id = t.category_id
            where t.voided_at is null and t.direction = 'out'
              and coalesce(t.books_month, date_trunc('month', t.txn_date)::date) = $1
              and (t.charge_for_id is not null or c.slug = 'bank-charges' or c.name ilike '%bank charge%'
                   or c.parent_id in (select id from categories where slug = 'bank-charges' or name ilike '%bank charge%'))
            group by 1`,
          [mo.from],
        )
      ).map((r) => [r.account_id, r.fee]),
    );
    const revalRows = new Map(
      (
        await q(
          `select t.account_id,
                  coalesce(sum(t.amount) filter (where t.direction = 'in'), 0)::text as gain,
                  coalesce(sum(t.amount) filter (where t.direction = 'out'), 0)::text as loss
             from transactions t join categories c on c.id = t.category_id
            where t.voided_at is null and c.slug in ('exchange-gain', 'exchange-loss')
              and coalesce(t.books_month, date_trunc('month', t.txn_date)::date) = $1
            group by 1`,
          [mo.from],
        )
      ).map((r) => [r.account_id, r]),
    );
    for (const r of s.rows) {
      cells++;
      const rv = revalRows.get(r.accountId) ?? { gain: "0", loss: "0" };
      if (cents(r.revaluation.bdt) === cents(rv.gain) - cents(rv.loss)) revals++;
      else bad.push(`${mo.key} ${r.name}: revaluation ${r.revaluation.bdt} vs SQL +${rv.gain} -${rv.loss}`);
      for (const cur of ["bdt", "usd"]) {
        const want = cents(r.opening[cur]) + cents(r.moneyIn[cur]) - cents(r.moneyOut[cur]) - cents(r.fee[cur]);
        if (want === cents(r.closing[cur])) ties++;
        else bad.push(`${mo.key} ${r.name} ${cur}: row does not add up`);
      }
      const before = prev?.rows.find((p) => p.accountId === r.accountId);
      if (prev) {
        const carried = (cur) => (cents(r.opening[cur]) - cents(r.revaluation[cur])) / 100;
        if (before && same(before.closing.bdt, carried("bdt")) && same(before.closing.usd, carried("usd"))) carries++;
        else if (!before && same(carried("bdt"), 0)) carries++;
        else bad.push(`${mo.key} ${r.name}: opening ${r.opening.bdt}/${r.opening.usd} less revaluation ${r.revaluation.bdt}/${r.revaluation.usd} is not last month's closing ${before?.closing.bdt}/${before?.closing.usd}`);
      } else carries++;
      const a = accounts.find((x) => x.id === r.accountId);
      if (a && same(a.balance, r.closing.bdt)) accts++;
      else bad.push(`${mo.key} ${r.name}: closing ${r.closing.bdt} vs Accounts ${a?.balance}`);
      if (r.currency === "USD") {
        if (a && same(a.ownBalance, r.closing.usd)) accUsd++;
        else bad.push(`${mo.key} ${r.name}: closing $${r.closing.usd} vs Accounts $${a?.ownBalance}`);
      } else accUsd++;
      const g = groups.get(r.accountId);
      const dashIn = (cents(r.moneyIn.bdt) + cents(rv.gain)) / 100;
      const dashOut = (cents(r.moneyOut.bdt) + cents(r.fee.bdt) + cents(rv.loss)) / 100;
      if (same(g?.moneyIn ?? 0, dashIn) && same(g?.moneyOut ?? 0, dashOut)) dash++;
      else bad.push(`${mo.key} ${r.name}: in/out ${dashIn}/${dashOut} vs Dashboard ${g?.moneyIn}/${g?.moneyOut}`);
      if (same(feeRows.get(r.accountId) ?? 0, r.fee.bdt)) fees++;
      else bad.push(`${mo.key} ${r.name}: fee ${r.fee.bdt} vs SQL ${feeRows.get(r.accountId)}`);
    }
    prev = s;
  }
  check(`Opening + IN − OUT − Fee = Closing, both currencies`, ties === cells * 2, `${ties}/${cells * 2}`);
  check(`Opening less the revaluation is the previous month's Closing, both currencies`, carries === cells, `${carries}/${cells}`);
  check(`the revaluation = Exchange gain − loss, in plain SQL`, revals === cells, `${revals}/${cells}`);
  check(`Closing = Accounts at the end of the month`, accts === cells, `${accts}/${cells}`);
  check(`a USD account's dollar Closing = Accounts' own balance`, accUsd === cells, `${accUsd}/${cells}`);
  check(`IN + gain and OUT + Fee + loss = the Dashboard's in and out`, dash === cells, `${dash}/${cells}`);
  check(`Fee = the Bank charges rows, in plain SQL`, fees === cells, `${fees}/${cells}`);
  for (const line of bad.slice(0, 12)) console.log("       " + line);
}

/* ------------------------------------------------------------------------ */
console.log("3. the totals row");
{
  let ok = true;
  for (const mo of MONTHS) {
    const s = status[mo.key];
    for (const col of ["opening", "revaluation", "moneyIn", "moneyOut", "fee", "closing"])
      for (const cur of ["bdt", "usd"])
        if (s.rows.reduce((a, r) => a + cents(r[col][cur]), 0) !== cents(s.totals[col][cur])) ok = false;
  }
  check("every total is its column's sum, every month", ok);
}

/* ------------------------------------------------------------------------ */
console.log("4. Check");
{
  check("no month is Matched with nothing reconciled", MONTHS.every((mo) => status[mo.key].reconciled === false));
  const [st] = await q(
    `insert into statements (period_start, period_end, status) values ('2026-05-01','2026-05-31','reconciled') returning id`,
  );
  try {
    check("May is Matched once May's statement is reconciled", (await get(`/accounts/bank-status?month=2026-05-01`)).reconciled === true);
    check("June is not", (await get(`/accounts/bank-status?month=2026-06-01`)).reconciled === false);
    await q(`update statements set status='draft', audited=true where id=$1`, [st.id]);
    check("an audited statement counts too", (await get(`/accounts/bank-status?month=2026-05-01`)).reconciled === true);
    await q(`update statements set audited=false where id=$1`, [st.id]);
    check("a draft does not", (await get(`/accounts/bank-status?month=2026-05-01`)).reconciled === false);
  } finally {
    await q(`delete from statements where id=$1`, [st.id]);
  }
  const [qs] = await q(
    `insert into statements (period_start, period_end, status) values ('2026-04-01','2026-06-30','reconciled') returning id`,
  );
  try {
    check("a reconciled quarter around the month counts", (await get(`/accounts/bank-status?month=2026-05-01`)).reconciled === true);
  } finally {
    await q(`delete from statements where id=$1`, [qs.id]);
  }
}

/* ------------------------------------------------------------------------ */
console.log("5. Note");
{
  const account = status["2026-05"].rows[0];
  const put = (who, note, month = "2026-05-01") =>
    callAs(who, "PUT", "/accounts/bank-status/note", { accountId: account.accountId, month, note });
  const audits = async () =>
    (await q(`select action, summary from audit_logs where entity_table='account_month_notes' order by occurred_at, id`));
  const auditBefore = (await audits()).length;

  const w = await put(admin, "  Closed in June  ");
  check("the Super Admin writes a note", w.status === 200 && w.body?.note?.text === "Closed in June", `${w.status}`);
  const read = await get(`/accounts/bank-status?month=2026-05-01`, ceo);
  const mine = read.rows.find((r) => r.accountId === account.accountId);
  check("the CEO reads it, with who wrote it", mine?.note?.text === "Closed in June" && Boolean(mine?.note?.updatedBy), JSON.stringify(mine?.note));
  check("it is May's note, not June's", (await get(`/accounts/bank-status?month=2026-06-01`)).rows.find((r) => r.accountId === account.accountId)?.note === null);
  const c = await put(admin, "Closed in June, checked");
  check("changing it", c.status === 200 && (await q(`select count(*)::int n from account_month_notes where account_id=$1`, [account.accountId]))[0].n === 1);
  const refused = await put(ceo, "nope");
  check("the CEO may not write one", refused.status === 403, `${refused.status}`);
  const badMonth = await put(admin, "x", "2026-05-02");
  check("a month that is not a 1st is refused", badMonth.status === 400, `${badMonth.status}`);
  const badRead = await callAs(admin, "GET", "/accounts/bank-status?month=2026-13-01");
  check("so is month 13 on the read", badRead.status === 400, `${badRead.status}`);
  const cl = await put(admin, "   ");
  check("empty clears it", cl.status === 200 && cl.body?.note === null && (await q(`select count(*)::int n from account_month_notes where account_id=$1`, [account.accountId]))[0].n === 0);
  const trail = (await audits()).slice(auditBefore);
  check("each change is audited: create, update, delete", trail.map((a) => a.action).join(",") === "create,update,delete", trail.map((a) => `${a.action}: ${a.summary}`).join(" | "));
}

/* ------------------------------------------------------------------------ */
console.log("6. an archived account");
{
  const may = status["2026-05"];
  const quiet = may.rows.find((r) => same(r.moneyIn.bdt, 0) && same(r.moneyOut.bdt, 0) && same(r.fee.bdt, 0));
  const busy = may.rows.find((r) => cents(r.moneyIn.bdt) > 0);
  await q(`update accounts set is_active=false where id = any($1)`, [[quiet.accountId, busy.accountId]]);
  try {
    const s = await get(`/accounts/bank-status?month=2026-05-01`);
    check("archived and quiet in May: not shown", !s.rows.some((r) => r.accountId === quiet.accountId), quiet.bankName);
    check("archived but moved money in May: shown", s.rows.some((r) => r.accountId === busy.accountId), busy.bankName);
  } finally {
    await q(`update accounts set is_active=true where id = any($1)`, [[quiet.accountId, busy.accountId]]);
  }
}

/* ------------------------------------------------------------------------ */
console.log("7. a revaluation sits in the Opening (piece 4b), against the sheet");
{
  const find = (mo, part) => status[mo].rows.find((r) => `${r.bankName ?? ""} ${r.name}`.toLowerCase().includes(part));
  const jp = find("2026-06", "jp");
  check(
    "June, JPMorgan: Opening 8,52,252 (revaluation 3,132), IN 0",
    jp && same(jp.opening.bdt, 852252) && same(jp.revaluation.bdt, 3132) && same(jp.moneyIn.bdt, 0),
    jp && `${jp.opening.bdt} (${jp.revaluation.bdt}) / ${jp.moneyIn.bdt}; USD ${jp.opening.usd} (${jp.revaluation.usd})`,
  );
  const py = find("2026-07", "payoneer");
  check(
    "July, Payoneer: IN 0, revaluation 525.08 in the Opening",
    py && same(py.moneyIn.bdt, 0) && same(py.revaluation.bdt, 525.08),
    py && `opening ${py.opening.bdt} (${py.revaluation.bdt}) / in ${py.moneyIn.bdt}; USD ${py.opening.usd} (${py.revaluation.usd})`,
  );
}

await db.end();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
