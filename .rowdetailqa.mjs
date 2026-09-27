/**
 * No Description column, and a row that opens its whole record.
 *
 * The owner: "site er table gulate descriptions name je field ta ache oita onek
 * boro hoye jacche so ami cai prottekta table theke description ta soriye niba.
 * also table item gula clickable hobe jegulay click korle popup open hoye puro
 * data dekhabe jegula hide thakbe."
 *
 * On every table that had a Description column — All transactions, a heading
 * page and a register (which draw the same table), Cash In, Other expenses,
 * Money Transfer, the bank statement — this reads what was painted:
 *
 *   - no heading reads "Description";
 *   - a click on a row opens ONE popup, and its title is that row's
 *     description as the API has it (so the popup is the row that was clicked,
 *     not merely a popup);
 *   - the popup carries the Description, the Amount and the Date;
 *   - Escape closes it;
 *   - a click on a link or a row button inside the row does NOT open it;
 *   - Enter on a focused row opens it, for a keyboard.
 *
 *     node .rowdetailqa.mjs      (local only — reads, writes nothing)
 *
 * Needs `npm run dev` running (web :3000, api :4001), and the local books to
 * hold at least one entry in the month it picks.
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB ?? "http://localhost:3000";

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
const one = async (sql) => (await db.query(sql)).rows[0];
const admin = await one(
  `select id, role, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`,
);
// The account with the most live entries, for its register and statement.
const busy = await one(
  `select account_id as id from transactions where voided_at is null group by account_id order by count(*) desc limit 1`,
);
// A month that has a receipt (Cash In) and one that has other spending.
const cashMonth = await one(
  `select to_char(txn_date, 'YYYY-MM') as m from transactions
    where direction = 'in' and voided_at is null and transfer_group_id is null
    group by 1 order by count(*) desc, 1 desc limit 1`,
);
const outMonth = await one(
  `select to_char(txn_date, 'YYYY-MM') as m from transactions
    where direction = 'out' and voided_at is null and transfer_group_id is null
    group by 1 order by count(*) desc, 1 desc limit 1`,
);
// A heading with entries, for its own page.
// A heading with entries, and the month they are in — its page opens on the
// current month otherwise, which may hold none.
const heading = await one(
  `select h.slug, to_char(t.txn_date, 'YYYY-MM') as m,
          to_char((date_trunc('month', t.txn_date) + interval '1 month - 1 day')::date, 'YYYY-MM-DD') as last
     from transactions t
     join categories c on c.id = t.category_id
     join categories h on h.id = coalesce(c.parent_id, c.id)
    where t.voided_at is null and t.direction = 'out' and h.deleted_at is null
    group by h.slug, 2, 3 order by count(*) desc limit 1`,
);
await db.end();
const token = jwt.sign({ sub: admin.id, role: admin.role, tv: admin.token_version }, env.JWT_ACCESS_SECRET, {
  expiresIn: "1h",
});

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.createBrowserContext();
await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await context.newPage();
await page.setViewport({ width: 1440, height: 900 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
// A failed request names its address, so a 500 says where it came from.
page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const open = async (path) => {
  await page.goto(`${WEB}${path}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(900);
};
const api = (path) =>
  page.evaluate(async (path) => {
    const r = await fetch(`/api${path}`, { credentials: "include", headers: { "X-Requested-With": "finance-web" } });
    return r.json();
  }, path);

const popups = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-popup]")].map((p) => ({
      title: p.querySelector("h2")?.textContent.trim(),
      text: p.innerText,
    })),
  );

/** Everything the checks need from one screen, given the descriptions the
 *  API says its rows carry. */
async function screen(label, descriptions) {
  console.log(`\n${label}`);
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll("main .table-data thead th")].map((th) => th.textContent.trim().toLowerCase()),
  );
  check("no Description column", heads.length > 0 && !heads.includes("description"), heads.join(" | "));

  const rows = await page.$$("main .table-data tbody tr[data-row-open]");
  check("its rows open their details", rows.length > 0, `${rows.length} clickable row(s)`);
  if (!rows.length) return;

  // A click in the middle of the row — on its date cell, not a control.
  const dateCell = await rows[0].$("td:nth-child(3)");
  await (dateCell ?? rows[0]).click();
  await settle(700);
  let shown = await popups();
  check(
    "a click opens one popup, titled with that row's description",
    shown.length === 1 && descriptions.includes(shown[0].title),
    shown.map((p) => p.title).join(" / ") || "no popup",
  );
  check(
    "it carries the description, the amount and the date",
    shown.length === 1 && /Description/.test(shown[0].text) && /Amount/.test(shown[0].text) && /Date/.test(shown[0].text),
  );
  await page.keyboard.press("Escape");
  await settle(400);
  check("Escape closes it", (await popups()).length === 0);

  // A link or a row button inside the row keeps its own click.
  const control = await rows[0].$("a[href], td:last-child button");
  if (control) {
    const isLink = await control.evaluate((el) => el.tagName === "A");
    if (isLink) {
      // Stop the navigation so the check reads the same page.
      await page.evaluate(() => {
        document.addEventListener("click", (e) => e.target.closest("a") && e.preventDefault(), { capture: true, once: true });
      });
    }
    await control.click();
    await settle(700);
    const after = await popups();
    check(
      `a click on a ${isLink ? "link" : "row button"} inside it does not open the details`,
      after.every((p) => !descriptions.includes(p.title)),
      after.map((p) => p.title).join(" / ") || "nothing opened",
    );
    await page.keyboard.press("Escape");
    await settle(400);
  }

  // The keyboard.
  await rows[0].focus();
  await page.keyboard.press("Enter");
  await settle(600);
  shown = await popups();
  check("Enter on a focused row opens it", shown.length === 1 && descriptions.includes(shown[0].title));
  await page.keyboard.press("Escape");
  await settle(300);
}

try {
  /* All transactions */
  await open("/transactions");
  const all = await api("/transactions?page=1&pageSize=20");
  await screen("/transactions", (all.items ?? []).map((r) => r.description));

  /* A heading's own page */
  if (heading) {
    await open(`/expenses/${heading.slug}?from=${heading.m}-01&to=${heading.last}`);
    const list = await api("/transactions?page=1&pageSize=200&direction=out");
    await screen(`/expenses/${heading.slug}`, (list.items ?? []).map((r) => r.description));
  }

  /* A register */
  if (busy) {
    await open(`/accounts/${busy.id}/register`);
    const reg = await api(`/accounts/${busy.id}/register`);
    await screen("/accounts/:id/register", (reg.rows ?? []).map((r) => r.description));
  }

  /* Cash In, at the month with receipts */
  if (cashMonth) {
    await open("/accounts/cash-in");
    await page.select('select[aria-label="Month"]', `${cashMonth.m}-01`);
    await settle(2500);
    const list = await api(`/transactions?page=1&pageSize=200&direction=in`);
    await screen(`/accounts/cash-in (${cashMonth.m})`, (list.items ?? []).map((r) => r.description));
  }

  /* Other expenses, at the month with spending */
  if (outMonth) {
    await open("/expenses/other");
    await page.select('select[aria-label="Month"]', `${outMonth.m}-01`);
    await settle(2500);
    const list = await api(`/transactions?page=1&pageSize=200&direction=out`);
    await screen(`/expenses/other (${outMonth.m})`, (list.items ?? []).map((r) => r.description));
  }

  /* Money Transfer */
  await open("/transfers");
  const transfers = await api("/transactions/transfers?page=1&pageSize=20");
  await screen("/transfers", (transfers.items ?? []).map((r) => r.description));

  /* The bank statement */
  if (busy) {
    await open(`/statement?account=${busy.id}`);
    const reg = await api(`/accounts/${busy.id}/register`);
    await screen("/statement", (reg.rows ?? []).map((r) => r.description));
  }

  check("no console errors on any of it", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
