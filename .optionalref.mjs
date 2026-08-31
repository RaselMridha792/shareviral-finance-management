/**
 * Invoice No., Transaction ID and Reference are optional. Everywhere.
 *
 * The owner's instruction: none of the three may be required. Money arrives
 * without an invoice and banks do not always give a number, and a box that
 * refuses the entry is how a real receipt goes unrecorded — or gets recorded
 * with an invented number, which is worse than blank because a blank says
 * "none" and a number says something untrue.
 *
 * The contract has always allowed all three to be empty. Cash In was the only
 * screen insisting, so the sweep matters more than the fix: this walks every
 * drawer that asks for them rather than checking the one that was wrong.
 *
 *     node .optionalref.mjs      (local only — writes and deletes)
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

await db.query("delete from transactions where description like 'OPTQA %'");

/* --------------------------------------------- the contract accepts nothing */

const account = (
  await db.query(
    "select id from accounts where deleted_at is null and type <> 'card' limit 1",
  )
).rows[0];
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

const spend = await call("POST", "/transactions", {
  direction: "out",
  txnDate: "2026-08-19",
  accountId: account.id,
  amount: "120.00",
  categoryId: cat.id,
  description: "OPTQA a spend with no paperwork numbers",
  paymentMethod: "cash",
});
check(
  "an expense records with neither number",
  spend.status === 201,
  `HTTP ${spend.status}${spend.status !== 201 ? " " + JSON.stringify(spend.body) : ""}`,
);

const cashIn = await call("POST", "/transactions/cash-in", {
  txnDate: "2026-08-19",
  accountId: account.id,
  amount: "5000.00",
  description: "OPTQA funding with no invoice and no transaction id",
  usdSent: "40.00",
  usdRate: "125.00",
});
check(
  "and a cash-in records with neither, which is the one that used to refuse",
  cashIn.status === 201,
  `HTTP ${cashIn.status}${cashIn.status !== 201 ? " " + JSON.stringify(cashIn.body) : ""}`,
);
const stored = (
  await db.query(
    "select invoice_no, reference from transactions where description like 'OPTQA funding%'",
  )
).rows[0];
check(
  "both land as nothing at all, not as an empty string pretending to be one",
  stored && stored.invoice_no === null && stored.reference === null,
  JSON.stringify(stored ?? null),
);

/* ------------------------------------------------- and no drawer insists */

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
await page.setViewport({ width: 1500, height: 1150 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/** What a drawer asks of the three fields, once it is open. */
const inspect = () =>
  page.evaluate(() => {
    /*
     * Found by their LABEL, not by an input name.
     *
     * Both fields used to hold a text box — `invoiceNo` and `reference` — and
     * this file looked them up with `input[name=...]`. Neither box exists now:
     * #6 made Invoice attach-only and #34 did the same to Reference, on the
     * owner's word that both are things you attach rather than things you type.
     * The lookup found nothing and reported all three drawers as missing both
     * fields — this file testing a rule that had been replaced.
     *
     * What it checks now is what still matters and what the change could
     * genuinely have broken: both fields are STILL THERE, both are attach-only,
     * and neither is required.
     */
    const fieldNamed = (re) =>
      [...document.querySelectorAll("label")].find((l) =>
        re.test((l.textContent ?? "").trim()),
      );
    const typeableIn = (field) =>
      field
        ? [...field.querySelectorAll("input")].filter(
            (el) => el.type !== "file" && el.type !== "checkbox",
          ).length
        : 0;
    const clipsIn = (field) =>
      field
        ? field.querySelectorAll(
            'button[aria-label*="ttach" i], button[title*="ttach" i]',
          ).length
        : 0;
    const invoice = fieldNamed(/^Invoice/);
    const reference = fieldNamed(/^Reference/);
    const labelFor = (field) =>
      (field?.textContent ?? "").split("\n")[0].trim().slice(0, 40);
    /*
     * The asterisk `Field` draws beside a required label, and only that: it is
     * the FIRST span inside the label's caption span, aria-hidden, reading "*".
     * Matching on `.text-negative` anywhere in the label caught the error text
     * and the toggle buttons instead, and reported every drawer as starred.
     */
    const starred = [...document.querySelectorAll("label")]
      .filter((l) =>
        /^(Invoice No\.|Transaction ID|Reference)/.test(
          (l.textContent ?? "").trim(),
        ),
      )
      .filter((l) =>
        [...(l.querySelector("span")?.children ?? [])].some(
          (c) => c.getAttribute("aria-hidden") === "true" && c.textContent === "*",
        ),
      )
      .map((l) => (l.textContent ?? "").slice(0, 24).trim());
    return {
      invoicePresent: Boolean(invoice),
      invoiceTypeable: typeableIn(invoice),
      invoiceClips: clipsIn(invoice),
      invoiceLabel: labelFor(invoice),
      referencePresent: Boolean(reference),
      referenceTypeable: typeableIn(reference),
      referenceClips: clipsIn(reference),
      referenceLabel: labelFor(reference),
      starredLabels: starred,
    };
  });

const openDrawer = async (url, opener) => {
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2600);
  const clicked = await page.evaluate((label) => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      new RegExp(label).test(x.textContent ?? ""),
    );
    if (!b) return false;
    b.click();
    return true;
  }, opener);
  await settle(1500);
  return clicked;
};

for (const [url, opener, name] of [
  ["/accounts/cash-in", "Add cash", "Cash In"],
  ["/expenses/other", "Add expense", "the expense drawer"],
  ["/transfers", "New transfer", "the transfer drawer"],
]) {
  const opened = await openDrawer(url, opener);
  const seen = opened ? await inspect() : null;
  check(
    `${name} offers both papers, asks for neither number, requires neither`,
    Boolean(opened) &&
      seen?.invoicePresent === true &&
      seen?.invoiceTypeable === 0 &&
      seen?.invoiceClips >= 1 &&
      seen?.referencePresent === true &&
      seen?.referenceTypeable === 0 &&
      seen?.referenceClips >= 1 &&
      (seen?.starredLabels.length ?? 0) === 0,
    JSON.stringify({ opened, ...seen }),
  );
  await page.keyboard.press("Escape");
  await settle(500);
}

/* ------------------ and Cash In really saves with the boxes left alone ---- */

await openDrawer("/accounts/cash-in", "Add cash");
const filled = await page.evaluate(() => {
  const set = (name, value) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (!el) return false;
    /*
     * Walk up to whichever prototype actually declares `value`. Taking it from
     * HTMLInputElement throws "Illegal invocation" on a select, and taking it
     * from the element's own prototype finds nothing when React has wrapped it.
     */
    let proto = Object.getPrototypeOf(el);
    let desc = Object.getOwnPropertyDescriptor(proto, "value");
    while (proto && !desc?.set) {
      proto = Object.getPrototypeOf(proto);
      desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : undefined;
    }
    if (!desc?.set) return false;
    desc.set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  return {
    date: set("txnDate", "2026-08-19"),
    description: set("description", "OPTQA typed with the numbers left blank"),
    usd: set("usdSent", "20"),
    rate: set("usdRate", "125"),
  };
});
// The account picker is a searchable button+listbox, not a native select.
await page.evaluate(() => {
  const field = [...document.querySelectorAll("label")].find((l) =>
    (l.textContent ?? "").startsWith("Received Bank Name"),
  );
  field?.querySelector("button")?.click();
});
await settle(600);
await page.evaluate(() => {
  const row = document.querySelector('[role="option"]');
  row?.click();
});
await settle(700);
/*
 * The honest question is not "does the form validate" — description, date,
 * account and amount are all genuinely required and a test that drives every
 * one of them is testing the test. It is: with the two numbers left alone,
 * is either of them among what the form objects to?
 */
const blocked = await page.evaluate(() => {
  const form = document.querySelector('[role="dialog"] form, form');
  const complaints = [...(form?.querySelectorAll(":invalid") ?? [])]
    .map((el) => el.getAttribute("name"))
    .filter(Boolean);
  return { complaints };
});
check(
  "leaving both numbers blank is not among what the form objects to",
  !blocked.complaints.includes("invoiceNo") &&
    !blocked.complaints.includes("reference"),
  `it objects to: ${blocked.complaints.join(", ") || "nothing"}`,
);

await browser.close();
await db.query("delete from transactions where description like 'OPTQA %'");
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
