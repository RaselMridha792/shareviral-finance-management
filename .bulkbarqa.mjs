/**
 * The selection bar belongs above the table, not inside it.
 *
 * The owner, with two screenshots side by side:
 *
 *   *"ekhane dekho multiple select korar por eta table er vitore dhuke jacche
 *    and broken hoye jacche. team page er ta thik ache eirokom howa ucit. issue
 *    ta sudhu payroll page er moddhe ache."*
 *
 * He is exactly right about where it is and where it should be. Payroll's
 * `<BulkBar>` sat between `<table>` and `<thead>`, and nothing but a caption, a
 * colgroup, a row group or a script may live there — so the browser hoisted the
 * div out during parsing and painted it over the header. Team's has always been
 * outside its table and has always looked right.
 *
 * A layout fault is not visible in a diff, so this MEASURES it in a real
 * browser: the bar's box against the table's box, on both pages, with rows
 * actually selected.
 *
 *     node .bulkbarqa.mjs      (local only — needs the web dev server)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.SFM_WEB ?? "http://localhost:3001";
const env = Object.fromEntries(
  fs
    .readFileSync("apps/api/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
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
await db.end();

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

/* The same two paths every other harness here uses. */
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome) ? chrome : edge,
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
await page.setViewport({ width: 1440, height: 900 });

/**
 * Ticks the header checkbox, then measures the bar against the table.
 *
 * The header tick is the one control both pages share, and selecting
 * everything is the state the owner's screenshot is in.
 */
async function measure(path_, label) {
  await page.goto(`${WEB}${path_}`, { waitUntil: "networkidle0", timeout: 60000 });
  try {
    await page.waitForSelector("table.table-data", { timeout: 30000 });
  } catch {
    const where = page.url();
    const seen = await page.evaluate(() =>
      (document.body.innerText ?? "").replace(/\s+/g, " ").slice(0, 200),
    );
    return { label, reason: `no table at ${where} — page says: ${seen}` };
  }

  const ticked = await page.evaluate(() => {
    const box = document.querySelector(
      'table.table-data thead input[type="checkbox"]',
    );
    if (!box) return false;
    box.click();
    return true;
  });
  if (!ticked) return { label, reason: "no header tick on this page" };
  await new Promise((r) => setTimeout(r, 600));

  return page.evaluate(() => {
    const table = document.querySelector("table.table-data");
    /* BulkBar draws itself as role="status" - one selector, no guessing. */
    const bar = [...document.querySelectorAll('[role="status"]')].find((el) =>
      /selected/.test(el.textContent ?? ""),
    );
    if (!table || !bar) return { missing: !table ? "table" : "bar" };

    const t = table.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const head = table.querySelector("thead")?.getBoundingClientRect();
    return {
      /* Is the bar an ancestor-chain member of the table? */
      insideTable: table.contains(bar),
      /* Does it sit above the table's own box, or on top of it? */
      bottom: Math.round(b.bottom),
      tableTop: Math.round(t.top),
      barWidth: Math.round(b.width),
      tableWidth: Math.round(t.width),
      /*
       * Overlap with the TABLE, not merely with its header.
       *
       * The first version of this asked about `<thead>` alone and passed
       * against the broken build — the hoisted box happened to land over the
       * first data rows rather than the header, so the one check named after
       * the symptom was the one check that missed it. A bar painted anywhere
       * on top of the table is the fault.
       */
      overlapsTable: b.bottom > t.top + 1 && b.top < t.bottom - 1,
      overlapsHeader: head
        ? b.bottom > head.top + 1 && b.top < head.bottom - 1
        : false,
      text: (bar.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
    };
  });
}

/* ------------------------------ the two pages -------------------------- */

const team = await measure("/team", "Team");
const payroll = await measure("/payroll", "Payroll");

for (const [label, m] of [
  ["Team", team],
  ["Payroll", payroll],
]) {
  if (m?.reason || m?.missing) {
    check(`${label}: a bar to measure`, false, m.reason ?? `no ${m.missing}`);
    continue;
  }
  check(
    `${label}: the bar is NOT inside the table element`,
    m.insideTable === false,
    m.insideTable ? "it is a descendant of <table>" : "outside, as it should be",
  );
  check(
    `${label}: it sits above the table, not over it`,
    m.bottom <= m.tableTop + 1,
    `bar ends at ${m.bottom}, table starts at ${m.tableTop}`,
  );
  check(
    `${label}: it is painted nowhere over the table`,
    m.overlapsTable === false,
    m.overlapsTable
      ? `over the table${m.overlapsHeader ? ", header included" : ""}`
      : "clear of it",
  );
  check(
    `${label}: it spans the width rather than floating`,
    m.barWidth >= m.tableWidth * 0.6,
    `${m.barWidth}px against a ${m.tableWidth}px table`,
  );
  console.log(`         ${label} bar reads: "${m.text}"`);
}

/* The two pages should now agree about where the bar goes. */
if (!team?.reason && !payroll?.reason && !team?.missing && !payroll?.missing) {
  check(
    "Payroll now behaves the same way Team does",
    team.insideTable === payroll.insideTable &&
      team.overlapsTable === payroll.overlapsTable,
    `inside: ${team.insideTable}/${payroll.insideTable}, overlap: ${team.overlapsTable}/${payroll.overlapsTable}`,
  );
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(72));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
      failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
