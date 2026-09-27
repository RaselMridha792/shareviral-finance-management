/**
 * Employee ID order, and an employee ID that is optional.
 *
 * Two of the owner's asks, and the trap in each:
 *
 *   - the list is ordered by EMPLOYEE ID, somebody with no ID at the bottom
 *     (Postgres puts NULLs last on ASC), and joining date, name and id behind
 *     it as tiebreaks. The trap is the tie: `joined_on` is a DATE and two
 *     uncoded people hired the same day have no order of their own, and this
 *     list is paged with OFFSET — without a unique final key one of them
 *     appears on two pages and the other on none. So the fixture deliberately
 *     hires three people on ONE day, two of them with no ID.
 *   - the employee ID is OPTIONAL. It was once required and unique, which is
 *     why it was removed; the whole difference this time is that somebody with
 *     no ID is a normal person. And a duplicate must name who holds it rather
 *     than come back as "Internal server error".
 *
 * Nothing here rewrites anybody's data: the ordering change touches no column.
 *
 *     node .teamorderqa.mjs      (local only — writes and deletes)
 *
 * Brought up to date 27 Sep 2026: the Team list is in employee ID order now,
 * not oldest joiner first (SESSIONS "39b — the Team list is ordered by employee
 * ID"; team-members.service.ts list() orders by employeeCode, joinedOn,
 * fullName, id). The payroll picker deliberately stays on seniority, so that
 * check is unchanged. Paging is still checked for no row on two pages.
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
 * of them share one joining date, which is where offset paging breaks. By
 * employee ID the list reads Zed, Bilal, Alice and then the two with no ID,
 * Nadia and Yara — so Alice (hired 2025) sits above two people hired in 2021,
 * which seniority would never do.
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

/* -------------------- employee ID, not seniority or the alphabet -------- */

/*
 * The list's own leading keys, as the service orders them: the code with the
 * uncoded last, then the joining date. Name and id come after, but a JS string
 * compare is not Postgres's collation, so those two are pinned by the fixture's
 * exact sequence below rather than compared here.
 */
const inOrder = (a, b) => {
  const ca = a.employeeCode ?? null;
  const cb = b.employeeCode ?? null;
  if (ca !== cb) {
    if (ca === null) return false; // an uncoded person never precedes a coded one
    if (cb === null) return true;
    return ca < cb;
  }
  return a.joinedOn <= b.joinedOn;
};
const EXPECTED = [
  "TOQA Zed Oldest",
  "TOQA Bilal Same Day",
  "TOQA Alice Newest",
  "TOQA Nadia Same Day",
  "TOQA Yara Same Day",
];

const listed = await call("GET", "/team-members?page=1&pageSize=100");
const ours = (listed.body?.items ?? []).filter((m) =>
  m.fullName.startsWith("TOQA "),
);
// Was: "the list runs oldest joiner first" — changed by the owner, SESSIONS 39b.
check(
  "the list runs in employee ID order, the people with no ID last",
  ours.length === 5 &&
    ours.every((m, i) => i === 0 || inOrder(ours[i - 1], m)) &&
    ours.map((m) => m.fullName).join("|") === EXPECTED.join("|"),
  ours
    .map((m) => `${m.employeeCode ?? "—"} ${m.joinedOn} ${m.fullName.replace("TOQA ", "")}`)
    .join(" | "),
);
check(
  "which is the OPPOSITE of alphabetical — so this cannot be a name sort",
  ours.length === 5 && ours[0].fullName > ours[2].fullName,
  `${ours[0]?.fullName} before ${ours[2]?.fullName}`,
);
check(
  "nor the old seniority sort — Alice, hired 2025, reads above the 2021 people with no ID",
  ours.length === 5 &&
    ours[2].fullName === "TOQA Alice Newest" &&
    ours[2].joinedOn > ours[3].joinedOn,
  `${ours[2]?.joinedOn} ${ours[2]?.fullName} before ${ours[3]?.joinedOn} ${ours[3]?.fullName}`,
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
// Was: join dates monotonic — the old leading key. The leading keys now are
// the employee ID (uncoded last) and then the joining date (SESSIONS 39b).
const paged = pages.flat();
check(
  "and the employee IDs stay in order across every page boundary",
  paged.every((m, i) => i === 0 || inOrder(paged[i - 1], m)),
  paged.map((m) => `${m.employeeCode ?? "—"} ${m.joinedOn}`).join(" | "),
);
/*
 * The whole directory's first eight rows need not include the fixture at all
 * now that other people's IDs sort ahead of it, so the tie is also paged where
 * it lives: the five TOQA people, two to a page. Nadia and Yara have no ID and
 * one joining date, so only the name and id tiebreaks keep them apart.
 */
const ourPage = async (n) =>
  (await call("GET", `/team-members?q=TOQA&page=${n}&pageSize=2`)).body?.items ?? [];
const ourPages = [await ourPage(1), await ourPage(2), await ourPage(3)];
const ourIds = ourPages.flat().map((m) => m.id);
check(
  "the fixture paged two at a time: all five, nobody twice, in the list's order",
  ourIds.length === 5 &&
    new Set(ourIds).size === 5 &&
    ourPages.flat().map((m) => m.fullName).join("|") === EXPECTED.join("|"),
  ourPages
    .map((p) => p.map((m) => m.fullName.replace("TOQA ", "")).join(", "))
    .join(" / "),
);

/* ------------- the sheet keeps seniority, whatever the directory does ----- */

const eligible = await call(
  "GET",
  "/payroll/eligible?periodYear=2026&periodMonth=8",
);
const pickerOurs = (eligible.body ?? eligible.body?.items ?? []).filter?.((m) =>
  (m.fullName ?? "").startsWith("TOQA "),
) ?? [];
// Unchanged on purpose: payroll stays on seniority while the directory moved
// to employee ID (SESSIONS 39b; team-members.service.ts list() comment).
check(
  "the payroll picker reads in seniority order",
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
// Was: "run oldest first" (Zed first, Alice last) — employee ID order since
// SESSIONS 39b, so Alice is third and the two with no ID close the list.
check(
  "and the rows on screen run in employee ID order, the people with no ID last",
  screen.rows.length === 5 &&
    EXPECTED.every((name, i) =>
      screen.rows[i].some((c) => c.includes(name.replace("TOQA ", ""))),
    ),
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
