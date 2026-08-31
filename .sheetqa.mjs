/**
 * The salary sheet reads like the owner's own Excel.
 *
 * Their sheet's columns, in their order: Name, Role, Dept, Basic, House Rent,
 * Medical, Conveyance, Bonus, Other +, Working Days, Gross, TDS, Net Pay,
 * FX Rate, Net Pay (USD) — plus the app's own SL at the front and the actions
 * at the end, and Other − kept beside TDS because it still moves the net.
 *
 * Two of those columns are not decoration, and this file types into both:
 * typing a number into Working Days pro-rates the row, and typing a rate into
 * FX Rate is what puts a dollar figure on it at all. That rate used to be one
 * governing figure the page fetched and printed on every row; it is now a box
 * per line, and a line nobody has typed one on has no dollar figure.
 *
 *     node .sheetqa.mjs      (local only — writes and deletes)
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

const wipe = async () => {
  await db.query(
    `delete from payroll_lines where payroll_run_id in
       (select id from payroll_runs where period_year = 2033 and period_month = 5)`,
  );
  await db.query(
    "delete from payroll_runs where period_year = 2033 and period_month = 5",
  );
  await db.query(
    `delete from compensation_history where team_member_id in
       (select id from team_members where full_name like 'SHQA %')`,
  );
  await db.query("delete from team_members where full_name like 'SHQA %'");
};
await wipe();

const created = await call("POST", "/team-members", {
  fullName: "SHQA Sheet Person",
  engagementType: "employee",
  designation: "Product Executive",
  department: "Product Management",
  joinedOn: "2030-01-01",
  currentSalary: "31000.00",
});
const memberId = created.body?.id;
const run = await call("POST", "/payroll/runs", {
  periodYear: 2033,
  periodMonth: 5,
});
const joined = await call("POST", `/payroll/runs/${run.body?.id}/members`, {
  teamMemberIds: [memberId],
});

/*
 * Say so here, loudly, if the fixtures did not get made.
 *
 * A run this file could not create leaves it opening /payroll/undefined, where
 * there is no table at all — and every check below then fails with an empty
 * row, which reads like the salary sheet is broken when the truth is that this
 * file never got as far as the salary sheet. Seen once already: four blank
 * FAILs and nothing saying why.
 */
if (!memberId || !run.body?.id || joined.status >= 300) {
  console.log(
    `  FAIL  the fixtures could not be created — member HTTP ${created.status} ` +
      `${JSON.stringify(created.body)}, run HTTP ${run.status} ` +
      `${JSON.stringify(run.body)}, join HTTP ${joined.status} ` +
      `${JSON.stringify(joined.body)}`,
  );
  await wipe();
  await db.end();
  process.exit(1);
}

/* --------------------------------------------------------------- the head */

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1750, height: 1100 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`${WEB}/payroll/${run.body.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(3000);

const heads = await page.evaluate(() =>
  [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").replace(/\s+/g, " ").trim(),
  ),
);
const expected = [
  /^SL/i,
  /^Name$/,
  /^Role$/,
  /^Dept$/,
  /^Basic/,
  /^House Rent/,
  /^Medical/,
  /^Conveyance/,
  /^Bonus$/,
  /^Other \+$/,
  /^Working Days/,
  /^Gross$/,
  /^TDS$/,
  /^Other −$/,
  /^Net Pay$/,
  /^FX Rate$/,
  /^Net Pay \(USD\)$/,
];
const inOrder =
  heads.length === expected.length + 1 && // + the actions column
  expected.every((rx, i) => rx.test(heads[i]));
check(
  "the columns run exactly as the owner's sheet does",
  inOrder,
  inOrder ? heads.join(" | ") : `got: ${heads.join(" | ")}`,
);

const readRow = () =>
  page.evaluate(() => {
    const r = [...document.querySelectorAll("tbody tr")].find((x) =>
      (x.textContent ?? "").includes("SHQA Sheet Person"),
    );
    // An <input> holds its figure in .value, not in textContent.
    return [...(r?.querySelectorAll("td") ?? [])].map((td) => {
      const input = td.querySelector("input");
      return (input ? input.value : (td.textContent ?? ""))
        .replace(/\s+/g, " ")
        .trim();
    });
  });

let row = await readRow();
check(
  "role and dept sit in their own cells",
  row[2] === "Product Executive" && row[3] === "Product Management",
  JSON.stringify(row.slice(1, 4)),
);
check(
  "a full month reads as the month's own length — May 2033 has 31 days",
  row[10] === "31",
  `working days cell: ${JSON.stringify(row[10])}`,
);
/*
 * WAS: "the FX columns carry the governing rate and the net said in dollars",
 * asserting 122.50 printed on the row and a $ figure beside it.
 *
 * 018c36f took the app's ONE governing rate off this screen — the run page
 * stopped fetching it, `usdRate` is gone from the sheet's props, and the FX
 * Rate column became a box typed per line and frozen on it. So a line nobody
 * has stated a rate for has an EMPTY rate box and no dollar figure at all,
 * and that is the whole point of the change: N/A is the truth, where a
 * governing rate would have invented a number nobody checked.
 *
 * The old assertion is not repairable — there is no governing rate to read —
 * so it splits in two: this one, that an untouched line says nothing in
 * dollars, and the one at the bottom of the file, that typing a rate on the
 * line is what makes it say something.
 */
check(
  "a line with no rate of its own shows an empty rate box and no dollars",
  row[15] === "" && row[16] === "N/A",
  JSON.stringify(row.slice(15, 17)),
);

/* ------------------------------------------------- typing on the sheet ---- */

/**
 * Types into one cell of this person's row.
 *
 * Focus first: React's onBlur is a focusout listener, and blurring an element
 * that was never focused fires nothing.
 */
const typeCell = (col, value) =>
  page.evaluate(
    (c, v) => {
      const r = [...document.querySelectorAll("tbody tr")].find((x) =>
        (x.textContent ?? "").includes("SHQA Sheet Person"),
      );
      const box = [...r.querySelectorAll("td")][c].querySelector("input");
      const set = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      box.focus();
      set.call(box, v);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      box.blur();
    },
    col,
    value,
  );

/**
 * The line as the database has it, polled until it is what we are waiting for.
 */
const untilLine = async (ok, tries = 60) => {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = (
      await db.query(
        `select gross_amount, net_amount, working_days, fx_rate::text as fx_rate
           from payroll_lines where payroll_run_id = $1`,
        [run.body.id],
      )
    ).rows[0];
    if (ok(last)) break;
    await settle(250);
  }
  return last;
};

/*
 * Wait for the row to be ALIVE rather than for a fixed three seconds.
 *
 * A cell only saves once React has hydrated it: keystrokes into a box whose
 * onBlur has not been attached yet fire nothing, no request leaves, and the
 * check below then reads working_days null and blames the cell for a save the
 * page was never in a position to make. The fixed sleep is long enough on a
 * warm dev server and short on a cold compile, which is exactly how this file
 * failed. React hangs its props off the DOM node once it hydrates, so a box
 * carrying a __reactProps$… key has a live onBlur; if that internal ever
 * changes name we fall back to the old sleep rather than inventing a failure.
 */
const daysCell = 10;
const fxCell = 15;
await page
  .waitForFunction(
    (c) => {
      const r = [...document.querySelectorAll("tbody tr")].find((x) =>
        (x.textContent ?? "").includes("SHQA Sheet Person"),
      );
      const box = r?.querySelectorAll("td")[c]?.querySelector("input");
      return (
        !!box && Object.keys(box).some((k) => k.startsWith("__reactProps$"))
      );
    },
    { timeout: 60000, polling: 200 },
    daysCell,
  )
  .catch(() => settle(3000));

/* ------------------------- typing days on the sheet pro-rates the row ---- */

await typeCell(daysCell, "10");
let dbRow = await untilLine((r) => r?.working_days === 10);
if (dbRow?.working_days !== 10) {
  // One retry, and only one: a keystroke can still land in the sliver between
  // the row being painted and its handler being attached. A second attempt
  // that also does nothing is a real failure, not a race.
  await typeCell(daysCell, "10");
  dbRow = await untilLine((r) => r?.working_days === 10);
}
check(
  "typing 10 into the sheet's days cell pro-rates the gross (31,000 x 10/31)",
  dbRow?.working_days === 10 && dbRow?.gross_amount === "10000.00",
  JSON.stringify(dbRow),
);

/* ------------------------ typing a rate is what buys the dollar figure --- */

/*
 * The other half of the check above: the rate is a figure a person types on
 * the line now, so the way to test the FX columns is to type one. 122.50 is
 * the rate the removed governing box used to hold — same number, stated where
 * it now belongs. Stored at six places, because a rate is a divisor.
 */
await typeCell(fxCell, "122.50");
let fxLine = await untilLine((r) => r?.fx_rate === "122.500000");
if (fxLine?.fx_rate !== "122.500000") {
  await typeCell(fxCell, "122.50");
  fxLine = await untilLine((r) => r?.fx_rate === "122.500000");
}
check(
  "a rate typed on the line is stored on that line, at six places",
  fxLine?.fx_rate === "122.500000",
  JSON.stringify(fxLine?.fx_rate ?? null),
);

// The screen prints it as "≈ $123.45" — matched on the dollars rather than the
// whole string, so an approximately sign is not what decides this check.
const dollars = fxLine?.net_amount
  ? (Number(fxLine.net_amount) / 122.5).toFixed(2)
  : "?";
for (let i = 0; i < 60; i++) {
  row = await readRow();
  if ((row[16] ?? "") !== "N/A" && row[16] !== "") break;
  await settle(250);
}
check(
  "the row then reads in dollars at its own rate",
  row[15] === "122.50" && (row[16] ?? "").includes(`$${dollars}`),
  `rate ${JSON.stringify(row[15])}, dollars ${JSON.stringify(row[16])} — net ${
    fxLine?.net_amount
  } / 122.50 = ${dollars}`,
);

await page.screenshot({ path: "sheet-new.png" });
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
