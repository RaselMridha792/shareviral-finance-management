/**
 * One payload may not state two different months of spending.
 *
 * Every report in this app answers twice: a total, and a breakdown of that
 * total. They are computed by SEPARATE queries, which is how they came to
 * disagree — the exclusion for own-account transfers was added to the totals
 * and skipped in the breakdown beside it, because a comment in own-money.ts
 * claimed the breakdown was "already immune". It was not: it LEFT-joins its
 * categories, and a left join keeps the rows that match nothing.
 *
 * Measured before the fix, on /reports/overview:
 *     totals.moneyOut   1,11,600.00
 *     spendByCategory   Office rent 1,11,600.00 | Uncategorised 65,000.00
 * The 65,000 was one transfer between two of the company's own banks, and
 * incomeByCategory carried it too — so the same money was reported as both
 * earned and spent, in the same response, on the dashboard.
 *
 * `.notspend.mjs` passed throughout, because it asks "did the totals move" and
 * never "do the totals agree with what sits under them". This asks the second
 * question, which is the one that catches a rule applied to N-1 of N queries.
 *
 * It also checks the two figures that are immune for reasons worth pinning
 * down, so that a later change cannot quietly break them: topVendors (an INNER
 * join to vendors, and a transfer has none) and the tooling tile (whose
 * predicate reaches a prepaid card, which a transfer CAN sit on).
 *
 *     node .agreeqa.mjs      (local only — writes and deletes)
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
const money = (n) => Number(n ?? 0).toFixed(2);
const agrees = (a, b) => money(a) === money(b);
const sumOf = (lines) => (lines ?? []).reduce((a, l) => a + Number(l.total ?? 0), 0);

/* ------------------------------------------------------------- fixtures */

/*
 * Today, and the period parameters that name today's month.
 *
 * /reports/overview with no parameters answers about the open month, but
 * /reports/period does not — periodQuerySchema is a strictObject over
 * {granularity, fiscalYear, index} and asking without them returns an empty
 * period whose every figure is zero. Every check then "passes" against nothing,
 * which is the failure this file exists to catch, so the index is computed
 * rather than left to a default.
 *
 * The company's fiscal year is Bangladesh's July-June, so month 7 is index 1.
 */
const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const MONTH_START = TODAY.slice(0, 8) + "01";
const mode = (await db.query("select fiscal_year_mode m from app_settings")).rows[0].m;
const Y = Number(TODAY.slice(0, 4));
const M = Number(TODAY.slice(5, 7));
const julyJune = mode === "bd_july_june";
const FISCAL_YEAR = julyJune ? (M >= 7 ? Y : Y - 1) : Y;
const INDEX = julyJune ? (M >= 7 ? M - 6 : M + 6) : M;
const PERIOD_Q = `granularity=month&fiscalYear=${FISCAL_YEAR}&index=${INDEX}`;

const wipe = async () => {
  await db.query("delete from transactions where description like 'AGREEQA%'");
  await db.query("delete from accounts where name like 'AGREEQA %'");
};
await wipe();

const mk = async (name, extra = {}) =>
  (
    await call("POST", "/accounts", {
      name,
      type: "bank",
      currency: "BDT",
      openingBalance: "500000.00",
      openingBalanceOn: MONTH_START,
      ...extra,
    })
  ).body;
const from = await mk("AGREEQA From Bank");
const to = await mk("AGREEQA To Bank");
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/* One genuine expense, so the month is not empty and a share can be wrong. */
const spend = await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: from.id,
  amount: "40000.00",
  categoryId: cat.id,
  description: "AGREEQA a real expense",
  paymentMethod: "bank_transfer",
});
check(
  "a real expense records",
  spend.status === 201,
  `HTTP ${spend.status} ${JSON.stringify(spend.body?.message ?? spend.body?.errors ?? "")}`.slice(0, 150),
);

const readAll = async () => {
  const period = await call("GET", `/reports/period?${PERIOD_Q}`);
  const overview = await call("GET", "/reports/overview");
  return {
    period: period.body,
    overview: overview.body,
    status: [period.status, overview.status],
  };
};

const before = await readAll();
check(
  "both report endpoints answer",
  before.status.every((s) => s === 200),
  `HTTP ${before.status.join(", ")} for ${before.period?.label ?? "?"} / ${before.overview?.period?.label ?? "?"}`,
);
/* An empty period passes every comparison below by saying nothing. */
check(
  "and they are both looking at a month that has entries in it",
  Number(before.period?.entries ?? 0) > 0 &&
    Number(before.overview?.totals?.entries ?? 0) > 0,
  `period ${before.period?.entries} entries, overview ${before.overview?.totals?.entries}`,
);

/* ------------------------------ the invariant --------------------------- */

const invariants = (tag, snap) => {
  const p = snap.period ?? {};
  const o = snap.overview ?? {};
  const ot = o.totals ?? {};
  check(
    `${tag}: period moneyOut equals its own spendByCategory`,
    agrees(p.moneyOut, sumOf(p.spendByCategory)),
    `${money(p.moneyOut)} vs ${money(sumOf(p.spendByCategory))}`,
  );
  check(
    `${tag}: period moneyIn equals its own incomeByCategory`,
    agrees(p.moneyIn, sumOf(p.incomeByCategory)),
    `${money(p.moneyIn)} vs ${money(sumOf(p.incomeByCategory))}`,
  );
  check(
    `${tag}: dashboard moneyOut equals its own spendByCategory`,
    agrees(ot.moneyOut, sumOf(o.spendByCategory)),
    `${money(ot.moneyOut)} vs ${money(sumOf(o.spendByCategory))}`,
  );
  check(
    `${tag}: dashboard moneyIn equals its own incomeByCategory`,
    agrees(ot.moneyIn, sumOf(o.incomeByCategory)),
    `${money(ot.moneyIn)} vs ${money(sumOf(o.incomeByCategory))}`,
  );
  /* A share is a share OF the total the same payload reports. */
  const shares = (p.spendByCategory ?? []).reduce(
    (a, l) => a + Number(l.share ?? 0),
    0,
  );
  check(
    `${tag}: the shares add to 100%, not to something else`,
    (p.spendByCategory ?? []).length === 0 || Math.abs(shares - 100) < 0.05,
    `${shares.toFixed(1)}%`,
  );
};

invariants("before the transfer", before);

/* --------------- now move the owner's own money, and re-ask ------------- */

const moved = await call("POST", "/transactions/transfer", {
  txnDate: TODAY,
  fromAccountId: from.id,
  toAccountId: to.id,
  amount: "65000.00",
  description: "AGREEQA moving our own money between our own banks",
});
check("the transfer records", moved.status === 201, `HTTP ${moved.status}`);

const after = await readAll();
invariants("after the transfer", after);

check(
  "THE RULE: moving our own money did not change what we spent",
  agrees(before.period?.moneyOut, after.period?.moneyOut) &&
    agrees(before.overview?.totals?.moneyOut, after.overview?.totals?.moneyOut),
  `period ${money(before.period?.moneyOut)} -> ${money(after.period?.moneyOut)}, ` +
    `dashboard ${money(before.overview?.totals?.moneyOut)} -> ${money(after.overview?.totals?.moneyOut)}`,
);
check(
  "and did not change what we received",
  agrees(before.period?.moneyIn, after.period?.moneyIn) &&
    agrees(before.overview?.totals?.moneyIn, after.overview?.totals?.moneyIn),
  `period ${money(before.period?.moneyIn)} -> ${money(after.period?.moneyIn)}`,
);
check(
  "no Uncategorised bucket appeared in either breakdown",
  !(after.period?.spendByCategory ?? []).some((l) => !l.id) &&
    !(after.overview?.spendByCategory ?? []).some((l) => !l.id),
  (after.overview?.spendByCategory ?? [])
    .map((l) => `${l.name} ${money(l.total)}`)
    .join(" | ") || "empty",
);
check(
  "and it did not appear among the top vendors either",
  !(after.overview?.topVendors ?? []).some((v) => /AGREEQA/.test(v.name ?? "")),
  (after.overview?.topVendors ?? []).map((v) => v.name).join(" | ") || "none",
);

/* But the money really did leave one bank and arrive at the other. */
const balances = await call("GET", "/accounts?includeInactive=true");
const bal = (id) => (balances.body ?? []).find((a) => a.id === id)?.balance;
check(
  "the sending account is genuinely poorer — a transfer is still a ledger entry",
  money(bal(from.id)) === "395000.00",
  `${money(bal(from.id))} (500000 opening - 40000 expense - 65000 sent)`,
);
check(
  "and the receiving account genuinely richer",
  money(bal(to.id)) === "565000.00",
  `${money(bal(to.id))}`,
);

/* ---------------- the prepaid card, which a transfer can sit on --------- */
/*
 * The tooling tile counts money out that was "paid to a tool vendor, OR
 * settled on a non-taka CARD" — the card exists to pay for tooling, so its
 * spending is tooling even when nobody named the vendor. That heuristic
 * reaches any row on the card, and a transfer OFF the card is such a row.
 * Nothing in the dev data exercises it, so the case is built rather than
 * looked for: "no difference on this data" is not the same claim as "immune".
 */
const card = await mk("AGREEQA Prepaid Card", {
  type: "card",
  currency: "USD",
  openingBalance: "300000.00",
  openingBalanceUsd: "2500.00",
});
check("a USD prepaid card exists", Boolean(card?.id), `type ${card?.type}/${card?.currency}`);

/*
 * `expense.toolsAndSubscriptions`, named exactly. Guessing at the field and
 * falling back to null made this check pass by having nothing to compare, which
 * is the same vacuum the endpoint 400s produced earlier in this file's life.
 */
const toolingOf = async () => {
  const body = (await call("GET", "/reports/overview")).body;
  const v = body?.expense?.toolsAndSubscriptions;
  if (v === undefined) throw new Error("expense.toolsAndSubscriptions is gone");
  return v;
};

const toolBefore = await toolingOf();
const offCard = await call("POST", "/transactions/transfer", {
  txnDate: TODAY,
  fromAccountId: card.id,
  toAccountId: to.id,
  amount: "30000.00",
  description: "AGREEQA card top-up moved back to the bank",
});
check("money moves back off the card", offCard.status === 201, `HTTP ${offCard.status}`);

const toolAfter = await toolingOf();
check(
  "moving money OFF the card is not tooling spend",
  agrees(toolBefore, toolAfter),
  `${money(toolBefore)} -> ${money(toolAfter)}`,
);

const afterCard = await readAll();
invariants("after the card transfer", afterCard);

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
