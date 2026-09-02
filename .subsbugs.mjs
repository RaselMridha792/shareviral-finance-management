/**
 * Three complaints on AI tools and subscriptions, reproduced rather than guessed.
 *
 * The owner:
 *
 *   *"payment record add korle account theke taka kattechena, tarpor edit kore
 *    save dile error dicche, Ami expired duto subscription add korlam oigulao
 *    kaj korchena."*
 *
 * This is a DIAGNOSIS script, not an acceptance one: it drives the real screen
 * and prints what the API actually answered, because all three complaints are
 * about the browser's path and the API's own path already passes. Every failing
 * request is captured with its status and body — the point is to see the 400,
 * not to assert one is absent.
 *
 *     node .subsbugs.mjs      (local only — writes and deletes)
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

const say = (title) => console.log(`\n--- ${title} ${"-".repeat(Math.max(0, 60 - title.length))}`);

/* ------------------------------------------------------------- fixtures */

const MARK = "BUGQA";
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

const account = (
  await call("POST", "/accounts", {
    name: `${MARK} Card`,
    type: "card",
    currency: "USD",
    openingBalance: "500000.00",
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
    billingCycle: "monthly",
    startDate: "2026-08-01",
    accountId: account.id,
    paymentMethod: "card",
  })
).body;

const expired = (
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

console.log(`account ${account?.id}  plan ${plan?.id}  expired ${expired?.id}`);

/* ---------------------------------------------------- 3. EXPIRED, first */

say("3. an expired subscription");
console.log("  created with status:", JSON.stringify(expired?.status));
const readBack = (await call("GET", `/subscriptions/${expired.id}`)).body;
console.log("  reads back as:      ", JSON.stringify(readBack?.status));

for (const status of ["expired", "active", ""]) {
  const q = status ? `?status=${status}&page=1&pageSize=50` : "?page=1&pageSize=50";
  const list = await call("GET", `/subscriptions${q}`);
  const mine = (list.body?.items ?? []).filter((r) =>
    String(r.toolName).startsWith(MARK),
  );
  console.log(
    `  list${q.padEnd(38)} -> ${mine.length} of mine: ${mine.map((m) => `${m.toolName}=${m.status}`).join(", ") || "none"}`,
  );
}

/* --------------------------------------- 1. THE MONEY, through the API  */

say("1. recording a payment");
const balance = async () =>
  (
    await db.query(
      `select coalesce(sum(case when direction='in' then amount else -amount end),0)::numeric(14,2)::text m
         from transactions where account_id=$1 and voided_at is null and deleted_at is null`,
      [account.id],
    )
  ).rows[0].m;

const before = await balance();
const pay = await call("POST", `/subscriptions/${plan.id}/pay`, {
  txnDate: "2026-08-05",
});
const after = await balance();
console.log("  POST /pay ->", pay.status, JSON.stringify(pay.body).slice(0, 160));
console.log(`  ledger moved: ${before} -> ${after}`);

const rows = (
  await db.query(
    `select t.id, t.direction, t.amount::text, t.account_id, a.name account_name,
            t.subscription_id is not null tied, t.voided_at, t.deleted_at
       from transactions t left join accounts a on a.id = t.account_id
      where t.subscription_id = $1`,
    [plan.id],
  )
).rows;
console.log("  transactions written:", JSON.stringify(rows, null, 0).slice(0, 400));

/* What the ACCOUNTS screen says, which is a different query from the sum. */
const balances = await call("GET", "/accounts/balances");
const mineOnScreen = (balances.body?.accounts ?? []).find(
  (a) => a.id === account.id,
);
console.log("  the accounts screen reports:", JSON.stringify(mineOnScreen));
const txn = (
  await db.query(
    `select amount::text, original_amount::text, original_currency,
            usd_rate::text, fx_rate::text
       from transactions where subscription_id=$1`,
    [plan.id],
  )
).rows[0];
console.log("  the row it wrote:          ", JSON.stringify(txn));

/* -------------------------------- 2. THE EDIT, through the real screen  */

say("2. editing a plan on the screen and saving");

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

/* EVERY api call the screen makes, not only the failures — the first run
   showed "an error on screen" with no failed request at all, which means the
   question is whether a request was made rather than what it answered. */
const calls = [];
const failures = [];
page.on("response", async (res) => {
  const url = res.url();
  if (!url.includes("/api/")) return;
  const method = res.request().method();
  if (method !== "GET") {
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      body = "<unreadable>";
    }
    calls.push({ method, url: url.replace(/^.*\/api/, ""), status: res.status(), body });
  }
  if (res.status() >= 400) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 400);
    } catch {
      body = "<unreadable>";
    }
    failures.push({ method, url, status: res.status(), body });
  }
});
page.on("pageerror", (err) => failures.push({ pageerror: String(err).slice(0, 200) }));

await page.goto(`${WEB}/subscriptions?status=all`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 2500));

const opened = await page.evaluate((mark) => {
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(`${mark} Claude`),
  );
  if (!tr) return "row not found";
  const edit = [...tr.querySelectorAll("button")].find((b) =>
    /edit/i.test(b.getAttribute("aria-label") ?? b.getAttribute("title") ?? ""),
  );
  if (!edit) return "no edit button";
  edit.click();
  return "clicked";
}, MARK);
await new Promise((r) => setTimeout(r, 2000));
console.log("  edit button:", opened);

const formState = await page.evaluate(() => {
  const drawer = document.querySelector('[role="dialog"], aside, .drawer');
  const inputs = [...document.querySelectorAll("input, select, textarea")].map(
    (el) => ({
      label:
        el.closest("label")?.textContent?.trim().slice(0, 30) ??
        el.getAttribute("name") ??
        el.getAttribute("placeholder") ??
        "?",
      value: "value" in el ? String(el.value).slice(0, 40) : "",
    }),
  );
  return { hasDrawer: Boolean(drawer), fields: inputs.slice(0, 40) };
});
console.log("  drawer open:", formState.hasDrawer, "| fields:", formState.fields.length);

const saved = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Save",
  );
  if (!btn) return "no Save button";
  btn.click();
  return "clicked";
});
await new Promise((r) => setTimeout(r, 3000));
console.log("  Save:", saved);

const onScreen = await page.evaluate(() => {
  const text = document.body.innerText;
  /* The toast, and only the toast. Sweeping every element whose class contains
     "error" pulled in a <select>'s option list on the first run and reported
     eight "errors" that were the Category dropdown. */
  const toasts = [...document.querySelectorAll("[role='status'], [role='alert'], [class*='toast']")]
    .map((el) => (el.textContent ?? "").trim())
    .filter((t) => t.length > 0 && t.length < 200);
  const inline = [...document.querySelectorAll("p, span")]
    .map((el) => (el.textContent ?? "").trim())
    .filter((t) => /could not|failed|required|invalid|must be|enter a/i.test(t))
    .filter((t) => t.length < 160);
  const drawerStillOpen = Boolean(
    [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Save",
    ),
  );
  return {
    matchedInBody: /could not save|something went wrong/i.test(text),
    toasts: [...new Set(toasts)].slice(0, 6),
    inline: [...new Set(inline)].slice(0, 8),
    drawerStillOpen,
  };
});
console.log("  toast:              ", JSON.stringify(onScreen.toasts));
console.log("  inline messages:    ", JSON.stringify(onScreen.inline));
console.log("  drawer still open:  ", onScreen.drawerStillOpen);
console.log("  body says 'could not save':", onScreen.matchedInBody);

say("every write the screen made");
if (calls.length === 0) console.log("  NONE — the Save button sent nothing at all");
for (const c of calls) console.log(" ", JSON.stringify(c).slice(0, 400));

/* --- 3 on the screen: does an expired plan started in January show up? --- */
say("3 on the screen: the month filter");
await page.goto(`${WEB}/subscriptions?status=all`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 2500));
const listing = await page.evaluate((mark) => {
  const monthSelect = [...document.querySelectorAll("select")].find((s) =>
    /every month|\d{4}/i.test(s.textContent ?? ""),
  );
  return {
    months: monthSelect
      ? [...monthSelect.options].map((o) => `${o.value}=${o.text}`)
      : null,
    monthValue: monthSelect?.value ?? null,
    rows: [...document.querySelectorAll("tbody tr")]
      .map((r) => (r.textContent ?? "").trim())
      .filter((t) => t.includes(mark))
      .map((t) => t.slice(0, 60)),
    empty: /nothing is|no subscriptions|nothing here/i.test(document.body.innerText),
  };
}, MARK);
console.log("  month dropdown:", JSON.stringify(listing.months));
console.log("  month selected:", JSON.stringify(listing.monthValue));
console.log("  BUGQA rows visible:", JSON.stringify(listing.rows));
console.log("  screen says empty:", listing.empty);

/* Every tab in turn, because `?status=all` in the URL is evidently not what
   picks the tab — the screen came up showing one row, not two. */
for (const label of ["All", "Active", "Expired", "Canceled"]) {
  const clicked = await page.evaluate((want) => {
    const tab = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === want,
    );
    if (!tab) return false;
    tab.click();
    return true;
  }, label);
  await new Promise((r) => setTimeout(r, 1800));
  const seen = await page.evaluate((mark) => ({
    rows: [...document.querySelectorAll("tbody tr")]
      .map((r) => (r.textContent ?? "").trim())
      .filter((t) => t.includes(mark))
      .map((t) => (t.match(/BUGQA \w+/) ?? ["?"])[0]),
    month: [...document.querySelectorAll("select")].find((s) =>
      /every month/i.test(s.textContent ?? ""),
    )?.value,
    empty: /nothing is|no subscriptions|nothing here/i.test(document.body.innerText),
  }), MARK);
  console.log(
    `  tab ${label.padEnd(9)} clicked=${clicked} month=${JSON.stringify(seen.month)} -> ${JSON.stringify(seen.rows)}${seen.empty ? " (screen says empty)" : ""}`,
  );
}

say("failed API calls the screen made");
if (failures.length === 0) console.log("  none");
for (const f of failures) console.log(" ", JSON.stringify(f).slice(0, 500));

await browser.close();
await wipe();
await db.end();
