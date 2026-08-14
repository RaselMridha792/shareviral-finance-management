/**
 * T9 — PERIODS
 *
 * The unit tests prove the arithmetic. This proves the app obeys the setting:
 * flip the financial year between the BD income year and the calendar year and
 * every period-aware surface has to move with it.
 *
 * The substance is the boundary. Two ledger rows are placed one day apart, on
 * 30 June and 1 July. In BD mode they belong to different financial years; in
 * calendar mode they belong to the same one. Every figure is asserted as a
 * *delta* against a baseline read before the rows existed, so no assertion can
 * pass by comparing one absent number to another.
 *
 * Restores the setting and deletes its own rows before exiting.
 */
import fs from "node:fs";
import pg from "pg";

const API = process.env.API;
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const H = { "content-type": "application/json", authorization: `Bearer ${TOK.SUPER_ADMIN}`, "x-requested-with": "finance-web" };
const api = async (p, init) => {
  const r = await fetch(`${API}${p}`, { headers: H, ...init });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const send = (p, m, b) => api(p, { method: m, body: JSON.stringify(b ?? {}) });

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const rowsBefore = new Set((await db.query("select id from transactions")).rows.map((r) => r.id));
const [{ fiscal_year_mode: originalMode }] = (await db.query("select fiscal_year_mode from app_settings where id = 1")).rows;

const setMode = async (mode) => {
  const r = await send("/settings", "PATCH", { fiscalYearMode: mode });
  if (r.status !== 200) throw new Error(`could not set mode: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  const [{ fiscal_year_mode: got }] = (await db.query("select fiscal_year_mode from app_settings where id = 1")).rows;
  if (got !== mode) throw new Error(`asked for ${mode}, database says ${got}`);
};

/** One period report, with its figures proven present rather than assumed. */
const read = async (q) => {
  const r = await api(`/reports/period?${q}`);
  if (r.status !== 200) throw new Error(`/reports/period?${q} → HTTP ${r.status} ${JSON.stringify(r.body)}`);
  const b = r.body;
  const moneyIn = Number(b.moneyIn);
  if (!Number.isFinite(moneyIn)) throw new Error(`no usable moneyIn in ${JSON.stringify(Object.keys(b))}`);
  return { moneyIn, start: b.start, end: b.end, label: b.label, entries: b.entries };
};

console.log(`\nT9 — PERIODS   (starting mode: ${originalMode})\n`);

/* ------------------------------------------------------------- baselines */

const Q = {
  bdQ4of2025: "granularity=quarter&fiscalYear=2025&index=4", // Apr–Jun 2026
  bdQ1of2026: "granularity=quarter&fiscalYear=2026&index=1", // Jul–Sep 2026
  bdY2025: "granularity=year&fiscalYear=2025",
  bdY2026: "granularity=year&fiscalYear=2026",
  calQ2: "granularity=quarter&fiscalYear=2026&index=2",      // Apr–Jun 2026
  calQ3: "granularity=quarter&fiscalYear=2026&index=3",      // Jul–Sep 2026
  calY2026: "granularity=year&fiscalYear=2026",
  bdMonth1: "granularity=month&fiscalYear=2026&index=1",
  calMonth1: "granularity=month&fiscalYear=2026&index=1",
};

await setMode("bd_july_june");
const base = {
  bdQ4of2025: await read(Q.bdQ4of2025), bdQ1of2026: await read(Q.bdQ1of2026),
  bdY2025: await read(Q.bdY2025), bdY2026: await read(Q.bdY2026),
  bdMonth1: await read(Q.bdMonth1),
};
await setMode("calendar");
Object.assign(base, {
  calQ2: await read(Q.calQ2), calQ3: await read(Q.calQ3),
  calY2026: await read(Q.calY2026), calMonth1: await read(Q.calMonth1),
});

/* -------------------------------------------------- the two boundary rows */

const account = ((await api("/accounts")).body ?? [])[0];
const cats = (await api("/categories")).body ?? [];
const inCat = (cats.items ?? cats).find((c) => (c.kind === "in" || c.kind === "both") && c.parentId);
if (!account || !inCat) throw new Error("no account or no money-in sub-category to test with");

const made = [];
const place = async (date, amount, why) => {
  const r = await send("/transactions", "POST", {
    accountId: account.id, direction: "in", txnDate: date, amount: amount.toFixed(2),
    categoryId: inCat.id, description: why, paymentMethod: "bank_transfer",
  });
  if (r.status !== 201 && r.status !== 200) throw new Error(`could not place ${date}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  made.push(r.body.id);
};

const JUNE = 111, JULY = 222;
await place("2026-06-30", JUNE, "T9 — last day of the BD income year");
await place("2026-07-01", JULY, "T9 — first day of the BD income year");
ok("placed two rows one day apart across 30 June / 1 July", `৳${JUNE} and ৳${JULY}`);

/* ------------------------------------------------------ BD: July → June */

await setMode("bd_july_june");
const bd = {
  bdQ4of2025: await read(Q.bdQ4of2025), bdQ1of2026: await read(Q.bdQ1of2026),
  bdY2025: await read(Q.bdY2025), bdY2026: await read(Q.bdY2026),
  bdMonth1: await read(Q.bdMonth1),
};
const rose = (k, by, src = bd) => Math.abs((src[k].moneyIn - base[k].moneyIn) - by) < 0.005;

bd.bdMonth1.start === "2026-07-01" && bd.bdMonth1.end === "2026-07-31"
  ? ok("BD mode: month 1 is July", `${bd.bdMonth1.start} → ${bd.bdMonth1.end} "${bd.bdMonth1.label}"`)
  : bad("BD mode: month 1 is July", `got ${bd.bdMonth1.start} → ${bd.bdMonth1.end}`);

bd.bdY2026.start === "2026-07-01" && bd.bdY2026.end === "2027-06-30"
  ? ok("BD mode: FY2026 runs 1 Jul 2026 → 30 Jun 2027", `"${bd.bdY2026.label}"`)
  : bad("BD mode: FY2026 range", `got ${bd.bdY2026.start} → ${bd.bdY2026.end}`);

bd.bdY2025.end === "2026-06-30"
  ? ok("BD mode: FY2025 ends 30 June 2026", `${bd.bdY2025.start} → ${bd.bdY2025.end}`)
  : bad("BD mode: FY2025 ends 30 June 2026", `got ${bd.bdY2025.end}`);

rose("bdQ4of2025", JUNE)
  ? ok("BD: the 30 June row lands in Q4 of FY2025", `Apr–Jun rose by exactly ৳${JUNE} (${base.bdQ4of2025.moneyIn} → ${bd.bdQ4of2025.moneyIn})`)
  : bad("BD: the 30 June row lands in Q4 of FY2025", `rose by ${(bd.bdQ4of2025.moneyIn - base.bdQ4of2025.moneyIn).toFixed(2)}, wanted ${JUNE}`);

rose("bdQ1of2026", JULY)
  ? ok("BD: the 1 July row lands in Q1 of FY2026", `Jul–Sep rose by exactly ৳${JULY} (${base.bdQ1of2026.moneyIn} → ${bd.bdQ1of2026.moneyIn})`)
  : bad("BD: the 1 July row lands in Q1 of FY2026", `rose by ${(bd.bdQ1of2026.moneyIn - base.bdQ1of2026.moneyIn).toFixed(2)}, wanted ${JULY}`);

rose("bdY2025", JUNE) && rose("bdY2026", JULY)
  ? ok("BD: one day apart puts them in different financial years", `FY2025 +${JUNE}, FY2026 +${JULY}`)
  : bad("BD: different financial years", `FY2025 +${(bd.bdY2025.moneyIn - base.bdY2025.moneyIn).toFixed(2)}, FY2026 +${(bd.bdY2026.moneyIn - base.bdY2026.moneyIn).toFixed(2)}`);

rose("bdMonth1", JULY)
  ? ok("BD: July's month report holds the 1 July row and not the 30 June one", `+৳${JULY}`)
  : bad("BD: July's month report", `rose by ${(bd.bdMonth1.moneyIn - base.bdMonth1.moneyIn).toFixed(2)}`);

/* ------------------------------------------------- calendar: Jan → Dec */

await setMode("calendar");
const cal = {
  calQ2: await read(Q.calQ2), calQ3: await read(Q.calQ3),
  calY2026: await read(Q.calY2026), calMonth1: await read(Q.calMonth1),
};

cal.calMonth1.start === "2026-01-01" && cal.calMonth1.end === "2026-01-31"
  ? ok("calendar mode: month 1 is January, not July", `${cal.calMonth1.start} → ${cal.calMonth1.end} "${cal.calMonth1.label}"`)
  : bad("calendar mode: month 1 is January", `got ${cal.calMonth1.start} → ${cal.calMonth1.end}`);

cal.calY2026.start === "2026-01-01" && cal.calY2026.end === "2026-12-31"
  ? ok("calendar mode: 2026 runs Jan → Dec", `"${cal.calY2026.label}"`)
  : bad("calendar mode: 2026 range", `got ${cal.calY2026.start} → ${cal.calY2026.end}`);

cal.calQ2.start === "2026-04-01" && cal.calQ2.end === "2026-06-30"
  ? ok("calendar mode: Q2 is Apr–Jun", `"${cal.calQ2.label}"`)
  : bad("calendar mode: Q2 is Apr–Jun", `got ${cal.calQ2.start} → ${cal.calQ2.end}`);

// The heart of it: the same two rows, one year here, two years there.
rose("calY2026", JUNE + JULY, cal)
  ? ok("calendar: both rows fall in the same year", `2026 rose by ৳${JUNE + JULY} — the BD year end is not a boundary here`)
  : bad("calendar: both rows in one year", `rose by ${(cal.calY2026.moneyIn - base.calY2026.moneyIn).toFixed(2)}, wanted ${JUNE + JULY}`);

rose("calQ2", JUNE, cal) && rose("calQ3", JULY, cal)
  ? ok("calendar: the quarters still separate them correctly", `Q2 +${JUNE}, Q3 +${JULY}`)
  : bad("calendar quarters", `Q2 +${(cal.calQ2.moneyIn - base.calQ2.moneyIn).toFixed(2)}, Q3 +${(cal.calQ3.moneyIn - base.calQ3.moneyIn).toFixed(2)}`);

// Same dates, different mode, same money — a date range cannot depend on labels.
Math.abs(cal.calQ2.moneyIn - bd.bdQ4of2025.moneyIn) < 0.005 &&
Math.abs(cal.calQ3.moneyIn - bd.bdQ1of2026.moneyIn) < 0.005
  ? ok("identical date ranges report identical money in either mode", `Apr–Jun ${cal.calQ2.moneyIn} both ways, Jul–Sep ${cal.calQ3.moneyIn} both ways`)
  : bad("identical date ranges, identical money", `${cal.calQ2.moneyIn} vs ${bd.bdQ4of2025.moneyIn}, ${cal.calQ3.moneyIn} vs ${bd.bdQ1of2026.moneyIn}`);

/* ----------------------------------------- the picker follows the setting */

const pickerOf = async () => {
  const r = await api("/reports/periods?granularity=month");
  if (r.status !== 200) throw new Error(`/reports/periods → HTTP ${r.status}`);
  const list = r.body?.periods ?? [];
  if (list.length !== 12) throw new Error(`expected 12 months, got ${list.length}`);
  return { mode: r.body.fiscalYearMode, labels: list.map((p) => p.label), first: list[0], years: r.body.years };
};

const calPicker = await pickerOf();
await setMode("bd_july_june");
const bdPicker = await pickerOf();

bdPicker.first.label.startsWith("July") && bdPicker.first.start === "2026-07-01"
  ? ok("the picker starts the year at July in BD mode", `"${bdPicker.first.label}" → "${bdPicker.labels[11]}"`)
  : bad("the picker starts at July in BD mode", `first is "${bdPicker.first.label}"`);

calPicker.first.label.startsWith("January") && calPicker.first.start === "2026-01-01"
  ? ok("the picker starts the year at January in calendar mode", `"${calPicker.first.label}" → "${calPicker.labels[11]}"`)
  : bad("the picker starts at January in calendar mode", `first is "${calPicker.first.label}"`);

bdPicker.mode === "bd_july_june" && calPicker.mode === "calendar"
  ? ok("the picker states which mode it was built for", "the UI never has to guess")
  : bad("the picker states its mode", `${bdPicker.mode} / ${calPicker.mode}`);

/* ------------------------------------------ the statement moves with it too */

const stmtRange = async () => {
  const r = await api("/reports/statement?granularity=month&fiscalYear=2026&index=1");
  if (r.status !== 200) throw new Error(`/reports/statement → HTTP ${r.status} ${JSON.stringify(r.body)}`);
  const p = r.body.range ?? r.body.period ?? r.body;
  return `${p.start} → ${p.end}`;
};
const stmtBd = await stmtRange();
await setMode("calendar");
const stmtCal = await stmtRange();

stmtBd === "2026-07-01 → 2026-07-31" && stmtCal === "2026-01-01 → 2026-01-31"
  ? ok("the financial statement follows the setting too", `BD ${stmtBd} vs calendar ${stmtCal}`)
  : bad("the statement follows the setting", `BD ${stmtBd}, calendar ${stmtCal}`);

/* ------------------------------ a period that does not exist is now refused */

await setMode("bd_july_june");
const cases = [
  ["quarter", 9, "there is no quarter 9"],
  ["half", 3, "2 halves"],
  ["year", 2, "must be 1"],
];
for (const [granularity, index, wanted] of cases) {
  const r = await api(`/reports/period?granularity=${granularity}&index=${index}`);
  // The reason is per field, under `errors`; `message` is only the envelope.
  const said = (r.body?.errors?.index ?? []).join(" | ");
  r.status === 400 && said.includes(wanted)
    ? ok(`${granularity} ${index} is refused, and says why`, `"${said}"`)
    : bad(`${granularity} ${index} is refused with a reason`, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
}
const monthNine = await api("/reports/period?granularity=month&index=9");
monthNine.status === 200
  ? ok("month 9 is still perfectly valid", `"${monthNine.body.label}" — the rule is per granularity, not a blanket cap`)
  : bad("month 9 is still valid", `HTTP ${monthNine.status}`);

const stmtNine = await api("/reports/statement?granularity=quarter&index=9");
stmtNine.status === 400
  ? ok("the statement refuses it as well", "the rule is shared, not copied into one endpoint")
  : bad("the statement refuses it", `HTTP ${stmtNine.status}`);

const overviewNine = await api("/reports/overview?granularity=half&index=7");
overviewNine.status === 400
  ? ok("the dashboard refuses it as well", "all three period endpoints agree")
  : bad("the dashboard refuses it", `HTTP ${overviewNine.status}`);

/* ------------------------------------------------------- restore and clean */

await setMode(originalMode);
const [{ fiscal_year_mode: nowMode }] = (await db.query("select fiscal_year_mode from app_settings where id = 1")).rows;
nowMode === originalMode ? ok("the setting is back where it started", nowMode) : bad("restore the setting", `wanted ${originalMode}, is ${nowMode}`);

const mine = (await db.query("select id from transactions")).rows.map((r) => r.id).filter((id) => !rowsBefore.has(id));
if (mine.length) {
  await db.query("delete from audit_logs where entity_id = any($1::text[])", [mine]);
  const gone = await db.query("delete from transactions where id = any($1::uuid[])", [mine]);
  gone.rowCount === made.length
    ? ok("removed only what this script made", `${gone.rowCount} row(s)`)
    : meh("cleanup", `made ${made.length}, deleted ${gone.rowCount}`);
}
const after = (await db.query("select count(*)::int n from transactions")).rows[0].n;
after === rowsBefore.size ? ok("transaction count back to baseline", `${after}`) : bad("transaction count", `was ${rowsBefore.size}, now ${after}`);

await db.end();
console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
