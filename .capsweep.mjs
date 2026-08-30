/**
 * The rate caption is gone from every signed-in screen, and every screen still
 * draws.
 *
 * Removing it was one line in the shell, which is exactly the kind of change
 * that reaches twenty screens and is invisible in a diff. So this visits all
 * of them — the dynamic routes with real ids from the database — and checks
 * two things per screen: the sentence is nowhere in the page text, and the
 * page still rendered something (a heading), so "the caption is gone" cannot
 * be satisfied by a screen that failed to load.
 *
 *   node .capsweep.mjs
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    }),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const { rows: users } = await c.query(
  "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1",
);
const { rows: account } = await c.query(
  "select a.id from accounts a join transactions t on t.account_id = a.id group by a.id order by count(t.id) desc limit 1",
);
const { rows: category } = await c.query(
  "select slug from categories where parent_id is null order by name limit 1",
);
const { rows: run } = await c.query(
  "select id from payroll_runs order by created_at desc limit 1",
);
// The payslip route's :runId is a payroll **line** id — one payslip is one
// person's line. A run id there is a 404, which draws the error page and
// proves nothing about the caption.
const { rows: line } = await c.query(
  "select id from payroll_lines order by created_at desc limit 1",
);
const { rows: member } = await c.query(
  "select id from team_members where deleted_at is null order by created_at limit 1",
);
await c.end();

const token = jwt.sign(
  { sub: users[0].id, role: users[0].role, tv: users[0].token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);

// Every route the caption used to be rendered under — the whole app bar the
// dashboard, which had it removed earlier, and the assistant, which is
// full-bleed and never had it.
const routes = [
  "/",
  "/accounts",
  `/accounts/${account[0].id}`,
  `/accounts/${account[0].id}/register`,
  "/accounts/cash-in",
  "/expenses",
  `/expenses/${category[0].slug}`,
  "/expenses/other",
  "/import",
  "/payroll",
  ...(run.length ? [`/payroll/${run[0].id}`] : []),
  ...(line.length ? [`/payroll/${line[0].id}/payslip`] : []),
  "/reports",
  "/settings",
  "/statement",
  "/subscriptions",
  "/tax/withholding",
  "/team",
  ...(member.length ? [`/team/${member[0].id}`] : []),
  "/transactions",
  "/assistant",
];

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await b.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 950 });

let bad = 0;
for (const route of routes) {
  await p.goto(`http://localhost:3000${route}`, {
    waitUntil: "networkidle0",
    timeout: 90000,
  });
  await new Promise((r) => setTimeout(r, 250));
  const view = await p.evaluate(() => {
    const text = document.body.innerText;
    /*
     * "Did this screen draw?" cannot be "is there an h1" — the payslip is a
     * print document built from divs and carries no heading at all. Real text
     * on the page, and no error card, is the test that holds for all of them.
     */
    const heading =
      document.querySelector("h1, h2")?.innerText.trim() ??
      text.trim().split(/\r?\n/)[0].slice(0, 34);
    const drew = text.trim().length > 200 && !/page couldn.t load/i.test(text);
    // The chip that now carries the rate on its own.
    const chip = /FX locked/.test(text);
    return {
      caption: /Dollar figures are approximate|recorded in BDT/.test(text),
      heading,
      drew,
      chip,
    };
  });
  const flags = [];
  if (view.caption) {
    flags.push("CAPTION STILL THERE");
    bad += 1;
  }
  if (!view.drew) {
    flags.push("NOTHING RENDERED");
    bad += 1;
  }
  if (!view.chip) {
    flags.push("no FX chip");
    bad += 1;
  }
  console.log(
    `${route.padEnd(46)} ${view.caption ? "caption" : "clean  "} · chip ${
      view.chip ? "yes" : "no "
    } · ${view.heading.slice(0, 34)}${flags.length ? "   <-- " + flags.join(", ") : ""}`,
  );
}

await b.close();
console.log(
  bad === 0
    ? `\nOK — ${routes.length} routes, the caption is gone from every one and every one still draws.`
    : `\n${bad} FAILURE(S)`,
);
process.exit(bad === 0 ? 0 : 1);
