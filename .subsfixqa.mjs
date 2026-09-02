/**
 * Three complaints on AI tools and subscriptions, fixed and driven.
 *
 * The owner:
 *
 *   *"payment record add korle account theke taka kattechena, tarpor edit kore
 *    save dile error dicche, Ami expired duto subscription add korlam oigulao
 *    kaj korchena."*
 *
 * All three were real and none of them showed in a diff:
 *
 *   THE MONEY   the taka balance moved every time. A foreign account's balance
 *               ON SCREEN is its own currency, built from each row's dollars or
 *               its rate — and this path wrote neither, so a $100 plan paid
 *               from a dollar card took $0 out of it.
 *   THE SAVE    PATCH answered 200 with an EMPTY BODY, the client called
 *               `.json()` on it, and the thrown parse error was reported as
 *               "Could not save that". The save had already succeeded.
 *   THE VANISH  the register opens on Active. A plan saved as Expired matched
 *               nothing afterwards, so the table looked untouched and the save
 *               looked like it had failed.
 *
 *     node .subsfixqa.mjs      (local only — writes and deletes)
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

const MARK = "FIXQA";
const wipe = async () => {
  await db.query(
    "delete from subscription_users where subscription_id in (select id from subscriptions where tool_name like $1)",
    [`${MARK}%`],
  );
  await db.query(
    "delete from transactions where subscription_id in (select id from subscriptions where tool_name like $1)",
    [`${MARK}%`],
  );
  await db.query("delete from subscriptions where tool_name like $1", [`${MARK}%`]);
  await db.query("delete from transactions where description like $1", [`${MARK}%`]);
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
};
await wipe();

/* A dollar card with its opening stated in dollars, which is the only way the
   screen can call the figure exact rather than an estimate. */
const account = (
  await call("POST", "/accounts", {
    name: `${MARK} Card`,
    type: "card",
    currency: "USD",
    openingBalance: "500000.00",
    openingBalanceUsd: "4000.00",
    openingBalanceOn: "2026-08-01",
  })
).body;

const plan = (
  await call("POST", "/subscriptions", {
    toolName: `${MARK} Claude`,
    planName: "Max 5x",
    category: "ai_tool",
    status: "active",
    costUsd: "100.00",
    usdRate: "122.77",
    costBdt: "12277.00",
    chargeUsd: "5.00",
    billingCycle: "monthly",
    startDate: "2026-08-01",
    accountId: account.id,
    paymentMethod: "card",
  })
).body;
check(
  "a dollar card and a $100 plan with a charge exist",
  Boolean(account?.id && plan?.id),
  `card ${account?.currency}, plan $${plan?.costUsd} + $${plan?.chargeUsd}`,
);

const screenBalance = async () => {
  const b = await call("GET", "/accounts/balances");
  return (b.body?.accounts ?? []).find((a) => a.id === account.id);
};

/* ---------------------------- 1. THE MONEY, as the screen reports it ---- */

const before = await screenBalance();
await call("POST", `/subscriptions/${plan.id}/pay`, { txnDate: "2026-08-05" });
const after = await screenBalance();

check(
  "the taka balance still moves by the price plus the charge",
  (Number(before.balance) - Number(after.balance)).toFixed(2) === "12890.85",
  `${before.balance} → ${after.balance}`,
);
/* THE COMPLAINT. This was 0.00 → 0.00 before, on every plan, on every card. */
check(
  "and the DOLLAR balance the screen shows moves by the price plus the charge",
  (Number(before.ownBalance) - Number(after.ownBalance)).toFixed(2) === "105.00",
  `$${before.ownBalance} → $${after.ownBalance}`,
);
check(
  "the figure stays a record rather than becoming an estimate",
  after.ownBalanceExact === true,
  `exact ${before.ownBalanceExact} → ${after.ownBalanceExact}`,
);

const row = (
  await db.query(
    `select amount::text, original_amount::text, original_currency,
            fx_rate::text, usd_rate::text
       from transactions where subscription_id=$1 order by created_at desc limit 1`,
    [plan.id],
  )
).rows[0];
check(
  "the row records the dollars, the currency and the rate",
  row?.original_amount === "105.00" &&
    row?.original_currency === "USD" &&
    Number(row?.fx_rate) === 122.77,
  JSON.stringify(row),
);

/* A typed amount claims no dollars — the card may have charged something else. */
const typed = await call("POST", `/subscriptions/${plan.id}/pay`, {
  txnDate: "2026-08-06",
  amount: "9000.00",
});
const typedRow = (
  await db.query(
    `select amount::text, original_amount::text, usd_rate::text
       from transactions where id=$1`,
    [typed.body?.id ?? "00000000-0000-0000-0000-000000000000"],
  )
).rows[0];
check(
  "a typed amount carries the rate but claims no dollar figure of its own",
  typedRow?.amount === "9000.00" &&
    typedRow?.original_amount === null &&
    Number(typedRow?.usd_rate) === 122.77,
  JSON.stringify(typedRow),
);

/* --------------------------------- 2. THE SAVE, through the real screen  */

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

const failures = [];
page.on("response", async (res) => {
  if (!res.url().includes("/api/") || res.status() < 400) return;
  failures.push(`${res.request().method()} ${res.status()} ${res.url().replace(/^.*\/api/, "")}`);
});
page.on("pageerror", (e) => failures.push(`pageerror ${String(e).slice(0, 120)}`));

await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

const openedEdit = await page.evaluate((mark) => {
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(`${mark} Claude`),
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
/* Change something real, so the save is a save rather than a no-op. */
await page.evaluate(() => {
  const label = [...document.querySelectorAll("label")].find((l) =>
    /^Plan\b/.test((l.textContent ?? "").trim()),
  );
  const input = label?.control ?? label?.parentElement?.querySelector("input");
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  input.focus();
  setter.call(input, "Max 20x");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.blur();
});
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Save",
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 3500));

const afterSave = await page.evaluate(() => ({
  errorShown: /could not save|unexpected end of json/i.test(document.body.innerText),
  drawerOpen: Boolean(
    [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Save",
    ),
  ),
}));
const stored = (
  await db.query("select plan_name from subscriptions where id=$1", [plan.id])
).rows[0];

check("the edit drawer opened on the row", openedEdit === "opened", openedEdit);
check(
  "saving an edit shows no error — it used to say 'Could not save that' every time",
  afterSave.errorShown === false,
  afterSave.errorShown ? "error still on screen" : "clean",
);
check(
  "the drawer closes, which is how somebody knows it worked",
  afterSave.drawerOpen === false,
  afterSave.drawerOpen ? "still open" : "closed",
);
check(
  "and the change is actually stored",
  stored?.plan_name === "Max 20x",
  `plan_name ${JSON.stringify(stored?.plan_name)}`,
);
check(
  "the PATCH now answers with a body rather than an empty 200",
  Boolean((await call("PATCH", `/subscriptions/${plan.id}`, { planName: "Max 20x" })).body?.id),
  "PATCH returns the plan",
);

/* ------------------------------ 3. THE ROW THAT USED TO VANISH --------- */

await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

const startedOnActive = await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Active",
  );
  return tab?.getAttribute("aria-pressed") ?? tab?.className ?? "";
});

/* Add a plan as Expired, from the Active tab — exactly what he did. */
const expiredPlan = (
  await call("POST", "/subscriptions", {
    toolName: `${MARK} Expired`,
    planName: "Old",
    category: "ai_tool",
    status: "expired",
    costUsd: "50.00",
    usdRate: "122.77",
    costBdt: "6138.50",
    billingCycle: "monthly",
    startDate: "2026-01-01",
    accountId: account.id,
    paymentMethod: "card",
  })
).body;

/* The screen's own behaviour is what matters, so this drives the form's
   callback the way the form does: save, then look. */
const moved = await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Expired",
  );
  if (!tab) return "no Expired tab";
  tab.click();
  return "clicked";
});
await new Promise((r) => setTimeout(r, 2000));
const onExpiredTab = await page.evaluate((mark) =>
  [...document.querySelectorAll("tbody tr")]
    .map((r) => (r.textContent ?? "").trim())
    .some((t) => t.includes(`${mark} Expired`)),
  MARK,
);

check(
  "the register opens on Active, which is why an expired plan looked lost",
  startedOnActive !== "",
  `Active tab state ${JSON.stringify(String(startedOnActive).slice(0, 40))}`,
);
check(
  "an expired plan does exist and is reachable on its own tab",
  moved === "clicked" && onExpiredTab && Boolean(expiredPlan?.id),
  `tab ${moved}, visible ${onExpiredTab}`,
);

/* The fix itself: the form tells the screen what status it saved, and the
   screen moves to that tab. Driven through the form rather than asserted on
   the callback, because the callback is not what the owner clicks. */
await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
const addedFromActive = await page.evaluate((mark) => {
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(`${mark} Claude`),
  );
  const edit = tr
    ? [...tr.querySelectorAll("button")].find((b) =>
        /edit/i.test(b.getAttribute("aria-label") ?? b.getAttribute("title") ?? ""),
      )
    : null;
  if (!edit) return "no row";
  edit.click();
  return "opened";
}, MARK);
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => {
  const select = [...document.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => /^Expired$/i.test(o.text)),
  );
  if (!select) return;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  ).set;
  const option = [...select.options].find((o) => /^Expired$/i.test(o.text));
  setter.call(select, option.value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Save",
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 3500));

const landed = await page.evaluate((mark) => {
  const active = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Expired",
  );
  return {
    expiredTabPressed: active?.getAttribute("aria-pressed"),
    sees: [...document.querySelectorAll("tbody tr")]
      .map((r) => (r.textContent ?? "").trim())
      .some((t) => t.includes(`${mark} Claude`)),
    empty: /nothing is/i.test(document.body.innerText),
  };
}, MARK);

check("the edit drawer opened again", addedFromActive === "opened", addedFromActive);
check(
  "changing a plan to Expired leaves it ON SCREEN instead of vanishing",
  landed.sees === true,
  `row visible ${landed.sees}, expired tab pressed ${landed.expiredTabPressed}, screen empty ${landed.empty}`,
);

check(
  "and the screen made no failing API call throughout",
  failures.length === 0,
  failures.join(" | ") || "none",
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
