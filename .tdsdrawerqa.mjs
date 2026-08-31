/**
 * The tax cell, and the panel behind it.
 *
 * Two claims to settle, and the code says both are already true — which is
 * exactly the kind of claim that has been wrong here before:
 *
 *   28  clicking the tax figure opens "how the tax was worked out", and the
 *       panel shows the arithmetic rather than an apology
 *   7.2 that panel does not run off its own right-hand edge, which is what the
 *       owner's screenshot showed
 *
 * The overflow is the part a diff cannot show. It is measured the only way it
 * can be: every element inside the drawer is asked for its bounding box, and
 * any box crossing the drawer's right edge is a failure with a name attached.
 *
 * Builds its own run for a month nothing uses and deletes it again, so the
 * August sheet somebody is actually working on is never touched.
 *
 *     node .tdsdrawerqa.mjs      (local only — writes and deletes)
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
 * March 2026 — a month with no run on this database, so nothing real moves.
 *
 * The person is built here too, with a wage, because the sheet is generated
 * from who was employed that month and what they were paid. The first run of
 * this harness produced a sheet with no lines and reported it as a product
 * fault; there was simply nobody with a salary on this database.
 */
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
    await db.query("select id from team_members where full_name like 'TDSQA %'")
  ).rows.map((r) => r.id);
  for (const id of people) {
    await db.query("delete from payroll_lines where team_member_id=$1", [id]);
    await db.query("delete from compensation_history where team_member_id=$1", [id]);
    await db.query("delete from team_members where id=$1", [id]);
  }
  return { runs: ids.length, people: people.length };
};
await wipe();

const member = (
  await call("POST", "/team-members", {
    fullName: "TDSQA Person",
    engagementType: "employee",
    joinedOn: "2024-01-01",
  })
).body;
/* A wage in the band the rule actually bites on, so the working has something
   to show beyond a row of zeroes. */
const comp = await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "120000.00",
  effectiveFrom: "2024-01-01",
});
const run = (
  await call("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: MONTH })
).body;
const gen = await call("POST", `/payroll/runs/${run.id}/generate-lines`, {});
check(
  "a draft sheet is built for a month nothing else uses",
  Boolean(member?.id) &&
    comp.status < 300 &&
    Boolean(run?.id) &&
    gen.status === 200,
  `member ${String(member?.id).slice(0, 8)}, comp HTTP ${comp.status}, run ${String(run?.id).slice(0, 8)}, generate HTTP ${gen.status}`,
);

const lines = (
  await db.query(
    "select id, tds_amount, tds_basis is not null has_basis from payroll_lines where payroll_run_id=$1",
    [run.id],
  )
).rows;
check(
  "and every line carries the working the app used",
  lines.length > 0 && lines.every((l) => l.has_basis),
  `${lines.filter((l) => l.has_basis).length} of ${lines.length} lines have a basis`,
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
await page.setViewport({ width: 1700, height: 1200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/payroll/${run.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);

/* The tax cell is a button holding a money figure, under the Tax heading. */
const cell = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  /* The heading reads "TDS", not "Tax" — the first run of this looked for the
     wrong word, found nothing, and blamed the screen. */
  const col = heads.findIndex((h) => /^TDS$/i.test(h));
  const row = document.querySelector("tbody tr");
  const td = row?.querySelectorAll("td")[col];
  const button = td?.querySelector("button");
  if (button) button.setAttribute("data-tdsqa", "1");
  return {
    heads,
    col,
    hasButton: Boolean(button),
    text: (td?.textContent ?? "").trim(),
    warning: Boolean(td?.querySelector("svg.lucide-triangle-alert")),
  };
});
check(
  "the tax figure is a button, not plain text",
  cell.hasButton,
  `column ${cell.col} "${cell.heads[cell.col]}", reads "${cell.text}"`,
);
check(
  "and the warning triangle is gone from it",
  !cell.warning,
  cell.warning ? "still drawing a triangle" : "no triangle",
);

await page.click('[data-tdsqa="1"]');
await settle(1200);

const drawer = await page.evaluate(() => {
  /* The drawer is the dialog that appeared — not the sidebar, which also
     answers to `aside`, and not the backdrop. */
  const panels = [...document.querySelectorAll('[role="dialog"]')];
  const el = panels[panels.length - 1];
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const text = (el.textContent ?? "").replace(/\s+/g, " ");

  /* Anything whose box crosses the panel's right edge. A single px of
     rounding is not overflow; four is. */
  const spills = [];
  for (const child of el.querySelectorAll("*")) {
    const b = child.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    if (b.right > box.right + 3) {
      const cls = child.className ? "." + String(child.className).split(" ")[0] : "";
      const label = (child.textContent ?? "").trim().slice(0, 30);
      spills.push(
        `${child.tagName.toLowerCase()}${cls} +${Math.round(b.right - box.right)}px ${label}`,
      );
    }
  }
  /* And any horizontal scrollbar inside it, which is the same fault wearing
     a different hat. */
  const scrollers = [...el.querySelectorAll("*")]
    .filter((c) => c.scrollWidth > c.clientWidth + 3)
    .map(
      (c) =>
        `${c.tagName.toLowerCase()} ${c.scrollWidth}>${c.clientWidth}` +
        ` (${getComputedStyle(c).overflowX})`,
    );

  return {
    box: { right: Math.round(box.right), width: Math.round(box.width) },
    title: (el.querySelector("h2, h3")?.textContent ?? "").trim(),
    text,
    spills,
    scrollers,
    bottom: Math.round(box.bottom),
    viewport: window.innerHeight,
  };
});

check(
  "clicking it opens a panel",
  Boolean(drawer),
  drawer ? drawer.title : "nothing opened",
);
check(
  "28: the panel is the tax working, named after the person",
  /how the tax was worked out/i.test(drawer?.title ?? ""),
  drawer?.title ?? "",
);
check(
  "28: and it shows the arithmetic rather than an apology",
  /taxable|band|yearly|annual/i.test(drawer?.text ?? "") &&
    !/Nothing was worked out/i.test(drawer?.text ?? ""),
  (drawer?.text ?? "").slice(0, 150),
);
check(
  "7.2: nothing inside it runs off the right-hand edge",
  (drawer?.spills ?? []).length === 0,
  (drawer?.spills ?? []).slice(0, 3).join(" | ") ||
    "no element crosses the panel edge",
);
check(
  "7.2: and nothing inside it needs a sideways scrollbar",
  (drawer?.scrollers ?? []).length === 0,
  (drawer?.scrollers ?? []).slice(0, 3).join(" | ") || "clean",
);
check(
  "7.2: the panel itself fits the window rather than being cut off",
  (drawer?.bottom ?? 0) <= (drawer?.viewport ?? 0) + 3,
  `panel bottom ${drawer?.bottom}, window ${drawer?.viewport}`,
);

/* The figure on the sheet and the figure in the panel have to be the same
   number, which is the whole point of showing the working. */
const agreement = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="dialog"]')].pop();
  const text = (el?.textContent ?? "").replace(/\s+/g, " ");
  return {
    disagrees: /stored figure and this working disagree/i.test(text),
    numbers: (text.match(/[\d,]+\.\d\d/g) ?? []).slice(-4),
  };
});
check(
  "28: the sheet's figure and the panel's working agree",
  !agreement.disagrees,
  agreement.disagrees
    ? "the panel is reporting a disagreement"
    : agreement.numbers.join(" "),
);

await browser.close();
const removed = await wipe();
check(
  "the throwaway sheet and person are removed again",
  removed.runs === 1 && removed.people === 1,
  `${removed.runs} run, ${removed.people} person deleted`,
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
