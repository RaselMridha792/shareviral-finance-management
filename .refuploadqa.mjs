/**
 * Reference stops being typed, and stops sharing a name with our own number.
 *
 * The owner: *"sobgula table eri reference upload only hobe ekhane field dorkar
 * nai. etao invoice tar motoi hobe."* And, asked which of the two things called
 * "Reference" he meant: both — the box goes, and the table stops calling our own
 * number by the bank's name.
 *
 * The half that could go wrong silently is the DATA. `reference` is a stored
 * column with real bank numbers in it (`FT26081200412` was in the owner's own
 * screenshot). Removing the box must not remove the value, must not stop it
 * displaying, and must not quietly erase it the next time somebody edits
 * anything else on the row. That last one is the dangerous one: an edit form
 * that no longer sends a field it used to send is how a column empties itself
 * one save at a time.
 *
 *     node .refuploadqa.mjs      (local only — writes and deletes)
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

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const wipe = async () => {
  await db.query("delete from transactions where description like 'REFQA%'");
  await db.query("delete from accounts where name like 'REFQA %'");
};
await wipe();

const account = (
  await call("POST", "/accounts", {
    name: "REFQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "100000.00",
    openingBalanceOn: TODAY.slice(0, 8) + "01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/*
 * An entry carrying a bank reference typed BEFORE this change — which is the
 * state every existing row on the live site is in.
 */
const BANKREF = "FT26081200412";
const made = await call("POST", "/transactions", {
  direction: "out",
  txnDate: TODAY,
  accountId: account.id,
  amount: "1500.00",
  categoryId: cat.id,
  description: "REFQA entry with a bank reference",
  paymentMethod: "bank_transfer",
  reference: BANKREF,
});
check(
  "the contract still ACCEPTS a stored reference",
  made.status === 201,
  `HTTP ${made.status} ${JSON.stringify(made.body?.message ?? "").slice(0, 80)}`,
);
const entry = made.body;
const storedRef = async () =>
  (await db.query("select reference from transactions where id=$1", [entry.id]))
    .rows[0].reference;
check(
  "and it is on the row",
  (await storedRef()) === BANKREF,
  `stored ${await storedRef()}`,
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

/* ------------------------- no typed box, anywhere ---------------------- */

const FORMS = [
  ["Cash in", `${WEB}/accounts/cash-in`, /^Add cash$/i],
  ["Other expenses", `${WEB}/expenses/other`, /^Add expense$/i],
  ["Money transfer", `${WEB}/transfers`, /^Move money$|^Add a transfer$|^New transfer$/i],
  ["AI tools and subscriptions", `${WEB}/subscriptions`, /^Add a subscription$/i],
];

for (const [label, url, pattern] of FORMS) {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2500);
  const opened = await page.evaluate((src) => {
    const re = new RegExp(src.slice(1, src.lastIndexOf("/")), "i");
    const btn = [...document.querySelectorAll("button")].find((b) =>
      re.test((b.textContent ?? "").trim()),
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, String(pattern));
  if (!opened) {
    check(`${label}: the drawer opens`, false, "no matching button");
    continue;
  }
  await settle(1500);

  const field = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    const label = [...dialog.querySelectorAll("label")].find((l) =>
      /^Reference/.test((l.textContent ?? "").trim()),
    );
    if (!label) return { found: false };
    return {
      found: true,
      /* Any typeable control at all — text, number, or a bare input. */
      inputs: [...label.querySelectorAll("input")].filter(
        (el) => el.type !== "file" && el.type !== "checkbox",
      ).length,
      paperclips: label.querySelectorAll('button[aria-label*="ttach" i], button[title*="ttach" i]')
        .length,
      text: (label.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90),
    };
  });

  check(`${label}: the drawer still has a Reference field`, field.found, field.text ?? "");
  if (!field.found) continue;
  check(
    `${label}: and it is attach-only — no box to type a number into`,
    field.inputs === 0,
    `${field.inputs} typeable input(s) — "${field.text}"`,
  );
  check(
    `${label}: with a paperclip, like Invoice`,
    field.paperclips >= 1,
    `${field.paperclips} attach button(s)`,
  );
}

/* ------------------ the stored number still shows, and stays ----------- */

await page.goto(`${WEB}/transactions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2600);
const table = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("REFQA entry"),
  );
  return {
    heads,
    row: (row?.textContent ?? "").replace(/\s+/g, " "),
  };
});
check(
  "the table calls our own number Entry No., not Reference",
  table.heads.includes("Entry No.") && !table.heads.includes("Reference"),
  table.heads.filter((h) => /entry|reference|invoice|transaction/i.test(h)).join(" | "),
);
check(
  "and the bank's number typed before this change still shows on the row",
  table.row.includes(BANKREF),
  table.row.slice(0, 150),
);

/* THE DANGEROUS ONE: editing the row must not silently erase it. */
const edited = await call("PATCH", `/transactions/${entry.id}`, {
  description: "REFQA entry, description changed",
});
check(
  "editing something else does NOT erase the stored reference",
  edited.status < 300 && (await storedRef()) === BANKREF,
  `HTTP ${edited.status}, stored ${JSON.stringify(await storedRef())}`,
);

/* And the same on the bank statement, which used to print ours under the
   bank's name whenever the bank had given none. */
await page.goto(`${WEB}/statement?account=${account.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2600);
const stmt = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("REFQA entry"),
  );
  return { heads, row: (row?.textContent ?? "").replace(/\s+/g, " ") };
});
check(
  "the bank statement names the column the same way",
  stmt.heads.includes("Entry No."),
  stmt.heads.join(" | ").slice(0, 140),
);
check(
  "and shows both numbers there — ours, and the bank's under it",
  /TXN-/.test(stmt.row) && stmt.row.includes(BANKREF),
  stmt.row.slice(0, 160),
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
