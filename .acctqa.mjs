/**
 * The Accounts screens against the ledger.
 *
 * Three questions the harness cannot ask, because two of these screens have no
 * table and the third's numbers are cumulative:
 *
 *   - does every balance on the list equal opening + in - out?
 *   - is Cash In showing every receipt of the month, and does its total add
 *     up to the ledger's, to the paisa?
 *   - does the register's running balance actually run — each row's balance
 *     the opening figure plus every entry up to and including it?
 *
 * Brought up to date with the screens as they are (27 Sep 2026). It counted
 * every money-in entry the ledger has held against a Cash In page that shows
 * ONE month and leaves out transfers between our own accounts, and it walked
 * the register oldest first when the page lists it newest first — so it
 * reported disagreements that were only its own old assumptions. It now asks
 * the ledger the page's own questions, and exits 1 when they disagree.
 *
 *     node .acctqa.mjs      (local only — reads, writes nothing)
 *
 * The third is the one worth having. A running balance is a window function
 * over an order, and it is wrong in a way that looks right: every figure is
 * plausible, and only the arithmetic between them gives it away.
 */
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

// The folder this script sits in — the repository root — wherever it is
// checked out. It named one machine's path, and failed on every other.
const REPO = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "");
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

const balances = (
  await c.query(`
    select a.id, a.name,
           a.opening_balance::numeric
             + coalesce(sum(t.signed_amount::numeric) filter (where t.voided_at is null), 0) as closing
      from accounts a
      left join transactions t on t.account_id = a.id
     where a.deleted_at is null
     group by a.id, a.name
     order by a.name`)
).rows;

/*
 * What Cash In shows: one month's money in, not voided, and not a transfer
 * between the company's own accounts (those land as money in too, but nobody
 * sent them). The month with the most receipts, so there is something to
 * count; summed in SQL, never in floats.
 */
const cashIn = (
  await c.query(`
    select to_char(txn_date, 'YYYY-MM') as month,
           count(*)::int as n,
           sum(amount)::numeric(14,2)::text as total
      from transactions
     where direction = 'in' and voided_at is null and transfer_group_id is null
     group by 1
     order by n desc, month desc
     limit 1`)
).rows[0];

/*
 * The register's running balance, worked out by the database over every entry
 * oldest first — then turned round, because the page lists newest first. Row
 * one on the page is the newest entry, and its balance is the account's
 * closing figure.
 */
const account = (
  await c.query(`
    select a.id, a.name
      from accounts a
      join transactions t on t.account_id = a.id and t.voided_at is null
     where a.deleted_at is null
     group by a.id, a.name
     order by count(t.id) desc
     limit 1`)
).rows[0];
const register = account
  ? (
      await c.query(
        `select a.opening_balance::numeric
                  + sum(t.signed_amount::numeric) over (
                      order by t.txn_date, t.created_at
                      rows between unbounded preceding and current row
                    ) as balance
           from transactions t
           join accounts a on a.id = t.account_id
          where t.account_id = $1 and t.voided_at is null
          order by t.txn_date desc, t.created_at desc`,
        [account.id],
      )
    ).rows.map((r) => Number(r.balance))
  : [];
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

const amount = (s) => {
  const negative = /[-\u2212]/.test(String(s));
  const n = Number(String(s).replace(/[^0-9.]/g, ""));
  return negative ? -n : n;
};

/* ---- 1. every balance on the list ------------------------------------- */
await page
  .goto("http://localhost:3000/accounts", { waitUntil: "networkidle0", timeout: 120000 })
  .catch(() => {});
await new Promise((r) => setTimeout(r, 2200));
/*
 * Each account's OWN card, found by the name in its title \u2014 not by searching
 * the page text for the name, which on these cards also appears as another
 * account's bank ("Standard Chartered Bank" under M/S. EXPROVIA) and read that
 * card's figures instead. The taka figure is the one with the \u09f3.
 */
const cards = await page.evaluate(() =>
  // By the card's own hooks since the cards became drawn bank cards (#105).
  [...document.querySelectorAll("main [data-account-id]")]
    .map((card) => ({
      name: card.querySelector("[data-account-name]")?.textContent.trim(),
      taka: [...card.querySelectorAll(".col-amount")]
        .map((el) => el.textContent.trim())
        .find((text) => text.includes("\u09f3")),
    })),
);

console.log("--- /accounts: each balance against the ledger");
let failures = 0;
let wrong = 0;
for (const b of balances) {
  const card = cards.find((c) => c.name === b.name);
  if (!card || !card.taka) {
    console.log(`   ${b.name}: no card with a taka figure on the page`);
    wrong += 1;
    continue;
  }
  const want = Number(b.closing);
  if (Math.abs(amount(card.taka) - want) > 0.005) {
    console.log(`   ${b.name}: ledger ${want.toFixed(2)}, its card shows ${card.taka}`);
    wrong += 1;
  }
}
failures += wrong;
console.log(
  wrong === 0 ? "   all " + balances.length + " match" : `   ${wrong} disagree`,
);

/* ---- 2. Cash In: the month's receipts, and their total ------------------ */
console.log("\n--- /accounts/cash-in");
if (!cashIn) {
  console.log("   SKIPPED — the ledger holds no receipts to count");
} else {
  await page
    .goto("http://localhost:3000/accounts/cash-in", { waitUntil: "networkidle0", timeout: 120000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  // The month picker's options are the first day of each month.
  const picked = await page.evaluate((month) => {
    const select = document.querySelector('select[aria-label="Month"]');
    const option = [...(select?.options ?? [])].find((o) => o.value.startsWith(month));
    return option ? option.value : null;
  }, cashIn.month);
  if (!picked) {
    console.log(`   ${cashIn.month} is not offered in the month picker`);
    failures += 1;
  } else {
    await page.select('select[aria-label="Month"]', picked);
    await new Promise((r) => setTimeout(r, 2500));
    const cash = await page.evaluate(() => {
      const text = document.body.innerText;
      const pager = /Page\s+\d+\s+of\s+\d+\s+\u00b7\s+([\d,]+)\s+entr/i.exec(text);
      const rows = document.querySelectorAll(".table-data tbody tr.row-finance").length;
      const band = [...document.querySelectorAll("main .sv-card")].find((el) =>
        /Received in/i.test(el.innerText),
      );
      const figure = band?.querySelector(".text-right p")?.innerText ?? "";
      return { count: pager ? Number(pager[1].replace(/,/g, "")) : rows, figure };
    });
    const total = amount(cash.figure);
    const want = Number(cashIn.total);
    console.log(
      `   ${cashIn.month}: ledger ${cashIn.n} receipt(s), ৳${want.toFixed(2)}; the page ${cash.count}, ${cash.figure}`,
    );
    if (cash.count !== cashIn.n) {
      console.log("   the count disagrees");
      failures += 1;
    }
    if (Math.abs(total - want) > 0.005) {
      console.log("   the total disagrees");
      failures += 1;
    }
  }
}

/* ---- 3. the register's running balance --------------------------------- */
if (!account) {
  console.log("\n--- register: SKIPPED — no account has an entry");
} else {
  await page
    .goto(`http://localhost:3000/accounts/${account.id}/register`, {
      waitUntil: "networkidle0",
      timeout: 120000,
    })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 2200));
  const shown = await page.evaluate(() => {
    const t = document.querySelector(".table-data");
    if (!t) return [];
    const heads = [...t.querySelectorAll("thead th")].map((h) => h.textContent.trim());
    const col = heads.findIndex((h) => /balance/i.test(h));
    if (col === -1) return [];
    return [...t.querySelectorAll("tbody tr.row-finance")].map(
      (r) => (r.children[col]?.innerText || "").trim().split("\n")[0],
    );
  });

  console.log(`\n--- register (${account.name}): does the running balance run?`);
  if (shown.length === 0) {
    console.log("   no balance column found");
    failures += 1;
  } else {
    let bad = 0;
    const n = Math.min(shown.length, register.length);
    for (let i = 0; i < n; i += 1) {
      const onPage = amount(shown[i]);
      if (Math.abs(onPage - register[i]) > 0.005) {
        if (bad < 3) {
          console.log(
            `   row ${i + 1}: ledger says ${register[i].toFixed(2)}, page says ${onPage.toFixed(2)}`,
          );
        }
        bad += 1;
      }
    }
    failures += bad;
    console.log(
      bad === 0
        ? `   all ${n} rows on the first page carry the balance the ledger does, newest first`
        : `   ${bad} row(s) do not follow`,
    );
  }
}

await browser.close();
console.log(failures === 0 ? "\nOK — every check passed." : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
