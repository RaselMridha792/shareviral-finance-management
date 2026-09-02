/**
 * Money transfer: the two eyes, the tick column, and the pair that must go
 * together.
 *
 * The owner: *"ekhane eye button thakbe invoice and reference row te ... also
 * ekhane multiple select and trash option rakhte hobe."*
 *
 * The thing worth driving rather than reading is the PAIR. A transfer is two
 * ledger entries — money out of one account and into another — and the whole
 * reason it exists as its own screen is that the two must never disagree.
 * Ticking a row and pressing Move to trash has to take BOTH halves, or the two
 * accounts stop reconciling and the screen that exists to prevent that caused
 * it. So this counts the ledger rows before and after, not just the screen.
 *
 * And the eyes are checked the same way the transactions table's were: a
 * transfer carrying only ONE kind of file must offer the eye on that column and
 * say N/A on the other, rather than opening an empty drawer.
 *
 *     node .transfersqa2.mjs      (local only — writes and deletes)
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
    "delete from files where transaction_id in (select id from transactions where description like 'TRQA%')",
  );
  await db.query("delete from transactions where description like 'TRQA%'");
  await db.query("delete from accounts where name like 'TRQA %'");
};
await wipe();

const mkAccount = async (name, opening) =>
  (
    await call("POST", "/accounts", {
      name,
      type: "bank",
      currency: "BDT",
      openingBalance: opening,
      openingBalanceOn: month + "01",
    })
  ).body;
const from = await mkAccount("TRQA From", "900000.00");
const to = await mkAccount("TRQA To", "0.00");

const mkTransfer = async (desc, amount, day) =>
  call("POST", "/transactions/transfer", {
    txnDate: month + day,
    fromAccountId: from.id,
    toAccountId: to.id,
    amount,
    description: desc,
  });

const t1 = await mkTransfer("TRQA only an invoice", "10000.00", "05");
const t2 = await mkTransfer("TRQA only a bank record", "20000.00", "06");
const t3 = await mkTransfer("TRQA to be trashed in bulk", "30000.00", "07");
check(
  "three transfers exist",
  [t1, t2, t3].every((r) => r.status < 300),
  [t1, t2, t3].map((r) => r.status).join("/"),
);

/* The OUT half is the side files hang on and the side the screen sends. */
const outIdOf = async (desc) =>
  (
    await db.query(
      "select id from transactions where description like $1 and direction='out' limit 1",
      [desc + "%"],
    )
  ).rows[0]?.id;

const sample = path.join(process.env.TEMP || ".", "trqa.png");
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
    "trqa.png",
  );
  form.append("kind", kind);
  const res = await fetch(`${API}/files/transaction/${txnId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.status;
};
const invOut = await outIdOf("TRQA only an invoice");
const recOut = await outIdOf("TRQA only a bank record");
const up1 = await upload(invOut, "invoice");
const up2 = await upload(recOut, "bank_statement");
check(
  "one carries only an invoice, one only a bank record",
  up1 < 300 && up2 < 300,
  `HTTP ${up1} / ${up2}`,
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
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const load = async () => {
  await page.goto(`${WEB}/transfers`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await settle(2800);
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll("thead th")].map((h) =>
      (h.textContent ?? "").trim(),
    );
    const invCol = heads.findIndex((h) => /^Invoice$/i.test(h));
    const refCol = heads.findIndex((h) => /^Reference$/i.test(h));
    const readRow = (needle) => {
      const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
        (r.textContent ?? "").includes(needle),
      );
      if (!tr) return null;
      const cells = [...tr.querySelectorAll("td")];
      return {
        invoice: (cells[invCol]?.textContent ?? "").trim(),
        invoiceButton: Boolean(cells[invCol]?.querySelector("button")),
        reference: (cells[refCol]?.textContent ?? "").trim(),
        referenceButton: Boolean(cells[refCol]?.querySelector("button")),
        tick: tr.querySelectorAll('input[type="checkbox"]').length,
      };
    };
    return {
      heads,
      headerTicks: document.querySelectorAll('thead input[type="checkbox"]')
        .length,
      onlyInvoice: readRow("TRQA only an invoice"),
      onlyRecord: readRow("TRQA only a bank record"),
      toTrash: readRow("TRQA to be trashed in bulk"),
    };
  });
};

let view = await load();

check(
  "44: the table has a tick in its header and one on every row",
  view.headerTicks === 1 &&
    view.onlyInvoice?.tick === 1 &&
    view.toTrash?.tick === 1,
  `header ${view.headerTicks}, rows ${view.onlyInvoice?.tick}/${view.toTrash?.tick}`,
);

/* The eyes, each over its own drawer. */
check(
  "44: a transfer with only an invoice offers the eye on Invoice",
  view.onlyInvoice?.invoiceButton === true,
  `invoice cell "${view.onlyInvoice?.invoice}"`,
);
check(
  "44: and says N/A on Reference rather than opening an empty drawer",
  view.onlyInvoice?.referenceButton === false &&
    /N\/A/.test(view.onlyInvoice?.reference ?? ""),
  `reference "${view.onlyInvoice?.reference}", button ${view.onlyInvoice?.referenceButton}`,
);
check(
  "44: one with only a bank record offers the eye on Reference",
  view.onlyRecord?.referenceButton === true,
  `reference cell "${view.onlyRecord?.reference}"`,
);
check(
  "44: and says N/A on Invoice",
  view.onlyRecord?.invoiceButton === false &&
    /N\/A/.test(view.onlyRecord?.invoice ?? ""),
  `invoice "${view.onlyRecord?.invoice}", button ${view.onlyRecord?.invoiceButton}`,
);

/* ------------------ the bulk trash, and BOTH halves -------------------- */

const liveRows = async () =>
  (
    await db.query(
      "select count(*)::int n from transactions where description like 'TRQA%' and deleted_at is null",
    )
  ).rows[0].n;
const before = await liveRows();
check(
  "three transfers are six ledger rows — an out and an in each",
  before === 6,
  `${before} rows`,
);

/* Tick the one built for it, and confirm. */
await page.evaluate(() => {
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("TRQA to be trashed in bulk"),
  );
  tr?.querySelector('input[type="checkbox"]')?.click();
});
await settle(700);
const bar = await page.evaluate(() =>
  (document.querySelector("main")?.textContent ?? "").replace(/\s+/g, " "),
);
check(
  "44: ticking one raises a bar that counts TRANSFERS, not ledger rows",
  /1 transfer selected|1 selected/i.test(bar),
  (bar.match(/\d+ transfers? selected|\d+ selected/i) ?? ["not found"])[0],
);

await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Move to trash",
  );
  btn?.click();
});
await settle(1200);
await page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
  const type = (el, value) => {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  for (const box of dialog.querySelectorAll('input[type="checkbox"]')) {
    if (!box.checked) box.click();
  }
  const texts = [
    ...dialog.querySelectorAll('input[type="text"], input:not([type]), textarea'),
  ];
  const word = texts.find((el) => el.tagName !== "TEXTAREA");
  if (word) type(word, "trash");
  const reason = texts.find((el) => el.tagName === "TEXTAREA");
  if (reason) type(reason, "TRQA bulk");
});
await settle(500);
await page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
  const go = [...(dialog?.querySelectorAll("button") ?? [])].find(
    (b) => /^Yes,/i.test((b.textContent ?? "").trim()) && !b.disabled,
  );
  go?.click();
});

/* Wait for the fact, not for a clock. */
let after = before;
for (let waited = 0; waited < 20000 && after !== before - 2; waited += 500) {
  await settle(500);
  after = await liveRows();
}
check(
  "44: THE PAIR — trashing one transfer takes BOTH of its ledger rows",
  after === before - 2,
  `${before} -> ${after} (a transfer is two rows; ${before - 1} would mean one half was left behind)`,
);

const orphan = (
  await db.query(
    `select count(*)::int n
       from transactions
      where description like 'TRQA to be trashed%'
        and deleted_at is null`,
  )
).rows[0].n;
check(
  "44: and neither account is left holding half a transfer",
  orphan === 0,
  `${orphan} half-transfer(s) still live`,
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
