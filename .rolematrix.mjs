/**
 * Every role against every gated route, checked against the matrix rather
 * than against an opinion.
 *
 * The question is not "does this look right" — it is whether the screen a role
 * reaches agrees with `ROLE_PERMISSION_SETS`, which is the single list both the
 * sidebar and the API read. Two failures matter and they are not symmetric: a
 * role let into a screen it has no permission for is a hole, and a role refused
 * one it does have is a screen somebody cannot do their job on. The second gets
 * reported as loudly as the first, because it is the one nobody files a bug
 * about — they just stop using the app.
 *
 * The expectation comes from `proxy.ts`'s own table, copied here deliberately:
 * reading it out of the file being tested would let a wrong entry agree with
 * itself.
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

/** Route → the permission the proxy demands for it. */
const GATED = [
  ["/accounts", "accounts.read"],
  ["/transactions", "transactions.read"],
  ["/expenses", "transactions.read"],
  ["/subscriptions", "vendors.read"],
  ["/team", "team.read"],
  ["/payroll", "payroll.read"],
  ["/tax/withholding", "tds.read"],
  ["/reports", "reports.view"],
  ["/statement", "transactions.read"],
  ["/data", "imports.run"],
  ["/import", "imports.run"],
  ["/assistant", "ai.use"],
  ["/settings", "settings.read"],
];

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const people = (
  await c.query(
    `select distinct on (role) id, email, role, token_version
       from users where status='active' and deleted_at is null
      order by role, created_at`,
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

const wrong = [];
console.log(
  "route".padEnd(20) + people.map((p) => p.role.slice(0, 11).padEnd(12)).join(""),
);

for (const [route, permission] of GATED) {
  let line = route.padEnd(20);
  for (const person of people) {
    const token = jwt.sign(
      { sub: person.id, role: person.role, tv: person.token_version },
      env.JWT_ACCESS_SECRET,
      { expiresIn: "30m" },
    );
    await browser.setCookie({
      name: "sfm_access",
      value: token,
      domain: "localhost",
      path: "/",
    });
    const page = await browser.newPage();
    await page
      .goto("http://localhost:3000" + route, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    const landed = new URL(page.url()).pathname;
    await page.close();

    const allowed = !landed.startsWith("/no-access") && !landed.startsWith("/login");
    const expected = hasPermission(person.role, permission);

    line += (allowed === expected ? (allowed ? "in  " : "out ") : "WRONG").padEnd(12);
    if (allowed !== expected) {
      wrong.push({
        route,
        role: person.role,
        permission,
        expected: expected ? "in" : "out",
        actual: allowed ? "in" : "out",
        landed,
      });
    }
  }
  console.log(line);
}

await browser.close();

console.log("\n" + "=".repeat(70));
if (wrong.length === 0) {
  console.log(
    `every one of ${GATED.length} routes × ${people.length} roles matches the permission matrix`,
  );
} else {
  console.log(`${wrong.length} disagreement(s):\n`);
  for (const w of wrong) {
    console.log(
      `  ${w.route} [${w.role}] needs ${w.permission}: expected ${w.expected}, got ${w.actual} (${w.landed})`,
    );
  }
}
