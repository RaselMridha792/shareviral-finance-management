/**
 * The salary sheet reads like the owner's own Excel.
 *
 * Their sheet's columns, in their order: Name, Role, Dept, Basic, House Rent,
 * Medical, Conveyance, Bonus, Other +, Working Days, Gross, TDS, Net Pay,
 * FX Rate, Net Pay (USD) — plus the app's own SL at the front and the actions
 * at the end, and Other − kept beside TDS because it still moves the net.
 *
 * And the days column is not decoration: typing a number into it on the sheet
 * pro-rates the row exactly as the drawer does.
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
await call("POST", `/payroll/runs/${run.body.id}/members`, {
  teamMemberIds: [memberId],
});

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

const row = await page.evaluate(() => {
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
check(
  "the FX columns carry the governing rate and the net said in dollars",
  /122\.50/.test(row[15] ?? "") && /\$/.test(row[16] ?? ""),
  JSON.stringify(row.slice(15, 17)),
);

/* ------------------------- typing days on the sheet pro-rates the row ---- */

await page.evaluate(() => {
  const r = [...document.querySelectorAll("tbody tr")].find((x) =>
    (x.textContent ?? "").includes("SHQA Sheet Person"),
  );
  const cells = [...r.querySelectorAll("td")];
  const daysInput = cells[10].querySelector("input");
  const set = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  // Focus first: React's onBlur is a focusout listener, and blurring an
  // element that was never focused fires nothing.
  daysInput.focus();
  set.call(daysInput, "10");
  daysInput.dispatchEvent(new Event("input", { bubbles: true }));
  daysInput.blur();
});
let dbRow = null;
for (let i = 0; i < 40; i++) {
  dbRow = (
    await db.query(
      `select gross_amount, working_days from payroll_lines
        where payroll_run_id = $1`,
      [run.body.id],
    )
  ).rows[0];
  if (dbRow?.working_days === 10) break;
  await settle(250);
}
check(
  "typing 10 into the sheet's days cell pro-rates the gross (31,000 x 10/31)",
  dbRow?.working_days === 10 && dbRow?.gross_amount === "10000.00",
  JSON.stringify(dbRow),
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
