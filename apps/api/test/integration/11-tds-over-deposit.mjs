/**
 * An over-deposited month has to say so.
 *
 * `outstanding` is clamped at zero, and rightly — nobody owes negative tax.
 * But that clamp was the only thing said about the difference, so a month with
 * ৳18,700 deposited against ৳6,300 withheld read "still held ৳0" and the card
 * underneath said "everything deducted has been deposited". Both true, and the
 * wrong thing to be told: a challan with a digit too many, or filed against
 * the wrong month, is money already with the treasury that nobody is looking
 * for. The app does not calculate these figures — the accountant does — so a
 * typo saves silently unless something names it.
 *
 * Records a real challan far larger than the month's deductions, checks the
 * app reports it in both directions, and takes it back out again.
 */
import fs from "node:fs";
import pg from "pg";

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
const depositsBefore = new Set((await db.query("select id from tds_deposits")).rows.map((r) => r.id));

console.log("\nAN OVER-DEPOSITED MONTH SAYS SO\n");

const monthOf = (body, month) => (body?.months ?? []).find((m) => m.month === month);

/* -------------------------------- a month with deductions but no deposit */

const before = await api("/tds/liability?year=2026");
if (before.status !== 200) { bad("tds liability", `HTTP ${before.status}`); process.exit(1); }

const target = (before.body.months ?? []).find(
  (m) => Number(m.totalDeducted) > 0 && Number(m.deposited) === 0,
);

let challanId = null;
if (!target) {
  meh("fixture", "no month with deductions and nothing deposited against it");
} else {
  const withheld = Number(target.totalDeducted);
  // A digit too many: the mistake this exists to catch.
  const challan = (withheld * 10).toFixed(2);
  const account = ((await api("/accounts")).body ?? [])[0];

  console.log(`  ${target.label}: ৳${withheld.toFixed(2)} withheld, about to deposit ৳${challan}\n`);

  const made = await send("/tds/deposits", "POST", {
    challanNumber: "A-TEST-OVERPAY-1",
    challanDate: "2026-08-15",
    depositDate: "2026-08-15",
    amount: challan,
    periodYear: target.year,
    periodMonth: target.month,
    depositType: "vendor",
    accountId: account?.id,
    bankName: "Sonali Bank",
    notes: "Recorded by the over-deposit test",
  });

  if (made.status !== 201 && made.status !== 200) {
    bad("record the challan", `HTTP ${made.status} ${JSON.stringify(made.body)}`);
  } else {
    challanId = made.body?.id ?? null;
    ok("recorded a challan larger than the month's deductions", `৳${challan} against ৳${withheld.toFixed(2)}`);

    const after = await api("/tds/liability?year=2026");
    const row = monthOf(after.body, target.month);

    Number(row.outstanding) === 0
      ? ok("nothing is owed for that month", "still held ৳0 — which is true")
      : bad("nothing is owed", `still held ${row.outstanding}`);

    const expected = (Number(challan) - withheld).toFixed(2);
    row.overDeposited === expected
      ? ok("and the app says how much too much was deposited", `৳${row.overDeposited} beyond what was withheld`)
      : bad("the over-deposit is reported", `got ${row.overDeposited}, expected ${expected}`);

    Number(after.body.totals.overDeposited) >= Number(expected)
      ? ok("the year's total carries it too", `৳${after.body.totals.overDeposited}`)
      : bad("the year's total", `${after.body.totals.overDeposited}`);

    /* ------------- a short month and an over month do not cancel out ------ */

    const short = (after.body.months ?? []).find((m) => Number(m.outstanding) > 0);
    if (short) {
      Number(after.body.totals.outstanding) > 0 && Number(after.body.totals.overDeposited) > 0
        ? ok("a short month and an over month are both reported", `owed ৳${after.body.totals.outstanding}, over ৳${after.body.totals.overDeposited} — netting them off would hide both`)
        : bad("short and over months both reported", `owed ${after.body.totals.outstanding}, over ${after.body.totals.overDeposited}`);
    } else {
      meh("a short month alongside it", "no month is short, so the netting case is untested");
    }

    /* ----------------------------- and the download says the same thing --- */

    const xlsx = await fetch(`${API}/exports/tds/liability?year=2026`, { headers: H });
    if (xlsx.status !== 200) bad("the download", `HTTP ${xlsx.status}`);
    else {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
      const sheet = book.worksheets[0];

      let headerRow = null, column = null;
      sheet.eachRow((r, i) => {
        if (headerRow) return;
        const cells = r.values.map((v) => String(v ?? "").trim());
        const at = cells.findIndex((c) => /over-?deposited/i.test(c));
        if (at > -1) { headerRow = i; column = at; }
      });

      if (!headerRow) bad("the download carries the column", "no Over-deposited heading in the sheet");
      else {
        ok("the download carries the column", `column ${column} of the sheet`);
        let found = null;
        sheet.eachRow((r, i) => {
          if (i <= headerRow || found !== null) return;
          const label = String(r.values[1] ?? "");
          if (label.startsWith(target.label.split(" ")[0])) found = r.values[column];
        });
        found !== null && Math.abs(Number(found) - Number(expected)) < 0.005
          ? ok("and the figure in it is the same one on the screen", `${found}`)
          : bad("the figure in the download", `sheet says ${found}, screen says ${expected}`);
        typeof found === "number"
          ? ok("as a number, not text", "it can be summed in Excel")
          : meh("the cell type", `${typeof found}`);
      }
    }
  }
}

/* ------------------------------------------------------------- put it back */

if (challanId) {
  const [row] = (await db.query("select transaction_id from tds_deposits where id = $1", [challanId])).rows;
  await db.query("delete from tds_allocations where deposit_id = $1", [challanId]);
  await db.query("delete from audit_logs where entity_id = $1", [challanId]);
  await db.query("delete from tds_deposits where id = $1", [challanId]);
  if (row?.transaction_id) {
    await db.query("delete from audit_logs where entity_id = $1", [row.transaction_id]);
    await db.query("delete from transactions where id = $1", [row.transaction_id]);
  }
}

const strayTxns = (await db.query("select id from transactions")).rows
  .map((r) => r.id).filter((id) => !rowsBefore.has(id));
if (strayTxns.length) {
  await db.query("delete from audit_logs where entity_id = any($1::text[])", [strayTxns]);
  await db.query("delete from transactions where id = any($1::uuid[])", [strayTxns]);
}
const strayDeposits = (await db.query("select id from tds_deposits")).rows
  .map((r) => r.id).filter((id) => !depositsBefore.has(id));
if (strayDeposits.length) {
  await db.query("delete from tds_deposits where id = any($1::uuid[])", [strayDeposits]);
}

const back = await api("/tds/liability?year=2026");
Number(back.body?.totals?.overDeposited ?? 0) === 0
  ? ok("the books are back where they started", "nothing over-deposited any more")
  : bad("cleanup", `${back.body?.totals?.overDeposited} still over-deposited`);

await db.end();
console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
