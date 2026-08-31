/**
 * One Reference, and an invoice that is a paper rather than a number.
 *
 * The owner: *"sobgula drawer table a transaction id dorkar nai ekhane only
 * reference lekha thakbe"* and *"Invoice a sudhu upload system thakbe field
 * lagbena"*.
 *
 * The part that needs proving is not that the boxes went — a diff shows that.
 * It is that **nothing already recorded stopped reading**. `invoice_no` holds
 * numbers typed on entries the owner made before today, and dropping a form
 * field must not drop the column or the cell that shows it; a screen that
 * quietly stops displaying a fact is indistinguishable from one that lost it.
 *
 *     node .refqa.mjs      (local only — writes and deletes)
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

const wipe = async () => {
  await db.query("delete from transactions where description like 'REFQA%'");
  await db.query("delete from accounts where name like 'REFQA %'");
};
await wipe();

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const account = (
  await call("POST", "/accounts", {
    name: "REFQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "500000.00",
    openingBalanceOn: TODAY.slice(0, 8) + "01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/* An entry recorded the OLD way — with an invoice number typed on it. */
const old = await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: account.id,
  amount: "1000.00",
  categoryId: cat.id,
  description: "REFQA an older entry that has an invoice number",
  paymentMethod: "bank_transfer",
  invoiceNo: "INV-REFQA-77",
  reference: "FT26REFQA0001",
});
check(
  "an entry with an invoice number still records",
  old.status === 201,
  `HTTP ${old.status} ${JSON.stringify(old.body?.message ?? "")}`.slice(0, 110),
);
check(
  "THE RULE: the API still accepts and keeps an invoice number",
  old.body?.invoiceNo === "INV-REFQA-77",
  `${old.body?.invoiceNo}`,
);
check(
  "and the reference with it",
  old.body?.reference === "FT26REFQA0001",
  `${old.body?.reference}`,
);

/* -------------------------------- screens ------------------------------ */

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

/* The tables: no "Transaction ID" heading anywhere, and the number still shows. */
for (const [label, url] of [
  ["Other expenses", `${WEB}/expenses/other`],
  ["Cash in", `${WEB}/accounts/cash-in`],
  ["Money transfer", `${WEB}/transfers`],
  ["Bank statement", `${WEB}/statement`],
]) {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2300);
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll("thead th")].map((h) =>
      (h.textContent ?? "").trim(),
    ),
  );
  check(
    `${label}: no "Transaction ID" column`,
    !heads.some((h) => /transaction id/i.test(h)),
    heads.filter((h) => /reference|invoice|transaction/i.test(h)).join(" | ") ||
      "no such columns here",
  );
}

/* The old entry's invoice number is still on screen. */
await page.goto(`${WEB}/expenses/other`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2400);
const stillShows = await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("REFQA an older entry"),
  );
  return {
    found: Boolean(row),
    text: (row?.textContent ?? "").replace(/\s+/g, " "),
  };
});
check(
  "THE RULE: an entry recorded with an invoice number still shows it",
  stillShows.found && stillShows.text.includes("INV-REFQA-77"),
  stillShows.found ? stillShows.text.slice(0, 130) : "row not found",
);

/* The drawer: one Reference, no toggle, and the invoice is a clip. */
await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  [...main.querySelectorAll("button, a")]
    .find((b) => /^Add expense$/i.test((b.textContent ?? "").trim()))
    ?.click();
});
await settle(1700);

const drawer = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"], aside, form')].find(
    (x) => /Reference/i.test(x.textContent ?? ""),
  );
  const text = (d?.textContent ?? "").replace(/\s+/g, " ");
  return {
    found: Boolean(d),
    saysTransactionId: /Transaction ID/i.test(text),
    saysReferenceOnly: /Reference only/i.test(text),
    saysReference: /Reference/i.test(text),
    hasInvoiceNoBox: Boolean(d?.querySelector('input[name="invoiceNo"]')),
    hasReferenceBox: Boolean(d?.querySelector('input[name="reference"]')),
    fileInputs: (d?.querySelectorAll('input[type="file"]') ?? []).length,
  };
});
check("the expense drawer opens", drawer.found, "");
check(
  'THE ASK: no "Transaction ID", and no Reference-only toggle',
  !drawer.saysTransactionId && !drawer.saysReferenceOnly,
  `id ${drawer.saysTransactionId}, toggle ${drawer.saysReferenceOnly}`,
);
check(
  "just Reference, with its own box",
  drawer.saysReference && drawer.hasReferenceBox,
  "",
);
check(
  "THE ASK: the invoice has no number box, only somewhere to attach it",
  !drawer.hasInvoiceNoBox && drawer.fileInputs >= 2,
  `invoiceNo box ${drawer.hasInvoiceNoBox}, ${drawer.fileInputs} file inputs`,
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
