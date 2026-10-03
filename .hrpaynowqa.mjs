/**
 * HR Requests — approve a spend, then pay now or later; a To pay tab
 * (docs/briefs/2026-10-03-hr-requests-pay-now.md).
 *
 * The owner, 3 Oct 2026: "jokhon aprove korbe tokhon etake multi-step forms
 * banano jay tokhoni option dibe pay now or pay letter ... opore jekhane
 * filters gula ache oikhane to pay name ekta tab rakha jete pare".
 *
 *   A. the API: `state=to_pay` lists spends approved and not paid, `counts`
 *      carries `to_pay`, and Approved still lists every approval;
 *   B. approve a spend in the browser → step 2 → Pay now → the Pay drawer →
 *      paid: the spend is paid, the ledger has the expense, the row says Paid;
 *   C. approve another → Pay later → it is on To pay with its count, and
 *      paying it from there works as before;
 *   D. step 2 closed with Escape is Pay later; Pay now then Cancel leaves it
 *      approved, on To pay, and says so;
 *   E. a pay change's approval is still one step;
 *   F. the six tabs in order, and nothing scrolls sideways at 1440 or 390.
 *
 *     node .hrpaynowqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .hrpaynowqa.mjs   also saves screenshots
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
  (await q(`select id, role, token_version, full_name from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role]))[0];
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const users = { super_admin: await who("super_admin"), cfo: await who("cfo"), hr: await who("hr") };
const as = (user) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const hr = as(users.hr);
const decider = users.cfo ?? users.super_admin;
const fin = as(decider);
const admin = as(users.super_admin);

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const msg = (r) => `${r.status} ${r.body?.message ?? ""} ${JSON.stringify(r.body?.errors ?? "")}`.slice(0, 300);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await settle(250);
  }
};

const MARK = `HRPN${Date.now().toString(36)}`;
const YEAR = 2035;
const PB = crypto.randomUUID();
const S = { now: crypto.randomUUID(), later: crypto.randomUUID(), esc: crypto.randomUUID(), cancel: crypto.randomUUID() };
const PURPOSE = { now: `${MARK} Course fees`, later: `${MARK} Team lunch`, esc: `${MARK} Taxi`, cancel: `${MARK} Printer ink` };
const PC = crypto.randomUUID();
const txnIds = [];

async function wipe() {
  const members = (await q(`select id from team_members where full_name like $1`, [`${MARK} %`])).map((r) => r.id);
  const reqIds = members.length ? (await q(`select id::text from compensation_requests where team_member_id = any($1::uuid[])`, [members])).map((r) => r.id) : [];
  const budgetIds = (await q(`select id::text from hr_budget_periods where category_name like $1 union all select id::text from hr_budget_spends where purpose like $1`, [`${MARK}%`])).map((r) => r.id);
  const ids = [...members, ...reqIds, ...budgetIds];
  if (ids.length) await q(`delete from audit_logs where entity_id::text = any($1)`, [ids]);
  await q(`delete from notifications where title like $1 or body like $1`, [`%${MARK}%`]);
  await q(`delete from hr_budget_spends where purpose like $1`, [`${MARK}%`]);
  await q(`delete from hr_budget_periods where category_name like $1`, [`${MARK}%`]);
  if (members.length) {
    await q(`delete from compensation_requests where team_member_id = any($1::uuid[])`, [members]);
    await q(`delete from compensation_history where team_member_id = any($1::uuid[])`, [members]);
    await q(`delete from team_members where id = any($1::uuid[])`, [members]);
  }
}

const spendBody = (key, amount) => ({
  externalId: S[key],
  budgetExternalId: PB,
  spentOn: `${YEAR}-03-10`,
  amount,
  purpose: PURPOSE[key],
  teamMemberId: null,
  employeeName: "Anika Rahman",
  hrStatus: "approved",
  hrApprovedByName: "Karim (HR head)",
  hrApprovedAt: `${YEAR}-03-10T10:00:00+06:00`,
  recordedByName: "Nusrat (HR)",
  hasReceipt: true,
});
const spendRow = async (key) =>
  (await q(`select id::text, status, transaction_id::text txn, paid_on::text paid_on from hr_budget_spends where external_id = $1`, [S[key]]))[0];
const list = async (state) => (await fin("GET", `/hr-requests?state=${state}&q=${MARK}`)).body;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, url, width = 1440) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Encountered two children|status of 409/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  return { page, context };
};
const search = async (page, text) => {
  const box = await page.waitForSelector("input[placeholder^='Person']");
  await box.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await box.type(text);
};
const rowOf = async (page, key) => {
  const id = (await spendRow(key)).id;
  await page.waitForSelector(`tr[data-hrr-row='${id}']`, { timeout: 15000 });
  return id;
};
const clickRowButton = async (page, id, label) => {
  await page.evaluate(
    (rowId, word) => document.querySelector(`tr[data-hrr-row='${rowId}'] button[aria-label^='${word}:']`).click(),
    id,
    label,
  );
};
const tab = async (page, label) => {
  await page.evaluate((word) => [...document.querySelectorAll("[role='tab']")].find((t) => t.textContent.trim().startsWith(word)).click(), label);
};
const tabs = (page) => page.evaluate(() => [...document.querySelectorAll("[role='tab']")].map((t) => t.textContent.replace(/\s+/g, " ").trim()));
const toastMatching = (page, re) => until(() => page.evaluate((source) => document.body.textContent.match(new RegExp(source))?.[0] ?? null, re.source));
/* The Pay drawer: a heading and a rate; the account is the first, as on the page. */
const fillPay = async (page) => {
  await page.waitForSelector("[data-hrb-field='account']", { timeout: 10000 });
  await page.click("[data-popup] [role='combobox']");
  await page.waitForSelector("[role='option']", { timeout: 5000 });
  await page.click("[role='option']");
  await settle(200);
  const rateBox = await page.$("[data-hrb-field='rate']");
  if (!(await rateBox.evaluate((el) => el.value))) await rateBox.type("121.50");
};

try {
  await wipe();
  const period = await hr("POST", "/hr-budget/periods", { externalId: PB, categoryName: `${MARK} Training`, startsOn: `${YEAR}-03-01`, endsOn: `${YEAR}-06-30`, amount: "100000", note: null, recordedByName: "Nusrat (HR)" });
  const made = [];
  for (const [key, amount] of [["now", "150.00"], ["later", "120.50"], ["esc", "90.00"], ["cancel", "75.25"]]) {
    made.push((await hr("POST", "/hr-budget/spends", spendBody(key, amount))).status);
  }
  const pbId = (await q(`select id::text from hr_budget_periods where external_id = $1`, [PB]))[0]?.id;
  await fin("POST", `/hr-requests/budget/${pbId}/decision`, { decision: "approved" });
  if (period.status !== 201 || made.some((s) => s !== 201)) throw new Error(`fixtures: ${period.status} ${made}`);

  const member = await fin("POST", "/team-members", { fullName: `${MARK} Bashir Ahmed`, joinedOn: `${YEAR}-01-01`, joiningSalary: "40000" });
  if (member.status !== 201) throw new Error(`member: ${msg(member)}`);
  const pc = await hr("POST", "/hr-requests/pay-changes", {
    externalId: PC,
    teamMemberId: member.body.id,
    grossAmount: "45000.00",
    effectiveFrom: `${YEAR}-05-01`,
    changeReason: "Annual review",
    hrNote: `${MARK} review`,
    requestedByName: "Nusrat (HR)",
    hrApprovedByName: null,
    hrApprovedAt: null,
  });
  if (pc.status !== 201) throw new Error(`pay change: ${msg(pc)}`);

  /* ------------------------------------------------------------------ */
  console.log("\nA. The API's To pay");
  {
    const before = await list("to_pay");
    check("before any approval: To pay is empty and counted 0; four spends wait", before?.counts?.to_pay === 0 && before?.items?.length === 0 && before?.counts?.waiting === 5, JSON.stringify(before?.counts));
    const laterId = (await spendRow("later")).id;
    const ok = await fin("POST", `/hr-requests/spend/${laterId}/decision`, { decision: "approved" });
    const after = await list("to_pay");
    check("a spend approved by the API is on To pay, counted 1", ok.status === 200 || ok.status === 201 ? after?.counts?.to_pay === 1 && after?.items?.[0]?.id === laterId && after?.items?.[0]?.paid === false : false, `${msg(ok)} ${JSON.stringify(after?.counts)}`);
    await fin("POST", `/hr-requests/spend/${laterId}/decision`, { decision: "received" });
    const back = await list("to_pay");
    check("put back to waiting, it leaves To pay", back?.counts?.to_pay === 0, JSON.stringify(back?.counts));
    const bad = await fin("GET", `/hr-requests?state=to_paid`);
    check("a state the API does not know is a 400", bad.status === 400, String(bad.status));
    const spendsOnly = await fin("GET", `/hr-requests?state=to_pay&kind=pay_change&q=${MARK}`);
    check("To pay with another kind chosen is empty, not an error", spendsOnly.status === 200 && spendsOnly.body?.total === 0, msg(spendsOnly));
  }

  /* ------------------------------------------------------------------ */
  console.log("\nB. Approve → Pay now → paid");
  {
    const { page, context } = await open(decider, "/hr-requests");
    const order = await tabs(page);
    check(
      "the tabs: Waiting, To pay, Approved, Rejected, Withdrawn, All",
      order.map((t) => t.replace(/\s*\d+$/, "")).join("|") === "Waiting|To pay|Approved|Rejected|Withdrawn|All",
      order.join(" | "),
    );
    await search(page, MARK);
    const id = await rowOf(page, "now");
    await clickRowButton(page, id, "Approve");
    await page.waitForSelector("[data-hrr-submit]", { timeout: 10000 });
    const step1 = await page.evaluate(() => ({
      steps: document.querySelector("[data-hrr-steps]")?.getAttribute("data-hrr-steps") ?? null,
      words: document.querySelector("[data-hrr-consequence]")?.textContent ?? "",
    }));
    check("step 1 is the approval, marked step 1 of 2, and says what comes next", step1.steps === "1" && /pay it now, or later from To pay/.test(step1.words), JSON.stringify(step1));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "paynow-step1.png") });
    await page.click("[data-hrr-submit]");
    await page.waitForSelector("[data-hrr-step='pay']", { timeout: 10000 });
    const approved = await spendRow("now");
    const step2 = await page.evaluate(() => {
      const box = document.querySelector("[data-popup]");
      return {
        steps: document.querySelector("[data-hrr-steps]")?.getAttribute("data-hrr-steps") ?? null,
        text: box?.textContent ?? "",
        now: Boolean(document.querySelector("[data-hrr-pay-now]")),
        later: Boolean(document.querySelector("[data-hrr-pay-later]")),
        fits: box ? box.scrollWidth <= box.clientWidth + 1 : false,
      };
    });
    check("the approval is saved before step 2 shows (approved, unpaid)", approved.status === "approved" && approved.txn === null, JSON.stringify(approved));
    check(
      "step 2, in the same popup: \"Approved — pay it now?\", Pay now and Pay later, and closing is said to be Pay later",
      step2.steps === "2" && /Approved — pay it now\?/.test(step2.text) && step2.now && step2.later && /closing this does the same/.test(step2.text) && step2.fits,
      step2.text.slice(0, 200),
    );
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "paynow-step2.png") });
    await page.click("[data-hrr-pay-now]");
    await fillPay(page);
    const payTitle = await page.evaluate(() => document.querySelector("[data-popup]")?.textContent.includes("Pay this spend"));
    const stepGone = await page.evaluate(() => !document.querySelector("[data-hrr-step]"));
    check("Pay now opens the Pay drawer for that spend, with the invoice and reference", payTitle && stepGone && (await page.$$("#hrb-pay input[type='file']")).length === 2);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "paynow-pay.png") });
    await page.click("[data-hrb-submit]");
    const paid = await until(async () => {
      const row = await spendRow("now");
      return row.status === "paid" && row.txn ? row : null;
    });
    if (paid?.txn) txnIds.push(paid.txn);
    const txn = paid ? (await q(`select amount::text a, direction::text d, deleted_at from transactions where id = $1`, [paid.txn]))[0] : null;
    check("paid: the spend is paid against an expense of its amount in the ledger", Boolean(paid) && txn?.a === "150.00" && txn?.deleted_at === null, `${JSON.stringify(paid)} ${JSON.stringify(txn)}`);
    const toast = await toastMatching(page, /Paid as TXN-[\d-]+\./);
    await tab(page, "All");
    const badge = await until(() => page.evaluate((rowId) => document.querySelector(`tr[data-hrr-row='${rowId}']`)?.textContent.includes("Paid") ?? false, id));
    check("the drawer says Paid as …, and the row reads Paid", Boolean(toast) && badge, toast ?? "");
    const status = (await hr("GET", `/hr-requests/spends/status?externalIds=${S.now}`)).body?.[0];
    check("HR reads it as before: approved, with when the money moved", status?.state === "approved" && Boolean(status?.appliedAt), JSON.stringify(status));
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nC. Approve → Pay later → To pay → paid from there");
  {
    const { page, context } = await open(decider, "/hr-requests");
    await search(page, MARK);
    const id = await rowOf(page, "later");
    await clickRowButton(page, id, "Approve");
    await page.waitForSelector("[data-hrr-submit]", { timeout: 10000 });
    await page.click("[data-hrr-submit]");
    await page.waitForSelector("[data-hrr-pay-later]", { timeout: 10000 });
    await page.click("[data-hrr-pay-later]");
    const closed = await until(() => page.evaluate(() => !document.querySelector("[data-popup]")));
    const toast = await toastMatching(page, /Approved\. It is on To pay until it is paid\./);
    const row = await spendRow("later");
    check("Pay later closes, says it is on To pay, and the spend is approved and unpaid", Boolean(closed) && Boolean(toast) && row.status === "approved" && row.txn === null, `${toast ?? ""} ${JSON.stringify(row)}`);
    const count = await until(() => page.evaluate(() => [...document.querySelectorAll("[role='tab']")].find((t) => t.textContent.trim().startsWith("To pay"))?.textContent.replace(/\D+/g, "") === "1"));
    check("the To pay tab counts it: 1", Boolean(count), (await tabs(page)).join(" | "));
    await tab(page, "To pay");
    const onTab = await until(() => page.evaluate((rowId) => {
      const rows = [...document.querySelectorAll("tr[data-hrr-row]")];
      return rows.length === 1 && rows[0].getAttribute("data-hrr-row") === rowId && rows[0].textContent.includes("To pay");
    }, id));
    check("To pay lists exactly it, badged To pay", Boolean(onTab));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "paynow-topay.png") });
    const approvedTab = await list("approved");
    check(
      "Approved still lists every approval: the paid one and the unpaid one",
      approvedTab?.items?.some((r) => r.id === id && !r.paid) && approvedTab?.items?.some((r) => r.subject === PURPOSE.now && r.paid),
      JSON.stringify(approvedTab?.items?.map((r) => [r.subject, r.paid])),
    );
    await clickRowButton(page, id, "Pay");
    await fillPay(page);
    await page.click("[data-hrb-submit]");
    const paid = await until(async () => {
      const r = await spendRow("later");
      return r.status === "paid" && r.txn ? r : null;
    });
    if (paid?.txn) txnIds.push(paid.txn);
    const gone = await until(() => page.evaluate(() => {
      const t = [...document.querySelectorAll("[role='tab']")].find((x) => x.textContent.trim().startsWith("To pay"));
      return t?.textContent.replace(/\D+/g, "") === "0" && document.querySelectorAll("tr[data-hrr-row]").length === 0;
    }));
    const empty = await page.evaluate(() => document.body.textContent.includes("Nothing to pay"));
    check("paid from To pay as before: paid in the ledger, off the tab, counted 0", Boolean(paid) && Boolean(gone), JSON.stringify(paid));
    check("an empty To pay says so in its own words (with a search, it suggests clearing it)", empty);
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nD. Other ways out of step 2");
  {
    const { page, context } = await open(decider, "/hr-requests");
    await search(page, MARK);
    const escId = await rowOf(page, "esc");
    await clickRowButton(page, escId, "Approve");
    await page.waitForSelector("[data-hrr-submit]", { timeout: 10000 });
    await page.click("[data-hrr-submit]");
    await page.waitForSelector("[data-hrr-step='pay']", { timeout: 10000 });
    await page.keyboard.press("Escape");
    const closed = await until(() => page.evaluate(() => !document.querySelector("[data-popup]")));
    const toast = await toastMatching(page, /Approved\. It is on To pay until it is paid\./);
    const row = await spendRow("esc");
    check("Escape on step 2 is Pay later: closed, approved, unpaid, and said", Boolean(closed) && Boolean(toast) && row.status === "approved" && row.txn === null, JSON.stringify(row));

    const cancelId = await rowOf(page, "cancel");
    await clickRowButton(page, cancelId, "Approve");
    await page.waitForSelector("[data-hrr-submit]", { timeout: 10000 });
    await page.click("[data-hrr-submit]");
    await page.waitForSelector("[data-hrr-pay-now]", { timeout: 10000 });
    await page.click("[data-hrr-pay-now]");
    await page.waitForSelector("#hrb-pay", { timeout: 10000 });
    await page.evaluate(() => [...document.querySelectorAll("[data-popup] button")].find((b) => b.textContent.trim() === "Cancel").click());
    const shut = await until(() => page.evaluate(() => !document.querySelector("#hrb-pay")));
    const said = await toastMatching(page, /Approved, not paid yet\. It is on To pay\./);
    const left = await spendRow("cancel");
    const topay = await list("to_pay");
    check(
      "Pay now, then Cancel: approved and unpaid, on To pay, and the page says so",
      Boolean(shut) && Boolean(said) && left.status === "approved" && left.txn === null && topay?.counts?.to_pay === 2,
      `${said ?? ""} ${JSON.stringify(left)} ${JSON.stringify(topay?.counts)}`,
    );
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nE. A pay change's approval is still one step");
  {
    const pcRow = (await q(`select id::text from compensation_requests where external_id = $1`, [PC]))[0];
    const { page, context } = await open(decider, "/hr-requests");
    await search(page, MARK);
    await page.waitForSelector(`tr[data-hrr-row='${pcRow.id}']`, { timeout: 15000 });
    await clickRowButton(page, pcRow.id, "Approve");
    await page.waitForSelector("[data-hrr-submit]:not([disabled])", { timeout: 15000 });
    const marked = await page.evaluate(() => Boolean(document.querySelector("[data-hrr-steps]")));
    await page.click("[data-hrr-submit]");
    const closed = await until(() => page.evaluate(() => !document.querySelector("[data-popup]")));
    const step2 = await page.evaluate(() => Boolean(document.querySelector("[data-hrr-step]")));
    const now = (await q(`select status from compensation_requests where external_id = $1`, [PC]))[0];
    check("no step marker, no second step: approved and closed", !marked && Boolean(closed) && !step2 && now.status === "approved", JSON.stringify(now));
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nF. Nothing scrolls sideways");
  for (const width of [1440, 390]) {
    const { page, context } = await open(decider, "/hr-requests?state=to_pay", width);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    const selected = await page.evaluate(() => document.querySelector("[role='tab'][aria-selected='true']")?.textContent.trim() ?? "");
    check(`at ${width}: ?state=to_pay opens on To pay, and the page fits`, fits && selected.startsWith("To pay"), selected);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `paynow-${width}.png`) });
    await context.close();
  }

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  for (const id of txnIds) {
    await admin("POST", `/trash/transaction/${id}`, { reason: "harness" });
    await admin("DELETE", `/trash/transaction/${id}`);
  }
  await wipe();
  const left = await q(`select (select count(*) from team_members where full_name like $1)::int m, (select count(*) from hr_budget_spends where purpose like $2)::int s, (select count(*) from transactions where id = any($3::uuid[]))::int t`, [`${MARK} %`, `${MARK}%`, txnIds]);
  check("cleaned up", left[0].m === 0 && left[0].s === 0 && left[0].t === 0, JSON.stringify(left[0]));
  await db.end();
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
