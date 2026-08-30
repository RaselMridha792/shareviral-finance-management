/**
 * All transactions, and the three figures above the table.
 *
 * Those cells are the reason this check exists rather than a row count. A
 * summary that counts a voided entry is wrong in the one direction nobody
 * notices: the figure is plausible, the rows underneath are struck through and
 * obviously excluded, and the total quietly disagrees with them. That fault has
 * already shipped here once.
 *
 * So the same period the screen is showing, summed in SQL two ways — with the
 * voided rows and without — and whichever the page agrees with is the answer.
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
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const u = (
  await c.query(
    "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1",
  )
).rows[0];

const sums = (
  await c.query(`
    select
      coalesce(sum(amount::numeric) filter (where direction='in'  and voided_at is null), 0) as in_live,
      coalesce(sum(amount::numeric) filter (where direction='out' and voided_at is null), 0) as out_live,
      coalesce(sum(amount::numeric) filter (where direction='in'), 0)  as in_all,
      coalesce(sum(amount::numeric) filter (where direction='out'), 0) as out_all,
      count(*) filter (where voided_at is null)::int as n_live,
      count(*) filter (where voided_at is not null)::int as n_void
    from transactions`)
).rows[0];
await c.end();

const token = jwt.sign(
  { sub: u.id, role: u.role, tv: u.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);

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
await page.setViewport({ width: 1600, height: 1200 });
await page
  .goto("http://localhost:3000/transactions", {
    waitUntil: "networkidle0",
    timeout: 120000,
  })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 2500));

const seen = await page.evaluate(() => {
  const t = document.querySelector(".table-data");
  return {
    text: document.body.innerText,
    rows: t ? t.querySelectorAll("tbody tr").length : 0,
    struck: t
      ? [...t.querySelectorAll("tbody tr")].filter((r) =>
          r.querySelector(".line-through, [class*=line-through]"),
        ).length
      : 0,
  };
});

const amount = (s) => {
  const negative = /[-\u2212]/.test(String(s));
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return negative ? -n : n;
};
const figures = (seen.text.match(/[-\u2212]?[\u09f3$][\d,]+\.\d\d/g) || []).map(amount);

const near = (want) => figures.some((f) => Math.abs(f - want) < 0.02);

console.log("the ledger, whole:");
console.log(`   money in   live ${Number(sums.in_live).toFixed(2)}   with voided ${Number(sums.in_all).toFixed(2)}`);
console.log(`   money out  live ${Number(sums.out_live).toFixed(2)}   with voided ${Number(sums.out_all).toFixed(2)}`);
console.log(`   entries    ${sums.n_live} live, ${sums.n_void} voided`);
console.log("");
console.log("the page:");
console.log(`   rows on page one: ${seen.rows}, of which struck through: ${seen.struck}`);

for (const [label, live, all] of [
  ["money in", Number(sums.in_live), Number(sums.in_all)],
  ["money out", Number(sums.out_live), Number(sums.out_all)],
]) {
  const isLive = near(live);
  const isAll = live !== all && near(all);
  console.log(
    `   ${label}: ` +
      (isLive
        ? "matches the figure that excludes voided entries"
        : isAll
          ? "MATCHES THE ONE THAT INCLUDES VOIDED ENTRIES"
          : "no figure on the page matches either"),
  );
}

if (Number(sums.in_live) === Number(sums.in_all)) {
  console.log(
    "\n   note: no voided money-in entries in this database, so that half of the check proves nothing",
  );
}
await browser.close();
