/**
 * Choosing who is on a payroll month, driven end to end.
 *
 * The owner's rule under test: pick people while starting the month, keep
 * picking while it is a draft, and nobody's typed edits are lost when the
 * list changes around them. Plus the fences: no picking on a finalised run,
 * no ineligible names, no zero-pay people slipping on as a wage of nothing.
 *
 *     node .payrollpickqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
const YEAR = 2034;
const MONTH = 3;

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
const msgOf = (r) =>
  String(r.body?.message ?? "") +
  " " +
  Object.values(r.body?.errors ?? {}).flat().join(" ");

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const wipe = async () => {
  await db.query(
    `delete from payroll_lines where payroll_run_id in
       (select id from payroll_runs where period_year = $1)`,
    [YEAR],
  );
  await db.query(`delete from payroll_runs where period_year = $1`, [YEAR]);
  await db.query(
    `delete from compensation_history where team_member_id in
       (select id from team_members where full_name like 'PQA %')`,
  );
  await db.query(`delete from team_members where full_name like 'PQA %'`);
};
await wipe();

const mkMember = async (name, engagement, joined, ended = null) =>
  (
    await db.query(
      `insert into team_members (full_name, engagement_type, designation, status, joined_on, ended_on, created_by, updated_by)
       values ($1, $2, 'Tester', 'active', $3, $4, $5, $5) returning id`,
      [name, engagement, joined, ended, person.id],
    )
  ).rows[0].id;
const setPay = (memberId, gross) =>
  db.query(
    `insert into compensation_history (team_member_id, gross_amount, currency, effective_from, created_by)
     values ($1, $2, 'BDT', '2030-01-01', $3)`,
    [memberId, gross, person.id],
  );

// One person employed *now*, so the start-a-month drawer (which asks about
// the current month) has somebody to list.
const emran = await mkMember("PQA Emran (today)", "employee", "2026-01-01");
await db.query(
  `insert into compensation_history (team_member_id, gross_amount, currency, effective_from, created_by)
   values ($1, '20000.00', 'BDT', '2026-01-01', $2)`,
  [emran, person.id],
);

const alice = await mkMember("PQA Alice", "employee", "2030-01-01");
const bashir = await mkMember("PQA Bashir", "employee", "2030-01-01");
const chinta = await mkMember("PQA Chinta", "employee", "2030-01-01");
const dulal = await mkMember("PQA Dulal (no pay)", "employee", "2030-01-01");
const contractor = await mkMember("PQA Contractor", "contractor", "2030-01-01");
await mkMember("PQA Ended", "employee", "2030-01-01", "2031-12-31");
await setPay(alice, "50000.00");
await setPay(bashir, "40000.00");
await setPay(chinta, "30000.00");

/* -------------------------------------------------------- the eligible list */

const eligible = await call(
  "GET",
  `/payroll/eligible?periodYear=${YEAR}&periodMonth=${MONTH}`,
);
const names = (eligible.body ?? []).map((e) => e.fullName).filter((n) => n.startsWith("PQA"));
check(
  "eligible lists the month's employees, and only them",
  eligible.status === 200 &&
    names.length === 5 &&
    !names.includes("PQA Contractor") &&
    !names.includes("PQA Ended"),
  names.join(", "),
);
const dulalRow = (eligible.body ?? []).find((e) => e.id === dulal);
check(
  "somebody with no pay is listed with a null wage, not zero",
  dulalRow && dulalRow.monthlyGross === null,
  JSON.stringify(dulalRow?.monthlyGross),
);

/* ------------------------------------------ start a month with chosen people */

const run = await call("POST", "/payroll/runs", {
  periodYear: YEAR,
  periodMonth: MONTH,
});
const runId = run.body.id;
const firstSync = await call("POST", `/payroll/runs/${runId}/members`, {
  teamMemberIds: [alice, bashir],
});
check(
  "the run opens holding exactly the two chosen people",
  firstSync.status === 200 && firstSync.body.added === 2,
  JSON.stringify(firstSync.body),
);
const sheet1 = await call("GET", `/payroll/runs/${runId}`);
check(
  "the sheet shows them and the totals add up",
  sheet1.body.lines.length === 2 && sheet1.body.run.totalGross === "90000.00",
  `${sheet1.body.lines.length} lines, gross ${sheet1.body.run.totalGross}`,
);

/* --------------------------- edits survive the list changing around them */

const aliceLine = sheet1.body.lines.find((l) => l.teamMemberId === alice);
const bonus = await call("PATCH", `/payroll/lines/${aliceLine.id}`, {
  bonusAmount: "5000.00",
});
check("a bonus is typed onto a kept line", bonus.status === 200, `HTTP ${bonus.status}`);

// Bashir off, Chinta on — Alice untouched.
const secondSync = await call("POST", `/payroll/runs/${runId}/members`, {
  teamMemberIds: [alice, chinta],
});
check(
  "the swap adds one and removes one",
  secondSync.status === 200 &&
    secondSync.body.added === 1 &&
    secondSync.body.removed === 1,
  JSON.stringify({ added: secondSync.body.added, removed: secondSync.body.removed }),
);
const sheet2 = await call("GET", `/payroll/runs/${runId}`);
const aliceAfter = sheet2.body.lines.find((l) => l.teamMemberId === alice);
check(
  "and the kept line still carries its typed bonus",
  aliceAfter?.bonusAmount === "5000.00",
  `bonus ${aliceAfter?.bonusAmount}`,
);
check(
  "totals follow the new list",
  sheet2.body.run.totalGross === "80000.00" &&
    sheet2.body.run.totalAdditions === "5000.00",
  `gross ${sheet2.body.run.totalGross}, additions ${sheet2.body.run.totalAdditions}`,
);

/* ----------------------------------------------------------------- fences */

const withDulal = await call("POST", `/payroll/runs/${runId}/members`, {
  teamMemberIds: [alice, chinta, dulal],
});
check(
  "somebody with no pay is skipped by name, not paid nothing",
  withDulal.status === 200 &&
    withDulal.body.skipped?.some((n) => n.includes("Dulal")) &&
    /no pay is recorded/.test(withDulal.body.message ?? ""),
  withDulal.body.message?.slice(0, 80) ?? JSON.stringify(withDulal.body),
);

const withContractor = await call("POST", `/payroll/runs/${runId}/members`, {
  teamMemberIds: [alice, contractor],
});
check(
  "a name outside the month's eligible set is refused",
  withContractor.status === 400,
  msgOf(withContractor).slice(0, 70),
);

await call("POST", `/payroll/runs/${runId}/finalize`);
const lockedSync = await call("POST", `/payroll/runs/${runId}/members`, {
  teamMemberIds: [alice],
});
check(
  "a finalised run refuses to change its people",
  lockedSync.status === 400 && /reopen/.test(msgOf(lockedSync)),
  msgOf(lockedSync).slice(0, 70),
);
await call("POST", `/payroll/runs/${runId}/reopen`);
const reopenedSync = await call("POST", `/payroll/runs/${runId}/members`, {
  teamMemberIds: [alice],
});
check(
  "reopening makes it choosable again",
  reopenedSync.status === 200 && reopenedSync.body.removed === 1,
  JSON.stringify(reopenedSync.body),
);

/* --------------------------------------------------------- browser half */

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
// Every members call the page makes, status and answer, so a silent failure
// has somewhere to be seen.
page.on("response", (r) => {
  if (r.url().includes("/members")) {
    r.text().then((t) =>
      console.log(`      [net] ${r.status()} ${r.url().replace(/.*\/api/, "")} ${t.slice(0, 140)}`),
    );
  }
});

// The sheet's People drawer: open it on the QA run, untick Alice, save.
await page.goto(`${WEB}/payroll/${runId}`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);

const sheetSeen = await page.evaluate(() => ({
  peopleButton: [...document.querySelectorAll("button")].some((b) =>
    /^People$/.test((b.textContent ?? "").trim()),
  ),
  rows: document.body.innerText.includes("PQA Alice"),
}));
check(
  "the draft sheet offers a People button and shows the one line",
  sheetSeen.peopleButton && sheetSeen.rows,
  JSON.stringify(sheetSeen),
);

await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /^People$/.test((b.textContent ?? "").trim()))
    .click();
});
await settle(2000);
const drawerSeen = await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  const rowOf = (needle) =>
    boxes.find((b) => (b.closest("label")?.textContent ?? "").includes(needle));
  return {
    alice: rowOf("PQA Alice")?.checked ?? null,
    bashir: rowOf("PQA Bashir")?.checked ?? null,
    dulalDisabled: rowOf("PQA Dulal")?.disabled ?? null,
    saysNoPay: /no pay recorded/.test(document.body.innerText),
  };
});
check(
  "the drawer opens ticked to who is on the sheet, with no-pay rows disabled",
  drawerSeen.alice === true &&
    drawerSeen.bashir === false &&
    drawerSeen.dulalDisabled === true &&
    drawerSeen.saysNoPay,
  JSON.stringify(drawerSeen),
);

// Tick Bashir on and save: the sheet should gain his row without a reload.
await page.evaluate(() => {
  const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
  boxes
    .find((b) => (b.closest("label")?.textContent ?? "").includes("PQA Bashir"))
    .click();
});
await settle(300);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Save the list/.test(b.textContent ?? ""))
    .click();
});
/*
 * The API's answer is separate from the screen's: assert the line exists in
 * the database first, then give router.refresh() the seconds a dev server
 * needs to re-render the page before reading the screen.
 *
 * Polled rather than slept. A fixed 1.5s passed or failed with the dev
 * server's mood — the same run went green with one extra console line in it
 * and red without, which is a stopwatch, not a test.
 */
let bashirLine = 0;
for (let i = 0; i < 40 && bashirLine === 0; i++) {
  bashirLine = (
    await db.query(
      `select 1 from payroll_lines where payroll_run_id = $1
        and team_member_id = $2`,
      [runId, bashir],
    )
  ).rows.length;
  if (bashirLine === 0) await settle(250);
}
check("saving the list writes the new line", bashirLine === 1, "");
await settle(6000);
const afterSave = await page.evaluate(() => ({
  bashirOn: document.body.innerText.includes("PQA Bashir"),
  notice: /exactly the people you ticked/.test(document.body.innerText),
}));
check(
  "and the sheet shows him without a manual reload",
  afterSave.bashirOn,
  JSON.stringify(afterSave),
);

// The start-a-month form: its picker lists the month's people with wages.
await page.goto(`${WEB}/payroll`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2000);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /New month/.test(b.textContent ?? ""))
    .click();
});
await settle(2500);
const formSeen = await page.evaluate(() => ({
  // Only Emran is employed in the current month, so one box is the truth.
  hasChecklist: document.querySelectorAll('input[type="checkbox"]').length >= 1,
  saysGross: /of \d+ on the sheet/.test(document.body.innerText),
  everyone: /Everyone/.test(document.body.innerText),
}));
check(
  "the start-a-month drawer carries the same checklist",
  formSeen.hasChecklist && formSeen.saysGross && formSeen.everyone,
  JSON.stringify(formSeen),
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
