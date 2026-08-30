/**
 * Two questions the route matrix cannot answer.
 *
 * First, CFO. The role exists in the permission matrix and no user on this
 * system has it, so nothing has ever exercised it — which means "copied the
 * admin row" has been true only in the sense that nobody has looked. A token
 * can carry the claim without a user being created, and the proxy and the API
 * both read the claim, so the gating can be exercised without inventing an
 * account on a live system.
 *
 * Second, and more important: reaching a page is not seeing everything on it.
 * HR is allowed on Team and Payroll and must not read salary. Route gating
 * passing says nothing about that — the figures are filtered further down, in
 * the service's projection, and the only way to know is to read the page as HR
 * and look for a number that should not be there.
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";
import { hasPermission } from "./packages/shared/dist/index.js";

const REPO = "d:/codes/Finance-Management-software";
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const GATED = [
  ["/accounts", "accounts.read"],
  ["/transactions", "transactions.read"],
  ["/subscriptions", "vendors.read"],
  ["/team", "team.read"],
  ["/payroll", "payroll.read"],
  ["/tax/withholding", "tds.read"],
  ["/reports", "reports.view"],
  ["/data", "imports.run"],
  ["/settings", "settings.read"],
];

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const anyUser = (
  await c.query(
    "select id, token_version from users where status='active' and deleted_at is null limit 1",
  )
).rows[0];
const hr = (
  await c.query(
    "select id, token_version from users where role='hr' and status='active' and deleted_at is null limit 1",
  )
).rows[0];
// A salary figure that must not appear for HR, taken from the data itself.
const salaries = (
  await c.query(
    `select pl.gross_amount::numeric as gross, tm.full_name
       from payroll_lines pl join team_members tm on tm.id = pl.team_member_id
      order by pl.gross_amount desc limit 3`,
  )
).rows;
await c.end();

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});

const token = (id, tv, role) =>
  jwt.sign({ sub: id, role, tv }, env.JWT_ACCESS_SECRET, { expiresIn: "30m" });

const visit = async (tok, route) => {
  await browser.setCookie({
    name: "sfm_access",
    value: tok,
    domain: "localhost",
    path: "/",
  });
  const page = await browser.newPage();
  await page
    .goto("http://localhost:3000" + route, {
      waitUntil: "networkidle0",
      timeout: 90000,
    })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 1600));
  const landed = new URL(page.url()).pathname;
  const text = await page.evaluate(
    () => (document.querySelector("main") || document.body).innerText,
  );
  await page.close();
  return { landed, text };
};

/* ---- 1. CFO, on a token rather than a user ---------------------------- */
console.log("--- CFO: the role nothing has ever exercised");
const cfoTok = token(anyUser.id, anyUser.token_version, "cfo");
let cfoWrong = 0;
for (const [route, permission] of GATED) {
  const { landed } = await visit(cfoTok, route);
  const allowed = !landed.startsWith("/no-access") && !landed.startsWith("/login");
  const expected = hasPermission("cfo", permission);
  const ok = allowed === expected;
  if (!ok) cfoWrong += 1;
  console.log(
    `   ${route.padEnd(20)} needs ${permission.padEnd(18)} ` +
      `${expected ? "should be in " : "should be out"}  ${ok ? "correct" : "WRONG — got " + (allowed ? "in" : "out")}`,
  );
}
console.log(
  cfoWrong === 0
    ? "   the CFO row behaves as the matrix says"
    : `   ${cfoWrong} disagreement(s)`,
);

/* ---- 2. HR, and the salaries it must not see -------------------------- */
console.log("\n--- HR: allowed on Team and Payroll, must not read salary");
if (!hr) {
  console.log("   no HR user on this system");
} else {
  const hrTok = token(hr.id, hr.token_version, "hr");
  for (const route of ["/team", "/payroll"]) {
    const { landed, text } = await visit(hrTok, route);
    const leaked = salaries.filter((s) => {
      const plain = Number(s.gross).toFixed(2);
      const grouped = Number(s.gross).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
      });
      return text.includes(plain) || text.includes(grouped);
    });
    console.log(
      `   ${route.padEnd(12)} landed ${landed.padEnd(12)} ` +
        (leaked.length
          ? `SALARY VISIBLE: ${leaked.map((l) => l.full_name + " " + Number(l.gross).toFixed(2)).join(", ")}`
          : "no salary figure from the top three appears"),
    );
  }
  console.log(
    "   (checked against the three highest gross figures in the payroll)",
  );
}

await browser.close();
