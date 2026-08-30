/**
 * The same walk for Other expenses, plus the month dropdown on both screens.
 *
 * Seeds a month past the API's 200-row ceiling would be too slow, so it seeds
 * one past a page: enough to prove the pager reaches every row, that the
 * serials keep counting across the breaks, that the headline total stays the
 * month's rather than the page's, and that changing the month starts again at
 * page one. Deletes what it seeded on the way out, whatever happened.
 *
 *   node .otherpage.mjs
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const PREFIX = "PROBE-OTH-";
const SEED = 47;
const MONTH = "2026-07";

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l.slice(i + 1).trim().replace(/^["']|["']$/g, ""),
      ];
    }),
);

const connect = async () => {
  const client = new pg.Client({
    connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
};

let db = await connect();
const { rows: users } = await db.query(
  "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1",
);
const { rows: accounts } = await db.query("select id from accounts limit 1");
const { rows: cats } = await db.query(
  "select id, name from categories where slug = 'office-rent' or slug = 'electricity' limit 1",
);
await db.query("delete from transactions where ref_no like $1", [`${PREFIX}%`]);

for (let n = 1; n <= SEED; n++) {
  const day = String((n % 31) + 1).padStart(2, "0");
  const amount = (500 + n * 3).toFixed(2);
  await db.query(
    // signed_amount is generated from amount and direction.
    `insert into transactions
       (ref_no, account_id, category_id, direction, txn_date, amount,
        description, payment_method)
     values ($1,$2,$3,'out',$4,$5,$6,'bank_transfer')`,
    [
      `${PREFIX}${String(n).padStart(4, "0")}`,
      accounts[0].id,
      cats[0].id,
      `${MONTH}-${day}`,
      amount,
      `${PREFIX}${String(n).padStart(4, "0")} probe`,
    ],
  );
}
await db.end();
console.log(`seeded ${SEED} non-tool rows into ${MONTH}\n`);

const token = jwt.sign(
  { sub: users[0].id, role: users[0].role, tv: users[0].token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome) ? chrome : edge,
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
await page.setViewport({ width: 1500, height: 950 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const problems = [];
const check = (ok, message) => {
  console.log(`  ${ok ? "ok   " : "FAIL "} ${message}`);
  if (!ok) problems.push(message);
};

const money = (text) => Number((text || "").replace(/[^0-9.]/g, "")) || 0;

const read = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll(".table-data tbody tr")]
      .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim()))
      .filter((cells) => cells.length >= 5)
      .map((cells) => ({
        sl: Number(cells[0]),
        date: cells[1],
        what: cells[2],
        amount: cells[4],
      }));

    const pager = [...document.querySelectorAll("div")].find((d) =>
      /^Page\s+\d+\s+of\s+\d+/.test(d.innerText || ""),
    );

    return {
      rows,
      pager: pager ? pager.innerText.replace(/\s+/g, " ").trim() : null,
      heading:
        [...document.querySelectorAll("p, div")]
          .map((e) => e.innerText || "")
          .find((t) => /^\d+ entr(y|ies)$/.test(t.trim())) ?? null,
      spent:
        document.querySelector("main")?.innerText.match(/৳[\d,]+\.\d\d/)?.[0] ??
        null,
      month: document.querySelector('select[aria-label="Month"]')?.value ?? null,
    };
  });

const clickPager = (label) =>
  page.evaluate((text) => {
    const pager = [...document.querySelectorAll("div")].find((d) =>
      /^Page\s+\d+\s+of\s+\d+/.test(d.innerText || ""),
    );
    const button = [...(pager?.querySelectorAll("button") ?? [])].find(
      (b) => b.innerText.trim().toLowerCase() === text.toLowerCase(),
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, label);

const pickMonth = async (value) => {
  await page.select('select[aria-label="Month"]', value);
  await page
    .waitForFunction(
      (v) => document.querySelector('select[aria-label="Month"]')?.value === v,
      { timeout: 20000 },
      value,
    )
    .catch(() => {});
  await wait(1800);
};

try {
  const url = "http://localhost:3000/expenses/other";
  // `next dev` compiles a route on its first request and serves an error page
  // while it does, which reads exactly like a table with no rows in it.
  await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
  await wait(1500);
  await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
  await wait(1200);

  console.log("1. the month dropdown on Other expenses");
  const control = await page.evaluate(() => {
    const el = document.querySelector('select[aria-label="Month"]');
    return el
      ? { tag: el.tagName, options: [...el.options].map((o) => o.textContent.trim()) }
      : null;
  });
  check(control?.tag === "SELECT", `the month control is a ${control?.tag ?? "(missing)"}`);
  console.log(`   offers: ${control?.options.join(" | ")}`);

  await pickMonth("2026-07-01");
  let view = await read();
  check(view.month === "2026-07-01", `switched to July (${view.month})`);

  console.log("\n2. every page of July, front to back");
  console.log(`   pager: ${view.pager ?? "(none)"}`);
  console.log(`   heading says: ${view.heading ?? "(none)"} · spent: ${view.spent}`);

  const collected = [];
  const sizes = [];
  let guard = 0;
  while (guard++ < 20) {
    collected.push(...view.rows);
    sizes.push(view.rows.length);
    if (!(await clickPager("Next"))) break;
    await wait(400);
    view = await read();
  }

  const headingCount = Number((view.heading || "").replace(/\D/g, ""));
  check(
    collected.length === headingCount,
    `walked ${collected.length} rows and the card's heading says ${headingCount}`,
  );
  check(
    collected.filter((r) => r.what.includes(PREFIX)).length === SEED,
    `all ${SEED} seeded rows reachable`,
  );
  check(
    sizes.slice(0, -1).every((s) => s === 20),
    `every page but the last holds 20 (${sizes.join(", ")})`,
  );
  check(
    collected.every((row, i) => row.sl === i + 1),
    `serials run 1..${collected.length} unbroken across the page breaks`,
  );
  /*
   * Duplicate-checked on the rows this script owns, not on description text.
   *
   * Two real entries can share a description — "Office rent — 2026-07" twice
   * in a month is a correction, not a bug — so a distinct-description count
   * fails on honest data. The seeded refs are unique by construction, and the
   * walked-against-server count above is what proves nothing was dropped.
   */
  const times = new Map();
  for (const row of collected) {
    if (!row.what.includes(PREFIX)) continue;
    const ref = row.what.split(" ")[0];
    times.set(ref, (times.get(ref) ?? 0) + 1);
  }
  check(
    [...times.values()].every((n) => n === 1),
    `every seeded row appears exactly once across the pages (${times.size} of them)`,
  );
  check(
    collected.every((row, i) => i === 0 || collected[i - 1].date >= row.date),
    "dates never climb back up — newest first, all the way down",
  );

  console.log("\n3. the headline total is the month's, not the page's");
  const walked = collected.reduce((sum, row) => sum + money(row.amount), 0);
  const headline = money(view.spent);
  check(
    Math.abs(walked - headline) < 1,
    `rows across every page add to ${walked.toFixed(2)}, headline reads ${headline.toFixed(2)}`,
  );

  console.log("\n4. changing the month starts again at page one");
  await clickPager("Previous");
  await wait(400);
  const deep = await read();
  console.log(`   sitting on ${deep.pager}`);
  await pickMonth("2026-08-01");
  const august = await read();
  check(august.month === "2026-08-01", `switched to August (${august.month})`);
  check(
    august.rows[0]?.sl === 1,
    `first row is serial 1 again (was ${august.rows[0]?.sl})`,
  );

  console.log("\n5. the month dropdown on Expense overview");
  await page.goto("http://localhost:3000/expenses", {
    waitUntil: "networkidle0",
    timeout: 90000,
  });
  await wait(1200);
  const overview = await page.evaluate(() => {
    const el = document.querySelector('select[aria-label="Month"]');
    return el
      ? {
          tag: el.tagName,
          value: el.value,
          options: [...el.options].map((o) => o.textContent.trim()),
        }
      : null;
  });
  check(overview?.tag === "SELECT", `the month control is a ${overview?.tag ?? "(missing)"}`);
  console.log(`   offers: ${overview?.options.join(" | ")}`);
  await pickMonth("2026-06-01");
  const moved = await page.evaluate(() => ({
    month: document.querySelector('select[aria-label="Month"]')?.value,
    said: document.querySelector("main")?.innerText.match(/SPENT IN [A-Z]+ \d{4}/)?.[0],
  }));
  check(
    moved.month === "2026-06-01" && /JUNE/.test(moved.said ?? ""),
    `picking June re-scoped the page (${moved.said})`,
  );
} finally {
  await browser.close();
  const cleanupDb = await connect();
  const gone = await cleanupDb.query(
    "delete from transactions where ref_no like $1",
    [`${PREFIX}%`],
  );
  await cleanupDb.end();
  console.log(`\nseeded rows removed: ${gone.rowCount}`);
}

console.log(
  problems.length
    ? `\n${problems.length} problem(s):\n - ${problems.join("\n - ")}`
    : "\nall checks passed",
);
process.exit(problems.length ? 1 : 0);
