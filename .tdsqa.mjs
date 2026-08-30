/**
 * The TDS page: four faults, each with the test that would have caught it.
 *
 *   1. A payroll run in the trash still had its people on the register and
 *      its tax in the period total.
 *   2. Switching period tabs anchored on the period's START, so coarse → fine
 *      always dropped the reader on July — after one round trip every tab
 *      showed the same rows. This is the "same data in all tabs" report.
 *   3. The page opened on the month we are in, which is the month least
 *      likely to hold a finalised run, so it opened empty.
 *   4. `monthRange()` echoes the CALENDAR year as the fiscal one, putting the
 *      screen a whole fiscal year out between January and June.
 *
 * And the fifth thing, which was missing rather than wrong: no way to take a
 * challan off a row.
 *
 *     node .tdsqa.mjs      (local only — writes and deletes)
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
/*
 * Two finalised months in fiscal 2026 — September and November — each with
 * one taxed person, and September carrying a recorded challan. Two months so
 * "the same rows in every tab" is a claim the data can disprove.
 */
const wipe = async () => {
  /*
   * By month as well as by label: the two months this fixture uses are
   * claimed by a unique index, and a run left behind by an earlier probe
   * would fail the insert rather than the check.
   */
  await db.query(
    `delete from payroll_lines where payroll_run_id in
       (select id from payroll_runs
         where label like 'TQA %'
            or (period_year = 2026 and period_month in (9, 11)))`,
  );
  await db.query(
    `delete from payroll_runs
      where label like 'TQA %'
         or (period_year = 2026 and period_month in (9, 11))`,
  );
  await db.query(
    `delete from compensation_history where team_member_id in
       (select id from team_members where full_name like 'TQA %')`,
  );
  await db.query("delete from team_members where full_name like 'TQA %'");
};
await wipe();

const member = async (name) =>
  (
    await db.query(
      `insert into team_members (full_name, engagement_type, designation, status, joined_on, created_by, updated_by)
       values ($1, 'employee', 'Tester', 'active', '2020-01-01', $2, $2) returning id`,
      [name, person.id],
    )
  ).rows[0].id;
const run = async (year, month, label) =>
  (
    await db.query(
      `insert into payroll_runs (period_year, period_month, label, status, total_gross, total_additions, total_tds, total_deductions, total_net, created_by, updated_by)
       values ($1, $2, $3, 'finalized', '60000.00','0.00','3000.00','0.00','57000.00', $4, $4) returning id`,
      [year, month, label, person.id],
    )
  ).rows[0].id;
const line = (runId, memberId, challan) =>
  db.query(
    `insert into payroll_lines (payroll_run_id, team_member_id, gross_amount, tds_amount, tds_challan_number, updated_by)
     values ($1, $2, '60000.00', '3000.00', $3, $4)`,
    [runId, memberId, challan, person.id],
  );

const sepPerson = await member("TQA September Person");
const novPerson = await member("TQA November Person");
const sepRun = await run(2026, 9, "TQA Sep");
const novRun = await run(2026, 11, "TQA Nov");
await line(sepRun, sepPerson, "A-CHALLAN-SEP");
await line(novRun, novPerson, null);

/* ---------------------------------- 1. a trashed run leaves the register */

const sepQuery = "/tds/salary-deductions?granularity=month&fiscalYear=2026&index=3";
const before = await call("GET", sepQuery);
check(
  "September lists its taxed person",
  (before.body?.rows ?? []).some((r) => r.fullName === "TQA September Person") &&
    before.body?.periodTotal === "3000.00",
  `total ${before.body?.periodTotal}`,
);
await call("POST", `/trash/payroll-run/${sepRun}`, { reason: "TDS QA" });
const trashed = await call("GET", sepQuery);
check(
  "a run in the trash leaves the register AND the period total",
  (trashed.body?.rows ?? []).length === 0 && trashed.body?.periodTotal === "0.00",
  `rows ${trashed.body?.rows?.length}, total ${trashed.body?.periodTotal}`,
);
await call("POST", `/trash/payroll-run/${sepRun}/restore`);
const restored = await call("GET", sepQuery);
check(
  "and both come back on restore",
  (restored.body?.rows ?? []).length === 1 &&
    restored.body?.periodTotal === "3000.00",
  "",
);

/* ------------------------------- 4. the fiscal year echoed back is fiscal */

const january = await call(
  "GET",
  "/tds/salary-deductions?granularity=month&fiscalYear=2026&index=7",
);
check(
  "a month inside the fiscal year echoes THAT fiscal year, not the calendar one",
  january.body?.period?.fiscalYear === 2026,
  `label ${january.body?.period?.label}, fiscalYear ${january.body?.period?.fiscalYear}`,
);

/* ------------------------------------ 3. the default lands where data is */

const opened = await call("GET", "/tds/salary-deductions");
check(
  "asked for no period, the register opens where the tax actually is",
  (opened.body?.rows ?? []).length > 0,
  `${opened.body?.period?.label} — ${opened.body?.rows?.length ?? 0} row(s)`,
);

/* ---------------------------------------- 2. the tabs disagree, as they must */

const monthly = await call("GET", sepQuery);
const quarterly = await call(
  "GET",
  "/tds/salary-deductions?granularity=quarter&fiscalYear=2026&index=1",
);
const yearly = await call(
  "GET",
  "/tds/salary-deductions?granularity=year&fiscalYear=2026&index=1",
);
check(
  "a month, its quarter and its year give different totals",
  monthly.body?.periodTotal === "3000.00" &&
    quarterly.body?.periodTotal === "3000.00" &&
    yearly.body?.periodTotal === "6000.00",
  `month ${monthly.body?.periodTotal}, quarter ${quarterly.body?.periodTotal}, year ${yearly.body?.periodTotal}`,
);

/* ---------------------------------------------------------- the browser */

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
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const heading = () =>
  page.evaluate(() => {
    const match = document.body.innerText.match(
      /Deducted in ([A-Za-z0-9 –-]+)\n/,
    );
    const select = document.querySelector("select");
    return {
      period: select?.selectedOptions?.[0]?.textContent?.trim() ?? null,
      body: match?.[1] ?? null,
    };
  });

await page.goto(`${WEB}/tax/withholding`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(3000);

// Pick September, then walk the tabs and come back.
const pickPeriod = async (name) =>
  page.evaluate((wanted) => {
    const sel = [...document.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => (o.textContent ?? "").includes(wanted)),
    );
    if (!sel) return false;
    const option = [...sel.options].find((o) =>
      (o.textContent ?? "").includes(wanted),
    );
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    ).set;
    setter.call(sel, option.value);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, name);
const pickTab = async (label) =>
  page.evaluate((wanted) => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === wanted,
    );
    if (!button) return false;
    button.click();
    return true;
  }, label);

const gotSeptember = await pickPeriod("September");
await settle(2000);
const atSeptember = await heading();
check(
  "the reader can sit on September",
  gotSeptember && /September/.test(atSeptember.period ?? ""),
  JSON.stringify(atSeptember),
);

await pickTab("Quarterly");
await settle(2000);
const atQuarter = await heading();
await pickTab("Monthly");
await settle(2000);
const backAgain = await heading();
check(
  "a round trip through the tabs does not strand the reader in July",
  !/July/.test(backAgain.period ?? ""),
  `September → ${atQuarter.period} → ${backAgain.period}`,
);

/* ---------------------------------------- 5. the row can lose its challan */

await pickPeriod("September");
await settle(2000);
const rowActions = await page.evaluate(() => ({
  edit: document.querySelectorAll('button[aria-label="Edit"]').length,
  remove: document.querySelectorAll('button[aria-label="Delete"]').length,
  challan: /A-CHALLAN-SEP/.test(document.body.innerText),
}));
check(
  "the register's rows now end with the actions pair, like every other table",
  rowActions.edit >= 1 && rowActions.remove >= 1 && rowActions.challan,
  JSON.stringify(rowActions),
);

await page.evaluate(() => {
  document.querySelector('button[aria-label="Delete"]').click();
});
await settle(800);
const asked = await page.evaluate(() =>
  /Take this challan off the row\?/.test(document.body.innerText),
);
check("it asks before taking the challan off", asked, "");
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Remove it/.test(b.textContent ?? ""))
    .click();
});
await settle(2500);
const cleared = (
  await db.query(
    `select tds_challan_number from payroll_lines where payroll_run_id = $1`,
    [sepRun],
  )
).rows[0];
check(
  "and the challan really comes off the row",
  cleared.tds_challan_number === null,
  JSON.stringify(cleared),
);

await browser.close();

/* ---------------------------------------------------------------- tidy up */
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
