/**
 * Transaction ID, or only the paper — the choice, and what the table draws.
 *
 * The owner's rule: a bank does not always give a number. The drawer offers
 * both, and the table shows the number when there is one, an eye when there
 * is only paperwork, and a dash when there is neither.
 *
 *     node .refkindqa.mjs      (local only — writes and deletes)
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

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */
/*
 * Three rows, one per state the cell has to draw: a number with paper, no
 * number but paper (the eye), and neither (the dash).
 */
await db.query("delete from files where original_name like 'refkind-%'");
await db.query("delete from transactions where description like 'RK %'");
const account = (
  await db.query("select id from accounts where deleted_at is null limit 1")
).rows[0];
const cat = (
  await db.query("select id from categories where kind='out' and deleted_at is null limit 1")
).rows[0];

const mk = async (desc, reference) =>
  (
    await db.query(
      `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, category_id, description, reference, created_by, updated_by)
       values ('TXN-RK-' || floor(random()*100000)::int, $1, 'out', '2026-08-19', '150.00', 'BDT', $2, $3, $4, $5, $5)
       returning id`,
      [account.id, cat.id, desc, reference, person.id],
    )
  ).rows[0].id;
const attach = (txnId, name) =>
  db.query(
    `insert into files (storage_key, original_name, mime_type, size_bytes, checksum, kind, transaction_id)
     values ('rk/' || $1::text, $2, 'application/pdf', 100, 'rk', 'bank_statement', $1::uuid)`,
    [txnId, name],
  );

const withNumber = await mk("RK numbered with paper", "FT-RK-001");
await attach(withNumber, "refkind-a.pdf");
const paperOnly = await mk("RK paper only", null);
await attach(paperOnly, "refkind-b.pdf");
const neither = await mk("RK nothing at all", null);

/* --------------------------------------------------- the API reads them back */

const call = async (path) => {
  const res = await fetch(API + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const listed = await call("/transactions?page=1&pageSize=50");
const byDesc = Object.fromEntries(
  (listed.body?.items ?? []).map((r) => [r.description, r]),
);
check(
  "a row with only paperwork carries a null reference and a count",
  byDesc["RK paper only"]?.reference === null &&
    byDesc["RK paper only"]?.documentCount === 1,
  JSON.stringify({
    reference: byDesc["RK paper only"]?.reference,
    documentCount: byDesc["RK paper only"]?.documentCount,
  }),
);
check(
  "and a bare row carries neither",
  byDesc["RK nothing at all"]?.reference === null &&
    byDesc["RK nothing at all"]?.documentCount === 0,
  "",
);

/* -------------------------------------------------------------- the browser */

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
await page.setViewport({ width: 1500, height: 1100 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/** What the reference column drew for a row, by its description. */
const cellFor = (needle) =>
  page.evaluate((text) => {
    const row = [...document.querySelectorAll("tbody tr")].find((r) =>
      (r.textContent ?? "").includes(text),
    );
    if (!row) return null;
    const cells = [...row.querySelectorAll("td")];
    // The reference cell is the one holding an eye, a number-styled button,
    // or the dash — found by looking for our own marks.
    const eye = row.querySelector('button[aria-label="Show the attached record"]');
    const numbered = cells
      .flatMap((c) => [...c.querySelectorAll("button")])
      .find((b) => /FT-RK-001/.test(b.textContent ?? ""));
    return {
      hasEye: Boolean(eye),
      hasNumber: Boolean(numbered),
      text: row.textContent?.includes("FT-RK-001") ?? false,
    };
  }, needle);

await page.goto(`${WEB}/expenses/other`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(3000);

const numbered = await cellFor("RK numbered with paper");
check(
  "a numbered row still shows its clickable number",
  numbered?.hasNumber === true && numbered?.hasEye === false,
  JSON.stringify(numbered),
);
const paper = await cellFor("RK paper only");
check(
  "a paper-only row shows the eye instead of a dash",
  paper?.hasEye === true,
  JSON.stringify(paper),
);
const bare = await cellFor("RK nothing at all");
check(
  "a row with neither shows no eye",
  bare !== null && bare.hasEye === false && bare.hasNumber === false,
  JSON.stringify(bare),
);

// The eye opens the same drawer the number would.
await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("RK paper only"),
  );
  row.querySelector('button[aria-label="Show the attached record"]').click();
});
await settle(1800);
const opened = await page.evaluate(() => ({
  hasFile: /refkind-b\.pdf/.test(document.body.innerText),
}));
check("the eye opens the paperwork drawer", opened.hasFile, "");
await page.keyboard.press("Escape");
await settle(500);

/* ---------------------------------------------- the toggle in all four drawers */

const drawerHas = async (url, openLabel) => {
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2500);
  const clicked = await page.evaluate((label) => {
    const button = [...document.querySelectorAll("button")].find((b) =>
      new RegExp(label).test(b.textContent ?? ""),
    );
    if (!button) return false;
    button.click();
    return true;
  }, openLabel);
  await settle(1400);
  const state = await page.evaluate(() => {
    const idBtn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Transaction ID",
    );
    const paperBtn = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Reference only",
    );
    return {
      hasToggle: Boolean(idBtn && paperBtn),
      inputBefore: Boolean(document.querySelector('input[name="reference"]')),
    };
  });
  if (!state.hasToggle) return { clicked, ...state, inputAfter: null };
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").trim() === "Reference only")
      .click();
  });
  await settle(500);
  const inputAfter = await page.evaluate(() =>
    Boolean(document.querySelector('input[name="reference"]')),
  );
  await page.keyboard.press("Escape");
  await settle(400);
  return { clicked, ...state, inputAfter };
};

for (const [url, label, name] of [
  ["/expenses/other", "Add expense", "the expense drawer"],
  ["/accounts/cash-in", "Add cash", "the cash-in drawer"],
  ["/transfers", "New transfer", "the transfer drawer"],
]) {
  const seen = await drawerHas(url, label);
  check(
    `${name} offers the choice, and picking paper takes the box away`,
    seen.hasToggle && seen.inputBefore === true && seen.inputAfter === false,
    JSON.stringify(seen),
  );
}

// Subscriptions holds its reference in state rather than a named input, so it
// is checked by its label instead.
await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Add|New plan|Record/.test(b.textContent ?? ""))
    ?.click();
});
await settle(1500);
const subs = await page.evaluate(() => {
  const paperBtn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Reference only",
  );
  if (!paperBtn) return { hasToggle: false };
  const labelled = [...document.querySelectorAll("label")].find((l) =>
    (l.textContent ?? "").startsWith("Transaction ID"),
  );
  const before = Boolean(labelled?.querySelector("input"));
  paperBtn.click();
  return { hasToggle: true, before };
});
await settle(500);
const subsAfter = await page.evaluate(() => {
  const labelled = [...document.querySelectorAll("label")].find((l) =>
    (l.textContent ?? "").startsWith("Reference"),
  );
  return Boolean(labelled?.querySelector('input[type="text"], input:not([type])'));
});
check(
  "the subscription drawer offers the choice too",
  subs.hasToggle && subs.before === true && subsAfter === false,
  JSON.stringify({ ...subs, after: subsAfter }),
);

await browser.close();

/* ---------------------------------------------------------------- tidy up */
await db.query("delete from files where original_name like 'refkind-%'");
await db.query("delete from transactions where description like 'RK %'");
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
