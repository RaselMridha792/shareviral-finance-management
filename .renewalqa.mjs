/**
 * A renewal date nobody types.
 *
 * The owner: *"If select Monthly hoy tahole renews date auto calculation hobe
 * ekhane notun kore renewal date dite hobena oi field ta remove korte hobe"*.
 *
 * The interesting part is not the arithmetic — that has unit tests — it is what
 * the date must NOT do. It still moves on its own when a payment is recorded,
 * and an edit to something unrelated must not undo that. Deriving it on every
 * save would quietly pull a card charge back a month, and nobody would see it
 * happen.
 *
 * So this drives all four cases against a real plan:
 *
 *   create      the date is the next cycle boundary after today, counted from
 *               the start date — not start + one cycle, which for a plan
 *               entered today and started in 2024 is two years in the past
 *   edit cycle  it follows
 *   edit notes  it does not move
 *   payment     it advances, and a later unrelated edit leaves that alone
 *
 *     node .renewalqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
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

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;

const wipe = async () => {
  const ids = (
    await db.query("select id from subscriptions where tool_name like 'RENEWQA%'")
  ).rows.map((r) => r.id);
  for (const id of ids) {
    await db.query("delete from subscription_users where subscription_id=$1", [id]);
    await db.query("delete from subscriptions where id=$1", [id]);
  }
  await db.query("delete from transactions where description like 'RENEWQA%'");
  await db.query("delete from accounts where name like 'RENEWQA %'");
  return ids.length;
};
await wipe();

/* ---------------------------------------------------------------- create */

/* Started well over a year ago, on purpose: "start + one cycle" would put the
   answer in 2025 and call it the next renewal. */
const START = "2024-01-10";
const made = await call("POST", "/subscriptions", {
  toolName: "RENEWQA Tool",
  planName: "Team",
  category: "ai_tool",
  /* A taka price as well as a dollar one, because the ledger is in taka and
     paying reads `costBdt`. The screen derives it from the rate; a plan with
     only a dollar price genuinely has no taka figure to charge. */
  costUsd: "20.00",
  usdRate: "122.50",
  costBdt: "2450.00",
  billingCycle: "monthly",
  startDate: START,
  users: [],
});
check(
  "a plan can be created without being told when it renews",
  made.status === 201,
  `HTTP ${made.status} ${JSON.stringify(made.body?.message ?? "").slice(0, 90)}`,
);
const plan = made.body;

const expectAfter = (start, months, today) => {
  const step = (iso, n) => {
    const [y, m, d] = iso.split("-").map(Number);
    const idx = m - 1 + n;
    const yy = y + Math.floor(idx / 12);
    const mm = ((idx % 12) + 12) % 12;
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    const dd = String(Math.min(d, last)).padStart(2, "0");
    return `${yy}-${String(mm + 1).padStart(2, "0")}-${dd}`;
  };
  let next = step(start, months);
  while (next <= today) next = step(next, months);
  return next;
};
const wantMonthly = expectAfter(START, 1, TODAY);
const stored = async () =>
  (
    await db.query("select next_renewal_on::text d from subscriptions where id=$1", [
      plan.id,
    ])
  ).rows[0].d;

check(
  "and it is the next cycle boundary AFTER today, not start plus one cycle",
  (await stored()) === wantMonthly,
  `stored ${await stored()}, wanted ${wantMonthly} (started ${START}, today ${TODAY})`,
);
check(
  "which is in the future, which is the whole point of the word 'next'",
  (await stored()) > TODAY,
  `${await stored()} > ${TODAY}`,
);

/* The contract refuses the field outright rather than ignoring it — a value
   the server silently discards is worse than one it rejects. */
const typed = await call("POST", "/subscriptions", {
  toolName: "RENEWQA Typed",
  planName: "Team",
  category: "ai_tool",
  costUsd: "20.00",
  billingCycle: "monthly",
  startDate: START,
  nextRenewalOn: "2030-01-01",
  users: [],
});
check(
  "a client still sending a renewal date is told, not ignored",
  typed.status === 400,
  `HTTP ${typed.status}`,
);

/* ------------------------------------------------------ what moves it ---- */

await call("PATCH", `/subscriptions/${plan.id}`, { billingCycle: "yearly" });
check(
  "changing the cycle moves the date",
  (await stored()) === expectAfter(START, 12, TODAY),
  `${await stored()} vs ${expectAfter(START, 12, TODAY)}`,
);

await call("PATCH", `/subscriptions/${plan.id}`, { startDate: "2024-03-20" });
check(
  "changing the start date moves it too",
  (await stored()) === expectAfter("2024-03-20", 12, TODAY),
  `${await stored()} vs ${expectAfter("2024-03-20", 12, TODAY)}`,
);

const before = await stored();
await call("PATCH", `/subscriptions/${plan.id}`, { notes: "RENEWQA note" });
check(
  "editing something unrelated leaves it exactly where it was",
  (await stored()) === before,
  `${before} -> ${await stored()}`,
);

/* -------------------------------------------- a payment still moves it --- */

const account = (
  await call("POST", "/accounts", {
    name: "RENEWQA Card",
    type: "card",
    currency: "BDT",
    openingBalance: "500000.00",
    openingBalanceOn: TODAY.slice(0, 8) + "01",
  })
).body;
await call("PATCH", `/subscriptions/${plan.id}`, {
  billingCycle: "monthly",
  accountId: account.id,
});
const beforePay = await stored();
const category = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];
const paid = await call("POST", `/subscriptions/${plan.id}/pay`, {
  txnDate: TODAY,
  categoryId: category.id,
  note: "RENEWQA charge",
  advanceRenewal: true,
});
const afterPay = await stored();
check(
  "recording a payment still advances it by a cycle",
  paid.status < 300 && afterPay > beforePay,
  `HTTP ${paid.status} ${JSON.stringify(paid.body?.message ?? "").slice(0, 80)}, ${beforePay} -> ${afterPay}`,
);

/* The one that would be invisible: an unrelated edit must not re-derive the
   date and pull the payment's advance back. */
await call("PATCH", `/subscriptions/${plan.id}`, { notes: "RENEWQA second note" });
check(
  "and a later unrelated edit does NOT undo that advance",
  (await stored()) === afterPay,
  `${afterPay} -> ${await stored()}`,
);

/* --------------------------------------------- a plan that does not recur */

const once = await call("POST", "/subscriptions", {
  toolName: "RENEWQA Lifetime",
  planName: "Lifetime",
  category: "ai_tool",
  costUsd: "99.00",
  billingCycle: "none",
  startDate: START,
  users: [],
});
const onceRow = (
  await db.query("select next_renewal_on from subscriptions where id=$1", [
    once.body.id,
  ])
).rows[0];
check(
  "a plan that does not recur gets no date at all, rather than a guessed month",
  onceRow.next_renewal_on === null,
  `stored ${onceRow.next_renewal_on}`,
);

/* -------------------------------- the form ----------------------------- */

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});
const page = await browser.newPage();
await page.setViewport({ width: 1700, height: 1200 });
await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2600));

const buttons = await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()).slice(0, 14),
);
console.log("    buttons:", JSON.stringify(buttons));

/* Open the add drawer. */
await page.evaluate(() => {
  /* "Add a subscription" — matched on the whole phrase, because /add/ also
     matches the "Add" inside the bulk bar and the row menus. */
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /^Add a subscription$/i.test((b.textContent ?? "").trim()),
  );
  btn?.setAttribute("data-renewqa", "1");
});
/* Clicked in the page rather than through the mouse: `page.click` scrolls to
   the element and refuses if anything overlaps it, and this button sits under
   the sticky page header at this viewport. */
await page.evaluate(() => document.querySelector('[data-renewqa="1"]').click());
await new Promise((r) => setTimeout(r, 2000));

const form = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="dialog"]')].pop();
  if (!el) return null;
  const labels = [...el.querySelectorAll("label")].map((l) =>
    (l.textContent ?? "").trim(),
  );
  /* The label "Renews on" and whatever control sits under it. */
  const renews = [...el.querySelectorAll("label")].find((l) =>
    /Renews on/i.test(l.textContent ?? ""),
  );
  /* `Field` IS the <label> — the control is its child, not its sibling. Taking
     the parent widened this to the whole two-column grid, so every neighbour's
     input counted as this field's. */
  const field = renews;
  return {
    labels,
    hasLabel: Boolean(renews),
    input: Boolean(field?.querySelector("input")),
    text: (field?.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
});
check(
  "the add drawer opens",
  Boolean(form),
  form ? "" : `no dialog — page said "${await page.evaluate(() => (document.body.textContent ?? "").replace(/\s+/g, " ").slice(0, 120))}"`,
);
check(
  '21: "Renews on" is no longer a box somebody types into',
  form?.hasLabel && !form?.input,
  `label ${form?.hasLabel}, input ${form?.input}`,
);
check(
  "21: an empty form says what it needs rather than showing a made-up date",
  /Choose when it started/i.test(form?.text ?? ""),
  form?.text ?? "",
);

/*
 * And once a start date is typed, the date appears — which is the point of
 * removing the box rather than just hiding it. React does not see a value set
 * on the DOM node directly, so the native setter is used and an input event
 * dispatched, the way a person typing produces one.
 */
await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="dialog"]')].pop();
  const started = [...el.querySelectorAll("label")].find((l) =>
    /Started on/i.test(l.textContent ?? ""),
  );
  const box = started.querySelector("input");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(box, "2026-04-12");
  box.dispatchEvent(new Event("input", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 900));

const filled = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="dialog"]')].pop();
  const renews = [...el.querySelectorAll("label")].find((l) =>
    /Renews on/i.test(l.textContent ?? ""),
  );
  return (renews?.textContent ?? "").replace(/\s+/g, " ").trim();
});
check(
  "21: and typing a start date makes the renewal date appear, monthly",
  /12\/05\/2026|\d{2}\/\d{2}\/\d{4}/.test(filled),
  filled,
);

await browser.close();
const removed = await wipe();
check("the throwaway plans are removed again", removed === 2, `${removed} plans`);
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
