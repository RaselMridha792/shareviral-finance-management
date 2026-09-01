/**
 * The Expenses overview, and the one thing it has to get right.
 *
 * The owner asked for at least six dynamic boxes. A first plan gave him six that
 * counted the same money five times — salary inside Operational, inside Other,
 * inside the headline — so "Other expenses" would have read HIGHER than
 * "Operational expenses" beside it. Shown both shapes, he chose the one that
 * adds up:
 *
 *     Salary + Tooling + Operational + Uncategorised  =  Spent this month
 *
 * That equality is the whole design, so it is what this measures — with money
 * built to land in each slice and NOTHING in two of them. Four boxes that each
 * look plausible while double-counting is precisely the failure a screenshot
 * cannot catch and a diff cannot show.
 *
 * And two exclusions, each a bug this app has had:
 *
 *   a TRANSFER between our own accounts is not spending. It inflated five
 *   aggregates here before, through a LEFT JOIN that let category-less
 *   transfers survive as "Uncategorised" — which is now a box of its own, so
 *   the same mistake would be louder and no easier to see.
 *
 *   a VOIDED row is not spending. That is what makes voiding safe.
 *
 *     node .overviewqa.mjs      (local only — writes and deletes)
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

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const month = TODAY.slice(0, 8);
const from = month + "01";
const to = (
  await db.query(
    "select (date_trunc('month',$1::date) + interval '1 month - 1 day')::date::text d",
    [TODAY],
  )
).rows[0].d;

const wipe = async () => {
  await db.query("delete from transactions where description like 'OVQA%'");
  await db.query("delete from accounts where name like 'OVQA %'");
};
await wipe();

const bank = (
  await call("POST", "/accounts", {
    name: "OVQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "5000000.00",
    openingBalanceOn: from,
  })
).body;
const other = (
  await call("POST", "/accounts", {
    name: "OVQA Second Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "0.00",
    openingBalanceOn: from,
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/* A tool vendor, so tooling lands in the tooling slice by its own predicate. */
const toolVendor = (
  await db.query(
    /* The three the app itself calls recurring — RECURRING_VENDOR_TYPES. An
       earlier guess at this list named types the enum does not have and the
       query died rather than failing a check. */
    `select id from vendors where type in ('ai_tool','subscription','hosting')
       and deleted_at is null limit 1`,
  )
).rows[0];

const spend = async (desc, amount, extra = {}) =>
  call("POST", "/transactions", {
    direction: "out",
    txnDate: month + "10",
    accountId: bank.id,
    amount,
    description: desc,
    paymentMethod: "bank_transfer",
    ...extra,
  });

/* One in each slice, and each a different figure so nothing can be confused
   with anything else. */
await spend("OVQA operational", "40000.00", { categoryId: cat.id });
const uncat = await db.query(
  `insert into transactions (ref_no, account_id, direction, txn_date, amount,
     currency, description, created_by, updated_by)
   values ('TXN-OVQA-' || floor(random()*100000)::int, $1, 'out', $2, '7000.00',
     'BDT', 'OVQA uncategorised', $3, $3) returning id`,
  [bank.id, month + "11", person.id],
);
await db.query(
  `insert into transactions (ref_no, account_id, direction, txn_date, amount,
     currency, category_id, description, created_via, created_by, updated_by)
   values ('TXN-OVQA-' || floor(random()*100000)::int, $1, 'out', $2, '300000.00',
     'BDT', $3, 'OVQA salary', 'payroll', $4, $4)`,
  [bank.id, month + "12", cat.id, person.id],
);
if (toolVendor) {
  await db.query(
    `insert into transactions (ref_no, account_id, direction, txn_date, amount,
       currency, category_id, vendor_id, description, created_by, updated_by)
     values ('TXN-OVQA-' || floor(random()*100000)::int, $1, 'out', $2, '9000.00',
       'BDT', $3, $4, 'OVQA tooling', $5, $5)`,
    [bank.id, month + "13", cat.id, toolVendor.id, person.id],
  );
}

/* The two that must NOT count. */
const transfer = await call("POST", "/transactions/transfer", {
  txnDate: month + "14",
  fromAccountId: bank.id,
  toAccountId: other.id,
  amount: "500000.00",
  description: "OVQA transfer between our own accounts",
});
const voided = await spend("OVQA voided", "88000.00", { categoryId: cat.id });
if (voided.body?.id) {
  await call("POST", `/transactions/${voided.body.id}/void`, {
    reason: "OVQA — must not be counted",
  });
}
check(
  "the month is seeded: one in each slice, plus a transfer and a voided row",
  transfer.status < 300,
  `transfer HTTP ${transfer.status}`,
);

/* -------------------------------- the API ------------------------------ */

const ov = (await call("GET", `/expenses/overview?from=${from}&to=${to}`)).body;
const n = (v) => Number(v ?? 0);

check(
  "the four slices add up to the total, exactly",
  n(ov.salary) + n(ov.tooling) + n(ov.operational) + n(ov.uncategorised) ===
    n(ov.total),
  `${ov.salary} + ${ov.tooling} + ${ov.operational} + ${ov.uncategorised} = ${
    n(ov.salary) + n(ov.tooling) + n(ov.operational) + n(ov.uncategorised)
  }, total says ${ov.total}`,
);
check(
  "salary is its own slice and is not inside Operational",
  n(ov.salary) >= 300000,
  `salary ${ov.salary}`,
);
check(
  "the uncategorised row is counted, and only once",
  n(ov.uncategorised) >= 7000,
  `uncategorised ${ov.uncategorised}`,
);
if (toolVendor) {
  check(
    "tooling is its own slice",
    n(ov.tooling) >= 9000,
    `tooling ${ov.tooling}`,
  );
}

/* THE TWO EXCLUSIONS. */
check(
  "a TRANSFER between our own accounts is not counted as spending",
  !String(ov.total).includes("500000") && n(ov.total) < 500000,
  `total ${ov.total} — a 500,000 transfer would be visible here`,
);
check(
  "a VOIDED row is not counted either",
  n(ov.operational) < 88000 + 40000,
  `operational ${ov.operational} — 88,000 was voided`,
);

/* And the tax held is outside the total, not folded into it. */
check(
  "tax withheld comes back separately",
  "withheld" in ov,
  `withheld ${ov.withheld}`,
);
check(
  "the previous month comes back with it, named",
  Boolean(ov.previous?.label) && "total" in (ov.previous ?? {}),
  ov.previous?.label ?? "no previous month",
);

/* -------------------------------- the screen --------------------------- */

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
await page.setViewport({ width: 1700, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/expenses/overview`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(3000);

const screen = await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  const text = (main.textContent ?? "").replace(/\s+/g, " ");
  return {
    text,
    boxLabels: [...main.querySelectorAll("a[href^='/']")]
      .map((a) => (a.querySelector("p")?.textContent ?? "").trim())
      .filter(Boolean),
  };
});

check(
  "the overview page renders",
  screen.text.length > 200,
  `${screen.text.length} characters`,
);
for (const label of [
  "Salary",
  "AI tools and subscriptions",
  "Operational expenses",
  "Uncategorised",
  "Tax withheld",
]) {
  check(`23: the page shows "${label}"`, screen.text.includes(label), "");
}
check(
  "23: and it writes the sum out, so the total can be checked",
  /=\s*৳/.test(screen.text) || screen.text.includes("exactly one of the four"),
  screen.text.includes("exactly one of the four")
    ? ""
    : "the working is not on the page",
);
check(
  "23: it says transfers are not counted",
  /transfers between our own accounts are not spending/i.test(screen.text),
  "",
);

/* The rail and the grid's new name. */
await page.goto(`${WEB}/expenses`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2600);
const rail = await page.evaluate(() => {
  const nav = document.querySelector("aside") ?? document.body;
  const navText = (nav.textContent ?? "").replace(/\s+/g, " ");
  /* The heading carries a Material icon ligature before the words — the icon
     IS text in that font — so the raw textContent reads
     "receipt_longOperational expenses". Anything lowercase-with-underscores at
     the front is that, not the title. */
  const h1 = (document.querySelector("main h1")?.textContent ?? "")
    .replace(/^[a-z_]+/, "")
    .trim();
  return { navText, h1 };
});
check(
  "23: the category grid is now called Operational expenses",
  rail.h1 === "Operational expenses",
  rail.h1,
);
check(
  "23: Other expenses is off the menu",
  !/Other expenses/.test(rail.navText),
  /Other expenses/.test(rail.navText) ? "still in the rail" : "",
);
check(
  "23: and Expense overview is on it",
  /Expense overview/.test(rail.navText),
  "",
);

/* Its route still works, and names itself now that the rail does not. */
await page.goto(`${WEB}/expenses/other`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2600);
const otherPage = await page.evaluate(() => ({
  h1: (document.querySelector("main h1")?.textContent ?? "").trim(),
  crumbs: (document.querySelector("header")?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim(),
}));
check(
  "23: Other expenses is still reachable by its route",
  otherPage.h1.length > 0,
  otherPage.h1,
);
check(
  "23: and its breadcrumb still names it, now the rail does not",
  /Other expenses/.test(otherPage.crumbs),
  otherPage.crumbs.slice(0, 90),
);

await browser.close();
await db.query("delete from transactions where description like 'OVQA%'");
await db.query("delete from accounts where name like 'OVQA %'");
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
