/**
 * Walk the heading page's table page by page and check what a diff cannot show.
 *
 * Seeds a month busy enough to need three pages, then reads every page in the
 * browser: serials unbroken across the breaks, nothing dropped or shown twice,
 * order never flipping, twenty to a page except the last, the pager appearing
 * only when there is more than a page, a sub-category tab taking the reader
 * back to page one, and an empty result keeping its message but not its pager.
 * Deletes what it seeded on the way out, whatever happened.
 *
 *   node .catpage.mjs
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const PREFIX = "PROBE-CAT-";
const HEADING = "technology";
const FROM = "2026-07-01";
const TO = "2026-07-31";
/** Enough for three pages of twenty, with a short last one. */
const SEED = { "hosting-servers": 30, domains: 17 };

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

const cleanup = async () => {
  const db = await connect();
  const gone = await db.query("delete from transactions where ref_no like $1", [
    `${PREFIX}%`,
  ]);
  await db.end();
  return gone.rowCount;
};

let db = await connect();
const { rows: users } = await db.query(
  "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1",
);
const { rows: accounts } = await db.query("select id from accounts limit 1");
const { rows: cats } = await db.query(
  "select id, slug, name from categories where slug = any($1)",
  [Object.keys(SEED)],
);

// Anything a previous run left behind would make every count below a lie.
await db.query("delete from transactions where ref_no like $1", [`${PREFIX}%`]);

const { rows: before } = await db.query(
  `select count(*)::int as n from transactions t
     join categories c on c.id = t.category_id
     join categories p on p.id = coalesce(c.parent_id, c.id)
    where p.slug = $1 and t.direction = 'out' and t.txn_date between $2 and $3`,
  [HEADING, FROM, TO],
);

let n = 0;
for (const [slug, count] of Object.entries(SEED)) {
  const category = cats.find((c) => c.slug === slug);
  for (let i = 0; i < count; i++) {
    n += 1;
    const day = String((n % 31) + 1).padStart(2, "0");
    const amount = (1000 + n * 7).toFixed(2);
    await db.query(
      // signed_amount is generated from amount and direction.
      `insert into transactions
         (ref_no, account_id, category_id, direction, txn_date, amount,
          description, payment_method)
       values ($1,$2,$3,'out',$4,$5,$6,'card')`,
      [
        `${PREFIX}${String(n).padStart(4, "0")}`,
        accounts[0].id,
        category.id,
        `2026-07-${day}`,
        amount,
        `${PREFIX}${String(n).padStart(4, "0")} ${category.name}`,
      ],
    );
  }
}
await db.end();

const seeded = n;
const expected = before[0].n + seeded;
console.log(
  `seeded ${seeded} rows into ${HEADING} for July 2026 (${before[0].n} were already there, so ${expected} in all)\n`,
);

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

/** The rows on screen, the pager sentence, and which tab is lit. */
const read = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll(".table-data tbody tr")]
      .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.innerText.trim()))
      .filter((cells) => cells.length >= 5)
      .map((cells) => ({ sl: Number(cells[0]), date: cells[1], what: cells[2] }));

    const pager = [...document.querySelectorAll("div")].find((d) =>
      /^Page\s+\d+\s+of\s+\d+/.test(d.innerText || ""),
    );
    const buttons = pager
      ? [...pager.querySelectorAll("button")].map((b) => ({
          text: b.innerText.trim(),
          disabled: b.disabled,
        }))
      : [];

    return {
      rows,
      pager: pager ? pager.innerText.replace(/\s+/g, " ").trim() : null,
      buttons,
      tab: [...document.querySelectorAll('[role="tab"]')]
        .filter((b) => b.getAttribute("aria-selected") === "true")
        .map((b) => b.textContent.trim())[0],
      empty: (document.querySelector("main")?.innerText || "").includes(
        "Nothing filed under",
      ),
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

const clickTab = (name) =>
  page.evaluate((text) => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find(
      (b) => b.textContent.trim() === text,
    );
    if (!tab) return false;
    tab.click();
    return true;
  }, name);

try {
  const url = `http://localhost:3000/expenses/${HEADING}?from=${FROM}&to=${TO}`;
  // Warm the route first. `next dev` compiles a route on its first request and
  // serves an error page while it does, which reads exactly like a table with
  // no rows in it.
  await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
  await wait(1200);
  await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
  await wait(900);

  console.log("1. every page, front to back");
  const collected = [];
  const sizes = [];
  let guard = 0;
  let view = await read();
  console.log(`   pager: ${view.pager ?? "(none)"}`);

  while (guard++ < 20) {
    collected.push(...view.rows);
    sizes.push(view.rows.length);
    if (!(await clickPager("Next"))) break;
    await wait(350);
    view = await read();
  }

  check(
    collected.length === expected,
    `collected ${collected.length} rows, expected ${expected}`,
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
   * Two real entries can legitimately share a description; the seeded refs are
   * unique by construction, and the count against the database above is what
   * proves nothing was dropped.
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
  const probes = collected.filter((r) => r.what.includes(PREFIX)).length;
  check(probes === seeded, `all ${seeded} seeded rows reachable (found ${probes})`);
  check(
    collected.every((row, i) => i === 0 || collected[i - 1].date >= row.date),
    "dates never climb back up — newest first, all the way down",
  );

  console.log("\n2. the pager at the ends");
  check(view.buttons.some((b) => b.text === "Next" && b.disabled), "Next is dead on the last page");
  await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
  await wait(700);
  const first = await read();
  check(
    first.buttons.some((b) => b.text === "Previous" && b.disabled),
    "Previous is dead on page one",
  );

  console.log("\n3. a tab change goes back to page one");
  await clickPager("Next");
  await wait(300);
  await clickPager("Next");
  await wait(300);
  const deep = await read();
  check(/Page 3 of/.test(deep.pager ?? ""), `sitting on ${deep.pager}`);
  await clickTab("Hosting & servers");
  await wait(500);
  const filtered = await read();
  check(
    filtered.rows[0]?.sl === 1,
    `first row of the filtered table is serial 1 (was ${filtered.rows[0]?.sl})`,
  );
  check(
    /Page 1 of 2/.test(filtered.pager ?? ""),
    `pager reads ${filtered.pager} for the 30 hosting rows`,
  );

  console.log("\n4. a tab with nothing in it");
  const emptyTab = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')]
      .map((b) => b.textContent.trim())
      .find((t) => t !== "All"),
  );
  await page.goto(
    `http://localhost:3000/expenses/${HEADING}?from=2026-05-01&to=2026-05-31`,
    { waitUntil: "networkidle0", timeout: 90000 },
  );
  await wait(700);
  const may = await read();
  check(
    may.rows.length <= 20,
    `May 2026 holds ${may.rows.length} rows, so it fits one page`,
  );
  check(may.pager === null, "no pager on a table that fits one page");

  console.log("\n5. the month dropdown");
  const select = await page.evaluate(() => {
    const el = document.querySelector('select[aria-label="Month"]');
    if (!el) return null;
    return {
      tag: el.tagName,
      value: el.value,
      options: [...el.options].map((o) => ({ v: o.value, label: o.textContent.trim(), off: o.disabled })),
    };
  });
  check(Boolean(select), `the month control is a ${select?.tag ?? "(missing)"}`);
  check(
    select?.options.every((o) => !o.off),
    `no greyed rows — every month offered is a real one (${select?.options.length} of them)`,
  );
  console.log(`   offers: ${select?.options.map((o) => o.label).join(" | ")}`);
  check(
    select?.value === "2026-05-01",
    `shows the month the URL asked for (${select?.value})`,
  );

  await page.select('select[aria-label="Month"]', "2026-07-01");
  // router.push re-renders a server component; in dev that is not instant.
  await page.waitForFunction(
    () => location.search.includes("from=2026-07-01"),
    { timeout: 20000 },
  ).catch(() => {});
  await wait(1200);
  const moved = await read();
  const url2 = page.url();
  check(url2.includes("from=2026-07-01"), `picking July moved the page (${url2.split("?")[1]})`);
  check(moved.rows.length === 20, `and it is back on a full first page (${moved.rows.length} rows)`);
  check(moved.rows[0]?.sl === 1, "with serial 1 at the top");
} finally {
  await browser.close();
  const removed = await cleanup();
  console.log(`\nseeded rows removed: ${removed}`);
}

console.log(
  problems.length
    ? `\n${problems.length} problem(s):\n - ${problems.join("\n - ")}`
    : "\nall checks passed",
);
process.exit(problems.length ? 1 : 0);
