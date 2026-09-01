/**
 * Four small asks, driven: the row's colour, two eyes, the card, the password.
 *
 *   the ROW  "sudhu table bg color green caini also sathe text color and other
 *            column gulao green/red hobe" — a tint alone is half a signal.
 *   two EYES "duitai eye button rakho eta better hobe" — Invoice wore a
 *            truncated number, Reference wore an eye, and they do the same job.
 *   the CARD "card er details gula dekhano ucit oigula dekhacchena keno" — the
 *            API had the endpoint since the fields were added and no screen
 *            ever called it.
 *   the LOCK "etar jonne setting a option rakho ami password set korbo okhane".
 *
 * The colour is the one worth driving rather than eyeballing. `.table-data td`
 * sets a colour at specificity (0,1,1), so a utility class on a cell is (0,1,0)
 * and loses to it SILENTLY — the class is in the DOM, the screen is unchanged,
 * and a screenshot proves nothing. This asks the browser what it painted.
 *
 *     node .cardsandcolourqa.mjs      (local only — writes and deletes)
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

/* The browser answers in oklab or lab; the second number is the green-red
   axis, negative green and positive red. An rgb-only parser reads every one of
   these as nothing, which is a mistake this repo has made twice. */
const axis = (value) => {
  const s = String(value ?? "");
  const m = /\b(?:ok)?lab\(\s*[\d.]+%?\s+(-?[\d.]+)/.exec(s);
  if (m) return Number(m[1]);
  const rgb = /rgba?\(([^)]+)\)/.exec(s);
  if (!rgb) return 0;
  const [r, g] = rgb[1].split(",").map((n) => Number(n.trim()));
  return g > r ? -1 : r > g ? 1 : 0;
};

/* ------------------------------------------------------------- fixtures */

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const month = TODAY.slice(0, 8);
const wipe = async () => {
  await db.query("delete from transactions where description like 'CCLQA%'");
  await db.query("delete from accounts where name like 'CCLQA %'");
};
await wipe();

const bank = (
  await call("POST", "/accounts", {
    name: "CCLQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "500000.00",
    openingBalanceOn: month + "01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];
/* A rate and the dollars sent: cash-in asks for both, and a fixture that
   omits them is refused — which the first version of this file did not notice,
   so the money-in row simply was not there and three colour checks reported a
   missing colour instead of a missing row. */
const arriving = await call("POST", "/transactions/cash-in", {
  txnDate: month + "05",
  accountId: bank.id,
  amount: "70000.00",
  description: "CCLQA money arriving",
  usdRate: "122.00",
  usdSent: "573.77",
});
await call("POST", "/transactions", {
  direction: "out",
  txnDate: month + "06",
  accountId: bank.id,
  amount: "9000.00",
  categoryId: cat.id,
  description: "CCLQA money leaving",
  paymentMethod: "bank_transfer",
});

/* A card, with a number and a CVC on file. */
const card = (
  await call("POST", "/accounts", {
    name: "CCLQA Card",
    type: "card",
    currency: "USD",
    openingBalance: "0.00",
    openingBalanceOn: month + "01",
    cardHolderName: "MD. NIZAM UDDIN",
    cardLabel: "Payoneer Mastercard",
    cardNumber: "4111111111111111",
    cardCvc: "123",
    cardExpiry: "12/2029",
  })
).body;
check(
  "a bank with two movements and a card with digits on file",
  Boolean(bank?.id && card?.id) && arriving.status === 201,
  `cash-in HTTP ${arriving.status}; card last4 ${card?.cardLast4}, secrets ${Boolean(card?.cardSecretsSetAt)}`,
);
check(
  "the card's number and CVC are NOT on the account payload",
  !("cardNumber" in (card ?? {})) && !("cardCvc" in (card ?? {})),
  Object.keys(card ?? {})
    .filter((k) => /card/i.test(k))
    .join(", "),
);

/* -------------------------------- browser ------------------------------ */

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
await page.setViewport({ width: 1800, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------- the row's colour ---------------------------- */

await page.goto(`${WEB}/transactions?accountId=${bank.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);

const rows = await page.evaluate(() => {
  const read = (needle) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
      (r.textContent ?? "").includes(needle),
    );
    if (!tr) return null;
    const cells = [...tr.querySelectorAll("td")];
    /* The DESCRIPTION cell — ordinary prose, no colour of its own. If the row's
       colour reaches this one, it reaches the row. */
    const prose = cells.find((c) =>
      (c.textContent ?? "").includes(needle),
    );
    return {
      rowBg: getComputedStyle(tr).backgroundColor,
      cellBg: prose ? getComputedStyle(prose).backgroundColor : null,
      cellText: prose ? getComputedStyle(prose).color : null,
      plainText: getComputedStyle(cells[1] ?? prose).color,
    };
  };
  return { in: read("CCLQA money arriving"), out: read("CCLQA money leaving") };
});

check(
  "both rows are on screen",
  Boolean(rows.in && rows.out),
  rows.in ? "" : "the fixture rows were not found",
);
check(
  "the money-IN row's cells are tinted green",
  axis(rows.in?.cellBg) < 0,
  `${rows.in?.cellBg}`,
);
check(
  "and its TEXT is green too, not the ordinary grey",
  axis(rows.in?.cellText) < 0,
  `${rows.in?.cellText}`,
);
check(
  "the money-OUT row's cells are tinted red",
  axis(rows.out?.cellBg) > 0,
  `${rows.out?.cellBg}`,
);
check(
  "and its TEXT is red too",
  axis(rows.out?.cellText) > 0,
  `${rows.out?.cellText}`,
);
check(
  "another column on the same row carries the colour as well",
  axis(rows.in?.plainText) < 0 && axis(rows.out?.plainText) > 0,
  `in ${rows.in?.plainText} / out ${rows.out?.plainText}`,
);

/* ------------------------------ two eyes ------------------------------- */

await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2800);
const heads = await page.evaluate(() => {
  const table = document.querySelector("table.table-data");
  if (!table) return null;
  const names = [...table.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const row = table.querySelector("tbody tr");
  const cells = [...(row?.querySelectorAll("td") ?? [])];
  const at = (label) => {
    const i = names.indexOf(label);
    return i < 0 || !cells[i]
      ? null
      : {
          text: (cells[i].textContent ?? "").trim(),
          hasEye: Boolean(cells[i].querySelector("svg")),
        };
  };
  return { names, invoice: at("Invoice"), reference: at("Reference") };
});
if (!heads?.invoice) {
  check(
    "the subscriptions table has an Invoice and a Reference column",
    false,
    heads ? heads.names.join(" | ") : "no table — no plans this month",
  );
} else {
  check(
    "the subscriptions table has an Invoice and a Reference column",
    Boolean(heads.invoice && heads.reference),
    heads.names.join(" | "),
  );
  check(
    "Invoice and Reference now wear the SAME control",
    heads.invoice.hasEye === heads.reference.hasEye &&
      heads.invoice.text === heads.reference.text,
    `invoice "${heads.invoice.text}" eye=${heads.invoice.hasEye} · reference "${heads.reference.text}" eye=${heads.reference.hasEye}`,
  );
}

/* ------------------------------- the card ------------------------------ */

await page.goto(`${WEB}/accounts/${card.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);
const cardPage = await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  const text = (main.textContent ?? "").replace(/\s+/g, " ");
  return {
    text,
    hasReveal: [...main.querySelectorAll("button")].some((b) =>
      /Show the number/i.test(b.textContent ?? ""),
    ),
  };
});
check(
  "the card's own page shows its details",
  /Card holder/.test(cardPage.text) && /MD. NIZAM UDDIN/.test(cardPage.text),
  cardPage.text.slice(cardPage.text.indexOf("Card holder"), cardPage.text.indexOf("Card holder") + 90) || "no Card panel",
);
check(
  "with the last four digits, and the full number masked",
  /1111/.test(cardPage.text) && !/4111111111111111/.test(cardPage.text),
  /4111111111111111/.test(cardPage.text)
    ? "THE WHOLE NUMBER IS ON THE PAGE"
    : "masked",
);
check(
  "and a way to read it, behind the card password",
  cardPage.hasReveal,
  cardPage.hasReveal ? "" : "no reveal control",
);

/* The reveal must refuse a wrong password. */
const wrong = await call("POST", `/accounts/${card.id}/card-secrets`, {
  cardPassword: "definitely-not-it",
});
check(
  "a wrong card password is refused",
  wrong.status >= 400,
  `HTTP ${wrong.status}`,
);

/* ---------------------------- the password ----------------------------- */

await page.goto(`${WEB}/settings?tab=security`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);
const settings = await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  const text = (main.textContent ?? "").replace(/\s+/g, " ");
  return {
    text,
    passwordBoxes: main.querySelectorAll('input[type="password"]').length,
    hasCardPanel: /Card password/i.test(text),
  };
});
check(
  "Settings > Security has somewhere to set the card password",
  settings.hasCardPanel,
  settings.hasCardPanel ? "" : "no Card password panel",
);
check(
  "and it asks for it twice, because it can never be read back",
  settings.passwordBoxes >= 2,
  `${settings.passwordBoxes} password boxes`,
);
check(
  "it says plainly that this is not a sign-in password",
  /not your sign-in password/i.test(settings.text),
  "",
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
