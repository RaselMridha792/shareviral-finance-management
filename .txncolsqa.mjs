/**
 * All transactions: two columns, two eyes, and one colour per row.
 *
 * The owner, on a marked screenshot:
 *
 *   45  *"ekhaneo same vabe invoice and reference thakbe entry no thakbena. eye
 *       button thakbe."* — the same pair the other money tables carry, opened
 *       rather than read, and the app's own number off this screen.
 *   46  *"row te text gular color ek jaygay garo red arekjaygay halka red so sob
 *       color red hobe jei row red hobe kono extra kore blue korar dorkar nai
 *       link er khetre. sudhu underline holei colbe."*
 *
 * The failure worth driving rather than reading: the eye must open the drawer
 * that has something in it. Both columns used to read the row's TOTAL file
 * count, so an entry with only an invoice attached would have offered an eye on
 * Reference too — a click into an empty drawer, which is the complaint that
 * took the amber triangle off this table in the first place. So this attaches a
 * file of ONE kind and requires the other column to say N/A.
 *
 * And colour is measured, not read: `getComputedStyle` on the link and on a
 * muted caption inside a red row, both required to match the row's own colour.
 *
 *     node .txncolsqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import path from "node:path";
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
const call = async (method, path_, body) => {
  const res = await fetch(API + path_, {
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
const wipe = async () => {
  await db.query(
    "delete from files where transaction_id in (select id from transactions where description like 'COLQA%')",
  );
  await db.query("delete from transactions where description like 'COLQA%'");
  await db.query("delete from accounts where name like 'COLQA %'");
};
await wipe();

const account = (
  await call("POST", "/accounts", {
    name: "COLQA Bank",
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

/* One row with ONLY an invoice attached, and no number typed on either side. */
const withInvoice = (
  await call("POST", "/transactions", {
    direction: "out",
    txnDate: month + "05",
    accountId: account.id,
    amount: "9000.00",
    categoryId: cat.id,
    description: "COLQA only an invoice attached",
    paymentMethod: "bank_transfer",
  })
).body;
/* And one with only a bank record. */
const withRecord = (
  await call("POST", "/transactions", {
    direction: "out",
    txnDate: month + "06",
    accountId: account.id,
    amount: "8000.00",
    categoryId: cat.id,
    description: "COLQA only a bank record attached",
    paymentMethod: "bank_transfer",
  })
).body;

/* A 1x1 PNG, uploaded through the real endpoint so the row's counts come from
   the same place the screen reads. */
const sample = path.join(process.env.TEMP || ".", "colqa.png");
fs.writeFileSync(
  sample,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);
const upload = async (txnId, kind) => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([fs.readFileSync(sample)], { type: "image/png" }),
    "colqa.png",
  );
  form.append("kind", kind);
  const res = await fetch(`${API}/files/transaction/${txnId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.status;
};
const up1 = await upload(withInvoice.id, "invoice");
const up2 = await upload(withRecord.id, "bank_statement");
check(
  "two rows exist, one with only an invoice and one with only a bank record",
  up1 < 300 && up2 < 300,
  `HTTP ${up1} / ${up2}`,
);

const counts = (
  await db.query(
    `select t.description, t.invoice_no, t.reference,
            (select count(*)::int from files f where f.transaction_id=t.id and f.kind='invoice' and f.deleted_at is null) inv,
            (select count(*)::int from files f where f.transaction_id=t.id and f.kind in ('bank_statement','receipt','other') and f.deleted_at is null) rec
       from transactions t where t.description like 'COLQA%' order by t.txn_date`,
  )
).rows;
check(
  "and the two kinds really are counted apart",
  counts[0]?.inv === 1 && counts[0]?.rec === 0 && counts[1]?.inv === 0 && counts[1]?.rec === 1,
  counts.map((r) => `inv ${r.inv}/rec ${r.rec}`).join(", "),
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
await page.setViewport({ width: 1900, height: 1300 });
await page.goto(`${WEB}/transactions`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 3000));

const view = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const invCol = heads.findIndex((h) => /^Invoice$/i.test(h));
  const refCol = heads.findIndex((h) => /^Reference$/i.test(h));
  const rowFor = (needle) =>
    [...document.querySelectorAll("tbody tr")].find((r) =>
      (r.textContent ?? "").includes(needle),
    );
  const readRow = (needle) => {
    const tr = rowFor(needle);
    if (!tr) return null;
    const cells = [...tr.querySelectorAll("td")];
    const cellText = (i) => (cells[i]?.textContent ?? "").trim();
    const cellHasButton = (i) => Boolean(cells[i]?.querySelector("button"));
    const link = tr.querySelector("a");
    const muted = [...tr.querySelectorAll(".text-muted-foreground")].find(
      (el) => (el.textContent ?? "").trim().length > 0,
    );
    return {
      invoice: cellText(invCol),
      invoiceButton: cellHasButton(invCol),
      reference: cellText(refCol),
      referenceButton: cellHasButton(refCol),
      rowColour: getComputedStyle(cells[2] ?? tr).color,
      linkColour: link ? getComputedStyle(link).color : null,
      linkDecoration: link
        ? getComputedStyle(link).textDecorationLine +
          "/" +
          getComputedStyle(link).textDecorationColor
        : null,
      mutedColour: muted ? getComputedStyle(muted).color : null,
    };
  };
  return {
    heads,
    invCol,
    refCol,
    onlyInvoice: readRow("COLQA only an invoice attached"),
    onlyRecord: readRow("COLQA only a bank record attached"),
  };
});

check(
  "45: the table carries Invoice and Reference",
  view.invCol >= 0 && view.refCol >= 0,
  view.heads.filter((h) => /invoice|reference|entry/i.test(h)).join(" | "),
);
check(
  "45: and Entry No. is gone from this screen",
  !view.heads.some((h) => /entry no/i.test(h)),
  view.heads.join(" | ").slice(0, 150),
);

/* THE ONE THAT MATTERS: an eye only where its own drawer has something. */
check(
  "45: a row with only an invoice offers the eye on Invoice",
  view.onlyInvoice?.invoiceButton === true,
  `invoice cell "${view.onlyInvoice?.invoice}"`,
);
check(
  "45: and says N/A on Reference rather than opening an empty drawer",
  view.onlyInvoice?.referenceButton === false &&
    /N\/A/.test(view.onlyInvoice?.reference ?? ""),
  `reference cell "${view.onlyInvoice?.reference}", button ${view.onlyInvoice?.referenceButton}`,
);
check(
  "45: a row with only a bank record offers the eye on Reference",
  view.onlyRecord?.referenceButton === true,
  `reference cell "${view.onlyRecord?.reference}"`,
);
check(
  "45: and says N/A on Invoice",
  view.onlyRecord?.invoiceButton === false &&
    /N\/A/.test(view.onlyRecord?.invoice ?? ""),
  `invoice cell "${view.onlyRecord?.invoice}", button ${view.onlyRecord?.invoiceButton}`,
);

/* --------------------------- 46: one colour per row -------------------- */

const row = view.onlyInvoice;
check(
  "46: a link inside a coloured row is the row's colour, not blue",
  row?.linkColour !== null && row?.linkColour === row?.rowColour,
  `link ${row?.linkColour} vs row ${row?.rowColour}`,
);
check(
  "46: it is still underlined, which is what tells it apart now",
  /underline/.test(row?.linkDecoration ?? ""),
  row?.linkDecoration ?? "no link found",
);
check(
  "46: a muted caption takes the row's colour too — no second shade",
  row?.mutedColour === null || row?.mutedColour === row?.rowColour,
  `muted ${row?.mutedColour} vs row ${row?.rowColour}`,
);

await browser.close();
fs.rmSync(sample, { force: true });
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
