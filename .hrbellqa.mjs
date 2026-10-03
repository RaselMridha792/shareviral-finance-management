/**
 * #122 — HR Budget rings the bell, and paying a spend carries its papers.
 *
 * The bell (read back from `notifications`, not from the screen):
 *   - a spend's and a budget's first arrival raise one for each active CFO and
 *     super admin, and for nobody else; a resend does not raise another;
 *   - the Settings switch is stored, read back, and honoured — off, a new
 *     request raises nothing and the HR portal still gets its 201;
 *   - the Settings screen draws the fifth row, and its switch saves;
 *   - the budget's link opens the page on Budgets.
 *
 * The Pay drawer:
 *   - Invoice and Reference clips; a paper picked on each is filed on the
 *     expense the payment wrote, under `invoice` and `bank_statement`;
 *   - an upload that fails leaves the payment made and says so, with the
 *     upload offered again — never a second payment.
 *
 *     node .hrbellqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .hrbellqa.mjs   also saves screenshots
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await settle(250);
  }
};

const MARK = `HRBELL${Date.now().toString(36)}`;
const PERIOD = crypto.randomUUID();
const S1 = crypto.randomUUID();
const S2 = crypto.randomUUID();
const S3 = crypto.randomUUID();
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

/* The finance people who should hear, as the service picks them. */
const deciders = (await q(`select id::text from users where role in ('cfo','super_admin') and status = 'active' and deleted_at is null order by id`)).map((r) => r.id);
const bellsFor = async (entity) =>
  q(`select user_id::text uid, kind, dedupe_key, title, body, href from notifications where dedupe_key = $1 order by user_id`, [entity]);

/* A 1x1 PNG, twice under two names: one invoice, one bank slip. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hrbell-"));
const invoicePng = path.join(tmp, `${MARK}-invoice.png`);
const slipPng = path.join(tmp, `${MARK}-slip.png`);
fs.writeFileSync(invoicePng, PNG);
fs.writeFileSync(slipPng, PNG);

const [{ notify_hr_budget: switchBefore }] = await q(`select notify_hr_budget from app_settings where id = 1`);

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
let quietAborts = false;
const open = async (user, url, width = 1440) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error" || /Encountered two children/.test(m.text())) return;
    if (quietAborts && /Failed to load resource|Failed to fetch|ERR_FAILED/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(700);
  return { page, context };
};
const search = async (page, text) => {
  const box = await page.$("input[placeholder^='Person']");
  await box.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await box.type(text);
  await page.waitForFunction((t) => [...document.querySelectorAll("tr[data-row-id]")].some((tr) => tr.textContent.includes(t)), { timeout: 15000 }, text);
};
const spendId = async (ext) => (await q(`select id::text from hr_budget_spends where external_id = $1`, [ext]))[0].id;

/* Opens the Pay drawer on a spend's row and fills what the ledger needs. */
const openPay = async (page, purpose) => {
  await search(page, purpose);
  await page.evaluate((t) => [...document.querySelectorAll("tr[data-row-id]")].find((tr) => tr.textContent.includes(t)).querySelector("button[aria-label^='Pay']").click(), purpose);
  await page.waitForSelector("[data-hrb-field='account']", { timeout: 10000 });
  await page.click("[data-popup] [role='combobox']");
  await page.waitForSelector("[role='option']", { timeout: 5000 });
  await page.click("[role='option']");
  await settle(200);
  const rateBox = await page.$("[data-hrb-field='rate']");
  if (!(await rateBox.evaluate((el) => el.value))) await rateBox.type("121.50");
};

const txnIds = [];
try {
  const hr = api(users.hr);
  const admin = api(users.super_admin);
  const fin = api(finance);

  /* ------------------------------------------------------------------ */
  console.log("\nThe switch");
  await admin("POST", "/notifications/settings", { hrBudget: true });
  const read = await admin("GET", "/notifications/settings");
  check("GET /notifications/settings carries hrBudget, and it is on", read.status === 200 && read.body?.hrBudget === true, JSON.stringify(read.body));

  /* ------------------------------------------------------------------ */
  console.log("\nA request arrives");
  const s1 = await hr("POST", "/hr-budget/spends", spendBody({ externalId: S1, purpose: `${MARK} Laptop bags` }));
  const s1id = await spendId(S1);
  const b1 = await bellsFor(`hr-spend:${s1id}`);
  check(
    "a spend's first arrival rings once for every active CFO and super admin",
    s1.status === 201 && b1.length === deciders.length && b1.map((b) => b.uid).join() === deciders.join() && b1.every((b) => b.kind === "hr_request" && b.href === "/hr-requests?kind=spend"),
    `${s1.status} ${b1.length}/${deciders.length}`,
  );
  check(
    "it says what arrived: the purpose, the taka, the day, who for, who sent it",
    b1[0]?.title === `HR sent a spend: ${MARK} Laptop bags` && /1,250\.50/.test(b1[0]?.body ?? "") && b1[0]?.body.includes("14/09/2026") && b1[0]?.body.includes("for Rasel Sarker") && b1[0]?.body.includes("from Nusrat (HR)"),
    `${b1[0]?.title} | ${b1[0]?.body}`,
  );
  const hrAndCeo = (await q(`select count(*)::int n from notifications where dedupe_key = $1 and user_id = any($2::uuid[])`, [`hr-spend:${s1id}`, [users.hr?.id, users.ceo?.id].filter(Boolean)]))[0].n;
  check("HR and the CEO are not rung — they do not decide it", hrAndCeo === 0, `${hrAndCeo}`);

  const again = await hr("POST", "/hr-budget/spends", spendBody({ externalId: S1, purpose: `${MARK} Laptop bags`, amount: "1300.00" }));
  const b1b = await bellsFor(`hr-spend:${s1id}`);
  const total1 = (await q(`select count(*)::int n from notifications where kind = 'hr_request' and title like $1`, [`%${MARK}%`]))[0].n;
  check("sent again with a change: an amend, and no second bell", again.status === 200 && b1b.length === deciders.length && total1 === deciders.length, `${again.status} ${b1b.length} ${total1}`);

  const p1 = await hr("POST", "/hr-budget/periods", { externalId: PERIOD, categoryName: `${MARK} Equipment`, startsOn: "2026-09-01", endsOn: "2026-10-31", amount: "50000", note: null, recordedByName: "Nusrat (HR)" });
  const pid = (await q(`select id::text from hr_budget_periods where external_id = $1`, [PERIOD]))[0].id;
  const bp = await bellsFor(`hr-budget:${pid}`);
  check(
    "a budget's arrival rings too, and links to the Budgets list",
    p1.status === 201 && bp.length === deciders.length && bp[0]?.href === "/hr-requests?kind=budget" && bp[0]?.title === `HR sent a budget: ${MARK} Equipment` && bp[0]?.body.includes("01/09/2026 to 31/10/2026"),
    `${p1.status} ${bp.length} ${bp[0]?.href} | ${bp[0]?.body}`,
  );
  const feed = await admin("GET", "/notifications");
  check("the super admin's bell lists it", (feed.body?.items ?? []).some((n) => n.title === `HR sent a spend: ${MARK} Laptop bags`), `${feed.status}`);

  /* ------------------------------------------------------------------ */
  console.log("\nSwitched off");
  const off = await admin("POST", "/notifications/settings", { hrBudget: false });
  const [{ notify_hr_budget: stored }] = await q(`select notify_hr_budget from app_settings where id = 1`);
  const s2 = await hr("POST", "/hr-budget/spends", spendBody({ externalId: S2, purpose: `${MARK} Team lunch`, amount: "4200" }));
  const s2id = await spendId(S2);
  const b2 = await bellsFor(`hr-spend:${s2id}`);
  check("off: stored off, the next spend still lands (201), and nothing rings", off.status === 200 && stored === false && s2.status === 201 && b2.length === 0, `${off.status} ${stored} ${s2.status} ${b2.length}`);
  const cfoTries = await api(users.hr)("POST", "/notifications/settings", { hrBudget: true });
  check("HR cannot switch it back on (settings.write)", cfoTries.status === 403, `${cfoTries.status}`);
  await admin("POST", "/notifications/settings", { hrBudget: true });

  /* ------------------------------------------------------------------ */
  console.log("\nSettings → Notifications");
  {
    const { page, context } = await open(users.super_admin, "/settings?tab=notifications");
    await page.waitForFunction(() => document.body.textContent.includes("HR sent a money request"), { timeout: 20000 });
    const row = await page.evaluate(() => {
      const title = [...document.querySelectorAll("p")].find((p) => p.textContent.trim() === "HR sent a money request");
      const box = title?.closest(".sv-switch-row");
      const sw = box?.querySelector("[role='switch']");
      const card = box?.parentElement;
      return {
        found: Boolean(sw),
        checked: sw?.getAttribute("aria-checked"),
        rowsInCard: card ? card.querySelectorAll("[role='switch']").length : 0,
        detail: box?.textContent ?? "",
      };
    });
    check("the fifth row sits with the other three, on", row.found && row.checked === "true" && row.rowsInCard === 4 && row.detail.includes("not at 9am"), JSON.stringify({ ...row, detail: undefined }));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "bell-settings.png") });
    const click = () =>
      page.evaluate(() => {
        const title = [...document.querySelectorAll("p")].find((p) => p.textContent.trim() === "HR sent a money request");
        title.closest(".sv-switch-row").querySelector("[role='switch']").click();
      });
    await click();
    const wentOff = await until(async () => (await q(`select notify_hr_budget v from app_settings where id = 1`))[0].v === false);
    await click();
    const cameBack = await until(async () => (await q(`select notify_hr_budget v from app_settings where id = 1`))[0].v === true);
    check("its switch saves — off, then on again (read back)", wentOff && cameBack, `${wentOff} ${cameBack}`);
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check("nothing scrolls sideways at 1440", fits);
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nThe bell's link");
  {
    const { page, context } = await open(finance, "/hr-requests?kind=budget&state=all");
    const onBudgets = await until(() => page.evaluate((m) => [...document.querySelectorAll("tr[data-row-id]")].some((tr) => tr.textContent.includes(`${m} Equipment`)), MARK));
    check("the bell's budget link opens HR Requests on budgets", Boolean(onBudgets));
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nPay, with the invoice and the bank's slip");
  await fin("POST", `/hr-budget/spends/${s1id}/decision`, { decision: "approved", note: null });
  await fin("POST", `/hr-budget/spends/${s2id}/decision`, { decision: "approved", note: null });
  {
    const { page, context } = await open(finance, "/hr-requests?kind=spend&state=all");
    await openPay(page, `${MARK} Laptop bags`);
    const clips = await page.evaluate(() => {
      const form = document.querySelector("#hrb-pay");
      const labels = [...form.querySelectorAll("label, span, p")].map((el) => el.textContent.trim());
      return { inputs: form.querySelectorAll("input[type='file']").length, invoice: labels.includes("Invoice"), reference: labels.some((t) => t.startsWith("Reference")) };
    });
    check("the drawer has an Invoice and a Reference to attach", clips.inputs === 2 && clips.invoice && clips.reference, JSON.stringify(clips));
    const [invoiceInput, slipInput] = await page.$$("#hrb-pay input[type='file']");
    await invoiceInput.uploadFile(invoicePng);
    await slipInput.uploadFile(slipPng);
    await page.waitForFunction((a, b) => document.querySelector("#hrb-pay").textContent.includes(a) && document.querySelector("#hrb-pay").textContent.includes(b), { timeout: 5000 }, path.basename(invoicePng), path.basename(slipPng));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "bell-pay-papers.png") });
    const clipped = await page.evaluate(() => {
      const box = document.querySelector("[data-popup]");
      return box.scrollWidth <= box.clientWidth + 1;
    });
    check("two papers picked, and the drawer does not scroll sideways", clipped);
    await page.click("[data-hrb-submit]");
    const txnId = await until(async () => (await q(`select transaction_id::text t from hr_budget_spends where external_id = $1 and status = 'paid'`, [S1]))[0]?.t);
    if (txnId) txnIds.push(txnId);
    const filed = await until(async () => {
      const rows = await q(`select kind::text, original_name from files where transaction_id = $1 order by kind`, [txnId]);
      return rows.length === 2 ? rows : null;
    });
    check(
      "paid, and both papers are filed on the expense it wrote — invoice and bank_statement",
      Boolean(txnId) && filed?.[0]?.kind === "bank_statement" && filed?.[0]?.original_name === path.basename(slipPng) && filed?.[1]?.kind === "invoice" && filed?.[1]?.original_name === path.basename(invoicePng),
      JSON.stringify(filed),
    );
    const closed = await until(() => page.evaluate(() => !document.querySelector("#hrb-pay")));
    const toast = await page.evaluate(() => document.body.textContent.match(/Paid as \S+, papers attached\./)?.[0] ?? null);
    check("the drawer closes and says so", Boolean(closed) && Boolean(toast), toast ?? "");
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nAn upload that fails");
  {
    const { page, context } = await open(finance, "/hr-requests?kind=spend&state=all");
    await openPay(page, `${MARK} Team lunch`);
    const [invoiceInput] = await page.$$("#hrb-pay input[type='file']");
    await invoiceInput.uploadFile(invoicePng);
    await settle(300);
    await page.setRequestInterception(true);
    const refuseUploads = (r) => (r.method() === "POST" && r.url().includes("/files/transaction/") ? r.abort() : r.continue());
    page.on("request", refuseUploads);
    quietAborts = true;
    await page.click("[data-hrb-submit]");
    const shown = await page.waitForSelector("[data-hrb-paid]", { timeout: 20000 }).then(() => true, () => false);
    const words = await page.evaluate(() => document.querySelector("[data-hrb-paid]")?.textContent ?? "");
    const row = (await q(`select status, transaction_id::text t from hr_budget_spends where external_id = $1`, [S2]))[0];
    if (row?.t) txnIds.push(row.t);
    const onFile = row?.t ? (await q(`select count(*)::int n from files where transaction_id = $1`, [row.t]))[0].n : -1;
    const payments = (await q(`select count(*)::int n from transactions where description = $1 and deleted_at is null`, [`HR: ${MARK} Team lunch`]))[0].n;
    check(
      "the payment stands, the drawer says what did not go up, and offers the upload again",
      shown && row?.status === "paid" && onFile === 0 && payments === 1 && words.includes("Recorded as") && words.includes("invoice or receipt") && words.includes("did not go through"),
      `${shown} ${JSON.stringify(row)} files=${onFile} payments=${payments}`,
    );
    const offered = await page.evaluate(() => Boolean(document.querySelector("[data-hrb-paid] input[type='file']")) || [...document.querySelectorAll("[data-popup] button")].some((b) => /upload|attach/i.test(b.textContent)));
    check("the upload is offered there, nothing to pay again", offered && !(await page.$("[data-hrb-submit]")));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "bell-pay-failed.png") });
    page.off("request", refuseUploads);
    await page.setRequestInterception(false);
    quietAborts = false;
    await page.evaluate(() => [...document.querySelectorAll("[data-popup] button")].find((b) => b.textContent.trim() === "Done").click());
    const gone = await until(() => page.evaluate(() => !document.querySelector("[data-hrb-paid]")));
    const paidOnRow = await until(() => page.evaluate((t) => [...document.querySelectorAll("tr[data-row-id]")].find((tr) => tr.textContent.includes(t))?.textContent.includes("Paid"), `${MARK} Team lunch`));
    check("Done closes it, and the row reads Paid", Boolean(gone) && Boolean(paidOnRow));
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nStill a normal send when the bell cannot be raised for anyone");
  const s3 = await hr("POST", "/hr-budget/spends", spendBody({ externalId: S3, purpose: `${MARK} Chairs`, amount: "900" }));
  /* The bell is raised for every decider after the 201; with many of them on
     the local database, the last are written a moment later. */
  const s3id = await spendId(S3);
  const rung = await until(async () => (await bellsFor(`hr-spend:${s3id}`)).length === deciders.length);
  check("a third spend: 201 and rung", s3.status === 201 && Boolean(rung), `${s3.status}`);

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  const admin = api(users.super_admin);
  for (const id of txnIds) {
    await admin("POST", `/trash/transaction/${id}`, { reason: "harness" });
    await admin("DELETE", `/trash/transaction/${id}`);
  }
  await q(`update app_settings set notify_hr_budget = $1 where id = 1`, [switchBefore]);
  const ids = (await q(`select id::text from hr_budget_periods where category_name like $1 union all select id::text from hr_budget_spends where purpose like $1`, [`${MARK}%`])).map((r) => r.id);
  await q(`delete from notifications where kind in ('hr_budget', 'hr_request') and title like $1`, [`%${MARK}%`]);
  await q(`delete from audit_logs where entity_id::text = any($1)`, [ids]);
  await q(`delete from hr_budget_spends where purpose like $1`, [`${MARK}%`]);
  await q(`delete from hr_budget_periods where category_name like $1`, [`${MARK}%`]);
  const left = (await q(`select (select count(*) from hr_budget_periods where category_name like $1)::int + (select count(*) from hr_budget_spends where purpose like $1)::int + (select count(*) from notifications where title like $2)::int as n`, [`${MARK}%`, `%${MARK}%`]))[0].n;
  const txLeft = txnIds.length ? (await q(`select count(*)::int n from transactions where id = any($1::uuid[])`, [txnIds]))[0].n : 0;
  check("cleaned up, and the switch left as it was", left === 0 && txLeft === 0 && (await q(`select notify_hr_budget v from app_settings where id = 1`))[0].v === switchBefore, `${left} ${txLeft}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  await db.end();
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
