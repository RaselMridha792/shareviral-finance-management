/**
 * Saved invoices, through the API (#118).
 *
 * The owner, 29 Sep 2026: *"All invoice a table format a invoice gula save
 * thakbe. okhan theke view kora jabe, edit kora jabe, delete kora jabe"*.
 *
 * Against the running API and the local database:
 *   - a save stores the document as sent, and the list's columns read out of
 *     it — the total worked out on the server in paisa, whatever the browser
 *     claims;
 *   - list, search, status filter, one invoice, the next number;
 *   - one live invoice per number (any case), refused in words;
 *   - an edit rewrites it, and the audit log keeps the facts, not the logo;
 *   - a price or quantity that is not a number is refused by item; an
 *     oversized logo is refused;
 *   - only the roles that write to the books reach it;
 *   - delete goes to the trash; the number is free again; restoring the old
 *     one while the number is taken is refused in words; purge cleans up.
 *
 *     node .invoiceapiqa.mjs      (needs `npm run dev`: api :4001)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

const API = "http://localhost:4001/api";
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
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const who = async (role) =>
  (await q(`select id, role, token_version from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role]))[0];
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const roles = { super_admin: await who("super_admin"), cfo: await who("cfo"), ceo: await who("ceo"), hr: await who("hr") };

const call = async (method, path, body, role = "super_admin") => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokenFor(roles[role])}`,
      "X-Requested-With": "finance-web",
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
};

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const TAG = `QA-INV-${Date.now().toString(36).toUpperCase()}`;
const doc = (number, over = {}) => ({
  v: 1,
  logo: null,
  companyName: "ShareViral™",
  tagline: "Level Up Your Earnings",
  background: "#0a0a0a",
  heading: "#0a0a0a",
  accent: "#bfff00",
  status: "SENT",
  number,
  issuedOn: "2026-09-29",
  dueOn: "2026-10-29",
  currencyLabel: "৳ — BDT",
  salesPeriod: "September 2026",
  showUsd: true,
  usdRate: "120",
  billTo: [
    { id: 1, text: "", bold: false, size: 12 },
    { id: 2, text: "Acme Holdings Ltd", bold: true, size: 14 },
  ],
  billFrom: [{ id: 3, text: "ShareViral Corp (BD)", bold: true, size: 14 }],
  projectTitle: `${TAG} Roadmap`,
  items: [
    { id: 4, description: "Build", qty: "2.5", price: "1,000.10" },
    { id: 5, description: "Hosting", qty: "3", price: "0.10" },
  ],
  payTerms: "30 Days",
  pay: [{ id: 6, label: "Bank Name", value: "Standard Chartered Bank", bold: false, size: 12.5 }],
  notes: "Thank you.",
  hidden: { meta: false, bill: false, terms: false, bank: false, notes: false },
  nextId: 7,
  ...over,
});

const made = [];
try {
  console.log("\nSaving");
  const first = await call("POST", "/invoices", { document: doc(`${TAG}-001`) });
  made.push(first.body?.id);
  check("a save answers 201 with the invoice", first.status === 201 && Boolean(first.body?.id), String(first.status));
  check(
    "the total is the server's, in paisa — 2.5 × 1,000.10 + 3 × 0.10 = 2,500.55",
    first.body?.totalAmount === "2500.55",
    first.body?.totalAmount,
  );
  check("who it is to is the first line with words on it", first.body?.clientName === "Acme Holdings Ltd", first.body?.clientName);
  check("the dates and the rate are read out of it", first.body?.issuedOn === "2026-09-29" && first.body?.dueOn === "2026-10-29" && Number(first.body?.usdRate) === 120);
  const stored = (await q(`select document from invoices where id = $1`, [first.body.id]))[0]?.document;
  /* jsonb keeps its own key order, so compare with the keys sorted. */
  const canon = (value) =>
    Array.isArray(value)
      ? value.map(canon)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canon(value[k])]))
        : value;
  check("the document is stored exactly as sent", JSON.stringify(canon(stored)) === JSON.stringify(canon(doc(`${TAG}-001`))));

  console.log("\nReading");
  const next = await call("GET", "/invoices/next-number");
  check("the next number follows the last one in its own shape", next.body?.number === `${TAG}-002`, next.body?.number);
  const list = await call("GET", `/invoices?q=${encodeURIComponent(TAG)}`);
  check("the list finds it by number", list.status === 200 && list.body.items.some((r) => r.id === first.body.id), `${list.body?.total}`);
  const byTitle = await call("GET", `/invoices?q=${encodeURIComponent(`${TAG} Roadmap`)}`);
  check("and by its project title", byTitle.body?.items?.some((r) => r.id === first.body.id));
  const paid = await call("GET", `/invoices?status=PAID&q=${encodeURIComponent(TAG)}`);
  check("the status filter leaves a SENT one out", paid.status === 200 && paid.body.items.length === 0);
  const one = await call("GET", `/invoices/${first.body.id}`);
  check("one invoice comes back with its document", one.status === 200 && one.body.document?.number === `${TAG}-001`);
  check("the list carries no documents", list.body.items.every((r) => !("document" in r)));

  console.log("\nOne number, one invoice");
  const twin = await call("POST", "/invoices", { document: doc(`${TAG}-001`.toLowerCase()) });
  check("the same number in another case is refused, 409, in words", twin.status === 409 && /already the number of another invoice/.test(twin.body?.message ?? ""), `${twin.status} ${twin.body?.message}`);
  const second = await call("POST", "/invoices", { document: doc(`${TAG}-002`, { status: "PAID" }) });
  made.push(second.body?.id);
  const clash = await call("PATCH", `/invoices/${second.body.id}`, { document: doc(`${TAG}-001`) });
  check("an edit onto a taken number is refused too", clash.status === 409, String(clash.status));

  console.log("\nEditing");
  const edited = await call("PATCH", `/invoices/${first.body.id}`, {
    document: doc(`${TAG}-001A`, { status: "PAID", items: [{ id: 4, description: "Build", qty: "1", price: "999.99" }], logo: "data:image/png;base64,iVBORw0KGgo=" }),
  });
  check("an edit rewrites number, status and total", edited.status === 200 && edited.body.invoiceNumber === `${TAG}-001A` && edited.body.status === "PAID" && edited.body.totalAmount === "999.99", JSON.stringify({ n: edited.body?.invoiceNumber, s: edited.body?.status, t: edited.body?.totalAmount }));
  const audit = await q(`select action::text, summary, before::text as before, after::text as after from audit_logs where entity_table = 'invoices' and entity_id = $1 order by occurred_at`, [first.body.id]);
  check("the audit log has the save and the edit", audit.length === 2 && audit[0].action === "create" && audit[1].action === "update", audit.map((a) => a.summary).join(" | "));
  check("and keeps the facts, not the logo", audit.every((a) => !String(a.after ?? "").includes("base64") && !String(a.before ?? "").includes("base64")));

  console.log("\nRefusals");
  const badPrice = await call("POST", "/invoices", { document: doc(`${TAG}-BAD`, { items: [{ id: 4, description: "x", qty: "1", price: "12abc" }] }) });
  check("a price that is not an amount is refused by item", badPrice.status === 400 && /Item 1: the unit price/.test(badPrice.body?.message ?? ""), badPrice.body?.message);
  const badQty = await call("POST", "/invoices", { document: doc(`${TAG}-BAD`, { items: [{ id: 4, description: "x", qty: "1.23456", price: "1" }] }) });
  check("a quantity past 3 decimals is refused by item", badQty.status === 400 && /Item 1: the quantity/.test(badQty.body?.message ?? ""), badQty.body?.message);
  const bigLogo = await call("POST", "/invoices", { document: doc(`${TAG}-BAD`, { logo: `data:image/png;base64,${"A".repeat(85000)}` }) });
  check("a logo over the limit is refused", bigLogo.status === 400, String(bigLogo.status));
  const noNumber = await call("POST", "/invoices", { document: doc("   ") });
  check("an invoice with no number is refused", noNumber.status === 400, String(noNumber.status));
  const leftover = await q(`select count(*)::int as n from invoices where invoice_number ilike $1`, [`${TAG}-BAD%`]);
  check("and none of those left a row", leftover[0].n === 0);

  console.log("\nWho");
  for (const [role, allowed] of [["cfo", true], ["ceo", false], ["hr", false]]) {
    if (!roles[role]) continue;
    const r = await call("GET", "/invoices", undefined, role);
    const w = await call("POST", "/invoices", { document: {} }, role);
    check(`${role}: ${allowed ? "reads and writes" : "refused, 403"}`, allowed ? r.status === 200 && w.status === 400 : r.status === 403 && w.status === 403, `${r.status}/${w.status}`);
  }

  console.log("\nDelete, and the trash");
  const binned = await call("POST", `/trash/invoice/${first.body.id}`, { reason: "harness" });
  check("delete goes to the trash", binned.status === 201 || binned.status === 200, `${binned.status} ${JSON.stringify(binned.body)}`);
  const gone = await call("GET", `/invoices/${first.body.id}`);
  const listAfter = await call("GET", `/invoices?q=${encodeURIComponent(TAG)}`);
  check("and it leaves the list and its own address", gone.status === 404 && !listAfter.body.items.some((r) => r.id === first.body.id));
  const summary = await call("GET", "/trash/summary");
  const kind = (summary.body ?? []).find?.((k) => k.kind === "invoice") ?? summary.body?.kinds?.find?.((k) => k.kind === "invoice");
  check("the trash lists invoices as a kind", Boolean(kind) && kind.count >= 1, JSON.stringify(kind));
  const reuse = await call("POST", "/invoices", { document: doc(`${TAG}-001A`) });
  made.push(reuse.body?.id);
  check("its number is free again", reuse.status === 201, String(reuse.status));
  const restore = await call("POST", `/trash/invoice/${first.body.id}/restore`);
  check("restoring the old one while the number is taken is refused, in words", restore.status === 400 && /Another invoice has the number/.test(restore.body?.message ?? ""), `${restore.status} ${restore.body?.message}`);
} finally {
  /* Clean up everything this made, through the trash like a person would. */
  const ids = (await q(`select id from invoices where invoice_number ilike $1`, [`${TAG}%`])).map((r) => r.id);
  for (const id of ids) {
    await call("POST", `/trash/invoice/${id}`, { reason: "harness" }).catch(() => {});
    await call("DELETE", `/trash/invoice/${id}`).catch(() => {});
  }
  const left = await q(`select count(*)::int as n from invoices where invoice_number ilike $1`, [`${TAG}%`]);
  await q(`delete from audit_logs where entity_table = 'invoices' and entity_id::text = any($1)`, [ids]).catch(() => {});
  check("cleaned up — purged through the trash", left[0].n === 0, `${left[0].n} left`);
  await db.end();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
