/**
 * Seniority order, and an employee ID that is optional.
 *
 * Two of the owner's asks, and the trap in each:
 *
 *   - the list is ordered by JOINING DATE, so SL 1 is the first hire. The trap
 *     is `joined_on` being a DATE: two people hired the same day have no
 *     defined order, and this list is paged with OFFSET — without a unique
 *     final key one of them appears on two pages and the other on none. So the
 *     fixture deliberately hires four people on ONE day.
 *   - the employee ID is OPTIONAL. It was once required and unique, which is
 *     why it was removed; the whole difference this time is that somebody with
 *     no ID is a normal person. And a duplicate must name who holds it rather
 *     than come back as "Internal server error".
 *
 * Nothing here rewrites anybody's data: the ordering change touches no column.
 *
 *     node .teamorderqa.mjs      (local only — writes and deletes)
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
 * Five people. Zed joined first and Alice last, so alphabetical and seniority
 * order are opposites — an ordering that only looks sorted cannot pass. Three
 * of them share one joining date, which is where offset paging breaks.
 */
const PEOPLE = [
  { name: "TOQA Zed Oldest", joined: "2019-03-01", code: "TOQA-0001" },
  { name: "TOQA Yara Same Day", joined: "2021-07-15", code: null },
  { name: "TOQA Bilal Same Day", joined: "2021-07-15", code: "TOQA-0003" },
  { name: "TOQA Nadia Same Day", joined: "2021-07-15", code: null },
  { name: "TOQA Alice Newest", joined: "2025-11-20", code: "TOQA-0005" },
];

const wipe = async () => {
  await db.query(
    `delete from compensation_history where team_member_id in
       (select id from team_members where full_name like 'TOQA %')`,
  );
  await db.query("delete from team_members where full_name like 'TOQA %'");
};
await wipe();

for (const p of PEOPLE) {
  const made = await call("POST", "/team-members", {
    fullName: p.name,
    engagementType: "employee",
    designation: "Tester",
    joinedOn: p.joined,
    ...(p.code ? { employeeCode: p.code } : {}),
  });
  if (made.status !== 201) {
    console.log("seed failed", p.name, made.status, JSON.stringify(made.body?.errors ?? made.body).slice(0, 200));
    process.exit(1);
  }
}
check("people record, with and without an employee ID", true, "");

/* ------------------------- the ID is optional, and unique ---------------- */

const noCode = (
  await db.query(
    "select employee_code from team_members where full_name = 'TOQA Yara Same Day'",
  )
).rows[0];
check(
  "somebody with no employee ID is a normal person",
  noCode?.employee_code === null,
  `stored ${JSON.stringify(noCode?.employee_code)}`,
);
const withCode = (
  await db.query(
    "select employee_code from team_members where full_name = 'TOQA Zed Oldest'",
  )
).rows[0];
check(
  "and one with an ID has it stored",
  withCode?.employee_code === "TOQA-0001",
  `stored ${JSON.stringify(withCode?.employee_code)}`,
);

const clash = await call("POST", "/team-members", {
  fullName: "TOQA Clash Person",
  engagementType: "employee",
  designation: "Tester",
  joinedOn: "2026-01-01",
  employeeCode: "TOQA-0001",
});
check(
  "a duplicate ID names who already holds it, rather than a 500",
  clash.status === 400 &&
    /Zed Oldest already has that employee ID/.test(
      JSON.stringify(clash.body?.errors ?? {}),
    ),
  `HTTP ${clash.status} ${JSON.stringify(clash.body?.errors ?? clash.body?.message ?? "")}`.slice(0, 120),
);

const target = (
  await db.query(
    "select id from team_members where full_name = 'TOQA Zed Oldest'",
  )
).rows[0].id;
const cleared = await call("PATCH", `/team-members/${target}`, {
  employeeCode: "",
});
const afterClear = (
  await db.query("select employee_code from team_members where id = $1", [target])
).rows[0];
check(
  "emptying the box really clears it — an omitted key would have kept it",
  cleared.status === 200 && afterClear.employee_code === null,
  `HTTP ${cleared.status}, stored ${JSON.stringify(afterClear.employee_code)}`,
);
// Put it back for the screen check below.
await call("PATCH", `/team-members/${target}`, { employeeCode: "TOQA-0001" });

/* --------------------------- seniority, not the alphabet ---------------- */

const listed = await call("GET", "/team-members?page=1&pageSize=100");
const ours = (listed.body?.items ?? []).filter((m) =>
  m.fullName.startsWith("TOQA "),
);
const joinDates = ours.map((m) => m.joinedOn);
check(
  "the list runs oldest joiner first",
  joinDates.length === 5 &&
    joinDates.every((d, i) => i === 0 || joinDates[i - 1] <= d) &&
    ours[0].fullName === "TOQA Zed Oldest" &&
    ours[4].fullName === "TOQA Alice Newest",
  ours.map((m) => `${m.joinedOn} ${m.fullName.replace("TOQA ", "")}`).join(" | "),
);
check(
  "which is the OPPOSITE of alphabetical — so this cannot be a name sort",
  ours[0].fullName > ours[4].fullName,
  `${ours[0].fullName} before ${ours[4].fullName}`,
);

/* ------------- the tie that breaks offset paging, if it is going to ------ */

const pageOf = async (page) =>
  (await call("GET", `/team-members?page=${page}&pageSize=2`)).body?.items ?? [];
const pages = [
  await pageOf(1),
  await pageOf(2),
  await pageOf(3),
  await pageOf(4),
];
const ids = pages.flat().map((m) => m.id);
check(
  "paging two at a time repeats nobody and drops nobody",
  new Set(ids).size === ids.length,
  `${ids.length} rows, ${new Set(ids).size} distinct`,
);
const paged = pages.flat().map((m) => m.joinedOn);
check(
  "and the join dates stay monotonic across every page boundary",
  paged.every((d, i) => i === 0 || paged[i - 1] <= d),
  paged.join(" | "),
);

/* --------------- the sheet agrees with the directory about row 1 -------- */

const eligible = await call(
  "GET",
  "/payroll/eligible?periodYear=2026&periodMonth=8",
);
const pickerOurs = (eligible.body ?? eligible.body?.items ?? []).filter?.((m) =>
  (m.fullName ?? "").startsWith("TOQA "),
) ?? [];
check(
  "the payroll picker reads in the same seniority order",
  pickerOurs.length === 0 ||
    (pickerOurs[0].fullName === "TOQA Zed Oldest" &&
      pickerOurs[pickerOurs.length - 1].fullName === "TOQA Alice Newest"),
  pickerOurs.map((m) => m.fullName.replace("TOQA ", "")).join(" | ") || "nobody eligible",
);

/* -------------------------------- the screen ---------------------------- */

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
await page.setViewport({ width: 1600, height: 1200 });
await page.goto(`${WEB}/team`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 3000));

/*
 * Read the directory as a table rather than as the whole document: scope to
 * the table that actually holds the fixtures, so a second table appearing on
 * the page later cannot silently supply the header row this file measures.
 */
const screen = await page.evaluate(() => {
  const table =
    [...document.querySelectorAll("table")].find((t) =>
      (t.textContent ?? "").includes("TOQA "),
    ) ?? document.querySelector("table");
  const heads = [...(table?.querySelectorAll("thead th") ?? [])].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const rows = [...(table?.querySelectorAll("tbody tr") ?? [])]
    .map((r) => [...r.querySelectorAll("td")].map((t) => (t.textContent ?? "").trim()))
    .filter((cells) => cells.some((c) => c.includes("TOQA ")));
  return { heads, rows };
});
/*
 * Columns are located by their heading, never by a counted index.
 *
 * The old checks read heads[1] and cells[1], written when SL was the first
 * column on this table. "Tick several rows, trash them once" put a bulk-select
 * checkbox in front of SL, so every column on the screen moved one to the
 * right and both checks failed while the screen was correct. Both ends of this
 * header row are now blank cells — the tick on the left, RowActions on the
 * right — so only a named heading identifies a column safely. The body's cells
 * line up one-to-one with the header, tick cell included.
 */
const colAt = (label) => screen.heads.indexOf(label);
const slAt = colAt("SL");
const idAt = colAt("Employee ID");
const nameAt = colAt("Name");
const shownHeads = screen.heads
  .map((h, i) => h || (i === 0 ? "(tick)" : "(actions)"))
  .join(" | ");
// Was: heads[1] === "Employee ID". The rule the owner asked for has not
// changed — the company's own identifier sits immediately after the serial the
// app made up — only the number of columns in front of it has.
check(
  "the table carries an Employee ID column, immediately after SL",
  slAt !== -1 && idAt === slAt + 1,
  shownHeads,
);
// Was: cells[1] === "N/A", the same fixed-index assumption.
check(
  "a person with no ID reads N/A rather than a blank cell",
  idAt !== -1 && screen.rows.some((cells) => cells[idAt] === "N/A"),
  JSON.stringify(screen.rows.map((c) => c[idAt])),
);
check(
  "and the rows on screen run oldest first",
  screen.rows.length === 5 &&
    screen.rows[0].some((c) => c.includes("Zed Oldest")) &&
    screen.rows[4].some((c) => c.includes("Alice Newest")),
  // Detail prints the Name column; it used to print c[2], which the extra
  // column turned into the employee ID and made unreadable as an ordering.
  screen.rows.map((c) => (nameAt === -1 ? c.join("/") : c[nameAt])).join(" | "),
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
