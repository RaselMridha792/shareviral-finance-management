/**
 * The three states a reference cell can be in — and the toggle that is gone.
 *
 * This file used to drive a "Transaction ID / Reference only" toggle in four
 * drawers. #34 removed it: on the owner's word a reference is now something you
 * ATTACH, never something you type, so there is nothing left to choose between
 * and no box for the choice to hide. Testing for the toggle would be testing a
 * rule that has been replaced.
 *
 * What survives is the half that still matters, because the DATA still has all
 * three shapes and always will — rows recorded before the change carry a typed
 * number, rows recorded after carry only paper, and some rows carry neither:
 *
 *   a number and paper   the number shows, clickable
 *   paper only           an eye, which opens the same drawer
 *   neither              no eye, no number
 *
 * And one guard added in place of what was removed: the toggle must stay gone.
 * A control that came back would put a typed box beside an attach-only one
 * again, which is exactly what the owner asked to be rid of.
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

/*
 * Dated TODAY, not a date written down when this file was created.
 *
 * The fixtures used to say '2026-08-19'. Other expenses opens on the current
 * month, so on the first of September every one of them fell off the screen and
 * three checks reported the reference column as drawing nothing — a harness
 * rotting with the calendar and blaming the product for it.
 */
const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;

const mk = async (desc, reference) =>
  (
    await db.query(
      `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, category_id, description, reference, created_by, updated_by)
       values ('TXN-RK-' || floor(random()*100000)::int, $1, 'out', $6::date, '150.00', 'BDT', $2, $3, $4, $5, $5)
       returning id`,
      [account.id, cat.id, desc, reference, person.id, TODAY],
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

/* ------------------------------- the toggle, which must stay gone --------- */

/*
 * Four drawers, one question: is there anything to type a reference into?
 *
 * The toggle went with the box. This checks the absence rather than deleting
 * the section, because "the control is gone" is a fact worth keeping true — the
 * next person to touch these forms should find out here, not from the owner.
 */
const drawerRef = async (url, openLabel) => {
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
  await settle(1500);
  const state = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    if (!dialog) return { field: false };
    const toggle = [...dialog.querySelectorAll("button")].some((b) =>
      /^(Transaction ID|Reference only)$/.test((b.textContent ?? "").trim()),
    );
    const field = [...dialog.querySelectorAll("label")].find((l) =>
      /^Reference/.test((l.textContent ?? "").trim()),
    );
    return {
      field: Boolean(field),
      toggle,
      typeable: field
        ? [...field.querySelectorAll("input")].filter(
            (el) => el.type !== "file" && el.type !== "checkbox",
          ).length
        : null,
      clips: field
        ? field.querySelectorAll(
            'button[aria-label*="ttach" i], button[title*="ttach" i]',
          ).length
        : null,
    };
  });
  await page.keyboard.press("Escape");
  await settle(400);
  return { clicked, ...state };
};

for (const [url, label, name] of [
  ["/expenses/other", "Add expense", "the expense drawer"],
  ["/accounts/cash-in", "Add cash", "the cash-in drawer"],
  ["/transfers", "New transfer|Move money|Add a transfer", "the transfer drawer"],
  ["/subscriptions", "Add a subscription", "the subscription drawer"],
]) {
  const seen = await drawerRef(url, label);
  check(
    `${name}: Reference is attach-only, and the old toggle is gone`,
    seen.clicked === true &&
      seen.field === true &&
      seen.toggle === false &&
      seen.typeable === 0 &&
      seen.clips >= 1,
    JSON.stringify(seen),
  );
}

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
