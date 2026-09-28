/**
 * A bank charge names its entry, and is asked in the entry's own currency.
 *
 * The owner, 28 Sep 2026, twice:
 *
 *   1. *"bank charge er ekhane details a lekha nei eta kon transaction er jonne
 *      charge ta add hoyeche etake clear kore mention korte hobe ... eta
 *      automatically dhore newa ucit."* — a charge's record must say which
 *      entry it was levied on. (And his worry that one upgrade had written its
 *      ৳200 charge three times.)
 *   2. *"dhoro ami transaction ta korechi usd te kintu bank charge keno ami bdt
 *      te likhbo. jokhon bdt transaction hobe tokhon bank charge o bdt hobe r
 *      jokhon usd hobe tokhon bank charge o usd howa ucit."*
 *
 * On three accounts (two taka, one USD-primary) and a plan made for the
 * purpose, all removed after:
 *
 *   A. storage — a dollar charge stores taka = dollars × the entry's rate to
 *      the paisa (including a case float arithmetic gets wrong) and its
 *      dollars in the fx columns; the USD account's own balance moves by
 *      exactly the dollars; a taka charge is stored as before; taka and
 *      dollars at once is refused on every door; a charge restated between
 *      currencies is the same row with its fx columns set or cleared together;
 *      an entry with no rate refuses a dollar charge.
 *   B. ONE live charge per entry — create and edit on every path (expense,
 *      Cash In, transfer, renew, upgrade), three saves at once, and the trash:
 *      a charge taken off and then brought back after the entry got a new one.
 *   C. the forms — Cash In, an entry (Other expenses and a register), Money
 *      Transfer, Renew and Upgrade each ask USD or BDT by the entry's rule; an
 *      edit reopens a charge in the currency it was entered in, and an old taka
 *      charge on a dollar entry can be restated in dollars.
 *   D. the record of a charge names its entry — Entry No., what it was, its
 *      description — and opens it; old charge rows read the same.
 *
 *     node .chargecurrencyqa.mjs     (needs `npm run dev`: web :3000, api :4001)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
const MARK = "CCQA";
const TOOL = `${MARK} Tool`;

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
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
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
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const cents = (v) => Math.round(Number(v) * 100);

/* ---------------------------------------------------------------- cleanup */
async function wipe() {
  const subs = (await q(`select id from subscriptions where tool_name = $1`, [TOOL])).map((r) => r.id);
  const accts = (await q(`select id from accounts where name like $1`, [`${MARK} %`])).map((r) => r.id);
  const txns = accts.length ? (await q(`select id from transactions where account_id = any($1::uuid[])`, [accts])).map((r) => r.id) : [];
  const files = txns.length ? await q(`select id from files where transaction_id = any($1::uuid[])`, [txns]) : [];
  const upgrades = subs.length ? (await q(`select id from subscription_upgrades where subscription_id = any($1::uuid[])`, [subs])).map((r) => r.id) : [];
  const ids = [...subs, ...accts, ...txns, ...files.map((f) => f.id), ...upgrades];
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::text[])`, [ids]);
  if (files.length) await q(`delete from files where id = any($1::uuid[])`, [files.map((f) => f.id)]);
  if (subs.length) await q(`delete from subscription_upgrades where subscription_id = any($1::uuid[])`, [subs]);
  if (txns.length) {
    await q(`delete from transactions where charge_for_id = any($1::uuid[])`, [txns]);
    await q(`delete from transactions where id = any($1::uuid[])`, [txns]);
  }
  if (subs.length) {
    await q(`delete from subscription_users where subscription_id = any($1::uuid[])`, [subs]);
    await q(`delete from subscriptions where id = any($1::uuid[])`, [subs]);
  }
  if (accts.length) await q(`delete from accounts where id = any($1::uuid[])`, [accts]);
}
await wipe();

/* --------------------------------------------------------------- fixtures */
const mk = async (name, currency, opening, openingUsd) => {
  const r = await call("POST", "/accounts", {
    name, type: "bank", currency, bankName: `${name} Bank`,
    openingBalance: opening, ...(openingUsd ? { openingBalanceUsd: openingUsd } : {}),
    openingBalanceOn: "2026-09-01",
  });
  if (r.status >= 300) throw new Error(`account ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
};
const taka = await mk(`${MARK} Taka`, "BDT", "2000000.00");
const takaTwo = await mk(`${MARK} Second Taka`, "BDT", "500000.00");
const dollar = await mk(`${MARK} Dollar`, "USD", "2430000.00", "20000.00");

const cats = (await call("GET", "/categories")).body;
const flat = cats.items ?? cats;
const outCat = flat.find((c) => (c.kind === "out" || c.kind === "both") && c.parentId && !/bank charge/i.test(c.name));
const inCat = flat.find((c) => (c.kind === "in" || c.kind === "both") && c.parentId);

const made = await call("POST", "/subscriptions", {
  toolName: TOOL, planName: "Pro", category: "ai_tool", status: "active",
  costUsd: "100.00", usdRate: "123.00", billingCycle: "monthly",
  startDate: "2026-08-10", accountId: dollar, paymentMethod: "card",
});
const planId = made.body?.id;
if (!planId) throw new Error(`plan: ${made.status} ${JSON.stringify(made.body)}`);

const liveCharges = (parentId) =>
  q(`select id, amount::text amount, original_amount::text usd, original_currency cur, fx_rate::text fx,
            fx_rate_source src, usd_rate::text rate, account_id, description,
            (amount = round(original_amount * fx_rate, 2)) as exact
       from transactions where charge_for_id = $1 and deleted_at is null and voided_at is null
      order by created_at`, [parentId]);
const ownUsd = async (id) => {
  const b = await call("GET", "/accounts/balances");
  const row = (b.body?.accounts ?? []).find((a) => a.id === id);
  return row?.ownBalance ?? null;
};
const fxClear = (c) => c && c.usd === null && c.cur === null && c.fx === null && c.src === null;
const TWICE = /Give the bank charge in taka or in dollars — not both/;

/* ================================================================= PART A */
console.log("\nA. What a dollar charge stores");

const own0 = await ownUsd(dollar);
const spend = await call("POST", "/transactions", {
  direction: "out", txnDate: "2026-09-20", accountId: dollar, amount: "4860.00", categoryId: outCat.id,
  description: `${MARK} card spend`, paymentMethod: "card", usdRate: "121.50",
  originalAmount: "40.00", originalCurrency: "USD", fxRate: "121.50", chargeUsd: "2.00",
});
check("a dollar entry takes its bank charge in dollars", spend.status === 201, `HTTP ${spend.status} ${spend.status >= 300 ? msgOf(spend) : ""}`);
let [c1] = await liveCharges(spend.body.id);
const spendChargeId = c1?.id;
check("its taka is dollars × the entry's rate, to the paisa — $2.00 × 121.50 = ৳243.00", c1?.amount === "243.00" && c1?.exact === true, JSON.stringify(c1));
check("and its dollars sit in the fx columns as a set: $2.00, USD, at 121.5, stated by hand",
  c1?.usd === "2.00" && c1?.cur === "USD" && Number(c1?.fx) === 121.5 && c1?.src === "manual" && Number(c1?.rate) === 121.5, JSON.stringify(c1));
const own1 = await ownUsd(dollar);
check("the USD account's own balance moved by exactly $42.00 — the $40 and the $2 charge", cents(own0) - cents(own1) === 4200, `${own0} → ${own1}`);
const readBack = (await call("GET", `/transactions/${spend.body.id}`)).body;
check("the entry reads its charge back in both currencies", readBack?.chargeAmount === "243.00" && readBack?.chargeUsd === "2.00", `${readBack?.chargeAmount} / ${readBack?.chargeUsd}`);

const floaty = await call("POST", "/transactions", {
  direction: "out", txnDate: "2026-09-20", accountId: dollar, amount: "1005.00", categoryId: outCat.id,
  description: `${MARK} float trap`, paymentMethod: "card", usdRate: "100.50",
  originalAmount: "10.00", originalCurrency: "USD", fxRate: "100.50", chargeUsd: "1.15",
});
const [cf] = floaty.status === 201 ? await liveCharges(floaty.body.id) : [];
check("$1.15 × 100.50 is ৳115.58 — half-up in paisa, where a float product reads 115.57", cf?.amount === "115.58" && cf?.exact === true, `${cf?.amount} (JS float: ${(1.15 * 100.5).toFixed(2)})`);

const rent = await call("POST", "/transactions", {
  direction: "out", txnDate: "2026-09-21", accountId: taka, amount: "10000.00", categoryId: outCat.id,
  description: `${MARK} office rent`, paymentMethod: "bank_transfer", usdRate: "122.00", chargeAmount: "115.00",
});
const [ct] = await liveCharges(rent.body.id);
check("a taka charge is stored exactly as before — ৳115.00, no dollars, the entry's rate to read it at",
  ct?.amount === "115.00" && fxClear(ct) && Number(ct?.rate) === 122, JSON.stringify(ct));

/* Both at once, on every door. */
const twice = [];
twice.push(["create", await call("POST", "/transactions", {
  direction: "out", txnDate: "2026-09-21", accountId: taka, amount: "100.00", categoryId: outCat.id,
  description: `${MARK} twice`, usdRate: "122.00", chargeAmount: "5.00", chargeUsd: "1.00",
})]);
twice.push(["edit", await call("PATCH", `/transactions/${rent.body.id}`, { chargeAmount: "5.00", chargeUsd: "1.00" })]);
twice.push(["cash in", await call("POST", "/transactions/cash-in", {
  txnDate: "2026-09-21", accountId: taka, amount: "100.00", description: `${MARK} twice`, usdRate: "122.00",
  chargeAmount: "5.00", chargeUsd: "1.00",
})]);
twice.push(["transfer", await call("POST", "/transactions/transfer", {
  txnDate: "2026-09-21", fromAccountId: taka, toAccountId: takaTwo, amount: "100.00", description: `${MARK} twice`,
  usdRate: "122.00", chargeAmount: "5.00", chargeUsd: "1.00",
})]);
twice.push(["renew", await call("POST", `/subscriptions/${planId}/pay`, { txnDate: "2026-09-10", chargeAmount: "5.00", chargeUsd: "1.00" })]);
twice.push(["upgrade", await call("POST", `/subscriptions/${planId}/upgrade`, {
  upgradedOn: "2026-09-20", toPlanName: "Twice", toCostUsd: "150.00", usdRate: "123.00", chargedUsd: "10.00",
  bankCharge: "5.00", bankChargeUsd: "1.00",
})]);
check("taka and dollars at once is refused on every door, by name",
  twice.every(([, r]) => r.status === 400 && TWICE.test(msgOf(r))), twice.map(([n, r]) => `${n} ${r.status}`).join(", "));
const noPayment = await call("POST", `/subscriptions/${planId}/upgrade`, {
  upgradedOn: "2026-09-20", toPlanName: "Silent", toCostUsd: "150.00", usdRate: "123.00", bankChargeUsd: "1.00",
});
check("an upgrade's bank charge with nothing charged is refused, not dropped in silence",
  noPayment.status === 400 && /needs the upgrade's own charge/.test(msgOf(noPayment)), `HTTP ${noPayment.status} ${msgOf(noPayment).trim()}`);
const zeroAndDollars = await call("POST", "/transactions", {
  direction: "out", txnDate: "2026-09-21", accountId: dollar, amount: "121.50", categoryId: outCat.id,
  description: `${MARK} zero and dollars`, usdRate: "121.50", originalAmount: "1.00", originalCurrency: "USD", fxRate: "121.50",
  chargeAmount: "0.00", chargeUsd: "0.50",
});
const [cz] = zeroAndDollars.status === 201 ? await liveCharges(zeroAndDollars.body.id) : [];
check("but a zero in one box beside a figure in the other is simply that figure", cz?.usd === "0.50" && cz?.amount === "60.75", `HTTP ${zeroAndDollars.status} ${JSON.stringify(cz)}`);

console.log("\n   restated between currencies");
await call("PATCH", `/transactions/${spend.body.id}`, { chargeAmount: "300.00" });
let [cs] = await liveCharges(spend.body.id);
check("dollars → taka: the same row, ৳300.00, and the three fx columns cleared together",
  cs?.id === spendChargeId && cs?.amount === "300.00" && fxClear(cs), JSON.stringify(cs));
await call("PATCH", `/transactions/${spend.body.id}`, { chargeUsd: "3.00" });
[cs] = await liveCharges(spend.body.id);
check("taka → dollars: still the same row, $3.00 → ৳364.50, the three set together",
  cs?.id === spendChargeId && cs?.amount === "364.50" && cs?.usd === "3.00" && cs?.cur === "USD" && Number(cs?.fx) === 121.5, JSON.stringify(cs));
check("and the account's own balance is $43.00 down — the $40 and the $3", cents(own0) - cents(await ownUsd(dollar)) === 4300 + 1000 + 115 + 100 + 50,
  `${own0} → ${await ownUsd(dollar)} (the float-trap and zero-box entries, with their charges, account for $12.65 more)`);
await call("PATCH", `/transactions/${spend.body.id}`, { notes: "untouched charge" });
[cs] = await liveCharges(spend.body.id);
check("an edit that does not mention the charge leaves it alone", cs?.id === spendChargeId && cs?.usd === "3.00", JSON.stringify(cs));
await call("PATCH", `/transactions/${spend.body.id}`, { chargeUsd: "0.00" });
check("$0.00 takes the charge off", (await liveCharges(spend.body.id)).length === 0);
await call("PATCH", `/transactions/${spend.body.id}`, { chargeUsd: "2.00" });
const spendCharges = await liveCharges(spend.body.id);
check("and a new one goes back on — one row, $2.00", spendCharges.length === 1 && spendCharges[0].usd === "2.00" && spendCharges[0].amount === "243.00", JSON.stringify(spendCharges));

const noRate = await call("POST", "/transactions", {
  direction: "out", txnDate: "2026-09-21", accountId: taka, amount: "500.00", categoryId: outCat.id,
  description: `${MARK} before rates`, usdRate: "122.00",
});
await q(`update transactions set usd_rate = null where id = $1`, [noRate.body.id]);
const noRateUsd = await call("PATCH", `/transactions/${noRate.body.id}`, { chargeUsd: "1.00" });
check("an entry with no rate refuses a dollar charge, and says why", noRateUsd.status === 400 && /no USD rate/.test(msgOf(noRateUsd)), `HTTP ${noRateUsd.status} ${msgOf(noRateUsd).trim()}`);
const noRateTaka = await call("PATCH", `/transactions/${noRate.body.id}`, { chargeAmount: "20.00" });
const [cnr] = await liveCharges(noRate.body.id);
check("while taka still goes", noRateTaka.status === 200 && cnr?.amount === "20.00" && fxClear(cnr), `HTTP ${noRateTaka.status} ${JSON.stringify(cnr)}`);

/* ================================================================= PART B */
console.log("\nB. One live charge per entry, on every path");
const one = async (parentId, label, extra) => {
  const rows = await liveCharges(parentId);
  check(label, rows.length === 1 && (!extra || extra(rows[0])), JSON.stringify(rows.map((r) => ({ id: r.id.slice(0, 8), amount: r.amount, usd: r.usd }))));
  return rows[0];
};

const cashIn = await call("POST", "/transactions/cash-in", {
  txnDate: "2026-09-15", accountId: dollar, amount: "121500.00", usdSent: "1000.00", usdRate: "121.50",
  description: `${MARK} September funding`, chargeUsd: "2.00",
});
const ci0 = await one(cashIn.body.id, "Cash In, recorded with a $2.00 charge: one", (c) => c.amount === "243.00" && c.usd === "2.00");
await call("PATCH", `/transactions/${cashIn.body.id}`, { chargeUsd: "2.50" });
await one(cashIn.body.id, "edited to $2.50: still one, the same row", (c) => c.id === ci0.id && c.amount === "303.75");
await call("PATCH", `/transactions/${cashIn.body.id}`, { chargeAmount: "250.00" });
await one(cashIn.body.id, "edited to ৳250.00: still one, the same row", (c) => c.id === ci0.id && fxClear(c));
await call("PATCH", `/transactions/${cashIn.body.id}`, { chargeUsd: "2.00" });
await one(cashIn.body.id, "and back to $2.00: still one", (c) => c.id === ci0.id && c.usd === "2.00");

const ownT0 = await ownUsd(dollar);
const xfer = await call("POST", "/transactions/transfer", {
  txnDate: "2026-09-22", fromAccountId: dollar, toAccountId: takaTwo, amount: "6075.00", usdAmount: "50.00", usdRate: "121.50",
  chargeUsd: "1.00", description: `${MARK} fifty dollars home`, paymentMethod: "bank_transfer",
});
const xferOut = xfer.body?.id;
const xc0 = await one(xferOut, "a transfer from the dollar account with a $1.00 charge: one, on the paying side",
  (c) => c.amount === "121.50" && c.usd === "1.00" && c.account_id === dollar);
check("and the dollar account's own balance moved by exactly $51.00", cents(ownT0) - cents(await ownUsd(dollar)) === 5100, `${ownT0} → ${await ownUsd(dollar)}`);
const xferBody = { txnDate: "2026-09-22", amount: "6075.00", usdAmount: "50.00", usdRate: "121.50", description: `${MARK} fifty dollars home`, paymentMethod: "bank_transfer" };
await call("PATCH", `/transactions/transfer/${xferOut}`, { ...xferBody, chargeUsd: "1.50" });
await one(xferOut, "corrected to $1.50: one, the same row", (c) => c.id === xc0.id && c.amount === "182.25");
await call("PATCH", `/transactions/transfer/${xferOut}`, { ...xferBody, chargeAmount: "200.00" });
await one(xferOut, "corrected to ৳200.00: one, the same row, fx cleared", (c) => c.id === xc0.id && fxClear(c));
await call("PATCH", `/transactions/transfer/${xferOut}`, { ...xferBody, chargeUsd: "1.00" });
await one(xferOut, "and back to $1.00: one", (c) => c.id === xc0.id && c.usd === "1.00");
const xferTwice = await call("PATCH", `/transactions/transfer/${xferOut}`, { ...xferBody, chargeAmount: "5.00", chargeUsd: "1.00" });
check("a transfer correction with both is refused too", xferTwice.status === 400 && TWICE.test(msgOf(xferTwice)), `HTTP ${xferTwice.status}`);

const takaXfer = await call("POST", "/transactions/transfer", {
  txnDate: "2026-09-22", fromAccountId: taka, toAccountId: takaTwo, amount: "5000.00", usdRate: "122.00",
  chargeAmount: "50.00", description: `${MARK} taka to taka`, paymentMethod: "bank_transfer",
});
await one(takaXfer.body.id, "a taka transfer with a ৳50.00 charge: one, in taka", (c) => c.amount === "50.00" && fxClear(c));

/* Three saves of one entry at once. */
const race = await call("POST", "/transactions", {
  direction: "out", txnDate: "2026-09-23", accountId: taka, amount: "700.00", categoryId: outCat.id,
  description: `${MARK} three saves at once`, usdRate: "122.00",
});
const raced = await Promise.all([10, 11, 12].map((n) => call("PATCH", `/transactions/${race.body.id}`, { chargeAmount: `${n}.00` })));
check("three saves of the same entry at once all answer", raced.every((r) => r.status === 200), raced.map((r) => r.status).join(","));
await one(race.body.id, "and leave ONE charge, not three");
const racedUsd = await Promise.all(["1.00", "1.10", "1.20"].map((v) => call("PATCH", `/transactions/${race.body.id}`, { chargeUsd: v })));
check("the same in dollars", racedUsd.every((r) => r.status === 200), racedUsd.map((r) => r.status).join(","));
await one(race.body.id, "one charge after that too");

/* The trash: a charge taken off, the entry given a new one, the old one restored. */
const [before] = await liveCharges(rent.body.id);
await call("PATCH", `/transactions/${rent.body.id}`, { chargeAmount: "0.00" });
await call("PATCH", `/transactions/${rent.body.id}`, { chargeAmount: "120.00" });
const [after] = await liveCharges(rent.body.id);
const restored = await call("POST", `/trash/transaction/${before.id}/restore`);
check("bringing back a charge the entry has since replaced is refused, naming the entry",
  restored.status === 400 && new RegExp(`belongs to ${readBackRef(rent)}`).test(msgOf(restored)) && /charge that entry twice/.test(msgOf(restored)),
  `HTTP ${restored.status} ${msgOf(restored).trim()}`);
await one(rent.body.id, "so the entry still has one charge — the new one", (c) => c.id === after.id && c.amount === "120.00");
const binParent = await call("POST", `/trash/transaction/${rent.body.id}`, { reason: `${MARK} round trip` });
const backParent = await call("POST", `/trash/transaction/${rent.body.id}/restore`);
check("while the entry and its charge still go in and come out of the trash together",
  binParent.status < 300 && backParent.status < 300, `bin ${binParent.status}, restore ${backParent.status} ${backParent.status >= 300 ? msgOf(backParent) : ""}`);
await one(rent.body.id, "with one charge", (c) => c.id === after.id);
function readBackRef(created) {
  return created.body?.refNo ?? "???";
}

/* ======================================================== PART C: forms */
console.log("\nC. The forms ask by the entry's currency");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
let renewPay = null;
let upgradePay = null;
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  const waitFor = (fn, arg, ms = 15000) =>
    page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg).then(() => true).catch(() => false);
  const fill = (values) =>
    page.evaluate((vals) => {
      const b = [...document.querySelectorAll("[data-popup]")].pop();
      const missing = [];
      for (const [name, value] of Object.entries(vals)) {
        const el = b.querySelector(`[name="${name}"]`);
        if (!el) { missing.push(name); continue; }
        const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return missing;
    }, values);
  const press = (text) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll("[data-popup]")].pop();
      const button = [...(b?.querySelectorAll("button") ?? [])].find((x) => (x.textContent ?? "").trim() === t);
      button?.click();
      return Boolean(button);
    }, text);
  /* The charge box as the person sees it: its label, the input's name, its value, the line under it. */
  const chargeBox = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("[data-popup]")].pop();
      const label = [...(b?.querySelectorAll("label") ?? [])].find((l) => /^Bank charge \((USD|BDT)\)/.test(l.querySelector("span")?.textContent?.trim() ?? ""));
      if (!label) return null;
      const input = label.querySelector("input");
      const spans = [...label.querySelectorAll(":scope > span")];
      return {
        label: label.querySelector("span").textContent.replace("*", "").trim(),
        name: input?.getAttribute("name") ?? null,
        value: input?.value ?? null,
        hint: spans.length > 1 ? spans[spans.length - 1].textContent.trim() : "",
        canSwitch: Boolean(label.querySelector("[data-charge-switch]")),
      };
    });
  const chooseAccount = async (fieldLabel, name) => {
    const opened = await page.evaluate((want) => {
      const b = [...document.querySelectorAll("[data-popup]")].pop();
      const label = [...b.querySelectorAll("label")].find((l) => l.querySelector("span")?.textContent?.replace("*", "").trim() === want);
      const combo = label?.querySelector('[role="combobox"]');
      if (!combo) return false;
      combo.click();
      return true;
    }, fieldLabel);
    if (!opened) return "no combobox";
    await settle(500);
    const picked = await page.evaluate((want) => {
      const option = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent ?? "").includes(want));
      option?.click();
      return Boolean(option);
    }, name);
    await settle(700);
    return picked ? "picked" : "option not found";
  };
  const closeAll = async () => {
    await page.keyboard.press("Escape");
    await settle(300);
  };
  const openRowEdit = async (id) => {
    await waitFor((rid) => Boolean(document.querySelector(`tbody tr[data-row-id="${rid}"]`)), id);
    const clicked = await page.evaluate((rid) => {
      const b = document.querySelector(`tbody tr[data-row-id="${rid}"] button[aria-label="Edit"]`);
      b?.click();
      return Boolean(b);
    }, id);
    await waitFor(() => /Edit/.test([...document.querySelectorAll("[data-popup]")].pop()?.querySelector("h2")?.textContent ?? ""));
    await settle(600);
    return clicked;
  };
  let lastMiss = null;
  const openRecord = async (id) => {
    /* A register pages at twenty rows; the row may be on a later page. */
    let ok = await waitFor((rid) => Boolean(document.querySelector(`tbody tr[data-row-id="${rid}"]`)), id, 8000);
    for (let turn = 0; !ok && turn < 5; turn += 1) {
      const moved = await page.evaluate(() => {
        const next = [...document.querySelectorAll("main button")].find((b) => (b.textContent ?? "").trim() === "Next");
        if (!next || next.disabled) return false;
        next.click();
        return true;
      });
      if (!moved) break;
      ok = await waitFor((rid) => Boolean(document.querySelector(`tbody tr[data-row-id="${rid}"]`)), id, 4000);
    }
    if (!ok) { lastMiss = await page.evaluate(() => ({ rows: document.querySelectorAll("tbody tr[data-row-id]").length, pager: [...document.querySelectorAll("main button")].filter((b) => /^(Next|Previous)$/.test((b.textContent ?? "").trim())).map((b) => b.textContent.trim() + (b.disabled ? "(off)" : "")).join(",") })); return false; }
    const idx = await page.evaluate((rid) => {
      const cells = [...document.querySelectorAll(`tbody tr[data-row-id="${rid}"] td`)];
      return cells.findIndex((td) => (td.textContent ?? "").trim() && !td.querySelector("a, button, input, select, label, [data-row-ignore]")) + 1;
    }, id);
    /* Twice at most: a click that lands while the table is re-rendering
       under it opens nothing, and that is the harness's timing, not the app. */
    for (let attempt = 0; attempt < 2; attempt += 1) {
      /* Centred first: the sticky top bar covers a row scrolled only just
         into view, and the click lands on the bar. */
      await page.evaluate((rid) => document.querySelector(`tbody tr[data-row-id="${rid}"]`)?.scrollIntoView({ block: "center" }), id);
      await settle(200);
      await page.click(`tbody tr[data-row-id="${id}"] td:nth-child(${idx})`);
      if (await waitFor(() => Boolean(document.querySelector("[data-popup] h2")), undefined, 5000)) return true;
    }
    return false;
  };
  const popupText = () => page.evaluate(() => ([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? "").replace(/\s+/g, " "));

  /* ---------------------------------------------------------- Cash In */
  console.log("\n   Cash In");
  await page.goto(`${WEB}/accounts/cash-in`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Add cash/.test(b.textContent ?? ""))?.click());
  await waitFor(() => Boolean([...document.querySelectorAll("[data-popup]")].pop()?.querySelector('[role="combobox"]')));
  await chooseAccount("Received Bank Name", `${MARK} Taka`);
  const ciTaka = await chargeBox();
  check("on a taka account it asks Bank charge (BDT)", ciTaka?.label === "Bank charge (BDT)" && ciTaka?.name === "chargeAmount", JSON.stringify(ciTaka));
  await fill({ chargeAmount: "99" });
  await chooseAccount("Received Bank Name", `${MARK} Dollar`);
  const ciUsd = await chargeBox();
  check("on the dollar account it asks Bank charge (USD) — and the ৳99 typed for the taka account is not carried over as $99",
    ciUsd?.label === "Bank charge (USD)" && ciUsd?.name === "chargeUsd" && ciUsd?.value === "", JSON.stringify(ciUsd));
  await fill({ txnDate: "2026-09-16", description: `${MARK} form funding`, usdSent: "500", usdRate: "121.5" });
  await settle(300);
  await fill({ chargeUsd: "2" });
  await settle(400);
  const ciHint = await chargeBox();
  check("and reads the dollars back in taka at the entry's rate as they are typed", /৳243\.00/.test(ciHint?.hint ?? ""), ciHint?.hint);
  await press("Add it");
  await waitFor(() => ![...document.querySelectorAll("[data-popup]")].some((p) => /Add cash/.test(p.querySelector("h2")?.textContent ?? "")), undefined, 20000);
  await settle(800);
  const formCashIn = (await q(`select id, ref_no from transactions where description = $1 and deleted_at is null`, [`${MARK} form funding`]))[0];
  const fci = formCashIn ? await one(formCashIn.id, "saved from the form: one charge, $2.00 → ৳243.00", (c) => c.usd === "2.00" && c.amount === "243.00" && c.exact) : null;

  await page.goto(`${WEB}/accounts/cash-in`, { waitUntil: "networkidle0", timeout: 120000 });
  if (formCashIn) await openRowEdit(formCashIn.id);
  const ciEdit = await chargeBox();
  check("its edit reopens the charge in dollars — Bank charge (USD), 2.00", ciEdit?.label === "Bank charge (USD)" && ciEdit?.value === "2.00", JSON.stringify(ciEdit));
  await fill({ chargeUsd: "3" });
  await press("Save changes");
  await waitFor(() => ![...document.querySelectorAll("[data-popup]")].some((p) => /^Edit/.test(p.querySelector("h2")?.textContent ?? "")), undefined, 20000);
  await settle(800);
  if (formCashIn) await one(formCashIn.id, "saved as $3.00 → ৳364.50, the same row", (c) => c.id === fci?.id && c.usd === "3.00" && c.amount === "364.50");

  /* An old charge: typed in taka on a dollar entry, before this rule. */
  const oldStyle = await call("POST", "/transactions/cash-in", {
    txnDate: "2026-09-17", accountId: dollar, amount: "60750.00", usdSent: "500.00", usdRate: "121.50",
    description: `${MARK} old style funding`, chargeAmount: "200.00",
  });
  const [oldCharge] = await liveCharges(oldStyle.body.id);
  await page.goto(`${WEB}/accounts/cash-in`, { waitUntil: "networkidle0", timeout: 120000 });
  await openRowEdit(oldStyle.body.id);
  const ciOld = await chargeBox();
  check("an old taka charge on a dollar entry reopens as it was entered — Bank charge (BDT), 200.00 — and offers dollars",
    ciOld?.label === "Bank charge (BDT)" && ciOld?.value === "200.00" && ciOld?.canSwitch, JSON.stringify(ciOld));
  await page.evaluate(() => [...document.querySelectorAll("[data-popup]")].pop()?.querySelector("[data-charge-switch]")?.click());
  await settle(400);
  const ciSwitched = await chargeBox();
  check("one click and it asks in dollars", ciSwitched?.label === "Bank charge (USD)" && ciSwitched?.value === "" && !ciSwitched?.canSwitch, JSON.stringify(ciSwitched));
  await fill({ chargeUsd: "1.5" });
  await press("Save changes");
  await waitFor(() => ![...document.querySelectorAll("[data-popup]")].some((p) => /^Edit/.test(p.querySelector("h2")?.textContent ?? "")), undefined, 20000);
  await settle(800);
  await one(oldStyle.body.id, "restated as $1.50 → ৳182.25: the same row, the fx columns now set", (c) => c.id === oldCharge.id && c.usd === "1.50" && c.amount === "182.25" && c.cur === "USD");

  /* ---------------------------------------------------------- An entry */
  console.log("\n   An entry (Other expenses, a register)");
  await page.goto(`${WEB}/expenses/other`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Add expense/.test(b.textContent ?? ""))?.click());
  await waitFor(() => Boolean([...document.querySelectorAll("[data-popup]")].pop()?.querySelector('[role="combobox"]')));
  await chooseAccount("Account", `${MARK} Dollar`);
  const exUsd = await chargeBox();
  check("the entry form on the dollar account asks Bank charge (USD)", exUsd?.label === "Bank charge (USD)" && exUsd?.name === "chargeUsd", JSON.stringify(exUsd));
  await chooseAccount("Account", `${MARK} Taka`);
  const exTaka = await chargeBox();
  check("and on a taka account Bank charge (BDT)", exTaka?.label === "Bank charge (BDT)" && exTaka?.name === "chargeAmount", JSON.stringify(exTaka));
  await closeAll();

  await page.goto(`${WEB}/accounts/${dollar}/register`, { waitUntil: "networkidle0", timeout: 120000 });
  await openRowEdit(spend.body.id);
  const exEdit = await chargeBox();
  check("a dollar entry's edit reopens its charge in dollars — 2.00", exEdit?.label === "Bank charge (USD)" && exEdit?.value === "2.00", JSON.stringify(exEdit));
  await fill({ chargeUsd: "2.5" });
  await press("Save changes");
  await waitFor(() => ![...document.querySelectorAll("[data-popup]")].some((p) => /^Edit/.test(p.querySelector("h2")?.textContent ?? "")), undefined, 20000);
  await settle(800);
  await one(spend.body.id, "saved as $2.50 → ৳303.75, one row", (c) => c.usd === "2.50" && c.amount === "303.75");

  await page.goto(`${WEB}/accounts/${taka}/register`, { waitUntil: "networkidle0", timeout: 120000 });
  await openRowEdit(rent.body.id);
  const exTakaEdit = await chargeBox();
  check("a taka entry's edit reopens its charge in taka — 120.00, nothing to switch", exTakaEdit?.label === "Bank charge (BDT)" && exTakaEdit?.value === "120.00" && !exTakaEdit?.canSwitch, JSON.stringify(exTakaEdit));
  await closeAll();

  /* ---------------------------------------------------------- Transfer */
  console.log("\n   Money Transfer");
  await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /New transfer/.test(b.textContent ?? ""))?.click());
  await waitFor(() => Boolean([...document.querySelectorAll("[data-popup]")].pop()?.querySelector('select[name="fromAccountId"]')));
  await fill({ fromAccountId: taka, toAccountId: takaTwo });
  await settle(400);
  const trTaka = await chargeBox();
  check("taka to taka asks Bank charge (BDT)", trTaka?.label === "Bank charge (BDT)" && trTaka?.name === "chargeAmount", JSON.stringify(trTaka));
  await fill({ toAccountId: dollar });
  await settle(400);
  const trUsd = await chargeBox();
  check("with the dollar account on a side it asks Bank charge (USD)", trUsd?.label === "Bank charge (USD)" && trUsd?.name === "chargeUsd", JSON.stringify(trUsd));
  await closeAll();
  await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
  await openRowEdit(xferOut);
  const trEdit = await chargeBox();
  check("a dollar transfer's edit reopens its charge in dollars — 1.00", trEdit?.label === "Bank charge (USD)" && trEdit?.value === "1.00", JSON.stringify(trEdit));
  await fill({ chargeUsd: "1.25" });
  await press("Save changes");
  await waitFor(() => ![...document.querySelectorAll("[data-popup]")].some((p) => /Edit transfer/.test(p.querySelector("h2")?.textContent ?? "")), undefined, 20000);
  await settle(800);
  await one(xferOut, "saved as $1.25 → ৳151.88, the same row", (c) => c.id === xc0.id && c.usd === "1.25" && c.amount === "151.88" && c.exact);
  await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
  await openRowEdit(takaXfer.body.id);
  const trTakaEdit = await chargeBox();
  check("a taka transfer's edit reopens in taka — 50.00", trTakaEdit?.label === "Bank charge (BDT)" && trTakaEdit?.value === "50.00", JSON.stringify(trTakaEdit));
  await closeAll();

  /* ---------------------------------------------------------- Renew and Upgrade */
  console.log("\n   Renew and Upgrade");
  const openRegister = async () => {
    await page.goto(`${WEB}/subscriptions?status=all`, { waitUntil: "networkidle0", timeout: 120000 });
    await page.evaluate(() => {
      const month = [...document.querySelectorAll("main select")].find((s) => [...s.options].some((o) => /Every month/i.test(o.text)));
      if (!month) return;
      const every = [...month.options].find((o) => /Every month/i.test(o.text));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(month, every.value);
      month.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor((id) => Boolean(document.querySelector(`tbody tr[data-row-id="${id}"]`)), planId);
    await settle(400);
  };
  await openRegister();
  await page.click(`tbody tr[data-row-id="${planId}"] button[aria-label="Renew ${TOOL}"]`);
  await waitFor(() => /Renew —/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""));
  const rnBox = await chargeBox();
  check("Renew asks Bank charge (USD) — a plan is billed in dollars", rnBox?.label === "Bank charge (USD)" && rnBox?.name === "chargeUsd", JSON.stringify(rnBox));
  await fill({ txnDate: "2026-09-10" });
  await fill({ chargeUsd: "1.25" });
  await settle(400);
  const rnHint = await chargeBox();
  check("and reads it back at the plan's rate — ৳153.75", /৳153\.75/.test(rnHint?.hint ?? ""), rnHint?.hint);
  await press("Renew");
  await waitFor(() => ![...document.querySelectorAll("[data-popup]")].some((p) => /Renew —/.test(p.innerText ?? "")), undefined, 20000);
  await settle(800);
  renewPay = (await q(`select t.id from transactions t where t.subscription_id = $1 and t.charge_for_id is null and t.deleted_at is null
                          and not exists (select 1 from subscription_upgrades u where u.transaction_id = t.id) order by t.created_at desc limit 1`, [planId]))[0];
  if (renewPay) await one(renewPay.id, "the renewal: one charge, $1.25 → ৳153.75", (c) => c.usd === "1.25" && c.amount === "153.75" && c.exact);
  else check("the renewal was recorded", false, (await popupText()).slice(0, 200));

  await openRegister();
  await page.click(`tbody tr[data-row-id="${planId}"] button[aria-label="Upgrade ${TOOL}"]`);
  await waitFor(() => /Upgrade —/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""));
  const upBox = await chargeBox();
  check("Upgrade asks Bank charge (USD)", upBox?.label === "Bank charge (USD)" && upBox?.name === "bankChargeUsd", JSON.stringify(upBox));
  await fill({ upgradedOn: "2026-09-20", toPlanName: "Max 20x", toCostUsd: "200", chargedUsd: "50" });
  await settle(500);
  await fill({ bankChargeUsd: "0.75" });
  await settle(300);
  await press("Upgrade");
  await waitFor(() => ![...document.querySelectorAll("[data-popup]")].some((p) => /Upgrade —/.test(p.innerText ?? "")), undefined, 20000);
  await settle(800);
  upgradePay = (await q(`select u.transaction_id id from subscription_upgrades u where u.subscription_id = $1 and u.transaction_id is not null order by u.created_at desc limit 1`, [planId]))[0];
  if (upgradePay) await one(upgradePay.id, "the upgrade's payment: one charge, $0.75 → ৳92.25", (c) => c.usd === "0.75" && c.amount === "92.25" && c.exact);
  else check("the upgrade was recorded", false, (await popupText()).slice(0, 200));
  if (renewPay) await one(renewPay.id, "and the renewal still has exactly its own one");

  /* ======================================================== PART D: records */
  console.log("\nD. A charge's record names its entry");
  const chargeOf = async (parentId) => (await liveCharges(parentId))[0]?.id;
  const cases = [
    { parent: spend.body, account: dollar, kind: /What it was Expense — /, desc: `${MARK} card spend` },
    { parent: cashIn.body, account: dollar, kind: /What it was Cash In/, desc: `${MARK} September funding` },
    { parent: xfer.body, account: dollar, kind: new RegExp(`What it was Money transfer to ${MARK} Second Taka`), desc: `${MARK} fifty dollars home` },
    renewPay ? { parent: { id: renewPay.id }, account: dollar, kind: /What it was Subscription renewal/, desc: `${TOOL} subscription` } : null,
    upgradePay ? { parent: { id: upgradePay.id }, account: dollar, kind: /What it was Subscription upgrade — to Max 20x/, desc: `${TOOL} — upgrade to Max 20x` } : null,
  ].filter(Boolean);
  await page.goto(`${WEB}/accounts/${dollar}/register`, { waitUntil: "networkidle0", timeout: 120000 });
  for (const c of cases) {
    const ref = (await q(`select ref_no from transactions where id = $1`, [c.parent.id]))[0]?.ref_no;
    const chargeId = await chargeOf(c.parent.id);
    await closeAll();
    const opened = chargeId ? await openRecord(chargeId) : false;
    await waitFor(() => /Its description/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""), undefined, 10000);
    const text = await popupText();
    if (process.env.SHOT_DIR && !text) await page.screenshot({ path: `${process.env.SHOT_DIR}/chargecurrencyqa-miss.png`, fullPage: true });
    check(`the record of ${c.desc}'s charge names ${ref}, what it was and its description`,
      opened && /Bank charge for/i.test(text) && text.includes(`Entry No. ${ref}`) && c.kind.test(text) && text.includes(`Its description ${c.desc}`),
      `${opened ? "" : `row ${chargeId} not opened ${JSON.stringify(lastMiss)}; `}${text.slice(0, 260)}`);
  }
  /* The dollar charge reads in dollars, and Open goes to the entry and back. */
  await closeAll();
  await openRecord(await chargeOf(spend.body.id));
  await waitFor(() => /Its description/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""), undefined, 10000);
  const dollarRecord = await popupText();
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/chargecurrencyqa-record.png` });
  check("a dollar charge's record leads with its dollars — Charged in dollars $2.50", /Charged in dollars \$2\.50/.test(dollarRecord), dollarRecord.match(/Money.{0,120}/)?.[0]);
  await page.evaluate(() => [...document.querySelectorAll("[data-popup]")].pop()?.querySelector("[data-open-charged-entry]")?.click());
  await waitFor(() => /Back to the bank charge/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""), undefined, 8000);
  const parentRecord = await page.evaluate(() => {
    const b = [...document.querySelectorAll("[data-popup]")].pop();
    return { title: b?.querySelector("h2")?.textContent?.trim(), text: (b?.innerText ?? "").replace(/\s+/g, " ") };
  });
  check("Open shows the entry's own record, with its charge in dollars and taka",
    parentRecord.title === `${MARK} card spend` && /Bank charge \$2\.50 ৳303\.75/.test(parentRecord.text), `${parentRecord.title} | ${parentRecord.text.match(/Bank charge.{0,30}/)?.[0]}`);
  await page.evaluate(() => [...[...document.querySelectorAll("[data-popup]")].pop().querySelectorAll("button")].find((b) => /Back to the bank charge/.test(b.textContent ?? ""))?.click());
  await settle(600);
  const backAgain = await page.evaluate(() => [...document.querySelectorAll("[data-popup]")].pop()?.querySelector("h2")?.textContent?.trim());
  check("and Back returns to the charge", backAgain === `Bank charge — ${MARK} card spend`, backAgain);
  await closeAll();

  /* An OLD charge: taka, and — like one written before charges carried a rate — none at all. */
  const rentCharge = await chargeOf(rent.body.id);
  await q(`update transactions set usd_rate = null where id = $1`, [rentCharge]);
  await page.goto(`${WEB}/accounts/${taka}/register`, { waitUntil: "networkidle0", timeout: 120000 });
  await openRecord(rentCharge);
  await waitFor(() => /Its description/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""), undefined, 10000);
  const oldText = await popupText();
  check("an old taka charge with no rate reads the same — Entry No., Expense, the entry's description",
    oldText.includes(`Entry No. ${rent.body.refNo}`) && /What it was Expense — /.test(oldText) && oldText.includes(`${MARK} office rent`) && /Bank charge — /.test(oldText),
    oldText.slice(0, 240));
  await closeAll();
  /* And a charge that is not one — an ordinary entry — has no such section and makes no extra request. */
  let extraReads = 0;
  const onReq = (r) => { if (/\/api\/transactions\/[0-9a-f-]{36}$/.test(r.url())) extraReads += 1; };
  page.on("request", onReq);
  await openRecord(rent.body.id);
  await settle(1200);
  page.off("request", onReq);
  const plainText = await popupText();
  check("an ordinary entry's record has no 'Bank charge for', and fetches nothing extra",
    /CCQA office rent/.test(plainText) && !/Bank charge for/i.test(plainText) && extraReads === 0, `${extraReads} extra read(s)`);
  await closeAll();
} finally {
  await browser.close();
}

/* ======================================================== the whole ledger */
console.log("\nE. The whole local ledger");
const dupes = await q(`select charge_for_id, count(*)::int n from transactions
                        where charge_for_id is not null and deleted_at is null and voided_at is null
                        group by 1 having count(*) > 1`);
check("no entry anywhere in this database carries more than one live bank charge", dupes.length === 0, JSON.stringify(dupes));
check("no 5xx and no page errors while driving the screens", errors.length === 0, errors.slice(0, 3).join(" | "));

await wipe();
const left = await q(`select count(*)::int n from accounts where name like $1`, [`${MARK} %`]);
check("clean-up: nothing of this run is left", left[0].n === 0 && (await q(`select count(*)::int n from subscriptions where tool_name = $1`, [TOOL]))[0].n === 0);
await db.end();

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
