/**
 * T6 — exports.
 *
 * The thing that actually goes wrong with a finance export is not that it
 * fails to download. It is that every figure arrives as *text*, so the
 * accountant's SUM() returns nothing and the error is invisible until somebody
 * trusts a total. So the check is cell types, not file size: money must be a
 * number, a date must be a date.
 *
 * Then: the sheet must hold the same rows the screen was showing, and HR's
 * copy must carry no pay.
 */
import fs from "node:fs";
import ExcelJS from "exceljs";

import { openDb } from "./reset.mjs";

const API = process.env.API;
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const H = (role = "SUPER_ADMIN") => ({ authorization: `Bearer ${TOK[role]}`, "x-requested-with": "finance-web" });

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

const grab = async (path, role) => {
  const r = await fetch(`${API}${path}`, { headers: H(role) });
  return { status: r.status, buf: r.status === 200 ? Buffer.from(await r.arrayBuffer()) : null };
};

/** Reads a workbook and reports what each column actually holds. */
async function inspect(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];

  /**
   * These sheets open with a title block — name, subtitle, "25 people ·
   * exported ...", a blank line — so row 1 is not the header. The header is
   * the first row carrying several text cells; reading row 1 blindly found one
   * column and type-checked nothing, which passed everything for no reason.
   */
  let headerRow = 1;
  for (let i = 1; i <= Math.min(sheet.rowCount, 12); i += 1) {
    let text = 0;
    sheet.getRow(i).eachCell((c) => { if (typeof c.value === "string" && c.value.trim()) text += 1; });
    if (text >= 3) { headerRow = i; break; }
  }

  const headers = [];
  sheet.getRow(headerRow).eachCell({ includeEmpty: true }, (c) => headers.push(String(c.value ?? "").trim()));

  const body = [];
  sheet.eachRow((row, i) => {
    if (i <= headerRow) return;
    let filled = 0;
    row.eachCell((c) => { if (c.value !== null && c.value !== undefined && c.value !== "") filled += 1; });
    if (filled) body.push(row);
  });

  /**
   * A trailing "Total" line is a summary, not a record. Counting it as data
   * made the sheet look one row longer than the screen — which is the app
   * doing the right thing and the test doing the wrong one.
   */
  const last = body[body.length - 1];
  const firstCell = last ? String(last.getCell(1).value ?? "").trim().toLowerCase() : "";
  const totalsRow = firstCell === "total" || firstCell === "totals" ? body.pop() : null;

  return { sheet, headers, body, headerRow, totalsRow, name: sheet.name };
}

/**
 * Which columns are supposed to hold a number, and which a date.
 *
 * `in$` and `out$` were suffix matches, meant for the ledger's "In" and "Out"
 * columns. They also matched **e-TIN**, so the subscriptions sheet failed for
 * carrying a 12-digit tax identifier as text — which is exactly what an e-TIN
 * is. An identifier is not money: it has leading zeros to lose, it is never
 * summed, and Excel would render 417029385512 in scientific notation the moment
 * it became a number.
 *
 * So those two are anchored now, and identifiers are excluded outright.
 */
const MONEY = /amount|balance|total|salary|gross|net|tax|deducted|deposited|paid|value|^(in|out)$/i;
const DATE = /date|on$|period|joined|from|to$/i;
/** Identifiers that look numeric and must stay text. */
const IDENTIFIER = /e-?tin|^bin$|nid|challan|routing|account number|wallet number|phone|acknowledgement|ref/i;

console.log("\nT6 — EXPORTS\n");

const runs = await fetch(`${API}/payroll/runs`, { headers: H() }).then((r) => r.json());
const runId = (runs.items ?? runs ?? [])[0]?.id;
const accounts = await fetch(`${API}/accounts`, { headers: H() }).then((r) => r.json());
const accountId = (accounts ?? [])[0]?.id;

const SHEETS = [
  ["transactions", "/exports/transactions"],
  ["accounts", "/exports/accounts"],
  ["team-members", "/exports/team-members"],
  ["tds/liability", "/exports/tds/liability?year=2026"],
  ["tds/deposits", "/exports/tds/deposits"],
  ["income-tax", "/exports/income-tax?assessmentYear=2026-2027"],
  ["reports/bank-stats", "/exports/reports/bank-stats?year=2026"],
  ["reports/funding", "/exports/reports/funding?from=2026-01-01&to=2026-12-31"],
  ...(accountId ? [["register", `/exports/register/${accountId}`]] : []),
  ...(runId ? [["payroll", `/exports/payroll/${runId}`]] : []),
  ["subscriptions", "/exports/subscriptions?includeInactive=true"],
];

for (const [name, path] of SHEETS) {
  const res = await grab(path);
  if (res.status !== 200) { bad(`${name}`, `HTTP ${res.status}`); continue; }
  if (res.buf[0] !== 0x50 || res.buf[1] !== 0x4b) { bad(`${name}`, "not a workbook"); continue; }

  const { headers, body, headerRow } = await inspect(res.buf);
  if (headers.length < 2) { bad(`${name}`, `only ${headers.length} column(s) found — header detection failed`); continue; }
  if (!body.length) { meh(`${name}`, `${headers.length} columns but no data rows to type-check`); continue; }

  const wrong = [];
  headers.forEach((header, index) => {
    const col = index + 1;
    // Look down the column for the first cell that actually holds something.
    const cell = body.map((r) => r.getCell(col)).find((c) => c.value !== null && c.value !== undefined && c.value !== "");
    if (!cell) return;

    if (IDENTIFIER.test(header)) return;

    if (MONEY.test(header) && typeof cell.value === "string" && /^[\d,.\-৳$ ]+$/.test(cell.value)) {
      wrong.push(`"${header}" holds the text "${cell.value}"`);
    }
    if (DATE.test(header) && typeof cell.value === "string" && /^\d{4}-\d{2}-\d{2}/.test(cell.value)) {
      wrong.push(`"${header}" holds the text "${cell.value}" instead of a date`);
    }
  });

  // Say how many cells were actually examined, so a green line cannot be
  // green because nothing was looked at.
  let checked = 0;
  headers.forEach((header, index) => {
    if (IDENTIFIER.test(header)) return;
    if (!MONEY.test(header) && !DATE.test(header)) return;
    const cell = body.map((r) => r.getCell(index + 1)).find((c) => c.value !== null && c.value !== undefined && c.value !== "");
    if (cell) checked += 1;
  });

  if (wrong.length) bad(`${name} cell types`, wrong.join("; "));
  else if (!checked) meh(`${name}`, `${headers.length} columns (header row ${headerRow}) but no money or date column had a value to check`);
  else ok(`${name}`, `${headers.length} columns, ${body.length} rows, ${checked} money/date columns all correctly typed`);
}

/* ---------------------------------------------------------------- */
console.log("\nThe sheet holds what the screen was holding");
{
  const filter = "?page=1&pageSize=200&direction=out";
  const onScreen = await fetch(`${API}/transactions${filter}`, { headers: H() }).then((r) => r.json());
  const shown = onScreen.total ?? (onScreen.items ?? onScreen.data ?? []).length;

  const res = await grab(`/exports/transactions${filter.replace("&pageSize=200", "")}`);
  if (res.status !== 200) bad("filtered export", `HTTP ${res.status}`);
  else {
    const { body, totalsRow } = await inspect(res.buf);
    if (!shown) meh("filtered export", "the screen had no rows to compare against");
    else if (body.length === shown) ok("filtered export", `${body.length} rows, the same ${shown} the screen showed for direction=out${totalsRow ? ", plus a Total line" : ""}`);
    else bad("filtered export", `sheet has ${body.length} rows, the screen showed ${shown}`);

    // And the unfiltered sheet must be bigger, or the filter did nothing.
    const all = await grab("/exports/transactions");
    const { body: allRows } = await inspect(all.buf);
    allRows.length > body.length
      ? ok("the filter actually filtered", `${allRows.length} rows unfiltered vs ${body.length} filtered`)
      : bad("the filter actually filtered", `${allRows.length} unfiltered vs ${body.length} filtered — the query was ignored`);
  }
}

/* ---------------------------------------------------------------- */
console.log("\nHR's copy, now that HR owns pay");
{
  const res = await grab("/exports/team-members", "HR");
  if (res.status !== 200) bad("HR team export", `HTTP ${res.status}`);
  else {
    const { headers } = await inspect(res.buf);
    ok("HR can run the team export", `${headers.length} columns`);
  }

  /**
   * The export that must still refuse.
   *
   * HR reads salaries now, so the old check — "HR's spreadsheet carries no
   * pay" — no longer describes anything. What has not changed is that HR does
   * not run the payroll or see the company's own position, and an export is
   * where a permission boundary is most often forgotten: the endpoint is
   * guarded and the download beside it quietly is not.
   */
  for (const [label, target] of [
    ["the ledger", "/exports/transactions"],
    ["the monthly report", "/exports/reports/period?granularity=month"],
  ]) {
    const denied = await grab(target, "HR");
    denied.status === 403
      ? ok(`HR cannot download ${label}`, "403")
      : bad(`HR and ${label}`, `expected 403, got ${denied.status}`);
  }
}

/* ---------------------------------------------------------------- */
/**
 * The download has to say what the screen says.
 *
 * The directory grew a Current salary column, from
 * `/team-members/compensation/current`. The export used to carry joining salary
 * only, so anybody who downloaded the team got a two-year-old figure where the
 * screen showed today's — and a file that disagrees with the screen sends
 * somebody back to the spreadsheet the app exists to replace.
 *
 * Compared against the endpoint rather than against a fixed number: a hard-coded
 * ৳50,000 would keep passing after the projection stopped being the screen's.
 *
 * The column is gated on `team.compensation.read`, and no role that can reach
 * this export currently lacks it — so the absent-column branch has nothing to
 * test against today. It is asserted where it can be: the permission is what
 * decides, not the URL.
 */
console.log("\nCurrent salary, in the file as well as on the screen");
{
  /**
   * One person with a salary, created for this check.
   *
   * The demo books carry no compensation rows, so without this the assertion
   * looked at an empty column and reported "inconclusive" — which is the same
   * output it would give if the feature were broken. Tagged `[test]` in notes,
   * which is what `reset.mjs` clears up between suites, and which is how the
   * payroll suites already do this.
   */
  const send = (path, method, body) =>
    fetch(`${API}${path}`, {
      method,
      headers: { ...H(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const GROSS = "77777.00";
  let seeded = null;

  const made = await send("/team-members", "POST", {
    fullName: "Export Salary Fixture",
    engagementType: "employee",
    designation: "Fixture",
    joinedOn: "2026-01-01",
    notes: "Created by the integration suite [test]",
  });

  if (made.ok) {
    const person = await made.json();
    const paid = await send(`/team-members/${person.id}/compensation`, "POST", {
      grossAmount: GROSS,
      effectiveFrom: "2026-01-01",
      changeReason: "Set by the integration suite",
    });
    if (paid.ok) seeded = person.id;
    else meh("seeding a salary", `HTTP ${paid.status} — the check falls back to whatever is on the books`);
  } else {
    meh("seeding a salary", `HTTP ${made.status} — the check falls back to whatever is on the books`);
  }

  const res = await grab("/exports/team-members", "HR");
  const live = await fetch(`${API}/team-members/compensation/current`, {
    headers: H("HR"),
  });

  if (res.status !== 200 || !live.ok) {
    bad("current salary in the team export", `export ${res.status}, endpoint ${live.status}`);
  } else {
    const { headers, body } = await inspect(res.buf);
    const rows = await live.json();

    const nameAt = headers.indexOf("Name");
    const payAt = headers.indexOf("Current salary");

    if (payAt < 0) {
      bad("current salary in the team export", `no "Current salary" column; got ${headers.join(", ")}`);
    } else {
      // Every figure in the sheet must be one the endpoint actually returned,
      // and it must be a number rather than text — an accountant's SUM() over
      // text cells returns nothing and says so silently.
      const expected = new Set(rows.map((r) => Number(r.grossAmount)));
      let checked = 0;
      let wrong = null;
      let asText = null;

      for (const row of body) {
        const cell = row.getCell(payAt + 1);
        if (cell.value === null || cell.value === undefined || cell.value === "") continue;
        checked += 1;
        if (typeof cell.value !== "number") {
          asText ??= `${row.getCell(nameAt + 1).value}: ${JSON.stringify(cell.value)}`;
        } else if (!expected.has(cell.value)) {
          wrong ??= `${row.getCell(nameAt + 1).value}: ${cell.value}`;
        }
      }

      if (asText) bad("current salary is a number", `text cell — ${asText}`);
      else if (wrong) bad("current salary matches the screen", `not a figure the endpoint returned — ${wrong}`);
      // The case worth failing on rather than shrugging at: the screen has
      // figures and the file does not. Reported as inconclusive it looked
      // identical to "nobody is paid yet", which is the one reading under which
      // the export being empty would be correct.
      else if (!checked && rows.length) {
        bad(
          "current salary matches the screen",
          `the endpoint returned ${rows.length} salaries and the sheet's column is empty`,
        );
      } else if (!checked) {
        meh(
          "current salary in the team export",
          "the column is there and correctly gated, but nothing on these books has pay on record",
        );
      } else if (seeded && !body.some((r) => r.getCell(payAt + 1).value === Number(GROSS))) {
        // The seeded figure specifically, not just "some number arrived". A
        // column full of other people's salaries would otherwise pass while the
        // one row this check actually controls was dropped.
        bad(
          "current salary matches the screen",
          `the seeded ${GROSS} is not in the sheet, so the column is not reading current pay`,
        );
      } else {
        ok(
          "current salary matches the screen",
          `${checked} figure(s), all numeric, all from /compensation/current${seeded ? `, including the seeded ${GROSS}` : ""}`,
        );
      }
    }
  }

  /**
   * The fixture goes with the suite.
   *
   * The runner checks after every suite that nothing was left on the books, and
   * it caught this one — a test that leaves a person behind is a test that will
   * lie to the next one. Removed by id, and only the id this script created;
   * `reset.mjs` would sweep it eventually, but "eventually" is not the same as
   * "before the next suite reads the team list".
   */
  if (seeded) {
    const db = await openDb();
    await db.query("delete from compensation_history where team_member_id = $1", [seeded]);
    await db.query("delete from audit_logs where entity_id = $1", [seeded]);
    const gone = await db.query("delete from team_members where id = $1", [seeded]);
    await db.end();
    gone.rowCount === 1
      ? ok("put the books back", "the seeded person and their salary are gone")
      : bad("put the books back", `expected to remove 1 person, removed ${gone.rowCount}`);
  }
}

/* ---------------------------------------------------------------- */
console.log("\nThe two PDFs");
for (const [name, path] of [["statement", "/exports/statement.pdf?granularity=month&fiscalYear=2026&index=2"], ["overview", "/exports/overview.pdf?granularity=month&fiscalYear=2026&index=2"]]) {
  const res = await grab(path);
  if (res.status !== 200) { bad(`${name}.pdf`, `HTTP ${res.status}`); continue; }
  const head = res.buf.subarray(0, 5).toString("latin1");
  const pages = (res.buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  head === "%PDF-"
    ? ok(`${name}.pdf`, `${(res.buf.length / 1024).toFixed(1)} KB, ${pages} page(s)`)
    : bad(`${name}.pdf`, `does not start with %PDF- (got ${JSON.stringify(head)})`);
}

console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
