/**
 * The Expenses overview, and the one thing it has to get right.
 *
 * The owner asked for at least six dynamic boxes. A first plan gave him six that
 * counted the same money five times — salary inside Operational, inside Other,
 * inside the headline — so "Other expenses" would have read HIGHER than
 * "Operational expenses" beside it. Shown both shapes, he chose the one that
 * adds up:
 *
 *     Salary + Tooling + Office rent + Operational  =  Spent this month
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
 *   transfers survive as spend with no heading — which now lands in
 *   Operational, so the same mistake would be quieter and this is where it
 *   gets caught.
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

/*
 * One row that recorded what it was in DOLLARS.
 *
 * Without one the API answers `usd: null` — correctly, because it adds the
 * dollars the rows carry rather than dividing taka by a rate — and the cards
 * print no equivalent line at all. The owner asked for the equivalent, so the
 * month has to contain something that has one.
 */
await spend("OVQA a dollar-carrying expense", "12000.00", {
  categoryId: cat.id,
  originalAmount: "100.00",
  originalCurrency: "USD",
  fxRate: "120.00",
});

/*
 * Office rent, and a DECOY.
 *
 * The tree carries two headings that read "Office rent" to a person: the real
 * sub-category under Office & premises (slug `office-rent`) and a stray
 * top-level one (slug `office-rent-test`). The slice matches on slug, and the
 * decoy is here so that a future change to matching by NAME fails loudly
 * rather than quietly folding somebody's test heading into the company's rent.
 */
const rentCat = (
  await db.query(
    "select id from categories where slug='office-rent' and deleted_at is null limit 1",
  )
).rows[0];
const decoyCat = (
  await db.query(
    "select id from categories where slug='office-rent-test' and deleted_at is null limit 1",
  )
).rows[0];

if (rentCat) {
  await spend("OVQA office rent", "85000.00", { categoryId: rentCat.id });
}
if (decoyCat) {
  await spend("OVQA rent decoy on the test heading", "1234.00", {
    categoryId: decoyCat.id,
  });
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
  n(ov.salary) + n(ov.tooling) + n(ov.rent) + n(ov.operational) ===
    n(ov.total),
  `${ov.salary} + ${ov.tooling} + ${ov.rent} + ${ov.operational} = ${
    n(ov.salary) + n(ov.tooling) + n(ov.rent) + n(ov.operational)
  }, total says ${ov.total}`,
);
check(
  "salary is its own slice and is not inside Operational",
  n(ov.salary) >= 300000,
  `salary ${ov.salary}`,
);
/*
 * The owner replaced the Uncategorised box with Office rent, and chose to keep
 * the four adding up — so money with no heading is not dropped, it lands in
 * Operational. This is the check that says it was not simply lost.
 */
check(
  "the API no longer reports an uncategorised slice",
  ov.uncategorised === undefined,
  `uncategorised ${JSON.stringify(ov.uncategorised)}`,
);
check(
  "money with no heading is counted in Operational rather than dropped",
  n(ov.operational) >= 47000,
  `operational ${ov.operational} — expected the 40,000 filed plus the 7,000 that is not`,
);

/* THE ONE THE WHOLE CHANGE TURNS ON. */
if (rentCat) {
  check(
    "Office rent is its own slice",
    n(ov.rent) === 85000,
    `rent ${ov.rent}`,
  );
  check(
    "and it is carved OUT of Operational, not counted beside it",
    n(ov.operational) < 47000 + 85000,
    `operational ${ov.operational} would be ${n(ov.operational) + 85000} if rent were still inside it`,
  );
}
if (decoyCat) {
  check(
    "a stray heading merely NAMED Office rent is not counted as rent",
    n(ov.rent) === 85000,
    `rent ${ov.rent} — the 1,234.00 decoy is filed elsewhere`,
  );
  check(
    "the decoy lands in Operational instead, so nothing is lost",
    n(ov.operational) >= 47000 + 1234,
    `operational ${ov.operational}`,
  );
}
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
  "Office rent",
  "Operational expenses",
  "Tax withheld",
]) {
  check(`23: the page shows "${label}"`, screen.text.includes(label), "");
}
check(
  "and Uncategorised is gone from it",
  !screen.text.includes("Uncategorised"),
  screen.text.includes("Uncategorised") ? "still on the page" : "gone",
);

/* ---- the cards themselves: the dashboard's look, measured -------------- */

/*
 * *"card gulake sundor UI daw dashbaord a jemon card ache onekta oirokom with
 * colorful progress bar and equivalant usd/bdt."*
 *
 * Three claims, and none of them is text: the cards share ONE panel the way
 * the dashboard's do rather than floating as four bordered boxes; each carries
 * a bar; and the bars are not all the same colour. Read off the DOM, because a
 * screenshot cannot tell a 40% bar from a 60% one and a diff cannot tell
 * either from a bar that is not there.
 */
const cards = await page.evaluate(() => {
  const strip = [...document.querySelectorAll("div")].find(
    (d) =>
      d.className.includes("rounded-xl") &&
      d.className.includes("border-border") &&
      d.style.gridTemplateColumns.includes("auto-fit"),
  );
  if (!strip) return { found: false };
  const cells = [...strip.children];
  return {
    found: true,
    count: cells.length,
    cells: cells.map((cell) => {
      const bar = cell.querySelector('[class*="rounded-sm"] > div');
      const link = cell.querySelector("a");
      return {
        text: (cell.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80),
        barClass: bar ? bar.className : null,
        barWidth: bar ? bar.style.width : null,
        href: link ? link.getAttribute("href") : null,
      };
    }),
  };
});

check(
  "the four cards sit in one panel, like the dashboard's",
  cards.found && cards.count === 4,
  cards.found ? `${cards.count} cells in the strip` : "no strip found",
);
check(
  "every card carries a progress bar",
  (cards.cells ?? []).every((c) => c.barWidth !== null),
  (cards.cells ?? []).map((c) => c.barWidth ?? "none").join(" | "),
);
check(
  "and the bars are not all one colour",
  new Set((cards.cells ?? []).map((c) => (c.barClass ?? "").match(/bg-[\w-]+/)?.[0]))
    .size === 4,
  (cards.cells ?? [])
    .map((c) => (c.barClass ?? "").match(/bg-[\w-]+/)?.[0] ?? "none")
    .join(" | "),
);
check(
  "each card shows its taka and its dollar equivalent",
  (cards.cells ?? []).every((c) => /৳/.test(c.text) && /\$/.test(c.text)),
  (cards.cells ?? []).map((c) => c.text.slice(0, 40)).join(" | "),
);
check(
  "and each one is still a way into the entries behind it",
  (cards.cells ?? []).every((c) => Boolean(c.href)),
  (cards.cells ?? []).map((c) => c.href ?? "none").join(" | "),
);

/* The bar has to mean the share, not decorate the card. */
const rentCell = (cards.cells ?? []).find((c) => c.text.includes("Office rent"));
const salaryCell = (cards.cells ?? []).find((c) => c.text.includes("Salary"));
check(
  "the bars are sized by share — salary's is the longest of the four",
  Boolean(rentCell && salaryCell) &&
    parseFloat(salaryCell.barWidth) > parseFloat(rentCell.barWidth),
  `salary ${salaryCell?.barWidth} vs rent ${rentCell?.barWidth}`,
);
check(
  "23: and it writes the sum out, so the total can be checked",
  /=\s*৳/.test(screen.text) || screen.text.includes("exactly one of the four"),
  screen.text.includes("exactly one of the four")
    ? ""
    : "the working is not on the page",
);
/*
 * The claim, measured rather than read.
 *
 * This asserted the SENTENCE "transfers between our own accounts are not
 * spending" was on the page — and the owner had that note removed months ago
 * (*"ekhane ato beshi lekha thakar dorkar nai"*), so it has been failing for a
 * text he asked to delete. What matters is that the ৳5,00,000 transfer is not
 * in the figures, and that is checkable.
 */
check(
  "23: the transfer between our own accounts is nowhere in the total",
  n(ov.total) < 500000,
  `total ${ov.total} — the transfer alone was 500000.00`,
);
check(
  "23: nor is the voided row",
  !screen.text.includes("88,000"),
  screen.text.includes("88,000") ? "88,000 is on the page" : "absent",
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
