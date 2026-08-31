/**
 * Five changes to two tables, driven rather than read off a diff.
 *
 * The owner asked for these together, and they are the kind that a diff shows
 * perfectly while the screen shows something else — a column removed from the
 * headings but not the body, a colour that lands on the wrong row, a link that
 * stops being a link but keeps its click.
 *
 *   24  "All accounts" gone from the filter; "Show voided" gone; the dollars
 *       read small under the taka instead of taking their own column
 *   25  a money-in row is green and a money-out row red — the whole row
 *   26  no Category column, and no small line under the description
 *   27  a reference with nothing attached says N/A and does not open a viewer
 *   31  the bank statement reads oldest first, with the same row colours
 *
 * It also checks the two things most likely to be broken BY those changes: the
 * headings and the cells still agreeing on how many columns there are, and the
 * running balance still counting downwards now that the statement is the other
 * way round.
 *
 *     node .tabletidyqa.mjs      (local only — writes and deletes)
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
  await db.query("delete from transactions where description like 'TIDYQA%'");
  await db.query("delete from accounts where name like 'TIDYQA %'");
};
await wipe();

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const month = TODAY.slice(0, 8);
const account = (
  await call("POST", "/accounts", {
    name: "TIDYQA Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "100000.00",
    openingBalanceOn: month + "01",
  })
).body;
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];

/* One in, one out, on different days so the order is checkable. */
const cashIn = await call("POST", "/transactions/cash-in", {
  txnDate: month + "05",
  accountId: account.id,
  amount: "50000.00",
  description: "TIDYQA money arriving",
  usdRate: "122.00",
  usdSent: "409.84",
});
const spend = await call("POST", "/transactions", {
  direction: "out",
  txnDate: month + "20",
  accountId: account.id,
  amount: "9000.00",
  categoryId: cat.id,
  description: "TIDYQA money leaving",
  paymentMethod: "bank_transfer",
});
check(
  "one movement in and one out are recorded",
  cashIn.status === 201 && spend.status === 201,
  `HTTP ${cashIn.status}/${spend.status}`,
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

/*
 * The browser reports these as oklab, not rgb.
 *
 * The tints are written as Tailwind alpha shades of the app's own tokens, and
 * those tokens are oklch — so `getComputedStyle` answers
 * `oklab(0.78 -0.12 0.05 / 0.06)`. An rgb-only parser read every one of them as
 * "none" and reported the colours as missing when they were on the screen. In
 * oklab the SECOND number is the green-red axis: negative is green, positive is
 * red, which is the whole test.
 */
const tint = (value) => {
  const s = String(value ?? "");
  const lab = /oklab\(\s*[\d.]+\s+(-?[\d.]+)/.exec(s);
  if (lab) {
    const a = Number(lab[1]);
    if (Math.abs(a) < 0.01) return "none";
    return a < 0 ? "green" : "red";
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(s);
  if (!rgb) return "none";
  const [r, g, , alpha] = rgb[1].split(",").map((n) => Number(n.trim()));
  if (alpha === 0) return "none";
  if (g > r) return "green";
  if (r > g) return "red";
  return "none";
};

await page.goto(`${WEB}/transactions`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);

const txn = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const first = document.querySelector("tbody tr");
  const cells = first ? first.querySelectorAll("td").length : 0;
  const rows = [...document.querySelectorAll("tbody tr")].map((r) => ({
    text: (r.textContent ?? "").replace(/\s+/g, " "),
    bg: getComputedStyle(r).backgroundColor,
  }));
  const filters = (document.querySelector("main")?.textContent ?? "").replace(
    /\s+/g,
    " ",
  );
  const options = [...document.querySelectorAll("select option")].map((o) =>
    (o.textContent ?? "").trim(),
  );
  return { heads, cells, rows, filters, options };
});

check(
  "26: the Category column is gone from the headings",
  !txn.heads.some((h) => /^Category$/i.test(h)),
  txn.heads.join(" | ").slice(0, 170),
);
check(
  "and the headings and the cells still agree on how many columns there are",
  txn.cells === txn.heads.length,
  `${txn.heads.length} headings, ${txn.cells} cells`,
);
check(
  "24: the dollars no longer have a column of their own",
  !txn.heads.some((h) => /Amount \(USD\)/i.test(h)) &&
    txn.heads.some((h) => /^Amount$/i.test(h)),
  txn.heads.filter((h) => /amount|usd/i.test(h)).join(" | "),
);
check(
  '24: "Show voided" is gone',
  !/Show voided/i.test(txn.filters),
  "",
);
check(
  '24: the account filter no longer offers "All accounts"',
  !txn.options.some((o) => /^All accounts$/i.test(o)),
  txn.options.slice(0, 6).join(" | "),
);

const inRow = txn.rows.find((r) => r.text.includes("TIDYQA money arriving"));
const outRow = txn.rows.find((r) => r.text.includes("TIDYQA money leaving"));
check(
  "25: the money-in row is tinted green",
  tint(inRow?.bg) === "green",
  `${inRow?.bg} -> ${tint(inRow?.bg)}`,
);
check(
  "25: and the money-out row red",
  tint(outRow?.bg) === "red",
  `${outRow?.bg} -> ${tint(outRow?.bg)}`,
);
check(
  "26: the payment method and transfer chip are gone from under the description",
  !/TIDYQA money leaving Bank transfer/i.test(
    (outRow?.text ?? "").replace(/\s+/g, " "),
  ),
  (outRow?.text ?? "").slice(0, 110),
);
check(
  "24: the dollars still show, small, on the row that has them",
  /409\.84|\$409/.test(inRow?.text ?? ""),
  (inRow?.text ?? "").slice(0, 130),
);

/* 27: a reference with no document is not a link. */
const refCell = await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("TIDYQA money leaving"),
  );
  const cells = [...(row?.querySelectorAll("td") ?? [])];
  const withRef = cells.find((c) => /TXN-/.test(c.textContent ?? ""));
  return {
    text: (withRef?.textContent ?? "").replace(/\s+/g, " ").trim(),
    isButton: Boolean(withRef?.querySelector("button")),
  };
});
check(
  "27: a reference with nothing attached says N/A and is not clickable",
  refCell.text.includes("N/A") && !refCell.isButton,
  `"${refCell.text}", button ${refCell.isButton}`,
);

/* ---------------------------- the statement ---------------------------- */

/* `?account=`, which is the key the page reads. With the wrong key it fell
   back to whichever account sorts first and every check below measured a
   statement of somebody else's money. */
await page.goto(`${WEB}/statement?account=${account.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);

const stmt = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("tbody tr")].map((r) => ({
    text: (r.textContent ?? "").replace(/\s+/g, " "),
    bg: getComputedStyle(r).backgroundColor,
  }));
  return {
    rows,
    blurb: (document.querySelector("main")?.textContent ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 200),
  };
});

const firstIdx = stmt.rows.findIndex((r) => r.text.includes("TIDYQA money arriving"));
const lastIdx = stmt.rows.findIndex((r) => r.text.includes("TIDYQA money leaving"));
check(
  "31: the statement reads oldest first",
  firstIdx >= 0 && lastIdx >= 0 && firstIdx < lastIdx,
  `arriving at ${firstIdx}, leaving at ${lastIdx}`,
);
check(
  "31: and the page says so rather than still claiming newest first",
  /oldest first/i.test(stmt.blurb) && !/newest first/i.test(stmt.blurb),
  stmt.blurb.slice(0, 110),
);
check(
  "31: the statement rows carry the same colours",
  tint(stmt.rows[firstIdx]?.bg) === "green" &&
    tint(stmt.rows[lastIdx]?.bg) === "red",
  `${tint(stmt.rows[firstIdx]?.bg)} / ${tint(stmt.rows[lastIdx]?.bg)}`,
);

/*
 * The running balance has to count DOWNWARDS now. This is what the reversal
 * could quietly break: the figures were computed ascending and then shown
 * descending, so reading them in the new order must still add up.
 */
const balances = await page.evaluate(() =>
  [...document.querySelectorAll("tbody tr")]
    .map((r) => {
      const cells = [...r.querySelectorAll("td")];
      const last = cells
        .map((c) => (c.textContent ?? "").trim())
        .filter((t) => /^৳/.test(t));
      return last[last.length - 1] ?? null;
    })
    .filter(Boolean),
);
check(
  "31: the balance still ends at the account's closing figure",
  balances.length >= 2 &&
    Number(String(balances[balances.length - 1]).replace(/[^0-9.]/g, "")) ===
      141000,
  `${balances.join(" -> ")} (100000 + 50000 - 9000 = 141000)`,
);

await browser.close();
await wipe();
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
