/*
 * Where does a transfer between our own accounts leak in as spending?
 *
 * One transfer, seeded on a known date, and every money surface read before
 * and after. Whatever moves by the transfer's amount is counting a movement
 * between our own pockets as money the company spent.
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

const DAY = "2026-08-14";
const AMOUNT = 50000;

await db.query("delete from transactions where description like 'LEAK %'");
const accounts = (
  await db.query(
    "select id, name from accounts where deleted_at is null order by created_at limit 2",
  )
).rows;
if (accounts.length < 2) {
  console.log("need two accounts");
  process.exit(1);
}

/** Every figure that claims to be about money, in one reading. */
const snapshot = async () => {
  const [txnOut, expenses, overview, summary] = await Promise.all([
    call("GET", `/transactions?from=2026-08-01&to=2026-08-31&direction=out&page=1&pageSize=1`),
    call("GET", `/transactions?from=2026-08-01&to=2026-08-31&direction=out&excludeToolSpend=true&excludeTransfers=true&page=1&pageSize=1`),
    call("GET", "/reports/overview?granularity=month&fiscalYear=2026&index=2"),
    call("GET", "/transactions/summary?from=2026-08-01&to=2026-08-31"),
  ]);
  const byCat = overview.body?.expenseByCategory ?? overview.body?.byCategory ?? [];
  // Matched by label: a group is keyed by its own `key`, not the account id.
  const group = (overview.body?.groups ?? []).find(
    (g) => g.label === accounts[0].name,
  );
  const expense = overview.body?.expense ?? {};
  return {
    "PER-ACCOUNT moneyOut (must move)": group?.moneyOut ?? null,
    "dashboard total spent": expense.totalSpent ?? expense.total ?? null,
    "Other expenses (rows)": expenses.body?.total ?? null,
    "All out (rows)": txnOut.body?.total ?? null,
    "summary moneyOut": summary.body?.moneyOut ?? null,
    "overview moneyOut": overview.body?.totals?.moneyOut ?? null,
    "overview categories total": Array.isArray(byCat)
      ? byCat.reduce((t, c) => t + Number(c.amount ?? c.total ?? 0), 0).toFixed(2)
      : null,
  };
};

const before = await snapshot();

const made = await call("POST", "/transactions/transfer", {
  txnDate: DAY,
  fromAccountId: accounts[0].id,
  toAccountId: accounts[1].id,
  amount: `${AMOUNT}.00`,
  description: `LEAK ${accounts[0].name} to ${accounts[1].name}`,
});
if (made.status !== 201) {
  console.log("transfer failed", made.status, JSON.stringify(made.body).slice(0, 200));
  process.exit(1);
}

const after = await snapshot();

console.log(`a ${AMOUNT} transfer between two of our own accounts:\n`);
for (const key of Object.keys(before)) {
  const a = before[key];
  const b = after[key];
  const moved = Number(b) - Number(a);
  const tag =
    a === null || b === null
      ? "  ? unreadable"
      : moved === 0
        ? "  ok  unchanged"
        : `  LEAK moved by ${moved}`;
  console.log(`${tag.padEnd(24)} ${key}: ${a} -> ${b}`);
}

// And is the row itself listed on the Other expenses screen's own query?
const listed = await call(
  "GET",
  "/transactions?from=2026-08-01&to=2026-08-31&direction=out&excludeToolSpend=true&excludeTransfers=true&page=1&pageSize=50",
);
const row = (listed.body?.items ?? []).find((r) => (r.description ?? "").startsWith("LEAK "));
console.log(
  `\nthe transfer's own row on Other expenses: ${row ? "LISTED — " + row.refNo : "not listed"}`,
);

await db.query("delete from transactions where description like 'LEAK %'");
await db.end();
