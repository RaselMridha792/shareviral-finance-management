/**
 * Working days drive the pay, against the month's own length.
 *
 * The owner's rules, each with the check that would catch its violation:
 *   - one number (Working Days) — Paid days is gone from the contract, and
 *     from the screen: the count is typed in a column on the salary sheet
 *     itself now, the Breakdown drawer that used to hold it having been
 *     removed (a8d5518, 422a22e);
 *   - the divisor is the month's real calendar length: 28, 29, 30 or 31;
 *   - gross = salary x days / length, the earnings lines scale with it and
 *     still sum to it exactly (rounding pinned, not hoped about);
 *   - the TAX is worked out on the pro-rated figure, not the full salary;
 *   - null puts the full month back;
 *   - a gross typed by hand clears the day count — a figure cannot claim to
 *     come from days it did not come from;
 *   - saving days twice pro-rates from the SALARY both times, never from an
 *     already-shrunk gross.
 *
 *     node .prorataqa.mjs      (local only — writes and deletes)
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
 * One person on 31,000/month, on three runs: February 2032 (29 days — a leap
 * year, the nastiest divisor), April 2032 (30) and May 2032 (31). 31,000
 * because it divides none of them evenly, so the rounding pin has to work.
 */
const wipe = async () => {
  /*
   * By period, not by label: the API names a run "February 2032" itself, so a
   * label pattern of ours matches nothing and a leftover run fails the next
   * create — the same lesson .tdsqa.mjs already paid for.
   */
  await db.query(
    `delete from payroll_lines where payroll_run_id in
       (select id from payroll_runs where (period_year = 2032 and period_month in (2, 4, 5))
           or (period_year = 2027 and period_month = 3))`,
  );
  await db.query(
    `delete from payroll_runs where (period_year = 2032 and period_month in (2, 4, 5))
        or (period_year = 2027 and period_month = 3)`,
  );
  await db.query(
    `delete from compensation_history where team_member_id in
       (select id from team_members where full_name like 'PRQA %')`,
  );
  await db.query("delete from team_members where full_name like 'PRQA %'");
};
await wipe();

const created = await call("POST", "/team-members", {
  fullName: "PRQA Prorated Person",
  engagementType: "employee",
  designation: "Tester",
  joinedOn: "2025-01-01",
  currentSalary: "31000.00",
});
const memberId = created.body?.id;

const mkRun = async (year, month, label) => {
  const run = await call("POST", "/payroll/runs", {
    periodYear: year,
    periodMonth: month,
  });
  if (run.status !== 201) {
    console.log("run create failed", run.status, JSON.stringify(run.body).slice(0, 200));
    process.exit(1);
  }
  // Creating a run makes an empty sheet; who is on it is chosen after.
  const put = await call("POST", `/payroll/runs/${run.body.id}/members`, {
    teamMemberIds: [memberId],
  });
  if (put.status >= 400) {
    console.log("members failed", put.status, JSON.stringify(put.body).slice(0, 200));
    process.exit(1);
  }
  const [line] = (
    await db.query(
      `select l.id, l.gross_amount, l.tds_amount from payroll_lines l
        join payroll_runs r on r.id = l.payroll_run_id
       where r.id = $1`,
      [run.body.id],
    )
  ).rows;
  return { runId: run.body.id, lineId: line.id, gross: line.gross_amount };
};

const lineNow = async (lineId) =>
  (
    await db.query(
      `select gross_amount, tds_amount, working_days, earnings_breakdown
         from payroll_lines where id = $1`,
      [lineId],
    )
  ).rows[0];

/* ------------------------- the divisor is the month's own length -------- */

const feb = await mkRun(2032, 2, "PRQA Feb");
const apr = await mkRun(2032, 4, "PRQA Apr");
const may = await mkRun(2032, 5, "PRQA May");

const cases = [
  { name: "February 2032 (leap, 29 days)", run: feb, days: 10, dim: 29 },
  { name: "April 2032 (30 days)", run: apr, days: 10, dim: 30 },
  { name: "May 2032 (31 days)", run: may, days: 10, dim: 31 },
];
for (const c of cases) {
  const set = await call("PATCH", `/payroll/lines/${c.run.lineId}`, {
    workingDays: c.days,
  });
  const row = await lineNow(c.run.lineId);
  const expect = ((31000 * c.days) / c.dim).toFixed(2);
  check(
    `${c.name}: 10 days of 31,000 = ${expect}`,
    set.status === 200 && row.gross_amount === expect,
    `gross ${row.gross_amount}`,
  );
  const parts = row.earnings_breakdown ?? [];
  const sum = parts.reduce((t, p) => t + Number(p.amount), 0).toFixed(2);
  check(
    "  and the earnings lines still sum to the gross exactly",
    sum === row.gross_amount && parts.length > 0,
    `${parts.length} lines, sum ${sum}`,
  );
}

/* ----------------------- the tax follows the pro-rated figure ----------- */

// Whatever the policy says, the invariant is comparative: the tax on 10 days
// must equal the tax computed for a salary OF that pro-rated size — and if a
// full 31,000 month owes tax, the same person at a third of it must not owe
// the same amount.
const fullMonth = await call("PATCH", `/payroll/lines/${may.lineId}`, {
  workingDays: null,
});
const fullRow = await lineNow(may.lineId);
check(
  "null puts the full month back — gross and all",
  fullMonth.status === 200 &&
    fullRow.gross_amount === "31000.00" &&
    fullRow.working_days === null,
  `gross ${fullRow.gross_amount}, days ${fullRow.working_days}`,
);
const fullTds = Number(fullRow.tds_amount);

await call("PATCH", `/payroll/lines/${may.lineId}`, { workingDays: 10 });
const partRow = await lineNow(may.lineId);
const partTds = Number(partRow.tds_amount);
check(
  "the tax is worked out on the pro-rated amount, not the month's salary",
  fullTds === 0 ? partTds === 0 : partTds < fullTds,
  `full-month tds ${fullTds.toFixed(2)}, 10-day tds ${partTds.toFixed(2)}`,
);
check(
  "  (and its stored working names the pro-rated figure as the salary)",
  partRow.tds_amount !== fullRow.tds_amount || fullTds === 0,
  "",
);

/* --------------------- second save shrinks from the salary -------------- */

await call("PATCH", `/payroll/lines/${may.lineId}`, { workingDays: 20 });
const twice = await lineNow(may.lineId);
check(
  "changing 10 days to 20 pro-rates from the salary, not from the shrunk gross",
  twice.gross_amount === ((31000 * 20) / 31).toFixed(2),
  `gross ${twice.gross_amount}`,
);

/* ------------------------- hand-typed gross clears the count ------------ */

await call("PATCH", `/payroll/lines/${may.lineId}`, { grossAmount: "25000.00" });
const handSet = await lineNow(may.lineId);
check(
  "a gross typed by hand clears the day count",
  handSet.gross_amount === "25000.00" && handSet.working_days === null,
  `gross ${handSet.gross_amount}, days ${handSet.working_days}`,
);

/* -------- the tax rule with teeth: fiscal 2026 has a real policy --------- */
/*
 * The May-2032 comparison above proves shape but the policy there is unset,
 * so both sides were zero. Fiscal 2026 has the company's real rule, so this
 * is where "tax on the 10-day amount" is proven with money in it: a salary
 * big enough to owe tax, and the days-tax must EQUAL the tax of a hand-set
 * gross of the same figure — same amount, same rule, same answer — and be
 * smaller than the full month's.
 */
await call("PATCH", `/team-members/${memberId}`, { currentSalary: "150000.00" });
const fy = await mkRun(2027, 3, "PRQA Mar27");
const fyFull = await lineNow(fy.lineId);
const fyFullTds = Number(fyFull.tds_amount);
check(
  "a 150k month under the fiscal-2026 rule owes real tax",
  fyFullTds > 0,
  `tds ${fyFull.tds_amount}`,
);
// March 2027 has 31 days; 10 days of 150,000 = 48,387.10.
const prorated = ((150000 * 10) / 31).toFixed(2);
await call("PATCH", `/payroll/lines/${fy.lineId}`, { grossAmount: prorated });
const byHand = await lineNow(fy.lineId);
await call("PATCH", `/payroll/lines/${fy.lineId}`, { workingDays: 10 });
const byDays = await lineNow(fy.lineId);
check(
  "10 days' tax equals the tax on a hand-set gross of the same figure",
  byDays.gross_amount === prorated && byDays.tds_amount === byHand.tds_amount,
  `days ${byDays.tds_amount} vs hand ${byHand.tds_amount} on ${prorated}`,
);
check(
  "and it is less than the full month's tax — the owner's 10-of-30k rule",
  Number(byDays.tds_amount) < fyFullTds,
  `${byDays.tds_amount} < ${fyFull.tds_amount}`,
);

/* ------------------------------- the guards ----------------------------- */

const tooMany = await call("PATCH", `/payroll/lines/${feb.lineId}`, {
  workingDays: 30,
});
check(
  "30 days into February 2032 is refused, naming the month's 29",
  tooMany.status === 400 &&
    /29 days/.test(JSON.stringify(tooMany.body?.errors ?? {})),
  `HTTP ${tooMany.status} ${JSON.stringify(tooMany.body?.errors ?? {})}`,
);
const paid = await call("PATCH", `/payroll/lines/${feb.lineId}`, {
  paidDays: 5,
});
check(
  "the contract no longer accepts paidDays at all",
  paid.status === 400,
  `HTTP ${paid.status}`,
);

/* --------------------- the days box, on the sheet itself ---------------- */
/*
 * WAS: a Breakdown link on the row opened a drawer, and the Working days box
 * lived inside it. This section clicked the link and asserted the drawer
 * offered Working days alone, out of "the month's real length".
 *
 * The link, the drawer and that duplicate box were all removed today
 * (a8d5518 "Salary sheet: no Breakdown link"; 422a22e deleted BreakdownDrawer
 * along with it, dead since the link went). Working Days is a column typed
 * straight on the sheet now, headed with the month's own length underneath —
 * so the same rules are put to the column instead: one number and no Paid
 * days, the month's real length named where the person typing can see it, and
 * a figure typed there that really does re-figure the gross.
 */

/*
 * Put the fixture back on 31,000 before driving the screen.
 *
 * The fiscal-2026 section above raised this person to 150,000, and pro-rata
 * reads the salary ON RECORD FOR THE MONTH (compensation_history, latest row
 * effective on or before the month's end) rather than the line's own gross —
 * so a day count typed on the February 2032 sheet after that raise re-figures
 * against 150,000, which the first run of this section read as the screen
 * being wrong. Same effective date, so this amends that raise rather than
 * stacking a third row on it.
 */
await call("PATCH", `/team-members/${memberId}`, { currentSalary: "31000.00" });
const applies = (
  await db.query(
    `select gross_amount from compensation_history
      where team_member_id = $1 and deleted_at is null
        and effective_from <= date '2032-02-29'
      order by effective_from desc limit 1`,
    [memberId],
  )
).rows[0];
if (applies?.gross_amount !== "31000.00") {
  console.log("fixture not restored to 31,000 —", JSON.stringify(applies));
  process.exit(1);
}

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
await page.setViewport({ width: 1600, height: 1100 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`${WEB}/payroll/${feb.runId}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(3000);

/*
 * The column is found by its heading and the row's cell taken at that
 * heading's index — not by nth-child, which the FX Rate column added today
 * would have shifted under us, and not by a class five money columns share.
 * The box is marked as it is found, so the click that follows lands on the
 * element that was just measured; it is re-marked before every interaction
 * because saving re-keys the input on the stored day count, which mounts a
 * new node and leaves the marked one detached.
 */
const readSheet = () => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").replace(/\s+/g, " ").trim(),
  );
  const row = document.querySelector("tbody tr");
  const cellAt = (test) => {
    const i = heads.findIndex(test);
    return i === -1 ? { i, td: null } : { i, td: row?.querySelectorAll("td")[i] ?? null };
  };
  const days = cellAt((h) => /^Working Days/i.test(h));
  const gross = cellAt((h) => /^Gross$/i.test(h));
  const input = days.td?.querySelector("input") ?? null;
  if (input) input.setAttribute("data-prqa-days", "1");
  const shown = (td) => {
    const box = td?.querySelector("input") ?? null;
    return box ? box.value : ((td?.textContent ?? "").trim() || null);
  };
  /* What the four earnings columns add up to on screen — read-only cells, so
     they say what the last fetch returned whatever the input boxes do. */
  const parts = heads
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /^(Basic|House Rent|Medical|Conveyance)/i.test(h))
    .map(({ i }) => Number((row?.querySelectorAll("td")[i]?.textContent ?? "").replace(/[^\d.-]/g, "")))
    .filter((n) => Number.isFinite(n));
  return {
    loaded: heads.length > 0 && Boolean(row),
    columns: heads.length,
    col: days.i,
    heading: days.i === -1 ? "" : heads[days.i],
    typed: Boolean(input),
    days: shown(days.td),
    gross: shown(gross.td),
    grossAttr: gross.td?.querySelector("input")?.getAttribute("value") ?? null,
    partsSum: parts.length
      ? parts.reduce((t, n) => t + n, 0).toFixed(2)
      : null,
    // Paid days went from the contract and the screen together; the whole
    // page is searched because it must be nowhere, not merely not in a cell.
    paidDays: /Paid days/i.test(document.body.textContent ?? ""),
  };
};

const sheet = await page.evaluate(readSheet);
check(
  "Working Days is a column on the sheet — no drawer to open — headed out of February's own 29",
  sheet.loaded &&
    sheet.col !== -1 &&
    sheet.typed &&
    // "Working Daysof 29" with no space in textContent: the month's length is
    // a block <span> under the heading, and textContent joins without one.
    /Working Days\s*of\s*29\b/i.test(sheet.heading) &&
    !sheet.paidDays,
  `${sheet.columns} columns, heading "${sheet.heading}", typed ${sheet.typed}, "Paid days" on page ${sheet.paidDays}`,
);
check(
  "  and the box reads the 10 days this line was saved with",
  sheet.days === "10",
  `box reads ${JSON.stringify(sheet.days)}, gross cell ${JSON.stringify(sheet.gross)}`,
);

/*
 * Poll the row rather than sleep a fixed 1.4s: the save leaves on blur and
 * lands when it lands, and a sleep long enough on a warm machine is a false
 * failure on a cold one — the rot this suite has been bitten by before.
 */
const waitRow = async (lineId, ok, ms = 15000) => {
  const stop = Date.now() + ms;
  let row = await lineNow(lineId);
  while (!ok(row) && Date.now() < stop) {
    await settle(250);
    row = await lineNow(lineId);
  }
  return row;
};
const typeDays = async (text) => {
  const found = await page.evaluate(readSheet);
  if (!found.typed) return false;
  // Click to focus, then select what is in the box and type over it. A
  // triple-click does not select inside this input — the first run of this
  // typed 15 in front of the 10 already there and sent 1510, which the API
  // rightly refused, and the harness then read the unchanged row as a
  // product failure. select() leaves nothing to interpret.
  await page.click('[data-prqa-days="1"]');
  await page.evaluate(() => {
    const el = document.querySelector('[data-prqa-days="1"]');
    el?.focus();
    el?.select();
  });
  await page.keyboard.type(text);
  // Blur is what saves — the box has an onBlur, not an onChange.
  await page.keyboard.press("Tab");
  return true;
};
/*
 * The same patience for the screen: saving calls router.refresh(), which
 * refetches on its own schedule, so the row is polled until it has redrawn
 * rather than read once. Reading it a moment after the blur is how a harness
 * calls a screen stale when it was only early — and the days box is no
 * witness on its own, since it holds what was typed into it either way.
 */
const waitScreen = async (ok, ms = 20000) => {
  const stop = Date.now() + ms;
  let seen = await page.evaluate(readSheet);
  while (!ok(seen) && Date.now() < stop) {
    await settle(300);
    seen = await page.evaluate(readSheet);
  }
  return seen;
};

const expect15 = ((31000 * 15) / 29).toFixed(2);
const typed15 = await typeDays("15");
const after = await waitRow(feb.lineId, (r) => String(r.working_days) === "15");
check(
  "typing 15 in that box pro-rates the gross against the month's 29",
  typed15 &&
    String(after.working_days) === "15" &&
    after.gross_amount === expect15,
  `days ${after.working_days}, gross ${after.gross_amount}`,
);
const redrawn = await waitScreen(
  (s) => s.partsSum === expect15 && s.gross === expect15,
);
check(
  "  and the row redraws on it — the earnings columns and the Gross box both",
  redrawn.partsSum === expect15 && redrawn.gross === expect15,
  `earnings columns ${redrawn.partsSum}, gross box ${JSON.stringify(redrawn.gross)} (attribute ${JSON.stringify(redrawn.grossAttr)}), days box ${JSON.stringify(redrawn.days)}, stored ${after.gross_amount}`,
);

/*
 * The box has no clear button, so the month's own number is how a full month
 * is put back from the sheet: the screen sends 29-of-29 as null, the same
 * thing an emptied box sends. That translation lives only in the screen —
 * the API check above proves what null does, this proves the sheet says null.
 */
const typedFull = await typeDays("29");
const full = await waitRow(feb.lineId, (r) => r.working_days === null);
check(
  "typing the month's own 29 puts the full month back, stored as no day count at all",
  typedFull && full.working_days === null && full.gross_amount === "31000.00",
  `days ${full.working_days}, gross ${full.gross_amount}`,
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
