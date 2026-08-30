/**
 * A transfer between our own accounts is not money the company spent.
 *
 * The owner found it on Other expenses: loading the USD card from the bank
 * account was listed as an expense, under no category, beside the electricity
 * bill. It reached three figures, all measured before the fix — the Other
 * expenses list (+1 row), the company's `moneyOut` on the Reports overview
 * (+50,000) and the same on the statement.
 *
 * The rule cuts both ways, and the second half is the one that is easy to
 * break while fixing the first: the money DID leave that bank account, so the
 * account's own figures, its register and All transactions must all still
 * carry it. A fix that made the ledger tidy would make the balance wrong.
 *
 *     node .notspend.mjs      (local only — writes and deletes)
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
const call = async (method, path, body) => {
  const res = await fetch(API + path, {
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

const AMOUNT = 50000;
const wipe = () =>
  db.query("delete from transactions where description like 'NSQA %'");
await wipe();

const accounts = (
  await db.query(
    "select id, name from accounts where deleted_at is null order by created_at limit 2",
  )
).rows;
if (accounts.length < 2) {
  console.log("this needs two accounts on the books");
  process.exit(1);
}

/** Every figure that could be moved by a transfer, in one reading. */
const read = async () => {
  const [expenses, ledger, overview, balances] = await Promise.all([
    // The Other expenses screen's own query, flags and all.
    call(
      "GET",
      "/transactions?from=2026-08-01&to=2026-08-31&direction=out&excludeToolSpend=true&excludeTransfers=true&page=1&pageSize=100",
    ),
    call("GET", "/transactions?from=2026-08-01&to=2026-08-31&page=1&pageSize=100"),
    call("GET", "/reports/overview?granularity=month&fiscalYear=2026&index=2"),
    call("GET", "/accounts/balances"),
  ]);
  const group = (overview.body?.groups ?? []).find(
    (g) => g.label === accounts[0].name,
  );
  const balance = (balances.body?.accounts ?? []).find(
    (b) => b.id === accounts[0].id,
  );
  return {
    expenseRows: expenses.body?.total ?? null,
    expenseNames: (expenses.body?.items ?? []).map((r) => r.description ?? ""),
    ledgerRows: ledger.body?.total ?? null,
    companyOut: overview.body?.totals?.moneyOut ?? null,
    companyIn: overview.body?.totals?.moneyIn ?? null,
    companyNet: overview.body?.totals?.net ?? null,
    companyEntries: overview.body?.totals?.entries ?? null,
    accountOut: group?.moneyOut ?? null,
    accountBalance: balance?.balance ?? balance?.net ?? null,
  };
};

const before = await read();

const made = await call("POST", "/transactions/transfer", {
  txnDate: "2026-08-14",
  fromAccountId: accounts[0].id,
  toAccountId: accounts[1].id,
  amount: `${AMOUNT}.00`,
  description: "NSQA bank to card",
});
check("a transfer records", made.status === 201, `HTTP ${made.status}`);
const after = await read();

/* ------------------------- it is not an expense ------------------------- */

check(
  "it does not appear on Other expenses",
  after.expenseRows === before.expenseRows &&
    !after.expenseNames.some((n) => n.startsWith("NSQA ")),
  `${before.expenseRows} rows before, ${after.expenseRows} after`,
);
check(
  "the company's money out does not move",
  after.companyOut === before.companyOut,
  `${before.companyOut} -> ${after.companyOut}`,
);
check(
  "nor its money in — both halves are left out, so the net still ties",
  after.companyIn === before.companyIn && after.companyNet === before.companyNet,
  `in ${before.companyIn} -> ${after.companyIn}, net ${before.companyNet} -> ${after.companyNet}`,
);
check(
  "nor the count of what the company did this period",
  after.companyEntries === before.companyEntries,
  `${before.companyEntries} -> ${after.companyEntries}`,
);

/* -------------------- but the money really did move --------------------- */

check(
  "the sending account's own money out DOES move — it left that bank",
  Number(after.accountOut) - Number(before.accountOut) === AMOUNT,
  `${before.accountOut} -> ${after.accountOut}`,
);
check(
  "and its balance falls by the amount",
  Number(before.accountBalance) - Number(after.accountBalance) === AMOUNT,
  `${before.accountBalance} -> ${after.accountBalance}`,
);
check(
  "All transactions still lists both halves — it is the ledger",
  after.ledgerRows === before.ledgerRows + 2,
  `${before.ledgerRows} -> ${after.ledgerRows}`,
);

/* --------------- and the flag is a choice, not a new default ------------ */

const unflagged = await call(
  "GET",
  "/transactions?from=2026-08-01&to=2026-08-31&direction=out&page=1&pageSize=100",
);
check(
  "a query that does not ask to exclude transfers still gets them",
  (unflagged.body?.items ?? []).some((r) =>
    (r.description ?? "").startsWith("NSQA "),
  ),
  "the register and the statement depend on this",
);

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
