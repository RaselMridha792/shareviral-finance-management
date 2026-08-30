/**
 * An account's primary currency, obeyed by every drawer.
 *
 * The owner's rule: an account chooses BDT or USD; a USD-primary account's
 * forms ask for dollars first and work the taka out at the rate. The ledger
 * still stores taka — every total in the app depends on that — and the typed
 * dollars ride along as the recorded original.
 *
 *     node .usdprimaryqa.mjs      (local only — writes and deletes)
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

/* ------------------------------------------------------------- fixtures */

await db.query(`delete from transactions where account_id in (select id from accounts where name like 'QA USD%')`);
await db.query(`delete from accounts where name like 'QA USD%'`);
const usdBank = (
  await call("POST", "/accounts", {
    name: "QA USD Bank",
    type: "bank",
    currency: "USD",
    openingBalance: "500000.00",
    openingBalanceOn: "2026-08-01",
  })
).body.id;
const bdtBank = (
  await call("POST", "/accounts", {
    name: "QA USD Counterpart",
    type: "bank",
    currency: "BDT",
    openingBalance: "100000.00",
    openingBalanceOn: "2026-08-01",
  })
).body.id;
const catOut = (
  await db.query("select id from categories where kind='out' and deleted_at is null limit 1")
).rows[0].id;

/* ------------------------- API: the originals land, the taka stays the sum */

// A USD-primary spend, as the flipped form sends it.
const spend = await call("POST", "/transactions", {
  direction: "out",
  txnDate: "2026-08-20",
  accountId: usdBank,
  amount: "4880.00",
  categoryId: catOut,
  description: "QA USD spend",
  paymentMethod: "card",
  usdRate: "122.00",
  originalAmount: "40.00",
  originalCurrency: "USD",
  fxRate: "122.00",
});
check("a dollars-first spend records", spend.status === 201, `HTTP ${spend.status}`);
const spendRow = (
  await db.query(
    "select amount, original_amount, original_currency, fx_rate from transactions where description='QA USD spend'",
  )
).rows[0];
check(
  "the ledger holds taka, the original holds the dollars",
  spendRow.amount === "4880.00" &&
    spendRow.original_amount === "40.00" &&
    spendRow.original_currency === "USD" &&
    Number(spendRow.fx_rate) === 122,
  JSON.stringify(spendRow),
);

// A transfer stated in dollars.
const transfer = await call("POST", "/transactions/transfer", {
  txnDate: "2026-08-21",
  fromAccountId: usdBank,
  toAccountId: bdtBank,
  amount: "12200.00",
  usdAmount: "100.00",
  usdRate: "122.00",
  description: "QA USD transfer",
});
check("a dollars-stated transfer records", transfer.status === 201, `HTTP ${transfer.status}`);
const halves = (
  await db.query(
    "select direction, amount, original_amount, usd_rate from transactions where description='QA USD transfer' order by direction",
  )
).rows;
check(
  "both halves carry the dollars and the rate, taka in amount",
  halves.length === 2 &&
    halves.every(
      (h) =>
        h.amount === "12200.00" &&
        h.original_amount === "100.00" &&
        Number(h.usd_rate) === 122,
    ),
  JSON.stringify(halves),
);
const listed = await call("GET", "/transactions/transfers?page=1&pageSize=20");
const trow = listed.body?.items?.find((r) => r.description === "QA USD transfer");
check(
  "the transfers table's USD columns are fed",
  trow?.usdAmount === "100.00" && Number(trow?.usdRate) === 122,
  JSON.stringify({ usdAmount: trow?.usdAmount, usdRate: trow?.usdRate }),
);

// The overdraft rule still counts taka: a USD account holds its BDT balance.
const balance = (
  await db.query(
    `select (opening_balance::numeric + coalesce((select sum(signed_amount) from transactions t
       where t.account_id = a.id and t.voided_at is null and t.deleted_at is null), 0))::text as bal
       from accounts a where a.id = $1`,
    [usdBank],
  )
).rows[0];
check(
  "the account's balance is taka arithmetic (500000 - 4880 - 12200)",
  Number(balance.bal) === 482920,
  balance.bal,
);

// The tooling heuristic no longer swallows a USD *bank*.
const toolSpend = await call(
  "GET",
  "/transactions?page=1&pageSize=50&excludeToolSpend=true",
);
check(
  "a USD bank's spend is NOT auto-classified as tooling",
  (toolSpend.body?.items ?? []).some((r) => r.description === "QA USD spend"),
  "present in the everything-but-tooling view",
);

/* ------------------------------------------------ browser: the three drawers */

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
await page.setViewport({ width: 1500, height: 1100 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. The transaction drawer flips when the USD account is picked.
// (All transactions has no add button by design — entries are written from
// the expense screens, so the flip is proven on Other expenses.)
await page.goto(`${WEB}/expenses/other`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Add expense/.test(b.textContent ?? ""))
    ?.click();
});
await settle(1200);
const drawerBefore = await page.evaluate(() => ({
  hasUsdInput: [...document.querySelectorAll("label")].some((l) =>
    /Amount \(USD\)/.test(l.textContent ?? "") &&
    !l.textContent?.includes("Worked out"),
  ),
}));
/*
 * Both account pickers are SearchableSelects — a button that opens a listbox
 * inside its own Field label. Find the Field by its label text, click its
 * combo, then click the wanted option. One helper, used for every picker.
 */
const pickSearchable = async (labelText, optionText) => {
  const step1 = await page.evaluate((label) => {
    const field = [...document.querySelectorAll("label")].find((l) =>
      (l.textContent ?? "").startsWith(label),
    );
    const combo = field?.querySelector("button");
    if (!combo) return "no combo for " + label;
    combo.click();
    return "opened";
  }, labelText);
  await settle(500);
  const step2 = await page.evaluate((option) => {
    const row = [...document.querySelectorAll('[role="option"]')].find((o) =>
      (o.textContent ?? "").includes(option),
    );
    if (!row) return "no option " + option;
    row.click();
    return "picked";
  }, optionText);
  await settle(700);
  return `${step1}/${step2}`;
};

const flipped = await pickSearchable("Account", "QA USD Bank");
const drawerAfter = await page.evaluate(() => {
  const labels = [...document.querySelectorAll("label, span")].map(
    (l) => l.textContent ?? "",
  );
  return {
    usdFirst: labels.some((t) =>
      /This account's primary currency/.test(t),
    ),
    bdtDerivedHint: labels.some((t) =>
      /Worked out from the dollars/.test(t),
    ),
  };
});
check(
  "the expense drawer flips to dollars-first on the USD account",
  drawerAfter.usdFirst && drawerAfter.bdtDerivedHint,
  JSON.stringify({ before: drawerBefore, after: drawerAfter, flipped }),
);
await page.keyboard.press("Escape");
await settle(400);

// 2. The transfer drawer grows the USD pair when a USD account is on a side.
await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /New transfer/.test(b.textContent ?? ""))
    .click();
});
await settle(900);
const transferDrawer = await page.evaluate((usdName) => {
  const from = document.querySelector('select[name="fromAccountId"]');
  const option = [...from.options].find((o) => o.textContent?.includes(usdName));
  if (option) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    ).set;
    setter.call(from, option.value);
    from.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return Boolean(option);
}, "QA USD Bank");
await settle(600);
const transferFlipped = await page.evaluate(() => ({
  usdPair: /Amount \(USD\)/.test(document.body.innerText) &&
    /state the dollars/.test(document.body.innerText),
  bdtDerived: /Worked out from the dollars/.test(document.body.innerText),
}));
check(
  "the transfer drawer asks for dollars when a USD account is on a side",
  transferDrawer && transferFlipped.usdPair && transferFlipped.bdtDerived,
  JSON.stringify(transferFlipped),
);
await page.keyboard.press("Escape");
await settle(400);

// 3. Cash In: the USD box turns required for a USD-primary destination.
await page.goto(`${WEB}/accounts/cash-in`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Add cash/.test(b.textContent ?? ""))
    .click();
});
await settle(1000);
const cashinPick = await pickSearchable("Received Bank Name", "QA USD Bank");
const cashinState = { found: cashinPick === "opened/picked", why: cashinPick };
await settle(600);
const cashinAfter = await page.evaluate(() => {
  const usdBox = document.querySelector('input[name="usdSent"]');
  const dest = document.querySelector('select[name="accountId"]');
  return {
    required: usdBox?.required ?? null,
    hint: /primary currency/.test(document.body.innerText),
    chosen: dest ? dest.selectedOptions[0]?.textContent?.trim() : null,
  };
});
check(
  "Cash In makes the dollars required for a USD-primary destination",
  cashinState.found && cashinAfter.required === true && cashinAfter.hint,
  JSON.stringify({ state: cashinState, after: cashinAfter }),
);

await browser.close();

/* ---------------------------------------------------------------- tidy up */
await db.query(`delete from transactions where account_id in (select id from accounts where name like 'QA USD%')`);
await db.query(`delete from accounts where name like 'QA USD%'`);
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
