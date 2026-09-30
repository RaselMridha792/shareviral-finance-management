/**
 * The HR Budget page, in a browser (#121). The data arrives the way it will
 * in life — sent through the API as the HR role — and every decision made on
 * the page is read back from the database, not from the screen.
 *
 *   - the rail: People → HR Budget for the finance roles and the CEO; not for
 *     HR, whose URL is turned away;
 *   - Spends: a spend for a person not linked yet says so; a spend whose
 *     budget has not arrived says so; a row opens its record;
 *   - approve from the record, pay from the row — account, heading, rate —
 *     and the expense lands in the books; refuse with a note, which HR then
 *     reads back;
 *   - Budgets: spent, paid and left summed; approve from the row; "See its
 *     spends" narrows the spends to it;
 *   - the CEO reads it all and can act on none of it;
 *   - nothing scrolls sideways, at 1440 or on a phone; no errors.
 *
 *     node .hrbudgetuiqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .hrbudgetuiqa.mjs   also saves screenshots
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const API = "http://localhost:4001/api";
const SHOTS = process.env.SHOT_DIR || null;
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
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const who = async (role) =>
  (await q(`select id, role, token_version from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role]))[0];
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const users = { super_admin: await who("super_admin"), cfo: await who("cfo"), ceo: await who("ceo"), hr: await who("hr") };
const finance = users.cfo ?? users.super_admin;
const api = (user) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const MARK = `HRBUI${Date.now().toString(36)}`;
const PERIOD = crypto.randomUUID();
const S1 = crypto.randomUUID();
const S2 = crypto.randomUUID();
const spendBody = (over) => ({
  budgetExternalId: PERIOD,
  spentOn: "2026-09-14",
  amount: "1250.50",
  teamMemberId: null,
  employeeName: "Rasel Sarker",
  hrStatus: "approved",
  hrApprovedByName: "Nusrat (HR)",
  hrApprovedAt: "2026-09-14T15:00:00+06:00",
  recordedByName: "Nusrat (HR)",
  hasReceipt: true,
  ...over,
});

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, url = "/hr-budget", width = 1440) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Encountered two children/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(900);
  return { page, context };
};
const search = async (page, text) => {
  const box = await page.$("input[placeholder^='Purpose'], input[placeholder^='Category']");
  await box.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await box.type(text);
  await settle(1100);
};
const rowOf = (page, text) =>
  page.evaluateHandle((t) => [...document.querySelectorAll("tr[data-row-id]")].find((tr) => tr.textContent.includes(t)) ?? null, text);

let txnId = null;
try {
  /* ------------------------------------------------------------------ */
  console.log("\nSent in as HR would send them");
  const hr = api(users.hr);
  const p = await hr("POST", "/hr-budget/periods", { externalId: PERIOD, categoryName: `${MARK} Equipment`, startsOn: "2026-09-01", endsOn: "2026-10-31", amount: "50000", note: "Laptops and bags", recordedByName: "Nusrat (HR)" });
  const s1 = await hr("POST", "/hr-budget/spends", spendBody({ externalId: S1, purpose: `${MARK} Laptop bags` }));
  const s2 = await hr("POST", "/hr-budget/spends", spendBody({ externalId: S2, budgetExternalId: crypto.randomUUID(), purpose: `${MARK} Team lunch`, amount: "4200", employeeName: null, hasReceipt: false }));
  check("a budget and two spends arrive", p.status === 201 && s1.status === 201 && s2.status === 201, `${p.status}/${s1.status}/${s2.status}`);

  /* ------------------------------------------------------------------ */
  console.log("\nThe rail, and who sees it");
  for (const [role, sees] of [["super_admin", true], ["cfo", true], ["ceo", true], ["hr", false]]) {
    if (!users[role]) continue;
    const { page, context } = await open(users[role], "/");
    const rail = await page.evaluate(() => {
      const links = [...document.querySelectorAll("aside a, aside button")].map((el) => el.textContent.trim());
      return { has: links.includes("HR Budget"), afterPayroll: links.indexOf("HR Budget") > links.indexOf("Payroll & Bank") };
    });
    await page.goto(`${WEB}/hr-budget`, { waitUntil: "networkidle0" });
    const landed = new URL(page.url()).pathname;
    check(`${role}: ${sees ? "HR Budget under People, and it opens" : "no HR Budget, the URL turned away"}`, sees ? rail.has && rail.afterPayroll && landed === "/hr-budget" : !rail.has && landed === "/no-access", `${JSON.stringify(rail)} ${landed}`);
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nSpends");
  const { page, context } = await open(finance);
  await search(page, MARK);
  const rows = await page.evaluate(() => [...document.querySelectorAll("tr[data-row-id]")].map((tr) => [...tr.children].map((td) => td.textContent.trim())));
  const bags = rows.find((r) => r[2].includes("Laptop bags"));
  const lunch = rows.find((r) => r[2].includes("Team lunch"));
  check("both spends listed, waiting", rows.length === 2 && bags?.[8] === "Waiting" && lunch?.[8] === "Waiting", JSON.stringify(rows.map((r) => r[8])));
  check("a person not linked yet says so; a budget not here yet says so", bags?.[3] === "Rasel SarkerNot linked yet" && lunch?.[4] === "Budget not here yet", `${bags?.[3]} | ${lunch?.[4]}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "hrb-spends.png") });

  // Approve from the record.
  await (await rowOf(page, "Laptop bags")).asElement().click();
  await page.waitForSelector("[data-popup] [data-hrb-approve]", { timeout: 10000 });
  const popupTitle = await page.evaluate(() => document.querySelector("[data-popup] h2")?.textContent);
  await page.click("[data-popup] [data-hrb-approve]");
  await page.waitForSelector("[data-hrb-submit]", { timeout: 10000 });
  await page.type("[data-hrb-field='note']", "Within the budget");
  await page.click("[data-hrb-submit]");
  await settle(1800);
  let s1row = (await q(`select status, status_note, decided_by::text by from hr_budget_spends where external_id = $1`, [S1]))[0];
  check("a row opens its record; Approve there approves it (read back)", popupTitle === `${MARK} Laptop bags` && s1row?.status === "approved" && s1row?.status_note === "Within the budget" && s1row?.by === finance.id, JSON.stringify(s1row));

  // Pay from the row.
  await page.evaluate((t) => [...document.querySelectorAll("tr[data-row-id]")].find((tr) => tr.textContent.includes(t)).querySelector("button[aria-label^='Pay']").click(), "Laptop bags");
  await page.waitForSelector("[data-hrb-field='account']", { timeout: 10000 });
  const account = await page.evaluate(() => {
    const select = document.querySelector("[data-hrb-field='account']");
    return select.value;
  });
  await page.click("[data-popup] [role='combobox']");
  await settle(300);
  const optionCount = await page.evaluate(() => document.querySelectorAll("[role='option']").length);
  await page.click("[role='option']");
  await settle(200);
  const picked = await page.evaluate(() => document.querySelector("[data-popup] [role='combobox']")?.textContent?.trim());
  // The rate starts at the latest on file; this database may have none, and
  // then the box asks for one like every entry in the app does.
  const rateBox = await page.$("[data-hrb-field='rate']");
  if (!(await rateBox.evaluate((el) => el.value))) await rateBox.type("121.50");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "hrb-pay-before.png") });
  await page.click("[data-hrb-submit]");
  await settle(2500);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "hrb-pay-after.png") });
  console.log("   (pay drawer: options", optionCount, "picked", JSON.stringify(picked), ")");
  s1row = (await q(`select status, paid_on::text po, transaction_id::text txn from hr_budget_spends where external_id = $1`, [S1]))[0];
  txnId = s1row?.txn;
  const txn = txnId ? (await q(`select direction::text d, amount::text amt, account_id::text acc, description from transactions where id = $1`, [txnId]))[0] : null;
  const payError = await page.evaluate(() => document.querySelector("[data-hrb-error]")?.textContent ?? null);
  check("Pay from the row: paid, and the expense is in the books from the chosen account", s1row?.status === "paid" && Boolean(s1row?.po) && txn?.d === "out" && txn?.amt === "1250.50" && txn?.acc === account && txn?.description === `HR: ${MARK} Laptop bags`, `${JSON.stringify(s1row)} ${JSON.stringify(txn)} ${payError ?? ""}`);

  // Refuse from the row, with a note — once the list has reloaded after paying.
  await page.waitForFunction((t) => [...document.querySelectorAll("tr[data-row-id]")].some((tr) => tr.textContent.includes(t)), { timeout: 15000 }, "Team lunch");
  await page.evaluate((t) => [...document.querySelectorAll("tr[data-row-id]")].find((tr) => tr.textContent.includes(t)).querySelector("button[aria-label^='Refuse']").click(), "Team lunch");
  await page.waitForSelector("[data-hrb-field='note']", { timeout: 10000 });
  await page.click("[data-hrb-submit]");
  await settle(700);
  const stillOpen = Boolean(await page.$("[data-hrb-field='note']"));
  await page.type("[data-hrb-field='note']", "Not a budget line — pay from petty cash");
  await page.click("[data-hrb-submit]");
  await settle(1800);
  const s2row = (await q(`select status, status_note from hr_budget_spends where external_id = $1`, [S2]))[0];
  check("Refuse asks why before it goes; then refused, with the note (read back)", stillOpen && s2row?.status === "refused" && s2row?.status_note === "Not a budget line — pay from petty cash", JSON.stringify(s2row));

  const badges = await page.evaluate(() => [...document.querySelectorAll("tr[data-row-id]")].map((tr) => tr.children[8].textContent.trim()).sort());
  check("the list shows it: Paid, Refused", JSON.stringify(badges) === JSON.stringify(["Paid", "Refused"]), badges.join(", "));

  const back = await hr("GET", `/hr-budget/spends/status?externalIds=${S1},${S2}`);
  const byId = Object.fromEntries((back.body ?? []).map((s) => [s.externalId, s]));
  check("HR reads it back: paid with its day, refused with the note", byId[S1]?.status === "paid" && byId[S1]?.paidOn === s1row?.po && byId[S2]?.status === "refused" && byId[S2]?.statusNote === "Not a budget line — pay from petty cash", JSON.stringify(back.body));

  /* ------------------------------------------------------------------ */
  console.log("\nBudgets");
  await page.evaluate(() => [...document.querySelectorAll("[role='tab']")].find((b) => b.textContent.trim() === "Budgets").click());
  await settle(1200);
  await search(page, MARK);
  const budget = await page.evaluate(() => [...(document.querySelector("tr[data-row-id]")?.children ?? [])].map((td) => td.textContent.trim()));
  check("the budget: spent, paid and left from its spends (the refused lunch was another budget's)", budget[1] === `${MARK} Equipment` && budget[3] === "৳50,000.00" && budget[4] === "৳1,250.50" && budget[5] === "৳1,250.50" && budget[6] === "৳48,749.50" && budget[7] === "1" && budget[8] === "Waiting", JSON.stringify(budget));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "hrb-budgets.png") });
  await page.evaluate(() => document.querySelector("tr[data-row-id] button[aria-label^='Approve']").click());
  await page.waitForSelector("[data-hrb-submit]", { timeout: 10000 });
  await page.click("[data-hrb-submit]");
  await settle(1800);
  const prow = (await q(`select status from hr_budget_periods where external_id = $1`, [PERIOD]))[0];
  check("approve the budget from its row (read back)", prow?.status === "approved", prow?.status);

  await page.click("tr[data-row-id] td:nth-child(2)");
  await page.waitForSelector("[data-hrb-see-spends]", { timeout: 10000 });
  await page.click("[data-hrb-see-spends]");
  await settle(1500);
  const narrowed = await page.evaluate(() => ({
    rows: [...document.querySelectorAll("tr[data-row-id]")].map((tr) => tr.children[2].textContent.trim()),
    tab: [...document.querySelectorAll("[role='tab'][aria-selected='true']")].map((b) => b.textContent.trim()),
  }));
  check("See its spends: the Spends tab, narrowed to that budget", narrowed.rows.length === 1 && narrowed.rows[0] === `${MARK} Laptop bags` && narrowed.tab.includes("Spends"), JSON.stringify(narrowed));
  const fitsAt = async () =>
    page.evaluate(() => {
      const box = document.querySelector("tr[data-row-id]")?.closest(".overflow-x-auto");
      return document.documentElement.scrollWidth <= window.innerWidth && Boolean(box) && box.scrollWidth <= box.clientWidth;
    });
  const spendsFit = await fitsAt();
  await page.evaluate(() => [...document.querySelectorAll("[role='tab']")].find((b) => b.textContent.trim() === "Budgets").click());
  await settle(1200);
  const budgetsFit = await fitsAt();
  check("at 1440 neither table scrolls sideways — every row's buttons in view", spendsFit && budgetsFit, JSON.stringify({ spendsFit, budgetsFit }));
  await context.close();

  /* ------------------------------------------------------------------ */
  console.log("\nThe CEO reads, and acts on nothing");
  if (users.ceo) {
    const c = await open(users.ceo);
    await search(c.page, MARK);
    const ceoView = await c.page.evaluate(() => ({
      rows: document.querySelectorAll("tr[data-row-id]").length,
      buttons: document.querySelectorAll("tr[data-row-id] button").length,
    }));
    await c.page.click("tr[data-row-id] td:nth-child(3)");
    await settle(700);
    const popupButtons = await c.page.evaluate(() => document.querySelectorAll("[data-popup] [data-hrb-approve], [data-popup] [data-hrb-pay], [data-popup] [data-hrb-refuse]").length);
    check("the CEO sees the rows and their records, with no button to act", ceoView.rows === 2 && ceoView.buttons === 0 && popupButtons === 0, JSON.stringify({ ...ceoView, popupButtons }));
    await c.context.close();
  }

  const phone = await open(finance, "/hr-budget", 390);
  const fits = await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("at 390px nothing scrolls sideways", fits);
  await phone.context.close();

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  if (txnId) {
    const admin = api(users.super_admin);
    await admin("POST", `/trash/transaction/${txnId}`, { reason: "harness" });
    await admin("DELETE", `/trash/transaction/${txnId}`);
  }
  const ids = (await q(`select id::text from hr_budget_periods where category_name like $1 union all select id::text from hr_budget_spends where purpose like $1`, [`${MARK}%`])).map((r) => r.id);
  await q(`delete from audit_logs where entity_id::text = any($1)`, [ids]);
  await q(`delete from hr_budget_spends where purpose like $1`, [`${MARK}%`]);
  await q(`delete from hr_budget_periods where category_name like $1`, [`${MARK}%`]);
  const left = (await q(`select (select count(*) from hr_budget_periods where category_name like $1)::int + (select count(*) from hr_budget_spends where purpose like $1)::int as n`, [`${MARK}%`]))[0].n;
  check("cleaned up", left === 0 && (!txnId || (await q(`select count(*)::int n from transactions where id = $1`, [txnId]))[0].n === 0));
  await db.end();
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
