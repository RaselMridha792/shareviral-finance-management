/**
 * Buying something on a subscription takes money out of the bank.
 *
 * The owner: *"ai tools and subscription ta kaj korena thik vabe. ekhane kichu
 * kinle eta taka katena bank theke kono history thakena eta puro fix koro
 * perfect vabe."*
 *
 * He was right, and it was structural rather than a bug. A subscription is a
 * PLAN — cycle, price, card, next renewal — and nothing about adding or
 * renewing one ever wrote a transaction. "Paid this period" was summing entries
 * somebody had separately recorded and remembered to tag with the vendor.
 *
 * So there are two claims to prove here, and the second is the one that would
 * be easy to fake:
 *
 *   1. recording a payment moves the ACCOUNT BALANCE and appears in the ledger;
 *   2. it does so through the ordinary transaction path, so every rule that
 *      guards money still applies — the account cannot go below zero, a closed
 *      month is refused, and the entry can be voided and trashed like any other.
 *
 * A second INSERT that wrote its own row would pass (1) and quietly fail (2).
 *
 * It also covers the bug the owner hit on the same screen: the drawer posted
 * `reference` and `invoiceNo` to a strictObject schema that knew neither, so
 * every edit touching those boxes answered "Could not save that".
 *
 * Brought up to date 27 Sep 2026: the plan is a real `subscriptions` row made
 * with POST /subscriptions (dollar price + charge + rate) instead of a `vendors`
 * row, because the pay endpoint now looks plans up there (SESSIONS.md #33); the
 * payable is the dollars x the plan's rate, the entry is tied by
 * `subscription_id` and filed under the resolved AI-tools heading, it must carry
 * its USD rate, and cleanup runs in a `finally`.
 *
 *     node .subpayqa.mjs      (local only — writes and deletes)
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
/* Money arithmetic in Postgres numeric, never JS floats (CLAUDE.md). */
const sqlv = async (q, params = []) => (await db.query(q, params)).rows[0]?.v;

/* ------------------------------------------------------------- fixtures */

const PLANS = "select id from subscriptions where tool_name like 'PAYSUB%'";
const wipe = async () => {
  await db.query(`delete from transactions where subscription_id in (${PLANS})`);
  await db.query("delete from transactions where description like 'PAYSUB%'");
  await db.query(
    "delete from transactions where account_id in (select id from accounts where name like 'PAYSUB %')",
  );
  await db.query(`delete from subscription_users where subscription_id in (${PLANS})`);
  await db.query("delete from subscriptions where tool_name like 'PAYSUB%'");
  // What the pre-27-Sep version of this script made, should one ever be left.
  await db.query("delete from vendors where name like 'PAYSUB%'");
  await db.query("delete from accounts where name like 'PAYSUB %'");
};
await wipe();
// As text, so it goes back exactly as it was rather than via a JS Date.
const lockWas = await sqlv(
  "select books_locked_through::text v from app_settings limit 1",
);

try {
  await db.query("update app_settings set books_locked_through = null");

  const TODAY = await sqlv("select (now() at time zone 'Asia/Dhaka')::date::text v");
  const OPENING = "10000.00";
  const card = (
    await call("POST", "/accounts", {
      name: "PAYSUB Company Card",
      type: "card",
      currency: "BDT",
      openingBalance: OPENING,
      openingBalanceOn: TODAY.slice(0, 8) + "01",
    })
  ).body;

  /*
   * The heading a payment lands under, resolved exactly as
   * `TransactionsService.subscriptionCategoryId()` does. A subscription has no
   * ledger category of its own to carry (its `category` is `ai_tool` etc., the
   * register's words), and the pay drawer's heading picker was removed on the
   * owner's word — SESSIONS.md #59 — so "the plan's category" is now this.
   */
  const HEADING = await sqlv(
    `select coalesce(
       (select id from categories
         where deleted_at is null and kind = 'out' and slug = 'ai-tools' limit 1),
       (select id from categories
         where deleted_at is null and kind = 'out'
           and (name ilike '%ai tool%' or name ilike '%subscription%' or name ilike '%software%')
         order by name asc limit 1)
     )::text v`,
  );

  /*
   * The plan, as the AI tools and subscriptions screen makes it: a dollar price,
   * the vendor's charge on top, and the rate the taka price was struck at. The
   * three price fields must agree (`costsAgree`): 20.00 x 122.50 = 2,450.00.
   */
  const PLAN = {
    toolName: "PAYSUB Claude",
    planName: "PAYSUB Team",
    category: "ai_tool",
    costUsd: "20.00",
    chargeUsd: "0.40",
    usdRate: "122.50",
    costBdt: "2450.00",
    billingCycle: "monthly",
    startDate: TODAY,
    accountId: card.id,
  };
  /*
   * What one payment takes, worked out as `payForSubscription` does when nothing
   * is typed: `payableUsd(plan)` (price + charge) x the plan's own rate, to the
   * paisa — (20.00 + 0.40) x 122.50 = 2,499.00.
   */
  const PAYABLE_USD = await sqlv("select ($1::numeric + $2::numeric)::numeric(14,2)::text v", [
    PLAN.costUsd,
    PLAN.chargeUsd,
  ]);
  const PRICE = await sqlv("select round($1::numeric * $2::numeric, 2)::text v", [
    PAYABLE_USD,
    PLAN.usdRate,
  ]);

  const plan = await call("POST", "/subscriptions", PLAN);
  check(
    "a subscription records",
    plan.status === 201,
    `HTTP ${plan.status} ${JSON.stringify(plan.body?.errors ?? plan.body?.message ?? "")}`.slice(0, 130),
  );

  /* ------------- the bug the owner hit: reference would not save --------- */

  const ref = await call("PATCH", `/subscriptions/${plan.body.id}`, {
    reference: "STMT-88213",
    invoiceNo: "INV-PAYSUB-1",
  });
  check(
    "THE BUG: a reference can now be saved on a plan",
    ref.status === 200,
    `HTTP ${ref.status} ${JSON.stringify(ref.body?.errors ?? ref.body?.message ?? "")}`.slice(0, 120),
  );
  const kept = (
    await db.query("select reference r, invoice_no i from subscriptions where id = $1", [
      plan.body.id,
    ])
  ).rows[0];
  check(
    "and it is kept",
    kept?.r === "STMT-88213" && kept?.i === "INV-PAYSUB-1",
    `${kept?.r} / ${kept?.i}`,
  );

  /* -------------------- 1. the money actually moves ---------------------- */

  const before = (await call("GET", "/accounts?includeInactive=true")).body.find(
    (a) => a.id === card.id,
  );
  check("the card starts at its opening balance", money(before?.balance) === OPENING, money(before?.balance));

  const renewalWas = await sqlv(
    "select next_renewal_on::text v from subscriptions where id = $1",
    [plan.body.id],
  );

  const paid = await call("POST", `/subscriptions/${plan.body.id}/pay`, {
    txnDate: TODAY,
    advanceRenewal: true,
  });
  check(
    "THE ASK: a payment records against the plan",
    paid.status === 201,
    `HTTP ${paid.status} ${JSON.stringify(paid.body?.errors ?? paid.body?.message ?? "")}`.slice(0, 140),
  );

  const after = (await call("GET", "/accounts?includeInactive=true")).body.find(
    (a) => a.id === card.id,
  );
  const EXPECT_AFTER = await sqlv("select ($1::numeric - $2::numeric)::text v", [OPENING, PRICE]);
  check(
    "THE ASK: the card is poorer by the plan's price",
    money(after?.balance) === EXPECT_AFTER,
    `${money(before?.balance)} -> ${money(after?.balance)} (expected ${EXPECT_AFTER})`,
  );

  /*
   * Tied to the plan by `subscription_id`, not `vendor_id`: that column's FK is to
   * `vendors`, so a subscriptions id there could only fail (SESSIONS.md #33), and
   * `transactions.subscription_id` is the fact that replaced it.
   */
  const entry = (
    await db.query(
      `select id::text, ref_no, amount, direction, category_id::text, subscription_id::text,
              description, original_amount, original_currency, fx_rate, usd_rate
         from transactions where subscription_id = $1 and deleted_at is null
        order by created_at, id limit 1`,
      [plan.body.id],
    )
  ).rows[0];
  check(
    "THE ASK: there is a real ledger entry, tagged with the plan",
    entry?.direction === "out" &&
      entry?.amount === PRICE &&
      entry?.subscription_id === plan.body.id,
    `${entry?.ref_no} ${entry?.amount} (expected ${PRICE}) ${entry?.description}`,
  );
  check(
    "and it carries the plan's category rather than landing uncategorised",
    Boolean(HEADING) && entry?.category_id === HEADING,
    entry?.category_id
      ? entry.category_id === HEADING
        ? "the AI tools heading"
        : "categorised, but not under the AI tools heading"
      : "no category — it would sit in Uncategorised",
  );
  /*
   * The owner's rule: a rate on every entry (packages/shared/src/transactions.ts,
   * SESSIONS.md #67), and the dollars stated so a USD card's own balance moves
   * (SESSIONS.md #59).
   */
  check(
    "and it carries the dollars and the rate it was paid at",
    Number(entry?.usd_rate) === Number(PLAN.usdRate) &&
      Number(entry?.fx_rate) === Number(PLAN.usdRate) &&
      entry?.original_amount === PAYABLE_USD &&
      entry?.original_currency === "USD",
    `usd_rate ${entry?.usd_rate}, $${entry?.original_amount} ${entry?.original_currency} @ ${entry?.fx_rate}`,
  );

  /*
   * Measured against the renewal it had, not against today: a plan's renewal is
   * now worked out strictly AFTER today (`nextRenewalAfter`, shared
   * subscriptions.ts), so "not today" would pass with nothing moved.
   */
  const renewalNow = await sqlv(
    "select next_renewal_on::text v from subscriptions where id = $1",
    [plan.body.id],
  );
  const renewalExpected = await sqlv(
    "select ($1::date + interval '1 month')::date::text v",
    [renewalWas],
  );
  check(
    "and the renewal moved on a month",
    Boolean(renewalWas) && renewalNow === renewalExpected,
    `${renewalWas} -> ${renewalNow} (expected ${renewalExpected})`,
  );

  /* --------- 2. it went through the ordinary path, so rules apply -------- */

  const audited = (
    await db.query(
      "select count(*)::int n from audit_logs where entity_table='transactions' and entity_id = $1",
      [entry?.id ?? null],
    )
  ).rows[0].n;
  check(
    "THE RULE: it is in the audit log like any other entry",
    audited >= 1,
    `${audited} row(s)`,
  );

  /* The account rule: the card holds 7,501 and the plan costs 2,499 — three
     more payments leave 4.00, and a fourth would take it under. */
  const fillers = [];
  for (let i = 0; i < 3; i += 1) {
    fillers.push(
      (await call("POST", `/subscriptions/${plan.body.id}/pay`, { txnDate: TODAY })).status,
    );
  }
  const broke = await call("POST", `/subscriptions/${plan.body.id}/pay`, {
    txnDate: TODAY,
  });
  check(
    "THE RULE: the account cannot be taken below zero by a subscription either",
    broke.status === 400 &&
      /below zero|does not hold enough/i.test(JSON.stringify(broke.body?.message ?? "")),
    `fillers ${fillers.join(",")}; HTTP ${broke.status} ${JSON.stringify(broke.body?.message ?? "").slice(0, 100)}`,
  );

  /* A closed month refuses it, exactly as it refuses a typed expense. */
  await db.query("update app_settings set books_locked_through = $1", [TODAY]);
  const inClosed = await call("POST", `/subscriptions/${plan.body.id}/pay`, {
    txnDate: TODAY,
    amount: "1.00",
  });
  check(
    "THE RULE: a closed month refuses it too",
    inClosed.status === 403,
    `HTTP ${inClosed.status}`,
  );
  await db.query("update app_settings set books_locked_through = null");

  /* ------------------------------ the refusals --------------------------- */

  const noCard = await call("POST", "/subscriptions", {
    toolName: "PAYSUB No Card",
    planName: "PAYSUB Basic",
    category: "ai_tool",
    costUsd: "1.00",
    usdRate: "122.50",
    billingCycle: "monthly",
    startDate: TODAY,
  });
  const cannot = await call("POST", `/subscriptions/${noCard.body?.id}/pay`, {
    txnDate: TODAY,
  });
  check(
    "a plan with no card says so rather than guessing one",
    cannot.status === 400 && /no card or account/i.test(JSON.stringify(cannot.body?.message ?? "")),
    `HTTP ${cannot.status} ${JSON.stringify(cannot.body?.message ?? "").slice(0, 100)}`,
  );

  /*
   * A plan cannot have NO price any more — `costUsd` is required by
   * createSubscriptionSchema and `cost_usd` is NOT NULL — so the nearest is a
   * $0.00 one (taka derived as 0.00). The refusal now reads "no taka price"
   * (transactions.service.ts, payForSubscription).
   */
  const noPrice = await call("POST", "/subscriptions", {
    toolName: "PAYSUB No Price",
    planName: "PAYSUB Free",
    category: "ai_tool",
    costUsd: "0.00",
    usdRate: "122.50",
    billingCycle: "monthly",
    startDate: TODAY,
    accountId: card.id,
  });
  const priceless = await call(
    "POST",
    `/subscriptions/${noPrice.body?.id}/pay`,
    { txnDate: TODAY },
  );
  check(
    "and a plan with no price says so rather than recording zero",
    priceless.status === 400 && /no taka price/i.test(JSON.stringify(priceless.body?.message ?? "")),
    `HTTP ${priceless.status} ${JSON.stringify(priceless.body?.message ?? "").slice(0, 100)}`,
  );
} finally {
  await db.query("update app_settings set books_locked_through = $1", [lockWas ?? null]);
  await wipe();
  await db.end();
}

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
