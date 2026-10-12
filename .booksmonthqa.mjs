/**
 * The month an entry belongs to — piece 2 of
 * docs/briefs/2026-10-13-books-month-and-bank-status.md, writing it.
 *
 *   A. a new entry: a books month earlier than the date's is stored, the date's
 *      own month is stored as null, a later one is refused with the brief's
 *      sentence, a day other than the 1st is refused; its bank charge takes
 *      the entry's books month.
 *   B. an edit: null puts it back (charge too); a new month moves the charge
 *      with it though the body never mentions the charge; a date moved before
 *      the books month is refused.
 *   C. Cash In, a transfer (both halves and the charge share it), a transfer
 *      corrected without one (all three back to the date's month), the
 *      transfers list carrying it, and a subscription renewal.
 *   D. closed books: an entry dated in an open month may not join a closed
 *      books month, nor be moved out of one.
 *   E. payroll: a September run paid on 5 October is September's, without
 *      being asked.
 *   F. the Excel export has a "Books month" column, filled on every row.
 *
 * WRITES ENTRIES AND A PAYROLL RUN, and uses up reference numbers. Run it on a
 * copy of the database, never on Neon or live — so BM_DB is required and there
 * is no default:
 *
 *   BM_DB=postgres://postgres:copy@localhost:55432/sfm \
 *   BM_API=http://localhost:4091/api node .booksmonthqa.mjs
 *
 * with the built API running against that same copy on BM_API.
 */
import fs from "node:fs";
import ExcelJS from "exceljs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = process.env.BM_API ?? "http://localhost:4091/api";
if (!process.env.BM_DB) {
  console.error("BM_DB is required: the connection string of a COPY of the database.");
  process.exit(2);
}
const MARK = "BMQA";

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
const msgOf = (r) => String(r.body?.message ?? "") + " " + Object.values(r.body?.errors ?? {}).flat().join(" ");

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const months = async (id) =>
  (await q(`select books_month::text as bm from transactions where id=$1`, [id]))[0]?.bm ?? null;
const chargeMonth = async (parentId) => {
  const [row] = await q(`select books_month::text as bm from transactions where charge_for_id=$1 and deleted_at is null and voided_at is null`, [parentId]);
  return row ? row.bm : "(no charge)";
};

const [account] = await q(`select id from accounts where currency='BDT' and deleted_at is null order by name limit 1`);
const [outCategory] = await q(
  `select c.id from categories c where c.kind='out' and c.deleted_at is null and c.parent_id is not null and c.slug <> 'bank-charges' order by c.name limit 1`,
);
const LATER = "An entry cannot belong to a month after the one it is dated in.";
const expense = (extra) => ({
  direction: "out",
  txnDate: "2026-06-12",
  accountId: account.id,
  amount: "100.00",
  categoryId: outCategory.id,
  description: `${MARK} expense`,
  usdRate: "122.00",
  ...extra,
});

// Money in first, dated before every entry below, so the never-below-zero
// rule judges nothing but the books month. A copy: nothing real moves.
await call("POST", "/transactions/cash-in", {
  txnDate: "2026-03-01",
  accountId: account.id,
  amount: "100000.00",
  usdRate: "122.00",
  description: `${MARK} opening funds`,
});

console.log("A. a new entry");
const a = await call("POST", "/transactions", expense({ booksMonth: "2026-05-01", chargeAmount: "5.00" }));
check("dated 12 June, books May: saved", a.status === 201, `${a.status} ${msgOf(a)}`);
check("  stored as 2026-05-01", (await months(a.body?.id)) === "2026-05-01");
check("  the DTO carries it", a.body?.booksMonth === "2026-05-01", a.body?.booksMonth);
check("  its bank charge is May's too", (await chargeMonth(a.body?.id)) === "2026-05-01");
const own = await call("POST", "/transactions", expense({ booksMonth: "2026-06-01" }));
check("the date's own month is stored as null", own.status === 201 && (await months(own.body?.id)) === null);
const none = await call("POST", "/transactions", expense({ chargeAmount: "3.00" }));
check("no books month: null, and so is its charge", (await months(none.body?.id)) === null && (await chargeMonth(none.body?.id)) === null);
const later = await call("POST", "/transactions", expense({ booksMonth: "2026-07-01" }));
check("a later month is refused with the brief's sentence", later.status === 400 && msgOf(later).includes(LATER), `${later.status} ${msgOf(later)}`);
const notFirst = await call("POST", "/transactions", expense({ booksMonth: "2026-05-02" }));
check("a day other than the 1st is refused", notFirst.status === 400, `${notFirst.status} ${msgOf(notFirst)}`);

console.log("B. an edit");
let e = await call("PATCH", `/transactions/${a.body.id}`, { booksMonth: null });
check("null puts it back in the date's month", e.status === 200 && (await months(a.body.id)) === null, `${e.status} ${msgOf(e)}`);
check("  and the charge with it", (await chargeMonth(a.body.id)) === null);
e = await call("PATCH", `/transactions/${a.body.id}`, { booksMonth: "2026-04-01", notes: "moved" });
check("a new month, the charge not mentioned", e.status === 200 && (await months(a.body.id)) === "2026-04-01", `${e.status} ${msgOf(e)}`);
check("  the charge follows anyway", (await chargeMonth(a.body.id)) === "2026-04-01");
e = await call("PATCH", `/transactions/${a.body.id}`, { notes: "untouched month" });
check("an edit that says nothing keeps it", e.status === 200 && (await months(a.body.id)) === "2026-04-01");
e = await call("PATCH", `/transactions/${a.body.id}`, { txnDate: "2026-03-10" });
check("a date moved before its books month is refused", e.status === 400 && msgOf(e).includes(LATER), `${e.status} ${msgOf(e)}`);
e = await call("PATCH", `/transactions/${a.body.id}`, { txnDate: "2026-04-20" });
check("a date moved into its books month leaves nothing stored", e.status === 200 && (await months(a.body.id)) === null, `${e.status} ${msgOf(e)}`);

console.log("C. Cash In, a transfer, a renewal");
const cash = await call("POST", "/transactions/cash-in", {
  txnDate: "2026-06-09",
  booksMonth: "2026-05-01",
  accountId: account.id,
  amount: "1000.00",
  usdRate: "122.00",
  description: `${MARK} funding`,
  chargeAmount: "10.00",
});
check("cash-in, 9 June for May", cash.status === 201 && (await months(cash.body?.id)) === "2026-05-01", `${cash.status} ${msgOf(cash)}`);
check("  its charge is May's", (await chargeMonth(cash.body?.id)) === "2026-05-01");

const [other] = await q(`select id from accounts where currency='BDT' and deleted_at is null and id <> $1 order by name limit 1`, [account.id]);
const tr = await call("POST", "/transactions/transfer", {
  txnDate: "2026-06-11",
  booksMonth: "2026-05-01",
  fromAccountId: account.id,
  toAccountId: other.id,
  amount: "200.00",
  usdRate: "122.00",
  description: `${MARK} transfer`,
  chargeAmount: "2.00",
});
const halves = tr.body?.transferGroupId
  ? await q(`select books_month::text as bm from transactions where transfer_group_id=$1`, [tr.body.transferGroupId])
  : [];
check("a transfer: both halves May", tr.status === 201 && halves.length === 2 && halves.every((h) => h.bm === "2026-05-01"), `${tr.status} ${msgOf(tr)} ${JSON.stringify(halves)}`);
check("  and its charge", (await chargeMonth(tr.body?.id)) === "2026-05-01");
const list = await call("GET", "/transactions/transfers?page=1&pageSize=50");
const listed = list.body?.items?.find((row) => row.outId === tr.body?.id);
check("  the transfers list carries it", listed?.booksMonth === "2026-05-01", listed?.booksMonth);
const trEdit = await call("PATCH", `/transactions/transfer/${tr.body.id}`, {
  txnDate: "2026-06-11",
  amount: "200.00",
  usdRate: "122.00",
  chargeAmount: "2.00",
  description: `${MARK} transfer`,
  paymentMethod: "bank_transfer",
});
const after = await q(`select books_month::text as bm from transactions where transfer_group_id=$1`, [tr.body.transferGroupId]);
check("a correction without one: both halves back to the date's month", trEdit.status === 200 && after.every((h) => h.bm === null), `${trEdit.status} ${msgOf(trEdit)}`);
check("  and the charge", (await chargeMonth(tr.body.id)) === null);

const [plan] = await q(`select id from subscriptions where deleted_at is null and account_id is not null order by created_at limit 1`);
// Funded first, so the card holds it: a copy, so nothing real moves.
const [card] = await q(`select account_id from subscriptions where id=$1`, [plan.id]);
await call("POST", "/transactions/cash-in", {
  txnDate: "2026-09-01",
  accountId: card.account_id,
  amount: "100000.00",
  usdRate: "122.00",
  usdSent: "819.67",
  description: `${MARK} card funding`,
});
const renew = await call("POST", `/subscriptions/${plan.id}/pay`, {
  txnDate: "2026-09-25",
  booksMonth: "2026-08-01",
  usdAmount: "1.00",
  usdRate: "122.00",
  note: MARK,
  advanceRenewal: false,
});
check("a renewal charged 25 Sep for August", renew.status === 201 && (await months(renew.body?.id)) === "2026-08-01", `${renew.status} ${msgOf(renew)}`);

console.log("D. closed books");
await q(`update app_settings set books_locked_through='2026-05-31'`);
const closed = await call("POST", "/transactions", expense({ booksMonth: "2026-05-01" }));
check("dated in open June, books in closed May: refused", closed.status === 403, `${closed.status} ${msgOf(closed)}`);
const open = await call("POST", "/transactions", expense({}));
check("the same entry in June's books: saved", open.status === 201, `${open.status} ${msgOf(open)}`);
const moveIn = await call("PATCH", `/transactions/${open.body.id}`, { booksMonth: "2026-05-01" });
check("moved INTO closed May: refused", moveIn.status === 403, `${moveIn.status}`);
await q(`update app_settings set books_locked_through=null`);
await call("PATCH", `/transactions/${open.body.id}`, { booksMonth: "2026-05-01" });
await q(`update app_settings set books_locked_through='2026-05-31'`);
const moveOut = await call("PATCH", `/transactions/${open.body.id}`, { booksMonth: null });
check("moved OUT of closed May: refused", moveOut.status === 403, `${moveOut.status}`);
await q(`update app_settings set books_locked_through=null`);

console.log("E. payroll");
const [payer] = await q(`select id from accounts where currency='BDT' and deleted_at is null order by name limit 1`);
await call("POST", "/transactions/cash-in", {
  txnDate: "2026-10-01",
  accountId: payer.id,
  amount: "5000000.00",
  usdRate: "122.00",
  description: `${MARK} payroll funding`,
});
const run = await call("POST", "/payroll/runs", { periodYear: 2026, periodMonth: 9 });
check("a September run", run.status === 201, `${run.status} ${msgOf(run)}`);
const runId = run.body?.run?.id ?? run.body?.id;
const gen = await call("POST", `/payroll/runs/${runId}/generate-lines`, {});
const fin = await call("POST", `/payroll/runs/${runId}/finalize`, {});
check("  lines generated and finalised", gen.status < 300 && fin.status < 300, `${gen.status} ${msgOf(gen)} / ${fin.status} ${msgOf(fin)}`);
const paid = await call("POST", `/payroll/runs/${runId}/pay`, {
  paymentDate: "2026-10-05",
  accountId: payer.id,
  paymentMode: "individual",
  usdRate: "122.00",
});
const salaryRows = await q(`select books_month::text as bm from transactions where payroll_run_id=$1`, [runId]);
check(
  "paid 5 October: every salary row is September's",
  paid.status < 300 && salaryRows.length > 0 && salaryRows.every((r) => r.bm === "2026-09-01"),
  `${paid.status} ${msgOf(paid)} — ${salaryRows.length} rows`,
);

console.log("F. the Excel export");
const xr = await fetch(`${API}/exports/transactions?from=2026-06-01&to=2026-06-30`, { headers: H });
const book = new ExcelJS.Workbook();
await book.xlsx.load(Buffer.from(await xr.arrayBuffer()));
const sheet = book.worksheets[0];
let headerRow = null;
sheet.eachRow((row, n) => {
  if (!headerRow && row.values.includes("Books month")) headerRow = n;
});
check("a Books month column", xr.status === 200 && headerRow !== null, `${xr.status}`);
const header = sheet.getRow(headerRow ?? 1).values;
const bmCol = header.indexOf("Books month");
const refCol = header.indexOf("Ref");
const byRef = {};
sheet.eachRow((row, n) => {
  if (n > (headerRow ?? 0)) byRef[row.getCell(refCol).value] = row.getCell(bmCol).value;
});
check("  9 June in May's books reads May 2026", byRef[cash.body?.refNo] === "May 2026", String(byRef[cash.body?.refNo]));
check("  12 June in its own month reads June 2026", byRef[none.body?.refNo] === "June 2026", String(byRef[none.body?.refNo]));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
await db.end();
process.exit(passed === results.length ? 0 : 1);
