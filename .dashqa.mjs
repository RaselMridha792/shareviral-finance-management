/**
 * The dashboard's figures against the ledger.
 *
 * The screen has no table here, so the harness in `.qa.mjs` has nothing to
 * measure. What matters on this page is arithmetic: every block claims a
 * balance, and a balance is `opening + in - out` over entries that are neither
 * deleted nor voided. That definition is the app's own, and the only honest
 * check is to compute it in SQL and read the page back.
 *
 * Voided rows are excluded here on purpose — a figure that counted them is
 * exactly the fault this app has already shipped once.
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

const truth = (
  await c.query(`
    select a.name, a.type,
           a.opening_balance::numeric as opening,
           coalesce(sum(case when t.direction='in'  then t.amount::numeric else 0 end),0) as money_in,
           coalesce(sum(case when t.direction='out' then t.amount::numeric else 0 end),0) as money_out,
           a.opening_balance::numeric
             + coalesce(sum(case when t.direction='in' then t.amount::numeric else -t.amount::numeric end),0) as closing
      from accounts a
      left join transactions t
        on t.account_id = a.id and t.voided_at is null
     where a.deleted_at is null
     group by a.id, a.name, a.type, a.opening_balance
     order by a.name`)
).rows;
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
await page.setViewport({ width: 1600, height: 1400 });
await page
  .goto("http://localhost:3000/", { waitUntil: "networkidle0", timeout: 120000 })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 2500));

const screen = await page.evaluate(() => document.body.innerText);

/*
 * The sign is a Unicode minus, not a hyphen.
 *
 * The first version of this stripped everything but digits and a point, so
 * "−৳10,20,09,800.00" read as a positive hundred million and six
 * accounts were reported as disagreeing with a ledger they matched exactly. A
 * check that cries wolf is worse than no check: it teaches you to skip the
 * output.
 */
const amount = (s) => {
  const negative = /[-−]/.test(String(s));
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return negative ? -n : n;
};

console.log(
  "account".padEnd(26) + "closing (ledger)".padStart(18) + "   on the page",
);

let bad = 0;
for (const t of truth) {
  const at = screen.indexOf(t.name);
  const want = Number(t.closing);
  if (at === -1) {
    console.log(t.name.padEnd(26) + want.toFixed(2).padStart(18) + "   NOT ON THE PAGE");
    bad += 1;
    continue;
  }
  /*
   * The figure under "CURRENT BALANCE", not the first one in the block.
   *
   * A block prints four: the opening balance carried forward, the inflow, the
   * outflow, and then the current balance. Taking whichever came first meant
   * comparing the ledger's closing figure against the period's opening one,
   * which differ by exactly the movement being checked.
   */
  const block = screen.slice(at, at + 600);
  const marker = block.indexOf("CURRENT BALANCE");
  const near =
    (marker === -1 ? block : block.slice(marker)).match(
      /[-−]?[৳$]?[\d,]+\.\d\d/g,
    ) || [];
  const hit = near.some((v) => Math.abs(amount(v) - want) < 0.02);
  console.log(
    t.name.padEnd(26) +
      want.toFixed(2).padStart(18) +
      "   " +
      (hit ? "matches" : "NO MATCH — near it: " + near.slice(0, 4).join("  ")),
  );
  if (!hit) bad += 1;
}

console.log(
  "\n" +
    (bad === 0
      ? "every block's closing balance equals opening + in - out from the ledger"
      : bad + " account(s) disagree with the ledger"),
);
await browser.close();
