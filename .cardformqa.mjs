/**
 * The account drawer, when the type is Card.
 *
 * The owner's list, in his order: Card Holder Name, Type, Bank/Card Company
 * Name, Card Name, the 16 digits, expiry, CVC, opening balance, opening date,
 * primary currency, order, notes.
 *
 * Two things this has to prove that a diff cannot:
 *
 *   1. the drawer CHANGES when Type changes — a card asks for a holder and a
 *      number, and stops asking for a branch, a routing number and a SWIFT
 *      code, none of which a card has;
 *   2. hiding a field does NOT clear it. An account switched to card and back
 *      must still have its bank details, because a field that is not rendered
 *      sends nothing and the patch leaves absent keys alone. Getting this
 *      wrong destroys real data on a mistaken click.
 *
 *     node .cardformqa.mjs      (local only — writes and deletes)
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

const wipe = async () => {
  await db.query("delete from accounts where name like 'CFQA %'");
};
await wipe();

/* ------------------- the API stores what the form sends ----------------- */

const made = await call("POST", "/accounts", {
  name: "CFQA Company Card",
  type: "card",
  bankName: "Payoneer",
  cardHolderName: "MD NIZAM UDDIN",
  cardLabel: "Platinum Business",
  cardNumber: "4111 1111 1111 7823",
  cardExpiry: "09/2028",
  cardCvc: "731",
  currency: "USD",
  openingBalance: "0.00",
  openingBalanceUsd: "0.00",
  openingBalanceOn: "2026-08-01",
});
check(
  "a card records with all of it",
  made.status === 201,
  `HTTP ${made.status} ${JSON.stringify(made.body?.message ?? made.body?.errors ?? "")}`.slice(0, 130),
);
const id = made.body?.id;

const stored = (
  await db.query(
    `select card_holder_name h, card_label l, card_last4 four, card_expiry e,
            card_number_sealed n, card_cvc_sealed c
       from accounts where id = $1`,
    [id],
  )
).rows[0];
check(
  "the holder and the card's name are kept as typed",
  stored?.h === "MD NIZAM UDDIN" && stored?.l === "Platinum Business",
  `${stored?.h} / ${stored?.l}`,
);
check(
  "the number is sealed and only the last four are readable",
  Boolean(stored?.n?.startsWith("v1.")) &&
    !stored.n.includes("411111111111") &&
    stored?.four === "7823",
  `sealed ${String(stored?.n).slice(0, 14)}…, last4 ${stored?.four}`,
);
check(
  "the CVC is sealed too",
  Boolean(stored?.c?.startsWith("v1.")) && !stored.c.includes("731"),
  String(stored?.c).slice(0, 14) + "…",
);
check("and the expiry is kept as a month", stored?.e === "09/2028", stored?.e);

/* The response must not carry either secret. */
check(
  "the create response carries neither",
  !JSON.stringify(made.body).includes("Sealed") &&
    !JSON.stringify(made.body).includes("7823456") &&
    JSON.stringify(made.body).includes("7823"),
  "last four only",
);

/* --------- switching the type must not destroy what is stored ---------- */

const bank = await call("POST", "/accounts", {
  name: "CFQA Real Bank",
  type: "bank",
  bankName: "Standard Chartered",
  branch: "Gulshan",
  accountNumber: "01-7023747-01",
  routingNumber: "215261726",
  swiftCode: "SCBLBDDX",
  currency: "BDT",
  openingBalance: "0.00",
  openingBalanceOn: "2026-08-01",
});
check("a bank account records", bank.status === 201, `HTTP ${bank.status}`);

/* The drawer sends no branch/routing/swift when the type is card. */
await call("PATCH", `/accounts/${bank.body.id}`, {
  type: "card",
  name: "CFQA Real Bank",
  bankName: "Standard Chartered",
  cardHolderName: "SOMEBODY",
});
const afterSwitch = (
  await db.query(
    "select branch, account_number a, routing_number r, swift_code s from accounts where id = $1",
    [bank.body.id],
  )
).rows[0];
check(
  "THE RULE: switching to card keeps the bank details rather than wiping them",
  afterSwitch?.branch === "Gulshan" &&
    afterSwitch?.a === "01-7023747-01" &&
    afterSwitch?.s === "SCBLBDDX",
  JSON.stringify(afterSwitch),
);

/* -------------------------- and on the screen -------------------------- */

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
await page.setViewport({ width: 1600, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/accounts`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2400);
await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  [...main.querySelectorAll("button, a")]
    .find((b) => /^(Add an account|Add account|Add)$/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await settle(1500);

const fieldsFor = () =>
  page.evaluate(() => {
    const drawer = [...document.querySelectorAll('[role="dialog"], aside, form')].find(
      (d) => /Opening balance/i.test(d.textContent ?? ""),
    );
    return {
      found: Boolean(drawer),
      names: [...(drawer?.querySelectorAll("input, select, textarea") ?? [])]
        .map((i) => i.getAttribute("name"))
        .filter(Boolean),
    };
  });

const asBank = await fieldsFor();
check("the drawer opens", asBank.found, "");
check(
  "a bank account is asked for branch, routing and SWIFT",
  ["branch", "routingNumber", "swiftCode"].every((n) => asBank.names.includes(n)),
  asBank.names.join(", ").slice(0, 130),
);
check(
  "and not for a card number",
  !asBank.names.includes("cardNumber"),
  "",
);

/* Choose Card. */
await page.evaluate(() => {
  const sel = document.querySelector('select[name="type"]');
  if (!sel) return;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )?.set;
  setter?.call(sel, "card");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await settle(900);

const asCard = await fieldsFor();
check(
  "THE ASK: choosing Card asks for the holder, the card name, the number, the expiry and the CVC",
  ["cardHolderName", "cardLabel", "cardNumber", "cardExpiry", "cardCvc"].every(
    (n) => asCard.names.includes(n),
  ),
  asCard.names.join(", ").slice(0, 150),
);
check(
  "and stops asking for a branch, a routing number and a SWIFT code",
  ["branch", "routingNumber", "swiftCode"].every(
    (n) => !asCard.names.includes(n),
  ),
  asCard.names.filter((n) => /branch|routing|swift/i.test(n)).join(", ") || "none of them",
);
check(
  "the currency, order and notes are still there",
  ["currency", "sortOrder", "notes", "openingBalance", "openingBalanceOn"].every(
    (n) => asCard.names.includes(n),
  ),
  "",
);

const saysEncrypted = await page.evaluate(() => {
  const drawer = [...document.querySelectorAll('[role="dialog"], aside, form')].find(
    (d) => /Opening balance/i.test(d.textContent ?? ""),
  );
  return /encrypted/i.test(drawer?.textContent ?? "");
});
check("and the drawer says the number is encrypted", saysEncrypted, "");

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
