/**
 * A bank charge on every kind of transaction, as its own row.
 *
 * The owner: *"sob dhoroner transaction a ei charge ta rakho. karon bank charge
 * dorkar hoy sob transaction er khetrei."* Asked how a ৳115 charge on ৳10,000
 * of rent should count, he chose **a separate row under Bank charges** rather
 * than a bigger amount.
 *
 * That choice is what makes this worth driving rather than reading. A second
 * row is easy to write and easy to strand: void the payment and the charge
 * stays live, delete the payment and the charge is an orphan, clear the box on
 * an edit and a ৳0.00 line item sits on the Expenses screen for ever. So the
 * assertions here are mostly about what happens to the charge when something
 * happens to its parent — and each one is measured from the LEDGER, not from
 * the response.
 *
 *     node .bankchargeqa.mjs      (local only — writes and deletes)
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
const call = async (method, path_, body) => {
  const res = await fetch(API + path_, {
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

const MARK = "BCQA";
const wipe = async () => {
  await db.query(
    "delete from transactions where charge_for_id in (select id from transactions where description like $1)",
    [`%${MARK}%`],
  );
  await db.query("delete from transactions where description like $1", [`%${MARK}%`]);
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
};
await wipe();

const account = (
  await call("POST", "/accounts", {
    name: `${MARK} Bank`,
    type: "bank",
    currency: "BDT",
    openingBalance: "500000.00",
    openingBalanceOn: "2026-08-01",
  })
).body;
const other = (
  await call("POST", "/accounts", {
    name: `${MARK} Second`,
    type: "bank",
    currency: "BDT",
    openingBalance: "100000.00",
    openingBalanceOn: "2026-08-01",
  })
).body;

const outCat = (
  await db.query(
    "select id, name from categories where kind='out' and slug <> 'bank-charges' and deleted_at is null limit 1",
  )
).rows[0];
const bankChargeCat = (
  await db.query(
    "select id, name from categories where slug='bank-charges' and deleted_at is null limit 1",
  )
).rows[0];
check(
  "there is a Bank charges heading to file into",
  Boolean(bankChargeCat?.id),
  bankChargeCat?.name ?? "missing",
);

const balance = async (accountId) =>
  (
    await db.query(
      `select coalesce(sum(case when direction='in' then amount else -amount end),0)::numeric(14,2)::text m
         from transactions where account_id=$1 and voided_at is null and deleted_at is null`,
      [accountId],
    )
  ).rows[0].m;

const chargeRowOf = async (parentId) =>
  (
    await db.query(
      `select id, direction, amount::text, category_id, account_id, txn_date::text,
              description, voided_at is not null voided, deleted_at is not null deleted
         from transactions where charge_for_id=$1`,
      [parentId],
    )
  ).rows;

/* ------------------------------------ 1. an expense, and its charge row */

const before = await balance(account.id);
const rent = (
  await call("POST", "/transactions", {
    direction: "out",
    txnDate: "2026-08-05",
    accountId: account.id,
    amount: "10000.00",
    categoryId: outCat.id,
    description: `${MARK} office rent`,
    paymentMethod: "bank_transfer",
    chargeAmount: "115.00",
  })
).body;
const after = await balance(account.id);

check(
  "an expense with a charge is accepted",
  Boolean(rent?.id),
  `${rent?.refNo ?? JSON.stringify(rent).slice(0, 120)}`,
);

const charge = (await chargeRowOf(rent.id))[0];
check(
  "the charge is its OWN row, out, on the same account and date",
  charge?.direction === "out" &&
    charge?.amount === "115.00" &&
    charge?.account_id === account.id &&
    charge?.txn_date === "2026-08-05",
  charge ? `${charge.direction} ${charge.amount} on ${charge.txn_date}` : "no charge row",
);
check(
  "filed under Bank charges, not under the entry's own heading",
  charge?.category_id === bankChargeCat.id && charge?.category_id !== outCat.id,
  charge?.category_id === bankChargeCat.id ? bankChargeCat.name : "wrong heading",
);
check(
  "and named after the entry it was levied on",
  /^Bank charge — /.test(charge?.description ?? ""),
  charge?.description,
);
check(
  "the account is lighter by the amount PLUS the charge",
  (Number(before) - Number(after)).toFixed(2) === "10115.00",
  `${before} → ${after}`,
);

/* The point of the whole design: the heading keeps its own figure. */
const byHeading = (
  await db.query(
    `select c.name, sum(t.amount)::numeric(14,2)::text total
       from transactions t join categories c on c.id = t.category_id
      where t.account_id=$1 and t.voided_at is null and t.deleted_at is null
      group by c.name order by c.name`,
    [account.id],
  )
).rows;
check(
  "the expense heading counts 10,000 and Bank charges counts 115 — not 10,115 in one",
  byHeading.some((r) => r.name === outCat.name && r.total === "10000.00") &&
    byHeading.some((r) => r.name === bankChargeCat.name && r.total === "115.00"),
  JSON.stringify(byHeading),
);

/* The entry reads its own charge back, which is what the edit form shows. */
const readBack = (await call("GET", `/transactions/${rent.id}`)).body;
check(
  "the entry reports the charge levied on it",
  readBack?.chargeAmount === "115.00",
  `chargeAmount ${JSON.stringify(readBack?.chargeAmount)}`,
);

/* ----------------------------------------- 2. editing it, and clearing */

await call("PATCH", `/transactions/${rent.id}`, { chargeAmount: "200.00" });
const raised = (await chargeRowOf(rent.id)).filter((r) => !r.deleted);
check(
  "raising the charge rewrites the same row rather than adding a second",
  raised.length === 1 && raised[0].amount === "200.00",
  `${raised.length} live charge row(s), ${raised[0]?.amount}`,
);

/* An edit that says nothing about the charge must leave it alone. */
await call("PATCH", `/transactions/${rent.id}`, { notes: `${MARK} a note` });
const untouched = (await chargeRowOf(rent.id)).filter((r) => !r.deleted);
check(
  "an edit that never mentions the charge leaves it standing",
  untouched.length === 1 && untouched[0].amount === "200.00",
  `${untouched.length} live, ${untouched[0]?.amount}`,
);

await call("PATCH", `/transactions/${rent.id}`, { chargeAmount: "0.00" });
const cleared = (await chargeRowOf(rent.id)).filter((r) => !r.deleted);
check(
  "clearing the box removes the row rather than leaving a 0.00 line item",
  cleared.length === 0,
  `${cleared.length} live charge row(s)`,
);

/* Put one back for the rest of the story. */
await call("PATCH", `/transactions/${rent.id}`, { chargeAmount: "115.00" });
const restored = (await chargeRowOf(rent.id)).filter((r) => !r.deleted);
check(
  "typing one again writes a new row",
  restored.length === 1 && restored[0].amount === "115.00",
  `${restored.length} live, ${restored[0]?.amount}`,
);

/* A moved entry takes its charge with it. */
await call("PATCH", `/transactions/${rent.id}`, {
  txnDate: "2026-08-20",
  chargeAmount: "115.00",
});
const moved = (await chargeRowOf(rent.id)).filter((r) => !r.deleted)[0];
check(
  "moving the entry to another date moves its charge too",
  moved?.txn_date === "2026-08-20",
  `charge sits on ${moved?.txn_date}`,
);

/* ------------------------------------------------- 3. void and delete */

const beforeVoid = await balance(account.id);
await call("POST", `/transactions/${rent.id}/void`, {
  reason: `${MARK} voided for the test`,
});
/* The LIVE charge, not the first row returned. An earlier step cleared a
   charge and typed a new one, so this entry has a soft-deleted charge row as
   well — and the first draft asserted against that one and reported the void
   had not happened when it had. */
const voided = (await chargeRowOf(rent.id)).filter((r) => !r.deleted)[0];
const afterVoid = await balance(account.id);
check(
  "voiding the entry voids its charge with it",
  voided?.voided === true,
  voided?.voided ? "struck through" : "still live",
);
check(
  "and the account gets both figures back",
  (Number(afterVoid) - Number(beforeVoid)).toFixed(2) === "10115.00",
  `${beforeVoid} → ${afterVoid}`,
);

/* A fresh one, to delete rather than void. */
const stationery = (
  await call("POST", "/transactions", {
    direction: "out",
    txnDate: "2026-08-06",
    accountId: account.id,
    amount: "3000.00",
    categoryId: outCat.id,
    description: `${MARK} stationery`,
    paymentMethod: "bank_transfer",
    chargeAmount: "50.00",
  })
).body;
const del = await call("POST", `/trash/transaction/${stationery.id}`, {
  reason: `${MARK} binned for the test`,
});
const binned = await chargeRowOf(stationery.id);
check(
  "deleting the entry takes its charge into the bin as well",
  del.status < 300 && binned.every((r) => r.deleted),
  `HTTP ${del.status}, ${binned.filter((r) => r.deleted).length} of ${binned.length} deleted`,
);

const back = await call("POST", `/trash/transaction/${stationery.id}/restore`, {});
const restoredCharge = await chargeRowOf(stationery.id);
check(
  "restoring it brings the charge back too",
  back.status < 300 && restoredCharge.every((r) => !r.deleted),
  `HTTP ${back.status}, ${restoredCharge.filter((r) => !r.deleted).length} live`,
);

/* -------------------------------------- 4. cash in, and a transfer ---- */

const inBefore = await balance(account.id);
const wire = (
  await call("POST", "/transactions/cash-in", {
    txnDate: "2026-08-07",
    accountId: account.id,
    amount: "200000.00",
    usdRate: "122.77",
    description: `${MARK} funding`,
    paymentMethod: "bank_transfer",
    chargeAmount: "500.00",
  })
).body;
const inAfter = await balance(account.id);
const wireCharge = (await chargeRowOf(wire?.id ?? "")).filter((r) => !r.deleted)[0];
check(
  "a wire arriving can carry a charge, and it is an OUT row",
  Boolean(wire?.id) && wireCharge?.direction === "out" && wireCharge?.amount === "500.00",
  wireCharge ? `${wireCharge.direction} ${wireCharge.amount}` : `no charge (wire ${wire?.id})`,
);
check(
  "so the account nets the receipt less the charge",
  (Number(inAfter) - Number(inBefore)).toFixed(2) === "199500.00",
  `${inBefore} → ${inAfter}`,
);

const fromBefore = await balance(account.id);
const toBefore = await balance(other.id);
const moved2 = (
  await call("POST", "/transactions/transfer", {
    txnDate: "2026-08-08",
    fromAccountId: account.id,
    toAccountId: other.id,
    amount: "25000.00",
    description: `${MARK} moving funds`,
    paymentMethod: "bank_transfer",
    chargeAmount: "30.00",
  })
).body;
const fromAfter = await balance(account.id);
const toAfter = await balance(other.id);
const transferCharge = (await chargeRowOf(moved2?.id ?? "")).filter((r) => !r.deleted)[0];
check(
  "a transfer's charge lands on the account the money LEFT",
  transferCharge?.account_id === account.id && transferCharge?.amount === "30.00",
  transferCharge
    ? `${transferCharge.amount} on ${transferCharge.account_id === account.id ? "the from account" : "the wrong account"}`
    : `no charge (transfer ${moved2?.id})`,
);
check(
  "so the sending side loses the amount plus the charge and the receiving side gains the amount",
  (Number(fromBefore) - Number(fromAfter)).toFixed(2) === "25030.00" &&
    (Number(toAfter) - Number(toBefore)).toFixed(2) === "25000.00",
  `from ${fromBefore} → ${fromAfter}, to ${toBefore} → ${toAfter}`,
);

/* ------------------------------------------------ 5. what must NOT happen */

const noCharge = (
  await call("POST", "/transactions", {
    direction: "out",
    txnDate: "2026-08-09",
    accountId: account.id,
    amount: "1000.00",
    categoryId: outCat.id,
    description: `${MARK} no charge at all`,
    paymentMethod: "bank_transfer",
  })
).body;
check(
  "an entry with no charge writes no second row — nothing regressed",
  (await chargeRowOf(noCharge.id)).length === 0,
  `${(await chargeRowOf(noCharge.id)).length} charge rows`,
);

const zero = (
  await call("POST", "/transactions", {
    direction: "out",
    txnDate: "2026-08-10",
    accountId: account.id,
    amount: "1000.00",
    categoryId: outCat.id,
    description: `${MARK} a zero charge`,
    paymentMethod: "bank_transfer",
    chargeAmount: "0.00",
  })
).body;
check(
  "and a charge of zero writes none either",
  (await chargeRowOf(zero.id)).length === 0,
  `${(await chargeRowOf(zero.id)).length} charge rows`,
);

/* ------------------------------- 6. a charge cannot be charged -------- */

/* The wire's charge, which is live — `rent` was voided a few checks ago and a
   voided row refuses every edit, so it would have answered the wrong refusal. */
const chargeOfRent = wireCharge;
const onACharge = chargeOfRent
  ? await call("PATCH", `/transactions/${chargeOfRent.id}`, {
      chargeAmount: "10.00",
    })
  : { status: 0, body: null };
check(
  "a bank charge cannot itself carry one",
  onACharge.status >= 400 &&
    /itself a bank charge/i.test(onACharge.body?.message ?? ""),
  `HTTP ${onACharge.status} ${String(onACharge.body?.message ?? "").slice(0, 60)}`,
);
check(
  "and nothing was written by the attempt",
  chargeOfRent
    ? (
        await db.query(
          "select count(*)::int n from transactions where charge_for_id=$1",
          [chargeOfRent.id],
        )
      ).rows[0].n === 0
    : false,
  "no charge on the charge",
);

/* -------------------------------- the screens -------------------------- */

/*
 * The API is only half the claim. The owner asked for the box on every money
 * form, and a field that exists in the contract and not on the screen is the
 * kind of "done" this codebase has shipped before — so each of the three forms
 * is opened and the box looked for, and the main one is actually typed into.
 */
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1900, height: 1300 });

const apiFailures = [];
page.on("response", async (res) => {
  if (!res.url().includes("/api/") || res.status() < 400) return;
  apiFailures.push(`${res.request().method()} ${res.status()} ${res.url().replace(/^.*\/api/, "")}`);
});

const openForm = async (url, buttonText) => {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await new Promise((r) => setTimeout(r, 2500));
  const opened = await page.evaluate((want) => {
    const btn = [...document.querySelectorAll("button, a")].find((b) =>
      new RegExp(want, "i").test((b.textContent ?? "").trim()),
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, buttonText);
  await new Promise((r) => setTimeout(r, 2000));
  return opened;
};

const hasChargeBox = () =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll("label")].find((l) =>
      /^Bank charge \(BDT\)/.test((l.textContent ?? "").trim()),
    );
    const input = document.querySelector('input[name="chargeAmount"]');
    return { label: Boolean(label), input: Boolean(input) };
  });

/*
 * `/transactions` has no Add button — the owner had it taken off — so the form
 * is reached the way he reaches it: the pencil on a row. Which is the half
 * that matters anyway, because it is the round trip that can silently fail:
 * a box that saves but comes back empty next time is a charge somebody
 * re-types and doubles.
 */
const screenRow = (
  await call("POST", "/transactions", {
    direction: "out",
    txnDate: "2026-08-11",
    accountId: account.id,
    amount: "4000.00",
    categoryId: outCat.id,
    description: `${MARK} edited on the screen`,
    paymentMethod: "bank_transfer",
    chargeAmount: "77.00",
  })
).body;

await page.goto(`${WEB}/transactions`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));
const openedEdit = await page.evaluate((mark) => {
  /* The PARENT, not its charge. The charge row's own description is
     "Bank charge — BCQA edited on the screen", which contains the same words —
     and the first draft of this clicked edit on the charge, found a box
     reading 0.00, and reported the round trip broken when it was the harness
     that had opened the wrong row. */
  const tr = [...document.querySelectorAll("tbody tr")].find(
    (r) =>
      (r.textContent ?? "").includes(`${mark} edited on the screen`) &&
      !(r.textContent ?? "").includes("Bank charge —"),
  );
  if (!tr) return "row not found";
  const edit = [...tr.querySelectorAll("button")].find((b) =>
    /edit/i.test(b.getAttribute("aria-label") ?? b.getAttribute("title") ?? ""),
  );
  if (!edit) return "no edit button";
  edit.click();
  return "opened";
}, MARK);
await new Promise((r) => setTimeout(r, 2000));

const txnBox = await page.evaluate(() => {
  const label = [...document.querySelectorAll("label")].find((l) =>
    /^Bank charge \(BDT\)/.test((l.textContent ?? "").trim()),
  );
  const input = document.querySelector('input[name="chargeAmount"]');
  return { label: Boolean(label), value: input ? input.value : null };
});
check(
  "the entry form offers the Bank charge box",
  openedEdit === "opened" && txnBox.value !== null,
  `drawer ${openedEdit}, label ${txnBox.label}, value ${JSON.stringify(txnBox.value)}`,
);
check(
  "and it opens showing the charge already on the entry — no re-typing, no doubling",
  txnBox.value === "77.00",
  `box reads ${JSON.stringify(txnBox.value)}`,
);

const retyped = await page.evaluate(() => {
  const el = document.querySelector('input[name="chargeAmount"]');
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  el.focus();
  setter.call(el, "88.00");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.blur();
  const save = [...document.querySelectorAll("button")].find(
    (b) => /^Save/i.test((b.textContent ?? "").trim()),
  );
  save?.click();
  return true;
});
await new Promise((r) => setTimeout(r, 3500));

const afterScreenEdit = (
  await db.query(
    `select amount::text from transactions
      where charge_for_id=$1 and deleted_at is null and voided_at is null`,
    [screenRow.id],
  )
).rows[0];
check(
  "changing it on the screen and saving rewrites the charge row",
  retyped && afterScreenEdit?.amount === "88.00",
  `charge now ${afterScreenEdit?.amount}`,
);

const onCashIn = await openForm(`${WEB}/accounts/cash-in`, "Add cash");
const cashBox = await hasChargeBox();
check(
  "the Cash In form offers it too",
  onCashIn && cashBox.input,
  `drawer ${onCashIn}, label ${cashBox.label}, input ${cashBox.input}`,
);

const onTransfer = await openForm(`${WEB}/transfers`, "New transfer");
const transferBox = await hasChargeBox();
check(
  "and so does Money transfer",
  onTransfer && transferBox.input,
  `drawer ${onTransfer}, label ${transferBox.label}, input ${transferBox.input}`,
);

check(
  "no failing API call anywhere in that",
  apiFailures.length === 0,
  apiFailures.join(" | ") || "none",
);

await browser.close();
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
