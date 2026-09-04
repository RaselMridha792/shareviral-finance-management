/**
 * What each account held at the end of a month, not just what it holds now.
 *
 * The owner: *"account overview page a date month filter any diyo dropdown
 * akare."* On a screen of balances a month can only mean one thing — the
 * figure as at the moment that month ended — so the dropdown sends the month's
 * last day and every figure on the page is read up to it, the total included.
 *
 * The risk this is written against is the quiet one: a cutoff that reaches the
 * taka expression and not the dollar one, or reaches the balance and not the
 * "is this exact" flag, leaves a page that looks filtered and is not. So this
 * asks the endpoint for the same account at four different cutoffs and checks
 * all three figures each time.
 *
 *     node .asofqa.mjs      (local only — writes and cleans up)
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
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
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
const call = async (method, path_, body) => {
  const res = await fetch(API + path_, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const MARK = "ASOFQA";

const wipe = async () => {
  await db.query("delete from transactions where description like $1", [
    `%${MARK}%`,
  ]);
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
};
await wipe();

/* ------------------------------------------------------------- fixtures */

/* Opened in MARCH, so a February cutoff has to report nothing at all. */
const bank = (
  await call("POST", "/accounts", {
    name: `${MARK} Bank`,
    type: "bank",
    openingBalance: "100000.00",
    openingBalanceOn: "2026-03-01",
  })
).body;
const card = (
  await call("POST", "/accounts", {
    name: `${MARK} Card`,
    type: "card",
    currency: "USD",
    openingBalance: "0.00",
    openingBalanceUsd: "0.00",
    openingBalanceOn: "2026-03-01",
  })
).body;
check("a taka bank and a dollar card, both opened 1 March", Boolean(bank?.id && card?.id));

const inCat = (
  await db.query(
    `select id from categories where kind='in' and deleted_at is null limit 1`,
  )
).rows[0];
const outCat = (
  await db.query(
    `select id from categories where kind='out' and parent_id is not null
       and is_active and deleted_at is null limit 1`,
  )
).rows[0];

/* One movement a month, so every cutoff has a different right answer. */
const entries = [
  ["2026-03-15", "in", "50000.00", bank.id, "March in"],
  ["2026-04-20", "out", "20000.00", bank.id, "April out"],
  ["2026-05-10", "in", "10000.00", bank.id, "May in"],
];
for (const [date, direction, amount, accountId, what] of entries) {
  const res = await call("POST", "/transactions", {
    direction,
    txnDate: date,
    accountId,
    amount,
    categoryId: direction === "in" ? inCat.id : outCat.id,
    usdRate: "120.00",
    description: `${MARK} ${what}`,
  });
  if (res.status !== 201)
    console.log("    entry refused:", JSON.stringify(res.body).slice(0, 200));
}

/* The card is funded and spent in dollars, so the OWN-currency figure is real. */
for (const [date, direction, usd, taka, what] of [
  ["2026-03-05", "in", "1000.00", "120000.00", "card funded"],
  ["2026-04-05", "out", "300.00", "36000.00", "April dollars"],
]) {
  await db.query(
    `insert into transactions (ref_no, account_id, direction, txn_date, amount,
       currency, category_id, description, original_amount, original_currency,
       fx_rate, usd_rate, created_by, updated_by)
     values ('TXN-ASOF-' || floor(random()*1000000)::int, $1, $2, $3, $4,
       'BDT', $5, $6, $7, 'USD', '120.000000', '120.000000', $8, $8)`,
    [card.id, direction, date, taka, direction === "in" ? inCat.id : outCat.id,
     `${MARK} ${what}`, usd, person.id],
  );
}

/* ----------------------------------------------------------- the reads */

const at = async (asOf) => {
  const res = await call(
    "GET",
    `/accounts?includeInactive=true${asOf ? `&asOf=${asOf}` : ""}`,
  );
  const rows = res.body ?? [];
  const find = (id) => rows.find((a) => a.id === id);
  return { status: res.status, bank: find(bank.id), card: find(card.id) };
};

/* Before either account existed. */
const feb = await at("2026-02-28");
check(
  "at the end of February the bank held nothing — it was not open yet",
  feb.status === 200 && Number(feb.bank?.balance).toFixed(2) === "0.00",
  `৳${feb.bank?.balance}`,
);
check(
  "and neither did the card, in its own currency",
  Number(feb.card?.ownBalance).toFixed(2) === "0.00",
  `$${feb.card?.ownBalance}`,
);

/* March: opening + one receipt. */
const mar = await at("2026-03-31");
check(
  "at the end of March: the opening plus March's receipt",
  Number(mar.bank?.balance).toFixed(2) === "150000.00",
  `৳${mar.bank?.balance} — 100,000 opening + 50,000 in`,
);
check(
  "the card holds the dollars it was funded with",
  Number(mar.card?.ownBalance).toFixed(2) === "1000.00",
  `$${mar.card?.ownBalance}`,
);

/* April: a payment out of each. */
const apr = await at("2026-04-30");
check(
  "at the end of April the bank is 20,000 lighter",
  Number(apr.bank?.balance).toFixed(2) === "130000.00",
  `৳${apr.bank?.balance}`,
);
check(
  "and the card's own dollar figure moved too — the cutoff reaches BOTH expressions",
  Number(apr.card?.ownBalance).toFixed(2) === "700.00",
  `$${apr.card?.ownBalance} — $1,000 less $300`,
);

/* May, and now. */
const may = await at("2026-05-31");
const now = await at(null);
check(
  "at the end of May the last receipt is in",
  Number(may.bank?.balance).toFixed(2) === "140000.00",
  `৳${may.bank?.balance}`,
);
check(
  "and with no cutoff the figure is the same as today's — nothing else changed",
  Number(now.bank?.balance).toFixed(2) === Number(may.bank?.balance).toFixed(2),
  `৳${now.bank?.balance}`,
);

/* The exactness flag has to follow the cutoff too, or a filtered page can
   claim a figure is a record when the row that made it an estimate is simply
   out of range — or the reverse. */
check(
  "the 'is this exact' flag is computed at the cutoff as well",
  typeof feb.card?.ownBalanceExact === "boolean" &&
    typeof apr.card?.ownBalanceExact === "boolean",
  `Feb=${feb.card?.ownBalanceExact} Apr=${apr.card?.ownBalanceExact}`,
);

/* A cutoff that is not a date must be refused, not silently ignored. */
const junk = await call("GET", "/accounts?includeInactive=true&asOf=notadate");
check(
  "a cutoff that is not a date is refused",
  junk.status === 400,
  String(junk.status),
);

console.log("\n  the bank, month by month:");
for (const [label, snap] of [
  ["end of Feb", feb],
  ["end of Mar", mar],
  ["end of Apr", apr],
  ["end of May", may],
  ["as it stands", now],
]) {
  console.log(
    `    ${label.padEnd(14)} ৳${String(Number(snap.bank?.balance).toFixed(2)).padStart(12)}` +
      `    card $${String(Number(snap.card?.ownBalance).toFixed(2)).padStart(9)}`,
  );
}

/* ------------------------------ and the screen ------------------------- */

const screen = fs.readFileSync(
  "apps/web/src/components/accounts/accounts-screen.tsx",
  "utf8",
);
check(
  "the screen offers the cutoff as a dropdown",
  screen.includes('aria-label="Balances as at"') &&
    screen.includes("As it stands now") &&
    screen.includes("End of {month.label}"),
  "a select, with an escape row",
);
check(
  "and it asks the server rather than filtering what it already has",
  screen.includes("accountsApi.list(true, next ?? undefined)"),
  "refetches at the cutoff",
);

await wipe();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(72));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
      failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
