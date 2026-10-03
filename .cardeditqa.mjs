/**
 * Editing a card must not erase its number or CVC.
 *
 * SESSIONS #138, "What the owner has to decide" 1: the Edit account drawer
 * said "Leave blank to keep the stored one", but always sent cardNumber: ""
 * and cardCvc: "" — and "" is the clear. So renaming a card, or changing its
 * expiry, wiped the number. This drives the real drawer, saves, and reads the
 * sealed columns back, which is the only way to see it.
 *
 *     node .cardeditqa.mjs      (local only — writes and deletes its own rows)
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
  await db.query("delete from accounts where name like 'CEQA %'");
};
await wipe();

const made = await call("POST", "/accounts", {
  name: "CEQA Card",
  type: "card",
  bankName: "Payoneer",
  cardHolderName: "MD NIZAM UDDIN",
  cardLabel: "Platinum Business",
  cardNumber: "4111 1111 1111 7823",
  cardExpiry: "09/2028",
  cardCvc: "731",
  currency: "USD",
  openingBalance: "0.00",
  openingBalanceOn: "2026-08-01",
});
check("a card records with its number and CVC", made.status === 201, `HTTP ${made.status}`);
const id = made.body?.id;

const read = async () =>
  (
    await db.query(
      `select name, card_expiry e, card_last4 four,
              card_number_sealed n, card_cvc_sealed c
         from accounts where id = $1`,
      [id],
    )
  ).rows[0];
const before = await read();
check(
  "both are sealed to begin with",
  Boolean(before?.n?.startsWith("v1.")) && Boolean(before?.c?.startsWith("v1.")) && before?.four === "7823",
  `last4 ${before?.four}`,
);

/* ------------------------------ the drawer ------------------------------ */

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
await page.setViewport({ width: 1600, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

let patchBody = null;
page.on("request", (req) => {
  if (req.method() === "PATCH" && req.url().includes(`/accounts/${id}`)) {
    patchBody = JSON.parse(req.postData() ?? "null");
  }
});

const openEdit = async () => {
  await page.goto(`${WEB}/accounts/${id}`, { waitUntil: "networkidle0", timeout: 120000 });
  await page
    .waitForFunction(
      () => [...document.querySelectorAll("button")].some((b) => (b.textContent ?? "").trim() === "Edit"),
      { timeout: 60000 },
    )
    .catch(async () => {
      await page.screenshot({ path: ".cardeditqa.png" });
      throw new Error("no Edit button on the account's page — see .cardeditqa.png");
    });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").trim() === "Edit")
      ?.click();
  });
  await page.waitForSelector("#account-form", { timeout: 15000 });
  await settle(600);
};
const retype = async (name, value) => {
  const box = await page.$(`#account-form [name="${name}"]`);
  await box.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  if (value) await box.type(value);
};
const save = async () => {
  patchBody = null;
  await page.click('button[form="account-form"]');
  for (let i = 0; i < 40 && patchBody === null; i++) await settle(250);
  for (let i = 0; i < 40 && (await page.$("#account-form")); i++) await settle(250);
  await settle(800);
};

/* 1. Rename it and move its expiry, leaving the number and CVC blank. */
await openEdit();
const hints = await page.evaluate(() => document.querySelector("#account-form")?.textContent ?? "");
check(
  "the number's box says blank keeps the stored one",
  /On file\. Leave blank to keep the stored one\./.test(hints),
  "",
);
check("and so does the CVC's", /Leave blank to keep what is on file\./.test(hints), "");
const boxes = await page.evaluate(() => ({
  n: document.querySelector('#account-form [name="cardNumber"]')?.value,
  c: document.querySelector('#account-form [name="cardCvc"]')?.value,
}));
check("both boxes open empty", boxes.n === "" && boxes.c === "", JSON.stringify(boxes));

await retype("name", "CEQA Card Renamed");
await retype("cardExpiry", "10/2029");
await save();

check("the save went out", patchBody !== null, "");
check(
  "THE BUG: the save sends no cardNumber and no cardCvc",
  patchBody !== null && !("cardNumber" in patchBody) && !("cardCvc" in patchBody),
  patchBody ? Object.keys(patchBody).join(", ").slice(0, 160) : "no request",
);
const afterRename = await read();
check(
  "the new name and expiry are kept",
  afterRename?.name === "CEQA Card Renamed" && afterRename?.e === "10/2029",
  `${afterRename?.name} / ${afterRename?.e}`,
);
check(
  "THE FIX: the stored number is untouched, last four and all",
  afterRename?.n === before?.n && afterRename?.four === "7823",
  `last4 ${afterRename?.four}, sealed ${afterRename?.n === before?.n ? "same" : "CHANGED"}`,
);
check(
  "THE FIX: the stored CVC is untouched",
  afterRename?.c === before?.c,
  afterRename?.c === before?.c ? "same" : `now ${String(afterRename?.c).slice(0, 10)}`,
);

/* 2. Typing a new number and CVC still replaces them. */
await openEdit();
await retype("cardNumber", "5500 0000 0000 0004");
await retype("cardCvc", "999");
await save();
check(
  "a typed number and CVC are sent",
  patchBody?.cardNumber === "5500 0000 0000 0004" && patchBody?.cardCvc === "999",
  JSON.stringify({ n: patchBody?.cardNumber, c: patchBody?.cardCvc }),
);
const afterReplace = await read();
check(
  "and replace what was stored",
  afterReplace?.four === "0004" &&
    afterReplace?.n?.startsWith("v1.") &&
    afterReplace?.n !== before?.n &&
    afterReplace?.c?.startsWith("v1.") &&
    afterReplace?.c !== before?.c,
  `last4 ${afterReplace?.four}`,
);

/* 3. A brand-new card left without a number is still allowed. */
await page.goto(`${WEB}/accounts`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(1500);
await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  [...main.querySelectorAll("button, a")]
    .find((b) => /^(Add an account|Add account|Add)$/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await page.waitForSelector("#account-form", { timeout: 15000 });
await page.evaluate(() => {
  const sel = document.querySelector('#account-form select[name="type"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
  setter?.call(sel, "card");
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await settle(600);
await retype("name", "CEQA Blank Card");
await retype("cardHolderName", "SOMEBODY");
await retype("cardLabel", "Spare");
await page.evaluate(() => {
  const day = document.querySelector('#account-form [name="openingBalanceOn"]');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(day, "2026-08-01");
  day.dispatchEvent(new Event("input", { bubbles: true }));
  day.dispatchEvent(new Event("change", { bubbles: true }));
});
let postStatus = null;
const onResponse = (res) => {
  if (res.request().method() === "POST" && /\/api\/accounts$/.test(res.url())) postStatus = res.status();
};
page.on("response", onResponse);
await page.click('button[form="account-form"]');
for (let i = 0; i < 40 && postStatus === null; i++) await settle(250);
if (postStatus === null) {
  await page.screenshot({ path: ".cardeditqa.png" });
}
const blank = (
  await db.query(
    "select card_number_sealed n, card_cvc_sealed c, card_last4 four from accounts where name = 'CEQA Blank Card'",
  )
).rows[0];
check(
  "a new card with no number still saves, holding none",
  postStatus === 201 && blank && blank.n === null && blank.c === null && blank.four === null,
  `HTTP ${postStatus}`,
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
