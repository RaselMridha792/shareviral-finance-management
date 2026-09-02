/**
 * Three asks, driven — the payslip, the Team order, and one paperclip.
 *
 * Three agents made these changes in parallel and two of them lost their
 * connection before proving anything, so nothing here is taken on trust. All of
 * it is measured against the running app.
 *
 *   38  the payslip says "Payment Date" and "Pay period", the pay period is two
 *       dates, and the bank account is printed ONCE rather than twice
 *   39  the Team list is ordered by employee ID, not by name — and somebody
 *       with no ID is last rather than first or missing
 *   40  the paperclip beside "Tool name" is gone, and the two lower ones are
 *       NOT, because those were made attach-only on purpose this week
 *
 * The fixtures are built so that the OLD behaviour would fail: three people who
 * sort one way by name and the opposite way by code, all joined on one day so
 * the old tiebreak would have decided it.
 *
 *     node .threeasksqa.mjs      (local only — writes and deletes)
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
  const people = (
    await db.query("select id from team_members where full_name like 'AQA %'")
  ).rows.map((r) => r.id);
  for (const id of people) {
    await db.query("delete from payroll_lines where team_member_id=$1", [id]);
    await db.query("delete from compensation_history where team_member_id=$1", [id]);
    await db.query("delete from team_members where id=$1", [id]);
  }
  const runs = (
    await db.query(
      "select id from payroll_runs where period_year=2026 and period_month=5",
    )
  ).rows.map((r) => r.id);
  for (const id of runs) {
    await db.query("delete from payroll_lines where payroll_run_id=$1", [id]);
    await db.query("delete from payroll_runs where id=$1", [id]);
  }
  await db.query("delete from subscriptions where tool_name like 'AQA %'");
  return people.length;
};
await wipe();

/*
 * Names and codes that DISAGREE. Sorted by name this reads Aaa, Mmm, Zzz;
 * sorted by code it reads AAQA, MMQA, ZZQA — the reverse for two of the three.
 * All on one joining date, so the order the list used to fall through to is the
 * one being replaced.
 */
const JOINED = "2024-01-01";
const made = [];
for (const [code, name] of [
  ["ZZQA-01", "AQA Aaa First"],
  ["MMQA-02", "AQA Mmm Middle"],
  ["AAQA-03", "AQA Zzz Last"],
]) {
  const m = (
    await call("POST", "/team-members", {
      fullName: name,
      employeeCode: code,
      engagementType: "employee",
      joinedOn: JOINED,
    })
  ).body;
  made.push({ code, name, id: m?.id });
}
/* And one with no code at all, which must not lead the list or vanish. */
const uncoded = (
  await call("POST", "/team-members", {
    fullName: "AQA Bbb Nocode",
    engagementType: "employee",
    joinedOn: JOINED,
  })
).body;
check(
  "four people exist, three coded and one not",
  made.every((m) => m.id) && Boolean(uncoded?.id),
  made.map((m) => `${m.code}=${m.name}`).join(", "),
);

/* -------------------------------- browser ------------------------------ */

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
await page.setViewport({ width: 1800, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------- 39: the order ------------------------- */

await page.goto(`${WEB}/team`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2800);

const listed = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const codeCol = heads.findIndex((h) => /employee id/i.test(h));
  const nameCol = heads.findIndex((h) => /^name$/i.test(h));
  return [...document.querySelectorAll("tbody tr")]
    .map((r) => {
      const cells = [...r.querySelectorAll("td")];
      return {
        code: (cells[codeCol]?.textContent ?? "").trim(),
        name: (cells[nameCol]?.textContent ?? "").trim(),
      };
    })
    .filter((r) => r.name.startsWith("AQA "));
});

/*
 * The screen prints "N/A" where a code is missing, not an empty cell. The first
 * run of this treated that as a code, so the expected string never matched and
 * the no-code row was reported as missing entirely — while the rendered order
 * was in fact exactly right.
 */
const hasCode = (r) => r.code && r.code !== "N/A";
const codes = listed.filter(hasCode).map((r) => r.code);
check(
  "39: the coded people come out in employee ID order",
  codes.join(",") === [...codes].sort().join(",") &&
    codes.join(",") === "AAQA-03,MMQA-02,ZZQA-01",
  codes.join(" ") || "no coded rows found",
);
check(
  "39: and the NAME is not what decided it — the old order is gone",
  listed.length >= 3 &&
    listed[0].name !== "AQA Aaa First",
  listed.map((r) => `${r.code || "(none)"}:${r.name.slice(4, 9)}`).join(" | "),
);
const noCodeAt = listed.findIndex((r) => !hasCode(r));
check(
  "39: somebody with no employee ID is LAST, not first and not missing",
  noCodeAt === listed.length - 1,
  `no-code row at index ${noCodeAt} of ${listed.length}`,
);

/* ------------------------------- 40: the clip -------------------------- */

await page.goto(`${WEB}/subscriptions`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2600);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === "Add a subscription",
  );
  btn?.click();
});
await settle(1800);

const drawer = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="dialog"]')].pop();
  if (!el) return null;
  const fieldNamed = (re) =>
    [...el.querySelectorAll("label")].find((l) =>
      re.test((l.textContent ?? "").trim()),
    );
  const clipsIn = (f) =>
    f
      ? f.querySelectorAll(
          'button[aria-label*="ttach" i], button[title*="ttach" i]',
        ).length
      : -1;
  /* The Tool name field is not a `label` in every shape, so also look at the
     row the input sits in. */
  const toolInput = [...el.querySelectorAll("input")].find(
    (i) => (i.placeholder ?? "").toLowerCase().includes("claude"),
  );
  const toolRow = toolInput?.closest("label") ?? toolInput?.parentElement;
  return {
    open: true,
    toolClips: toolRow
      ? toolRow.querySelectorAll("button").length
      : -1,
    invoiceClips: clipsIn(fieldNamed(/^Invoice/)),
    referenceClips: clipsIn(fieldNamed(/^Reference/)),
  };
});

check("40: the Add a subscription drawer opens", Boolean(drawer), "");
check(
  "40: there is no button beside Tool name any more",
  drawer?.toolClips === 0,
  `${drawer?.toolClips} button(s) in the Tool name row`,
);
check(
  "40: Invoice keeps its paperclip — that one was deliberate",
  (drawer?.invoiceClips ?? 0) >= 1,
  `${drawer?.invoiceClips}`,
);
check(
  "40: Reference keeps its paperclip too",
  (drawer?.referenceClips ?? 0) >= 1,
  `${drawer?.referenceClips}`,
);

/* The drawer must still SAVE — removing a control is not allowed to break the
   form it sat in. */
const savedPlan = await call("POST", "/subscriptions", {
  toolName: "AQA Tool",
  planName: "AQA Team",
  category: "ai_tool",
  costUsd: "20.00",
  usdRate: "122.50",
  costBdt: "2450.00",
  billingCycle: "monthly",
  startDate: "2026-01-05",
});
check(
  "40: a plan still saves with no screenshot on it",
  savedPlan.status === 201,
  `HTTP ${savedPlan.status}`,
);

/* ------------------------------ 38: the payslip ------------------------ */

/*
 * No paid payslip exists on this database, so one is built: a person, a wage, a
 * May sheet, and the line marked paid with a direct UPDATE rather than through
 * `POST /runs/:id/pay` — deliberately, so this leaves no ledger entry, no
 * reference number and no audit row on a database other work is using.
 */
const slipPerson = made[0];
/*
 * Bank details FIRST. The payroll line snapshots them when the sheet is built,
 * and without them `snapshot_bank_account` is null — which made the "printed
 * once, not twice" check pass while measuring nothing at all. That check is the
 * whole of change 3, so it has to have an account to count.
 */
await call("PATCH", `/team-members/${slipPerson.id}`, {
  bankName: "AQA Bank Limited",
  bankAccountNumber: "1083451057575",
});
await call("POST", `/team-members/${slipPerson.id}/compensation`, {
  grossAmount: "100000.00",
  effectiveFrom: "2024-01-01",
});
const run = (
  await call("POST", "/payroll/runs", { periodYear: 2026, periodMonth: 5 })
).body;
await call("POST", `/payroll/runs/${run.id}/generate-lines`, {});
const line = (
  await db.query(
    `select id, snapshot_bank_account from payroll_lines
      where payroll_run_id=$1 and team_member_id=$2 limit 1`,
    [run.id, slipPerson.id],
  )
).rows[0];
await db.query(
  "update payroll_lines set is_paid = true, paid_on = '2026-05-31' where id=$1",
  [line.id],
);
check("38: a paid payslip exists to read", Boolean(line?.id), line?.id ?? "none");

await page.goto(`${WEB}/payroll/${line.id}/payslip`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);

const slip = await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  return (main.textContent ?? "").replace(/\s+/g, " ");
});

check(
  "38: the label reads Payment Date, and Value date is gone",
  slip.includes("Payment Date") && !/Value date/i.test(slip),
  /Value date/i.test(slip) ? "Value date is still on the page" : "",
);
check(
  "38: the label reads Pay period, and Credited to is gone",
  slip.includes("Pay period") && !/Credited to/i.test(slip),
  /Credited to/i.test(slip) ? "Credited to is still on the page" : "",
);
check(
  "38: the pay period shows the month's first day to its last",
  /1 May 2026\s*to\s*31 May 2026/.test(slip),
  (slip.match(/Pay period[^A-Z]{0,60}/) ?? ["not found"])[0],
);

/* The whole point of change 3: the account number appears ONCE. */
const account = line.snapshot_bank_account;
const times = account
  ? slip.split(account).length - 1
  : null;
check(
  "38: the bank account is printed once, not twice",
  Boolean(account) && times === 1,
  account
    ? `"${account}" appears ${times} time(s)`
    : "NO ACCOUNT ON THE LINE — this check would have measured nothing",
);

await browser.close();
const removed = await wipe();
check("the fixtures are removed again", removed >= 4, `${removed} people`);
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
