/**
 * T8 — the governing rate.
 *
 * The rule, in the owner's words: the rate given when money is put in at the
 * start of a month governs that whole month. Only when no such rate exists does
 * the Settings rate apply.
 *
 * This is worth its own test because it is the one piece of FX logic that is a
 * *policy* rather than arithmetic, and getting it wrong does not throw — it
 * quietly reports a month in the wrong dollars.
 */
import fs from "node:fs";
import pg from "pg";
import { fiscalYearOf, monthIndexInFiscalYear } from "@finance/shared";

const API = process.env.API;
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const H = { "content-type": "application/json", authorization: `Bearer ${TOK.SUPER_ADMIN}`, "x-requested-with": "finance-web" };
const api = async (path, init) => {
  const r = await fetch(`${API}${path}`, { headers: H, ...init });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

console.log("\nT8 — THE GOVERNING RATE\n");

const settings = await api("/settings");
const settingsRate = settings.body?.fxFixedUsdBdt ?? null;
const mode = settings.body?.fiscalYearMode ?? "bd_july_june";
console.log(`  Settings rate: ${settingsRate ?? "(none set)"} · fiscal year mode: ${mode}`);

/**
 * A calendar month is not an index. In bd_july_june, July is index 1, so
 * asking for index 8 of fiscal 2026 is February 2027 — which has no funding
 * row, falls back to Settings, and made the app look wrong when it was the
 * question that was wrong.
 */
const period = (year, month) => ({
  fiscalYear: fiscalYearOf(`${year}-${String(month).padStart(2, "0")}-01`, mode),
  index: monthIndexInFiscalYear(month, mode),
});

const overview = (fiscalYear, index) => api(`/reports/overview?granularity=month&fiscalYear=${fiscalYear}&index=${index}&currency=USD`);

/** Which rate the app says governed a month, and where it came from. */
async function governing(label, year, index) {
  const res = await overview(year, index);
  if (res.status !== 200) { bad(`${label}`, `overview HTTP ${res.status}`); return null; }
  const rate = res.body.usdRate ?? null;
  const source = res.body.usdRateSource ?? null;
  if (rate === null) { meh(`${label}`, "the report carries no governing rate"); return null; }
  console.log(`  ${label}: rate ${rate}, source ${source}`);
  return { rate, source };
}

// What the books actually hold for funding rates, so the expectation is not
// invented here.
const funded = await db.query(`
  select to_char(txn_date, 'YYYY-MM') as month, txn_date,
         coalesce(fx_rate, usd_rate)::numeric as rate, ref_no
  from transactions
  where direction = 'in' and voided_at is null
    and (fx_rate is not null or usd_rate is not null)
  order by txn_date`);

if (!funded.rows.length) {
  meh("funding rows", "no money-in row carries a rate, so the rule cannot be exercised");
} else {
  console.log(`\n  Money-in rows carrying a rate:`);
  for (const r of funded.rows) console.log(`    ${r.month}  ${r.ref_no}  rate ${r.rate}`);

  // For each month that has one, the report must use it — not Settings.
  const byMonth = new Map();
  for (const r of funded.rows) if (!byMonth.has(r.month)) byMonth.set(r.month, r.rate);

  console.log(`\n  A month with a cash-in rate must use that rate`);
  for (const [month, rate] of byMonth) {
    const [y, m] = month.split("-").map(Number);
    const p = period(y, m);
    const got = await governing(`${month} (fy${p.fiscalYear} #${p.index})`, p.fiscalYear, p.index);
    if (!got) continue;

    Number(got.rate).toFixed(4) === Number(rate).toFixed(4)
      ? ok(`${month} uses the cash-in rate`, `${got.rate} from ${got.source}`)
      : bad(`${month} uses the cash-in rate`, `report says ${got.rate} (${got.source}), the funding row says ${rate}`);

    got.source && /fund|transaction|cash/i.test(String(got.source))
      ? ok(`${month} names the source`, String(got.source))
      : meh(`${month} names the source`, `source reads "${got.source}" — check it means the funding row`);
  }

  // A month with no funding row at all must fall back to Settings.
  console.log(`\n  A month with no cash-in must fall back to Settings`);
  const quiet = await db.query(`
    select to_char(d, 'YYYY-MM') as month, extract(year from d)::int as y, extract(month from d)::int as m
    from generate_series(date '2026-01-01', date '2026-12-01', interval '1 month') d
    where to_char(d, 'YYYY-MM') not in (
      select distinct to_char(txn_date, 'YYYY-MM') from transactions
      where direction = 'in' and voided_at is null and (fx_rate is not null or usd_rate is not null))
    order by d limit 1`);

  if (!quiet.rows.length) meh("a quiet month", "every month of 2026 has a funding row");
  else if (settingsRate === null) meh("a quiet month", "no Settings rate to fall back to");
  else {
    const q = quiet.rows[0];
    const p = period(q.y, q.m);
    const got = await governing(`${q.month} (no cash-in, fy${p.fiscalYear} #${p.index})`, p.fiscalYear, p.index);
    if (got) {
      Number(got.rate).toFixed(4) === Number(settingsRate).toFixed(4)
        ? ok(`${q.month} falls back to Settings`, `${got.rate} from ${got.source}`)
        : bad(`${q.month} falls back to Settings`, `got ${got.rate} (${got.source}), Settings says ${settingsRate}`);
    }
  }

  // And the rule must be per-month: two months with different funding rates
  // must not share one.
  if (byMonth.size >= 2) {
    const rates = [...byMonth.values()].map((r) => Number(r).toFixed(4));
    new Set(rates).size > 1
      ? ok("different months, different rates", rates.join(" vs "))
      : meh("different months, different rates", "every funding row carries the same rate, so this cannot be told apart");
  } else {
    meh("different months, different rates", `only ${byMonth.size} month has a funding rate`);
  }
}

await db.end();
console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
