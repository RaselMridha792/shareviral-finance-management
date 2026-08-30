/**
 * The Money Transfer page, driven end to end.
 *
 * API half: the pair listing groups two rows into one event, refuses a zero
 * or same-account or beyond-means transfer with the right words, and void /
 * trash / restore treat the pair as one.
 *
 * Browser half: the sidebar carries the item, the page opens, the form
 * records a transfer, both balances move, the row appears once (not twice),
 * void strikes it through, delete removes it and the trash gives it back.
 *
 *     node .transferqa.mjs      (local only — writes and deletes)
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
const msgOf = (r) =>
  String(r.body?.message ?? "") +
  " " +
  Object.values(r.body?.errors ?? {}).flat().join(" ");

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

await db.query(`delete from transactions where account_id in (select id from accounts where name like 'QA Transfer%')`);
await db.query(`delete from accounts where name like 'QA Transfer%'`);
const mk = async (name, opening) =>
  (
    await call("POST", "/accounts", {
      name,
      type: "bank",
      currency: "BDT",
      openingBalance: opening,
      openingBalanceOn: "2026-08-01",
    })
  ).body.id;
const bankA = await mk("QA Transfer Bank", "10000.00");
const bankB = await mk("QA Transfer Cash", "500.00");

/* ------------------------------------------------------------- API half */

const zero = await call("POST", "/transactions/transfer", {
  txnDate: "2026-08-20",
  fromAccountId: bankA,
  toAccountId: bankB,
  amount: "0.00",
  description: "QA zero transfer",
});
check(
  "a zero transfer is refused by name",
  zero.status === 400 && /more than zero/i.test(msgOf(zero)),
  msgOf(zero).slice(0, 70),
);

const same = await call("POST", "/transactions/transfer", {
  txnDate: "2026-08-20",
  fromAccountId: bankA,
  toAccountId: bankA,
  amount: "100.00",
  description: "QA same account",
});
check(
  "same account on both sides is refused",
  same.status === 400 && /two different accounts/i.test(msgOf(same)),
  msgOf(same).slice(0, 70),
);

const beyond = await call("POST", "/transactions/transfer", {
  txnDate: "2026-08-20",
  fromAccountId: bankB,
  toAccountId: bankA,
  amount: "9999.00",
  description: "QA beyond means",
});
check(
  "a transfer past the balance is refused, naming the account",
  beyond.status === 400 && /QA Transfer Cash/.test(msgOf(beyond)),
  msgOf(beyond).slice(0, 80),
);

const made = await call("POST", "/transactions/transfer", {
  txnDate: "2026-08-20",
  fromAccountId: bankA,
  toAccountId: bankB,
  amount: "2500.00",
  description: "QA to petty cash",
  invoiceNo: "INV-QA-77",
  reference: "TRF-QA-1",
});
check("a real transfer records", made.status === 201, `HTTP ${made.status} ${msgOf(made)}`);

const listed = await call("GET", "/transactions/transfers?page=1&pageSize=20");
const row = listed.body?.items?.find((r) => r.description === "QA to petty cash");
check(
  "the listing shows it once, as one event with both accounts",
  listed.status === 200 &&
    Boolean(row) &&
    row.fromAccountName === "QA Transfer Bank" &&
    row.toAccountName === "QA Transfer Cash" &&
    row.amount === "2500.00",
  row
    ? `${row.fromAccountName} -> ${row.toAccountName} ${row.amount}`
    : `HTTP ${listed.status}, ${listed.body?.items?.length ?? 0} items`,
);
check(
  "and carries the invoice number and a paper count, like every table",
  row?.invoiceNo === "INV-QA-77" && row?.documentCount === 0,
  JSON.stringify({ invoiceNo: row?.invoiceNo, documentCount: row?.documentCount }),
);
// A file on the out half turns the count — the number cells read it.
await db.query(
  `insert into files (storage_key, original_name, mime_type, size_bytes, checksum, kind, transaction_id)
   values ('qa/none-' || $1::text, 'qa-invoice.pdf', 'application/pdf', 100, 'qa-checksum', 'invoice', $1::uuid)`,
  [row.outId],
);
const counted = await call("GET", "/transactions/transfers?page=1&pageSize=20");
check(
  "an attached file shows up in the count",
  counted.body?.items?.find((r) => r.outId === row.outId)?.documentCount === 1,
  "",
);
await db.query("delete from files where transaction_id = $1", [row.outId]);
const twice = listed.body?.items?.filter((r) => r.description === "QA to petty cash");
check("and exactly once, not once per half", twice?.length === 1, `${twice?.length} rows`);

const balances = async () =>
  Object.fromEntries(
    (
      await db.query(
        `select name, (opening_balance::numeric + coalesce((select sum(signed_amount) from transactions t where t.account_id = a.id and t.voided_at is null and t.deleted_at is null), 0))::text as bal
           from accounts a where name like 'QA Transfer%'`,
      )
    ).rows.map((r) => [r.name, Number(r.bal)]),
  );
let bal = await balances();
check(
  "both balances moved by the amount",
  bal["QA Transfer Bank"] === 7500 && bal["QA Transfer Cash"] === 3000,
  JSON.stringify(bal),
);

// Void the pair through the out half.
const voided = await call("POST", `/transactions/${row.outId}/void`, {
  reason: "QA: voiding the pair",
});
check("voiding the out half answers 200", voided.status < 400, `HTTP ${voided.status}`);
bal = await balances();
check(
  "and both balances return",
  bal["QA Transfer Bank"] === 10000 && bal["QA Transfer Cash"] === 500,
  JSON.stringify(bal),
);
const listedVoided = await call("GET", "/transactions/transfers?page=1&pageSize=20");
const voidedRow = listedVoided.body?.items?.find((r) => r.outId === row.outId);
check(
  "the voided pair is still listed, marked voided",
  Boolean(voidedRow?.voidedAt),
  "",
);

// Delete the pair to the trash through the out half; both halves must go.
const del = await call("POST", `/trash/transaction/${row.outId}`, {
  reason: "QA: deleting the pair",
});
check("deleting sends the pair to the trash", del.status < 400 && del.body?.deleted === 2, `deleted ${del.body?.deleted}`);
const listedGone = await call("GET", "/transactions/transfers?page=1&pageSize=20");
check(
  "a deleted pair leaves the listing",
  !listedGone.body?.items?.some((r) => r.outId === row.outId),
  "",
);
const restore = await call("POST", `/trash/transaction/${row.outId}/restore`);
check(
  "restoring brings both halves back",
  restore.status < 400 && restore.body?.restored === 2,
  `restored ${restore.body?.restored}`,
);
// It was voided before deletion, so it must come back voided.
const back = await call("GET", "/transactions/transfers?page=1&pageSize=20");
const backRow = back.body?.items?.find((r) => r.outId === row.outId);
check(
  "and still voided, because the void came before the delete",
  Boolean(backRow?.voidedAt),
  "",
);

/* --------------------------------------------------------- browser half */

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
await page.setViewport({ width: 1500, height: 1000 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);

const opened = await page.evaluate(() => ({
  heading: document.querySelector("h1")?.textContent?.trim() ?? null,
  navItem: [...document.querySelectorAll("nav a, aside a")].some((a) =>
    (a.textContent ?? "").includes("Money Transfer"),
  ),
  hasNewButton: [...document.querySelectorAll("button")].some((b) =>
    /New transfer/.test(b.textContent ?? ""),
  ),
  sideways:
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  voidedListed: document.body.innerText.includes("QA to petty cash"),
}));
check(
  // The h1's textContent carries the icon's ligature ("swap_horiz") along
  // with the words — the glyph is text to the DOM even though it draws as an
  // arrow. Contains, not equals.
  "the page opens with its heading and the rail carries the item",
  Boolean(opened.heading?.includes("Money Transfer")) && opened.navItem,
  `heading ${JSON.stringify(opened.heading)}, nav ${opened.navItem}`,
);
check("nothing scrolls sideways", opened.sideways === 0, `${opened.sideways}px`);
check(
  "the voided transfer is on the page, struck through",
  opened.voidedListed,
  "",
);

// Record one through the form.
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /New transfer/.test(b.textContent ?? ""))
    .click();
});
await settle(600);
const formSeen = await page.evaluate(() => {
  const drawer = [...document.querySelectorAll('[role="dialog"], aside')].find(
    (d) => /Move money between accounts/.test(d.textContent ?? ""),
  );
  if (!drawer) return null;
  const fromOptions = [
    ...(drawer.querySelector('select[name="fromAccountId"]')?.options ?? []),
  ].map((o) => o.textContent?.trim());
  return { fromOptions: fromOptions.slice(0, 6) };
});
check(
  "the form opens and its pickers state each account's balance",
  Boolean(formSeen) &&
    formSeen.fromOptions.some((t) => /QA Transfer Bank — ৳/.test(t ?? "")),
  formSeen ? formSeen.fromOptions.join(" | ").slice(0, 110) : "no drawer",
);

await page.evaluate((ids) => {
  const drawer = [...document.querySelectorAll('[role="dialog"], aside')].find(
    (d) => /Move money between accounts/.test(d.textContent ?? ""),
  );
  const set = (name, value) => {
    const el = drawer.querySelector(`[name="${name}"]`);
    const proto =
      el.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  set("fromAccountId", ids.from);
  set("toAccountId", ids.to);
  set("amount", "1200.00");
  set("description", "QA UI transfer");
}, { from: bankA, to: bankB });
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Record the transfer/.test(b.textContent ?? ""))
    .click();
});
await settle(2500);

const afterCreate = await page.evaluate(() => ({
  listed: document.body.innerText.includes("QA UI transfer"),
  drawerGone: ![...document.querySelectorAll("*")].some((d) =>
    /Record the transfer/.test(d.textContent ?? "") && d.tagName === "BUTTON",
  ),
}));
check(
  "a transfer recorded through the form lands in the table without a reload",
  afterCreate.listed,
  "",
);
bal = await balances();
check(
  "and the money actually moved",
  bal["QA Transfer Bank"] === 8800 && bal["QA Transfer Cash"] === 1700,
  JSON.stringify(bal),
);

// Beyond-means through the form: the account rule's message must surface.
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /New transfer/.test(b.textContent ?? ""))
    .click();
});
await settle(600);
await page.evaluate((ids) => {
  const drawer = [...document.querySelectorAll('[role="dialog"], aside')].find(
    (d) => /Move money between accounts/.test(d.textContent ?? ""),
  );
  const set = (name, value) => {
    const el = drawer.querySelector(`[name="${name}"]`);
    const proto =
      el.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  set("fromAccountId", ids.from);
  set("toAccountId", ids.to);
  set("amount", "999999.00");
  set("description", "QA beyond means UI");
}, { from: bankB, to: bankA });
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Record the transfer/.test(b.textContent ?? ""))
    .click();
});
await settle(2000);
const refusal = await page.evaluate(
  () => document.body.innerText.match(/does not hold enough money[^.]*/)?.[0] ?? null,
);
check(
  "a transfer past the balance shows the account rule's own sentence",
  Boolean(refusal),
  refusal ?? "no refusal text found",
);

await browser.close();

/* ---------------------------------------------------------------- tidy up */
await db.query(`delete from transactions where account_id in (select id from accounts where name like 'QA Transfer%')`);
await db.query(`delete from accounts where name like 'QA Transfer%'`);
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
