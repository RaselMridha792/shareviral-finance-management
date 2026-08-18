/**
 * T13 — THE CLOSED-BOOKS LOCK
 *
 * Once a month has been reported on, nothing dated inside it may move. The
 * column and the Settings screen for it have existed since Phase 2, and
 * `assertPeriodOpen` is called from fourteen places across eight modules — but
 * nothing has ever proved it. An enforced-but-untested control is the exact
 * shape of thing that regresses silently: someone adds a write path, forgets
 * the one line, and every screen still looks right.
 *
 * Two rows are placed while the books are open — one inside the period that is
 * about to close, one well outside it. Then the books close, and each way of
 * changing money is tried against both.
 *
 * The assertion that matters most is not "a locked row cannot be edited". It is
 * that an OPEN row cannot be *moved into* the closed period — a check on the
 * incoming date alone would pass every other test in this file and still let
 * anybody backdate a payment into a signed-off month.
 *
 * Two more things are deliberate:
 *
 *   - Every refusal is paired with the same operation succeeding once the lock
 *     is lifted. A 403 on its own proves nothing; endpoints refuse for many
 *     reasons, and a test that only ever sees red cannot tell "the lock worked"
 *     from "the payload was wrong".
 *   - The lock is cleared in a `finally`. The other suites restore their
 *     settings on the way out, which is fine for a cosmetic one — leaving the
 *     BOOKS locked would refuse every write in the app until somebody noticed.
 *
 * The window is kept as narrow as the data allows: the lock date is the test's
 * own row, two days after records begin, so it closes almost nothing real.
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

/** A refusal only counts if it is the lock refusing, and says so. */
const refused = (name, r, why) => {
  if (r.status !== 403) return bad(name, `wanted 403, got HTTP ${r.status} ${JSON.stringify(r.body)}`);
  const said = JSON.stringify(r.body ?? "");
  return /books are closed/i.test(said)
    ? ok(name, why)
    : bad(name, `403, but not from the lock: ${said.slice(0, 160)}`);
};
const allowed = (name, r, why) =>
  r.status === 200 || r.status === 201
    ? ok(name, why)
    : bad(name, `wanted it to go through, got HTTP ${r.status} ${JSON.stringify(r.body)}`);

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const rowsBefore = new Set((await db.query("select id from transactions")).rows.map((r) => r.id));
const [{ books_locked_through: originalLock }] =
  (await db.query("select books_locked_through from app_settings where id = 1")).rows;

const setLock = async (through) => {
  const r = await send("/settings/lock-books", "POST", { booksLockedThrough: through });
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`could not set the lock to ${through}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
  }
};
/** Straight to the column. Used only to undo, where the API's own rules are in the way. */
const clearLock = () => db.query("update app_settings set books_locked_through = null where id = 1");

const LOCKED_DAY = "2026-05-02";  // records begin in May 2026; this closes almost nothing
const INSIDE_DAY = "2026-05-01";  // earlier still, so also inside the closed period
const OPEN_DAY = "2026-08-10";    // comfortably after it
const NEXT_DAY = "2026-05-03";    // the first day the lock must NOT cover

console.log(`\nT13 — THE CLOSED-BOOKS LOCK   (starting lock: ${originalLock ?? "none"})\n`);

const made = [];
let locked = false;

try {
  /* ------------------------------------------------- two rows, books open */

  await clearLock();

  const accounts = (await api("/accounts")).body ?? [];
  const cats = (await api("/categories")).body ?? [];
  const inCat = (cats.items ?? cats).find((c) => (c.kind === "in" || c.kind === "both") && c.parentId);
  const account = (accounts.items ?? accounts)[0];
  const other = (accounts.items ?? accounts)[1];
  if (!account || !inCat) throw new Error("no account or no money-in sub-category to test with");

  const place = async (date, why) => {
    const r = await send("/transactions", "POST", {
      accountId: account.id, direction: "in", txnDate: date, amount: "13.00",
      categoryId: inCat.id, description: why, paymentMethod: "bank_transfer",
    });
    if (r.status !== 201 && r.status !== 200) throw new Error(`could not place ${date}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    made.push(r.body.id);
    return r.body.id;
  };

  const insideRow = await place(INSIDE_DAY, "T13 — inside the period about to close");
  const outsideRow = await place(OPEN_DAY, "T13 — outside it");
  ok("placed two rows while the books were open", `${INSIDE_DAY} and ${OPEN_DAY}`);

  /* ------------------------------------------------------- close the books */

  await setLock(LOCKED_DAY);
  locked = true;
  const [{ books_locked_through: stored }] =
    (await db.query("select books_locked_through from app_settings where id = 1")).rows;
  const storedIso = stored instanceof Date ? stored.toISOString().slice(0, 10) : String(stored).slice(0, 10);
  storedIso === LOCKED_DAY
    ? ok("the books are closed through the lock date", storedIso)
    : bad("the lock reached the database", `wanted ${LOCKED_DAY}, column says ${storedIso}`);

  /* ------------------------------------------- the four ways money changes */

  refused("a new entry dated inside the closed period is refused",
    await send("/transactions", "POST", {
      accountId: account.id, direction: "in", txnDate: LOCKED_DAY, amount: "13.00",
      categoryId: inCat.id, description: "T13 — should never exist", paymentMethod: "bank_transfer",
    }),
    "the lock date itself is closed, so the boundary is inclusive");

  allowed("the very next day still accepts one",
    await (async () => {
      const r = await send("/transactions", "POST", {
        accountId: account.id, direction: "in", txnDate: NEXT_DAY, amount: "13.00",
        categoryId: inCat.id, description: "T13 — the day after the lock", paymentMethod: "bank_transfer",
      });
      if (r.body?.id) made.push(r.body.id);
      return r;
    })(),
    `${NEXT_DAY} is outside, so the lock closes a period rather than the ledger`);

  refused("editing an entry inside the closed period is refused",
    await send(`/transactions/${insideRow}`, "PATCH", { description: "T13 — edited after closing" }),
    "even a description, because the row itself is sealed");

  refused("voiding an entry inside the closed period is refused",
    await send(`/transactions/${insideRow}/void`, "POST", { reason: "T13 — should not be possible" }),
    "voiding is a change to a reported month like any other");

  if (other) {
    refused("a transfer dated inside the closed period is refused",
      await send("/transactions/transfer", "POST", {
        txnDate: LOCKED_DAY, fromAccountId: account.id, toAccountId: other.id,
        amount: "13.00", description: "T13 — transfer into a closed month",
      }),
      "both legs are ledger rows, so both are covered");
  } else {
    meh("a transfer dated inside the closed period", "only one account exists, nothing to transfer to");
  }

  /* ----------------------------------------------- the one that would slip */

  refused("an OPEN entry cannot be BACKDATED into the closed period",
    await send(`/transactions/${outsideRow}`, "PATCH", { txnDate: INSIDE_DAY }),
    "the incoming date is checked too, not just the row's current one");

  allowed("that same open entry still edits normally",
    await send(`/transactions/${outsideRow}`, "PATCH", { description: "T13 — still editable" }),
    "so the refusal above was the date, not the row");

  /* ------------------------------- the rule is shared, not one endpoint's */

  refused("a TDS deposit dated inside the closed period is refused",
    await send("/tds/deposits", "POST", {
      challanNumber: "T13-LOCK", challanDate: LOCKED_DAY, depositDate: LOCKED_DAY,
      amount: "13.00", periodYear: 2026, periodMonth: 5,
    }),
    "a different module, the same guard — the tax screens cannot route around it");

  /* ------------------------------------------ the lock cannot walk backwards */

  const backwards = await send("/settings/lock-books", "POST", { booksLockedThrough: INSIDE_DAY });
  backwards.status === 403
    ? ok("the lock cannot be moved backwards", `${LOCKED_DAY} → ${INSIDE_DAY} refused, so a closed month cannot be quietly reopened`)
    : bad("the lock cannot be moved backwards", `wanted 403, got HTTP ${backwards.status} ${JSON.stringify(backwards.body)}`);

  /* ------------------------------- and everything works again once reopened */

  await clearLock();
  locked = false;

  allowed("with the books reopened, the same entry edits",
    await send(`/transactions/${insideRow}`, "PATCH", { description: "T13 — editable again" }),
    "which is what proves the refusals above were the lock and nothing else");
} finally {
  /* ---------------------------------------------------------- restore, always */
  // Not best-effort. A suite that dies holding the lock leaves every write in
  // the app refused, so this runs whatever happened above.
  await clearLock();
  if (originalLock) {
    const back = originalLock instanceof Date ? originalLock.toISOString().slice(0, 10) : String(originalLock).slice(0, 10);
    await db.query("update app_settings set books_locked_through = $1 where id = 1", [back]);
  }
  const [{ books_locked_through: now }] =
    (await db.query("select books_locked_through from app_settings where id = 1")).rows;
  const nowIso = now instanceof Date ? now.toISOString().slice(0, 10) : now === null ? null : String(now).slice(0, 10);
  const wanted = originalLock
    ? (originalLock instanceof Date ? originalLock.toISOString().slice(0, 10) : String(originalLock).slice(0, 10))
    : null;
  nowIso === wanted
    ? ok("the lock is back where it started", wanted ?? "none")
    : bad("restore the lock", `wanted ${wanted ?? "none"}, is ${nowIso ?? "none"}`);
  if (locked) meh("the run did not finish", "the lock was cleared on the way out");

  const mine = (await db.query("select id from transactions")).rows.map((r) => r.id).filter((id) => !rowsBefore.has(id));
  if (mine.length) {
    await db.query("delete from audit_logs where entity_id = any($1::text[])", [mine]);
    const gone = await db.query("delete from transactions where id = any($1::uuid[])", [mine]);
    gone.rowCount === mine.length
      ? ok("removed only what this script made", `${gone.rowCount} row(s)`)
      : meh("cleanup", `found ${mine.length}, deleted ${gone.rowCount}`);
  }
  const after = (await db.query("select count(*)::int n from transactions")).rows[0].n;
  after === rowsBefore.size ? ok("transaction count back to baseline", `${after}`) : bad("transaction count", `was ${rowsBefore.size}, now ${after}`);

  await db.end();
}

console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
