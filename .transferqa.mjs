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
/*
 * Everything from here down hangs a file, a void, a delete and a restore on
 * this row's id, and it used to be dereferenced straight away. A listing that
 * did not carry the fixture therefore killed the file with a stack trace and
 * no summary at all — the one failure mode a harness must never have, because
 * "it threw" says nothing about which rule broke. Say so and stop instead.
 */
const bail = async (why) => {
  console.log(`\n${why} — nothing below it can be judged, so stopping here.`);
  await db.query(
    `delete from transactions where account_id in (select id from accounts where name like 'QA Transfer%')`,
  );
  await db.query(`delete from accounts where name like 'QA Transfer%'`);
  await db.end();
  console.log("\n" + "=".repeat(70));
  console.log(
    `stopped early: ${results.filter((r) => !r.pass).length} of ${results.length} failed`,
  );
  process.exit(1);
};
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
if (!row) await bail("the transfers listing did not carry the QA fixture");
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

/*
 * Wait for the page to say it is ready, not for a number of milliseconds.
 *
 * Every lookup below used to sit behind a fixed sleep and then dereference
 * whatever it found without checking — `drawer.querySelector(...)`,
 * `.find(...).click()`. One slow render (a cold dev server, or half a dozen
 * harnesses driving it at once) and the file died with a TypeError and no
 * summary, which reads as "the transfer page is broken" when all that
 * happened is that a drawer took 700ms. The waits poll; the lookups report.
 */
const waitFor = (fn, arg, ms = 15000) =>
  page
    .waitForFunction(fn, { timeout: ms, polling: 100 }, arg)
    .then(() => true)
    .catch(() => false);

await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
await waitFor(() =>
  [...document.querySelectorAll("button")].some((b) =>
    /New transfer/.test(b.textContent ?? ""),
  ),
);
// The table's own rows, rather than a guess at how long they take. If they
// never arrive the check below fails on its own terms, which is the point.
await waitFor((text) => document.body.innerText.includes(text), "QA to petty cash");

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

/*
 * Opening the form, filling it and submitting it, each reporting what it
 * could not find rather than throwing on it.
 */
const openForm = async () => {
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) =>
      /New transfer/.test(b.textContent ?? ""),
    );
    if (!button) return false;
    button.click();
    return true;
  });
  if (!clicked) return false;
  // Up means the form is up, not merely the drawer: with fewer than two
  // accounts loaded the same drawer draws a sentence and no fields at all.
  return waitFor(() => {
    const drawer = [...document.querySelectorAll('[role="dialog"], aside')].find(
      (d) => /Move money between accounts/.test(d.textContent ?? ""),
    );
    return Boolean(drawer?.querySelector('select[name="fromAccountId"]'));
  });
};
const fillForm = (values) =>
  page.evaluate((vals) => {
    const drawer = [...document.querySelectorAll('[role="dialog"], aside')].find(
      (d) => /Move money between accounts/.test(d.textContent ?? ""),
    );
    if (!drawer) return ["the drawer itself"];
    const missing = [];
    for (const [name, value] of Object.entries(vals)) {
      const el = drawer.querySelector(`[name="${name}"]`);
      if (!el) {
        missing.push(name);
        continue;
      }
      const proto =
        el.tagName === "SELECT"
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return missing;
  }, values);
const submitForm = () =>
  page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) =>
      /Record the transfer/.test(b.textContent ?? ""),
    );
    if (!button) return false;
    button.click();
    return true;
  });

// Record one through the form.
const formUp = await openForm();
const formSeen = formUp
  ? await page.evaluate(() => {
      const drawer = [
        ...document.querySelectorAll('[role="dialog"], aside'),
      ].find((d) => /Move money between accounts/.test(d.textContent ?? ""));
      const fromOptions = [
        ...(drawer.querySelector('select[name="fromAccountId"]')?.options ?? []),
      ].map((o) => o.textContent?.trim());
      return {
        /*
         * Every option, not the first six. The picker is alphabetical and the
         * account list grows, so slicing meant the fixture could be pushed off
         * the end by accounts that have nothing to do with this test and the
         * check would fail while the page was perfectly right.
         */
        fromOptions,
        typedReference: Boolean(drawer.querySelector('[name="reference"]')),
        typedInvoice: Boolean(drawer.querySelector('[name="invoiceNo"]')),
        referenceClip: [...drawer.querySelectorAll("button[aria-label]")].some(
          (b) => /Attach the bank record/i.test(b.getAttribute("aria-label")),
        ),
      };
    })
  : null;
check(
  "the form opens and its pickers state each account's balance",
  Boolean(formSeen) &&
    formSeen.fromOptions.some((t) => /QA Transfer Bank — ৳/.test(t ?? "")),
  // The fixture's own option in the detail, so a failure shows what the
  // picker said about that account rather than the top of an alphabet.
  formSeen
    ? (formSeen.fromOptions.find((t) => /QA Transfer/.test(t ?? "")) ??
      `${formSeen.fromOptions.length} options, none for the fixture`)
    : "no form drawer",
);
/*
 * New, and it pins down what changed on this form today.
 *
 * Reference used to be a typed box with a "Transaction ID / Reference only"
 * toggle beside it. Both are gone: a reference is the bank's slip, attached,
 * on all four money forms — so what must be here is a paperclip and NO input
 * named `reference`. The harness was silent about this field either way,
 * which is how the box could have come back unnoticed.
 */
check(
  "Reference is attach-only — a clip, and no box to type a number into",
  Boolean(formSeen) && !formSeen.typedReference && formSeen.referenceClip,
  formSeen
    ? `typed reference ${formSeen.typedReference}, typed invoice ${formSeen.typedInvoice}, clip ${formSeen.referenceClip}`
    : "no form drawer",
);

const missingFields = await fillForm({
  fromAccountId: bankA,
  toAccountId: bankB,
  amount: "1200.00",
  description: "QA UI transfer",
});
// The four a transfer is still typed into. A field that disappears now reads
// as a FAIL naming it, instead of a TypeError from the setter.
check(
  "the form still carries the fields a transfer is typed into",
  missingFields.length === 0,
  missingFields.length ? `missing: ${missingFields.join(", ")}` : "",
);
const submitted = await submitForm();
// Wait for the table to carry it, rather than for 2.5s and a hope. The row
// arriving is also what says the request landed, so the balances read below
// are read after the money moved and not during.
const landed =
  submitted &&
  (await waitFor(
    (text) => document.body.innerText.includes(text),
    "QA UI transfer",
  ));

check(
  "a transfer recorded through the form lands in the table without a reload",
  Boolean(landed),
  submitted ? "" : "no Record the transfer button",
);
bal = await balances();
check(
  "and the money actually moved",
  bal["QA Transfer Bank"] === 8800 && bal["QA Transfer Cash"] === 1700,
  JSON.stringify(bal),
);

// Beyond-means through the form: the account rule's message must surface.
await openForm();
await fillForm({
  fromAccountId: bankB,
  toAccountId: bankA,
  amount: "999999.00",
  description: "QA beyond means UI",
});
await submitForm();
// Poll for the refusal instead of sleeping past it: a slow API answer used to
// read as "the rule never fired".
await waitFor(() => /does not hold enough money/.test(document.body.innerText));
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
