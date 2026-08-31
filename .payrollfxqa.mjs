/**
 * A rate typed per LINE, not per app.
 *
 * The owner: *"fx rate take edit option dite hobe etake prottekta table a fx
 * rate likhte parbe"*. The sheet used to print the app's one governing rate on
 * every row and divide the net by it — one box that restates every historical
 * figure the moment somebody edits it.
 *
 * Two lines with DIFFERENT rates is the whole test, because that is the only
 * thing a global rate cannot do. Everything else here is the failure this
 * codebase keeps repeating: a column added to the Drizzle schema and forgotten
 * in the service's projection stores perfectly and reads back undefined, so the
 * screen says N/A and looks like a save that silently failed. It has bitten
 * accounts, team members and vendors.
 *
 * Builds its own two people and its own March sheet, and deletes all of it.
 *
 *     node .payrollfxqa.mjs      (local only — writes and deletes)
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

const YEAR = 2026;
const MONTH = 3;
const wipe = async () => {
  const ids = (
    await db.query(
      "select id from payroll_runs where period_year=$1 and period_month=$2",
      [YEAR, MONTH],
    )
  ).rows.map((r) => r.id);
  for (const id of ids) {
    await db.query("delete from payroll_lines where payroll_run_id=$1", [id]);
    await db.query("delete from payroll_runs where id=$1", [id]);
  }
  const people = (
    await db.query("select id from team_members where full_name like 'FXQA %'")
  ).rows.map((r) => r.id);
  for (const id of people) {
    await db.query("delete from payroll_lines where team_member_id=$1", [id]);
    await db.query("delete from compensation_history where team_member_id=$1", [id]);
    await db.query("delete from team_members where id=$1", [id]);
  }
  return { runs: ids.length, people: people.length };
};
await wipe();

/* Two people, two different wages — so two different dollar figures. */
const people = [];
for (const [name, wage] of [
  ["FXQA One", "120000.00"],
  ["FXQA Two", "90000.00"],
]) {
  const m = (
    await call("POST", "/team-members", {
      fullName: name,
      engagementType: "employee",
      joinedOn: "2024-01-01",
    })
  ).body;
  await call("POST", `/team-members/${m.id}/compensation`, {
    grossAmount: wage,
    effectiveFrom: "2024-01-01",
  });
  people.push(m);
}
const run = (
  await call("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: MONTH })
).body;
await call("POST", `/payroll/runs/${run.id}/generate-lines`, {});
const sheet = (await call("GET", `/payroll/runs/${run.id}`)).body;
const lines = sheet.lines;
check(
  "a two-person draft sheet exists",
  lines?.length === 2,
  `${lines?.length ?? 0} lines`,
);

/* ------------------------------ the projection ------------------------- */

check(
  "a line arrives carrying an fxRate key, empty to begin with",
  lines.every((l) => "fxRate" in l && l.fxRate === null),
  lines.map((l) => `${l.fullName}: ${JSON.stringify(l.fxRate)}`).join(", "),
);

/* Two different rates — the thing one global figure cannot express. */
const A = "122.500000";
const B = "110.000000";
const savedA = await call("PATCH", `/payroll/lines/${lines[0].id}`, {
  fxRate: "122.50",
});
const savedB = await call("PATCH", `/payroll/lines/${lines[1].id}`, {
  fxRate: "110",
});
check(
  "two lines take two different rates",
  savedA.status === 200 && savedB.status === 200,
  `HTTP ${savedA.status}/${savedB.status}`,
);

const stored = (
  await db.query(
    "select id, fx_rate::text from payroll_lines where payroll_run_id=$1 order by fx_rate desc",
    [run.id],
  )
).rows;
check(
  "and the database holds both, at six places",
  stored[0]?.fx_rate === A && stored[1]?.fx_rate === B,
  stored.map((r) => r.fx_rate).join(" / "),
);

const back = (await call("GET", `/payroll/runs/${run.id}`)).body.lines;
const byName = Object.fromEntries(back.map((l) => [l.fullName, l]));
check(
  "THE PROJECTION: the API sends the rate back rather than dropping it",
  byName["FXQA One"]?.fxRate === A && byName["FXQA Two"]?.fxRate === B,
  `One ${byName["FXQA One"]?.fxRate}, Two ${byName["FXQA Two"]?.fxRate}`,
);

/* -------------------------------- refusals ----------------------------- */

for (const [label, value] of [
  ["zero", "0"],
  ["negative", "-5"],
  ["letters", "abc"],
]) {
  const res = await call("PATCH", `/payroll/lines/${lines[0].id}`, {
    fxRate: value,
  });
  check(
    `a ${label} rate is refused`,
    res.status === 400,
    `HTTP ${res.status}`,
  );
}
const cleared = await call("PATCH", `/payroll/lines/${lines[1].id}`, {
  fxRate: null,
});
const afterClear = (
  await db.query("select fx_rate from payroll_lines where id=$1", [lines[1].id])
).rows[0];
check(
  "and null clears one back to nothing",
  cleared.status === 200 && afterClear.fx_rate === null,
  `HTTP ${cleared.status}, stored ${afterClear.fx_rate}`,
);
/* Put it back for the screen checks below. */
await call("PATCH", `/payroll/lines/${lines[1].id}`, { fxRate: "110" });

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
await page.setViewport({ width: 1900, height: 1200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const load = async () => {
  await page.goto(`${WEB}/payroll/${run.id}`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await settle(2600);
  return page.evaluate(() => {
    const heads = [...document.querySelectorAll("thead th")].map((h) =>
      (h.textContent ?? "").trim(),
    );
    const fx = heads.findIndex((h) => /^FX Rate$/i.test(h));
    const usd = heads.findIndex((h) => /Net Pay \(USD\)/i.test(h));
    const rows = [...document.querySelectorAll("tbody tr")].map((r) => {
      const cells = [...r.querySelectorAll("td")];
      const box = cells[fx]?.querySelector("input");
      return {
        name: (cells[1]?.textContent ?? "").trim(),
        rate: box ? box.value : (cells[fx]?.textContent ?? "").trim(),
        editable: Boolean(box),
        usd: (cells[usd]?.textContent ?? "").trim(),
      };
    });
    const foot = [...document.querySelectorAll("tfoot td")].map((c) =>
      (c.textContent ?? "").trim(),
    );
    return { heads, fx, usd, rows, foot };
  });
};

let view = await load();
check(
  "the sheet still has an FX Rate column and a Net Pay (USD) column",
  view.fx >= 0 && view.usd >= 0,
  view.heads.slice(-4).join(" | "),
);
check(
  "a draft's rate is a box somebody can type in",
  view.rows.length === 2 && view.rows.every((r) => r.editable),
  view.rows.map((r) => `${r.name}: "${r.rate}" editable=${r.editable}`).join(", "),
);
check(
  "each row shows ITS OWN rate, not one figure repeated",
  new Set(view.rows.map((r) => r.rate)).size === 2,
  view.rows.map((r) => r.rate).join(" / "),
);

/*
 * The arithmetic, per row. This is what a global rate got wrong: both people
 * were divided by the same number regardless of what their line said.
 */
const expected = back.map((l) => {
  const rate = l.fullName === "FXQA One" ? 122.5 : 110;
  return {
    name: l.fullName,
    usd: (Number(l.netAmount) / rate).toFixed(2),
  };
});
const shown = Object.fromEntries(view.rows.map((r) => [r.name, r.usd]));
check(
  "and the dollars on each row are that row's net at that row's rate",
  expected.every((e) => (shown[e.name] ?? "").includes(e.usd)),
  expected.map((e) => `${e.name} wants ${e.usd}, shows ${shown[e.name]}`).join(" | "),
);

const footUsd = view.foot[view.foot.length - 2] ?? "";
const wantTotal = expected
  .reduce((acc, e) => acc + Number(e.usd), 0)
  .toFixed(2);
check(
  "the total is the lines added up, not the month's net over one rate",
  footUsd.includes(wantTotal),
  `foot "${footUsd}", lines add to ${wantTotal}`,
);

/* A line with no rate has to be counted, not quietly dropped. */
await call("PATCH", `/payroll/lines/${lines[1].id}`, { fxRate: null });
view = await load();
const footNow = view.foot[view.foot.length - 2] ?? "";
check(
  "a line with no rate shows no dollars, and the total says how many",
  view.rows.some((r) => r.usd.includes("N/A")) &&
    /1 without a rate/.test(footNow),
  `rows ${view.rows.map((r) => r.usd).join(" / ")}; foot "${footNow}"`,
);

/* --------------------------- typing it on screen ----------------------- */

await page.evaluate((col) => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("FXQA Two"),
  );
  const box = [...row.querySelectorAll("td")][col].querySelector("input");
  box.setAttribute("data-fxqa", "1");
}, view.fx);
await page.click('[data-fxqa="1"]', { clickCount: 3 });
await page.type('[data-fxqa="1"]', "99.25");
await page.evaluate(() => document.querySelector('[data-fxqa="1"]').blur());
await settle(2200);

const typed = (
  await db.query("select fx_rate::text from payroll_lines where id=$1", [
    lines[1].id,
  ])
).rows[0];
check(
  "typing a rate into the sheet reaches the database",
  typed.fx_rate === "99.250000",
  `stored ${typed.fx_rate}`,
);

/* ------------------------------ once finalised ------------------------- */

await call("POST", `/payroll/runs/${run.id}/finalize`, {});
view = await load();
check(
  "a finalised sheet shows the rate but does not let it move",
  view.rows.length === 2 && view.rows.every((r) => !r.editable),
  view.rows.map((r) => `${r.name}: "${r.rate}" editable=${r.editable}`).join(", "),
);
const locked = await call("PATCH", `/payroll/lines/${lines[0].id}`, {
  fxRate: "1",
});
check(
  "and the server refuses a rate on a finalised sheet too",
  locked.status >= 400,
  `HTTP ${locked.status} ${JSON.stringify(locked.body?.message ?? "")}`,
);

await browser.close();
const removed = await wipe();
check(
  "the throwaway sheet and both people are removed again",
  removed.runs === 1 && removed.people === 2,
  `${removed.runs} run, ${removed.people} people`,
);
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
