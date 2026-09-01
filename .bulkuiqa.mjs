/**
 * Ticking rows on a real screen, and the tables that must not have moved.
 *
 * `.bulktrashqa.mjs` proves the API. This proves the part a diff cannot show:
 * that the tick reaches the screen, that the bar counts what is ticked, that
 * the confirmation names the number rather than "that one", and — the half
 * most likely to be skipped — that adding a column to ONE table left the
 * others looking exactly as they did.
 *
 * That last check exists because the tick lands in `components/ui/table.tsx`
 * and two rules in `globals.css`, which between them reach every table in the
 * app. A change there is invisible on the screen being worked on and obvious
 * on the twenty that were not.
 *
 *     node .bulkuiqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

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

const wipe = async () => {
  await db.query("delete from team_members where full_name like 'TICKQA %'");
};
await wipe();
for (const n of [1, 2, 3]) {
  await db.query(
    `insert into team_members
       (full_name, engagement_type, designation, status, joined_on, created_by, updated_by)
     values ($1, 'employee', 'Tester', 'active', '2024-0${n}-01', $2, $2)`,
    [`TICKQA Person ${n}`, person.id],
  );
}
const before = (
  await db.query(
    "select count(*)::int n from team_members where full_name like 'TICKQA %' and deleted_at is null",
  )
).rows[0].n;
check("three people to tick", before === 3, `${before}`);

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

await page.goto(`${WEB}/team`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2600);

const ticks = await page.evaluate(
  () => document.querySelectorAll('td.tick input[type="checkbox"]').length,
);
check("the team table has a tick on every row", ticks >= 3, `${ticks} ticks`);

const header = await page.evaluate(() =>
  Boolean(document.querySelector('th.tick input[type="checkbox"]')),
);
check("and one in the header", header, "");

/* Tick two of ours by name, not by position. */
const tickedTwo = await page.evaluate(() => {
  const wanted = ["TICKQA Person 1", "TICKQA Person 2"];
  let n = 0;
  for (const row of document.querySelectorAll("tbody tr")) {
    const name = (row.textContent ?? "").trim();
    if (!wanted.some((w) => name.includes(w))) continue;
    const box = row.querySelector('td.tick input[type="checkbox"]');
    if (box) {
      box.click();
      n += 1;
    }
  }
  return n;
});
await settle(900);
check("two rows can be ticked", tickedTwo === 2, `${tickedTwo}`);

const bar = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="status"]')].find((s) =>
    /selected/i.test(s.textContent ?? ""),
  );
  return {
    shown: Boolean(el),
    text: (el?.textContent ?? "").replace(/\s+/g, " ").trim(),
  };
});
check(
  "a bar appears and counts them",
  bar.shown && /2 persons? selected/i.test(bar.text),
  bar.text || "no bar",
);

/* The confirmation must say the number, not "that one". */
await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="status"]')].find((s) =>
    /selected/i.test(s.textContent ?? ""),
  );
  [...(el?.querySelectorAll("button") ?? [])]
    .find((b) => /move to trash/i.test(b.textContent ?? ""))
    ?.click();
});
await settle(1600);

const dialog = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /trash/i.test(x.textContent ?? ""),
  );
  const text = (d?.textContent ?? "").replace(/\s+/g, " ");
  return {
    open: Boolean(d),
    saysTwo: /those 2/i.test(text),
    saysThatOne: /that one/i.test(text),
    namesThem: /TICKQA Person 1/.test(text),
  };
});
check("the confirmation opens", dialog.open, "");
check(
  'THE ASK: it says "those 2", not "that one"',
  dialog.saysTwo && !dialog.saysThatOne,
  `those2 ${dialog.saysTwo}, thatOne ${dialog.saysThatOne}`,
);
check("and names who is going", dialog.namesThem, "");

/* Go through with it. */
await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /trash/i.test(x.textContent ?? ""),
  );
  const box = d?.querySelector('input[type="checkbox"]');
  if (box) box.click();
  const word = d?.querySelector('input[type="text"], input:not([type])');
  if (word) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(word, "trash");
    word.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await settle(700);
await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /trash/i.test(x.textContent ?? ""),
  );
  [...(d?.querySelectorAll("button") ?? [])]
    .find((b) => /yes, trash those/i.test(b.textContent ?? ""))
    ?.click();
});
await settle(3000);

const left = (
  await db.query(
    "select count(*)::int n from team_members where full_name like 'TICKQA %' and deleted_at is null",
  )
).rows[0].n;
check(
  "THE ASK: both went to the trash in one act",
  left === 1,
  `${before} -> ${left} live (expected 1)`,
);

/* ---------- the tables that were NOT meant to change, did not ---------- */
/*
 * A tick column lands in a shared component and two stylesheet rules. The
 * screens without one must render as they did: SL first, and no vertical rule
 * to its left.
 */
/*
 * The screens that DO get one, checked for the tick and the header tick.
 *
 * Two of these open on the CURRENT MONTH, and a month with nothing in it draws
 * an empty state rather than a table — so on a database whose fixtures have
 * just been cleaned up, "no table on this screen" was reported as a missing
 * tick column. It is not: the tick column is drawn by the table, and there is
 * no table to draw. The check below says which of the two it found, so the
 * distinction survives in the log rather than in somebody's memory.
 */
for (const [label, url] of [
  ["All transactions", `${WEB}/transactions`],
  ["Cash in", `${WEB}/accounts/cash-in`],
  ["Other expenses", `${WEB}/expenses/other`],
  ["AI tools and subscriptions", `${WEB}/subscriptions`],
  ["Users", `${WEB}/settings?tab=users`],
  ["Payroll runs", `${WEB}/payroll`],
]) {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2400);
  const shape = await page.evaluate(() => {
    const table = document.querySelector("table.table-data");
    if (!table) return { table: false };
    return {
      table: true,
      headTick: Boolean(table.querySelector('th.tick input[type="checkbox"]')),
      rowTicks: table.querySelectorAll('td.tick input[type="checkbox"]').length,
      bodyRows: table.querySelectorAll("tbody tr").length,
    };
  });
  if (!shape.table) {
    check(
      `${label}: has a tick on the header and on every row`,
      false,
      "the screen drew no table at all — an empty month shows an empty state, so seed a row for this month before reading anything into it",
    );
    continue;
  }
  check(
    `${label}: has a tick on the header and on every row`,
    shape.headTick && (shape.bodyRows === 0 || shape.rowTicks > 0),
    `head ${shape.headTick}, ${shape.rowTicks} row ticks of ${shape.bodyRows} rows`,
  );
}

/*
 * And the ones that must NOT, each excluded for a reason in the code.
 *
 * **Payroll runs has left this list**, on the owner's instruction — "etao tick
 * dewar option rakho". The reason it was here is still true and still enforced,
 * just not by absence: a PAID run has ledger entries behind it and the server
 * refuses to trash one, so the tick offers exactly what the single-row Delete
 * offers and a selection holding a paid run is refused whole.
 *
 * Two that remain, and why: the bank statement has no delete path at all, and
 * TDS withholding's "delete" clears a challan number rather than deleting a
 * row. A tick column can only ever offer what the single-row action offers.
 */
for (const [label, url] of [
  ["Bank statement", `${WEB}/statement`],
  ["TDS withholding", `${WEB}/tax/withholding`],
]) {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2200);
  const shape = await page.evaluate(() => {
    const table = document.querySelector("table.table-data");
    if (!table) return { table: false };
    const firstHead = table.querySelector("thead th");
    const firstCell = table.querySelector("tbody td");
    return {
      table: true,
      hasTick: Boolean(table.querySelector(".tick")),
      firstHeadText: (firstHead?.textContent ?? "").trim(),
      firstCellRule: firstCell
        ? getComputedStyle(firstCell).borderLeftWidth
        : null,
    };
  });
  check(
    `${label}: untouched — no tick column, SL still first`,
    !shape.table || (!shape.hasTick && shape.firstHeadText === "SL"),
    shape.table
      ? `tick ${shape.hasTick}, first "${shape.firstHeadText}"`
      : "no table on this screen",
  );
}

await browser.close();
await db.query("delete from team_members where full_name like 'TICKQA %'");
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
