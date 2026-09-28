/**
 * Correcting a transfer, and the refusal that sent the owner here.
 *
 * The owner, 28 Sep 2026: *"money transfer er ekhane edit button rakho jate
 * edit kora jay records"* — and: M/S. EXPROVIA holds ৳4,99,800, a $50 transfer
 * from it is refused, *"eta indetailed check koro properly"*.
 *
 * PART A rebuilds the refusal as it happened on the live site. An account
 * opens at ৳0; ৳5,00,000 arrives dated the 29th with a ৳200 charge; a transfer
 * of $50 at 121.5 (৳6,075) plus ৳200 is dated the 28th. On the 28th the
 * account held nothing, so the rule that an account can never go below zero on
 * any day refuses it — correctly. What was wrong was the sentence: "Record the
 * money coming in first" about money that was recorded. It must now name the
 * day the covering money is dated. Dated the 29th, the same transfer goes.
 *
 * PART B drives the new Edit: from the row and from the record, the form opens
 * on the transfer's own figures with the accounts fixed, the stored slip on its
 * clip; a correction changes BOTH halves and the charge, keeps the charge's own
 * row, clears the charge when the box is emptied, re-dates everything
 * together, refuses to overdraw either side (the receiving side included), and
 * is closed to a voided transfer. Half a transfer can no longer be edited alone
 * — not through the API, not from All transactions.
 *
 *     node .transfereditqa.mjs     (local only — makes two accounts and removes
 *                                   them and everything on them)
 *
 * Needs `npm run dev` running (web :3000, api :4001).
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
const MARK = "TEQA";
const FUND_DAY = "2026-09-29";
const EARLY_DAY = "2026-09-28";
const LATER_DAY = "2026-09-30";

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

const person = (
  await q(`select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null order by created_at limit 1`)
)[0];
const token = jwt.sign({ sub: person.id, role: person.role, tv: person.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "2h" });
const H = { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web" };
const call = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { ...H, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const msgOf = (r) => String(r.body?.message ?? "") + " " + Object.values(r.body?.errors ?? {}).flat().join(" ");

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- cleanup */
async function wipe() {
  const accts = (await q(`select id from accounts where name like $1`, [`${MARK} %`])).map((r) => r.id);
  if (!accts.length) return;
  const txns = (await q(`select id from transactions where account_id = any($1::uuid[])`, [accts])).map((r) => r.id);
  const files = txns.length ? await q(`select id, deleted_at from files where transaction_id = any($1::uuid[])`, [txns]) : [];
  for (const f of files.filter((f) => !f.deleted_at)) {
    await fetch(`${API}/files/${f.id}`, { method: "DELETE", headers: H }).catch(() => undefined);
  }
  const ids = [...accts, ...txns, ...files.map((f) => f.id)];
  await q(`delete from audit_logs where entity_id = any($1::text[])`, [ids]);
  if (files.length) await q(`delete from files where id = any($1::uuid[])`, [files.map((f) => f.id)]);
  if (txns.length) {
    await q(`delete from transactions where charge_for_id = any($1::uuid[])`, [txns]);
    await q(`delete from transactions where id = any($1::uuid[])`, [txns]);
  }
  await q(`delete from accounts where id = any($1::uuid[])`, [accts]);
}
await wipe();

/* --------------------------------------------------------------- fixtures */
const mk = async (name, currency) => {
  const r = await call("POST", "/accounts", {
    name, type: "bank", currency, bankName: `${name} Bank`,
    openingBalance: "0.00", openingBalanceOn: "2026-09-01",
  });
  if (r.status >= 300) throw new Error(`account ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id;
};
const cats = (await call("GET", "/categories")).body;
const inCat = (cats.items ?? cats).find((c) => (c.kind === "in" || c.kind === "both") && c.parentId);
const outCat = (cats.items ?? cats).find((c) => (c.kind === "out" || c.kind === "both") && c.parentId);
const exprovia = await mk(`${MARK} Exprovia`, "BDT");
const dollar = await mk(`${MARK} Dollar`, "USD");

const funded = await call("POST", "/transactions", {
  accountId: exprovia, direction: "in", txnDate: FUND_DAY, amount: "500000.00",
  categoryId: inCat.id, description: `${MARK} August Funding`, paymentMethod: "bank_transfer",
  usdRate: "121.50", chargeAmount: "200.00",
});
if (funded.status >= 300) throw new Error(`funding: ${funded.status} ${JSON.stringify(funded.body)}`);

const balanceOf = async (id) =>
  (await q(
    `select (a.opening_balance + coalesce((select sum(signed_amount) from transactions t
       where t.account_id = a.id and t.voided_at is null and t.deleted_at is null), 0))::text b
       from accounts a where a.id = $1`, [id]))[0].b;
check("the fixture: the account holds ৳4,99,800 — as on the live site", (await balanceOf(exprovia)) === "499800.00", await balanceOf(exprovia));

/* ======================================================== PART A: refusal */
console.log("\nA. The refusal, and its sentence");
const early = await call("POST", "/transactions/transfer", {
  txnDate: EARLY_DAY, fromAccountId: exprovia, toAccountId: dollar, amount: "6075.00",
  usdAmount: "50.00", usdRate: "121.5", chargeAmount: "200.00",
  description: `${MARK} fifty dollars`, paymentMethod: "bank_transfer",
});
const earlyMsg = msgOf(early);
check("a transfer dated before the money arrived is still refused", early.status === 400, `HTTP ${early.status}`);
check(
  "and the sentence names the day it fails and the day the money is dated",
  /does not hold enough money on 28\/09\/2026/.test(earlyMsg) && /dated 29\/09\/2026/.test(earlyMsg) && !/Record the money coming in first/.test(earlyMsg),
  earlyMsg.trim(),
);
const shortfall = await call("POST", "/transactions/transfer", {
  txnDate: FUND_DAY, fromAccountId: exprovia, toAccountId: dollar, amount: "900000.00",
  usdRate: "121.5", description: `${MARK} beyond means`, paymentMethod: "bank_transfer",
});
check(
  "a true shortfall keeps the old sentence",
  shortfall.status === 400 && /does not hold enough money for this/.test(msgOf(shortfall)) && /Record the money coming in first/.test(msgOf(shortfall)),
  msgOf(shortfall).trim(),
);

/* ---------------------------------------------------------------- browser */
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
let outId = null;
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  const waitFor = (fn, arg, ms = 15000) =>
    page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg).then(() => true).catch(() => false);
  const drawer = `[...document.querySelectorAll("[data-popup]")].pop()`;
  const fill = (values) =>
    page.evaluate((vals) => {
      const box = [...document.querySelectorAll("[data-popup]")].pop();
      const byLabel = (text) =>
        [...box.querySelectorAll("label")]
          .find((l) => l.querySelector("span")?.textContent?.replace("*", "").trim() === text)
          ?.querySelector("input, select") ?? null;
      const missing = [];
      for (const [name, value] of Object.entries(vals)) {
        const el = box.querySelector(`[name="${name}"]`) ?? byLabel(name);
        if (!el) { missing.push(name); continue; }
        const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return missing;
    }, values);
  const read = () =>
    page.evaluate(() => {
      const box = [...document.querySelectorAll("[data-popup]")].pop();
      if (!box) return null;
      const byLabel = (text) =>
        [...box.querySelectorAll("label")]
          .find((l) => l.querySelector("span")?.textContent?.replace("*", "").trim() === text)
          ?.querySelector("input, select") ?? null;
      return {
        title: box.querySelector("h2")?.textContent?.trim() ?? null,
        date: box.querySelector('[name="txnDate"]')?.value ?? null,
        usd: byLabel("Amount (USD)")?.value ?? null,
        rate: byLabel("USD rate")?.value ?? null,
        bdt: box.querySelector('[name="amount"]')?.value ?? null,
        charge: box.querySelector('[name="chargeAmount"]')?.value ?? null,
        description: box.querySelector('[name="description"]')?.value ?? null,
        accounts: [...box.querySelectorAll("select")].filter((s) => s.disabled).map((s) => s.selectedOptions[0]?.textContent?.trim()),
        stored: [...box.querySelectorAll('[data-attached="stored"]')].map((el) => el.textContent.trim()),
        alert: box.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
        save: [...box.querySelectorAll("button")].some((b) => /Save changes/.test(b.textContent ?? "")),
      };
    });
  const press = (re) =>
    page.evaluate((src) => {
      const re = new RegExp(src);
      const button = [...document.querySelectorAll("button")].find((b) => re.test(b.textContent ?? ""));
      if (!button) return false;
      button.click();
      return true;
    }, re.source);

  await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
  await waitFor(() => [...document.querySelectorAll("button")].some((b) => /New transfer/.test(b.textContent ?? "")));

  /* A2, A3 — the same through the form */
  await press(/New transfer/);
  await waitFor(() => Boolean([...document.querySelectorAll("[data-popup]")].pop()?.querySelector('select[name="fromAccountId"]')));
  let missing = await fill({ fromAccountId: exprovia, toAccountId: dollar });
  await settle(300);
  missing = missing.concat(await fill({
    txnDate: EARLY_DAY, "Amount (USD)": "50", "USD rate": "121.5", chargeAmount: "200",
    description: `${MARK} fifty dollars`,
  }));
  await press(/Record the transfer/);
  await waitFor(() => /does not hold enough money/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""));
  let form = await read();
  check("the form shows the new sentence, with the day to move it to", /dated 29\/09\/2026/.test(form?.alert ?? ""), missing.length ? `missing ${missing}` : form?.alert);

  await fill({ txnDate: FUND_DAY });
  await press(/Record the transfer/);
  await waitFor(() => !document.querySelector("[data-popup]"), undefined, 20000);
  const pair = await q(
    `select id, direction, account_id, amount::text, original_amount::text usd, usd_rate::text rate, transfer_group_id g
       from transactions where description = $1 and deleted_at is null order by direction desc`,
    [`${MARK} fifty dollars`],
  );
  outId = pair.find((r) => r.direction === "out")?.id ?? null;
  const inId = pair.find((r) => r.direction === "in")?.id ?? null;
  check(
    "dated the day the money arrived, the same transfer goes through — both halves, $50, ৳6,075",
    pair.length === 2 && pair.every((r) => r.amount === "6075.00" && r.usd === "50.00" && Number(r.rate) === 121.5) && pair[0].g === pair[1].g,
    JSON.stringify(pair.map((r) => [r.direction, r.amount, r.usd, r.rate])),
  );
  const firstCharge = (await q(`select id, amount::text, txn_date::text d from transactions where charge_for_id = $1 and deleted_at is null`, [outId]))[0];
  check("its ৳200 charge is its own row on the paying account", firstCharge?.amount === "200.00" && firstCharge?.d === FUND_DAY, JSON.stringify(firstCharge));

  /* ===================================================== PART B: edit */
  console.log("\nB. Editing a transfer");
  // A slip on it, so the edit form has a stored paper to show.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR42mP8z8BQz0AEYBxVSF+FAAsLBAF6r4OeAAAAAElFTkSuQmCC", "base64");
  const upload = new FormData();
  upload.append("file", new Blob([PNG, Buffer.from("\nteqa\n")], { type: "image/png" }), "teqa-slip.png");
  upload.append("kind", "bank_statement");
  const up = await fetch(`${API}/files/transaction/${outId}`, { method: "POST", headers: H, body: upload });
  check("fixture: a bank slip attached to the transfer", up.status < 300, `HTTP ${up.status}`);

  await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
  await waitFor((id) => Boolean(document.querySelector(`tbody tr[data-row-id="${id}"]`)), outId);
  const editButton = await page.evaluate((id) => {
    const b = document.querySelector(`tbody tr[data-row-id="${id}"] button[aria-label="Edit"]`);
    return b ? { disabled: b.disabled } : null;
  }, outId);
  check("the row has an Edit button, and it is live", Boolean(editButton) && !editButton.disabled, JSON.stringify(editButton));
  await page.click(`tbody tr[data-row-id="${outId}"] button[aria-label="Edit"]`);
  await waitFor(() => /Edit transfer/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""));
  await waitFor(() => Boolean([...document.querySelectorAll("[data-popup]")].pop()?.querySelector('[data-attached="stored"]')), undefined, 8000);
  form = await read();
  check("it opens titled as an edit, with Save changes", /^Edit transfer TXN-/.test(form?.title ?? "") && form?.save, form?.title);
  check(
    "on the transfer's own figures — date, $50, 121.5, ৳6,075, ৳200, description",
    form?.date === FUND_DAY && Number(form?.usd) === 50 && form?.rate === "121.5" && form?.bdt === "6075.00" && Number(form?.charge) === 200 && form?.description === `${MARK} fifty dollars`,
    JSON.stringify(form),
  );
  check("the two accounts are shown and cannot be changed", form?.accounts?.length === 2 && form.accounts[0] === `${MARK} Exprovia` && form.accounts[1] === `${MARK} Dollar`, JSON.stringify(form?.accounts));
  check("the slip already on it is on its clip", form?.stored?.some((t) => t.includes("teqa-slip.png")), JSON.stringify(form?.stored));

  // $60 at the same rate: the taka follows the dollars once they move.
  await fill({ "Amount (USD)": "60", chargeAmount: "150", description: `${MARK} sixty dollars` });
  await settle(300);
  form = await read();
  check("moving the dollars hands the taka back to the arithmetic — ৳7,290", form?.bdt === "7290.00", form?.bdt);
  await press(/Save changes/);
  await waitFor(() => !document.querySelector("[data-popup]"), undefined, 20000);

  const after = await q(
    `select id, direction, amount::text, original_amount::text usd, description, txn_date::text d from transactions
      where transfer_group_id = (select transfer_group_id from transactions where id = $1) and deleted_at is null`,
    [outId],
  );
  check(
    "both halves changed together — ৳7,290, $60, the new description",
    after.length === 2 && after.every((r) => r.amount === "7290.00" && r.usd === "60.00" && r.description === `${MARK} sixty dollars`),
    JSON.stringify(after.map((r) => [r.direction, r.amount, r.usd, r.description])),
  );
  const charge2 = await q(`select id, amount::text, description from transactions where charge_for_id = $1 and deleted_at is null`, [outId]);
  check(
    "the charge is the same row, now ৳150, renamed with it",
    charge2.length === 1 && charge2[0].id === firstCharge.id && charge2[0].amount === "150.00" && charge2[0].description === `Bank charge — ${MARK} sixty dollars`,
    JSON.stringify(charge2),
  );
  check(
    "and both accounts moved by exactly that — ৳4,92,360 and ৳7,290",
    (await balanceOf(exprovia)) === "492360.00" && (await balanceOf(dollar)) === "7290.00",
    `${await balanceOf(exprovia)} / ${await balanceOf(dollar)}`,
  );

  /* From the record, too — the popup has an Edit, and shows the charge. */
  await waitFor((id) => Boolean(document.querySelector(`tbody tr[data-row-id="${id}"]`)), outId);
  const cellIndex = await page.evaluate((id) => {
    const cells = [...document.querySelectorAll(`tbody tr[data-row-id="${id}"] td`)];
    return cells.findIndex((td) => (td.textContent ?? "").trim() && !td.querySelector("a, button, input, select, label, [data-row-ignore]")) + 1;
  }, outId);
  await page.click(`tbody tr[data-row-id="${outId}"] td:nth-child(${cellIndex})`);
  await waitFor(() => Boolean(document.querySelector("[data-popup] h2")), undefined, 8000);
  const record = await page.evaluate(() => {
    const box = [...document.querySelectorAll("[data-popup]")].pop();
    return {
      text: (box?.innerText ?? "").replace(/\s+/g, " "),
      edit: [...(box?.querySelectorAll("button") ?? [])].some((b) => /^Edit$/.test((b.textContent ?? "").trim())),
    };
  });
  check("the record shows the bank charge and offers Edit", /Bank charge ৳150\.00/.test(record.text) && record.edit, record.text.slice(0, 200));
  await page.evaluate(() => {
    const box = [...document.querySelectorAll("[data-popup]")].pop();
    [...box.querySelectorAll("button")].find((b) => /^Edit$/.test((b.textContent ?? "").trim()))?.click();
  });
  await waitFor(() => /Edit transfer/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""));
  await waitFor(() => Boolean([...document.querySelectorAll("[data-popup]")].pop()?.querySelector('[data-attached="stored"]')), undefined, 8000);
  form = await read();
  check("the record's Edit opens the same form, on the corrected figures", form?.bdt === "7290.00" && Number(form?.charge) === 150, JSON.stringify({ bdt: form?.bdt, charge: form?.charge }));

  // Clear the charge, move the date, take the slip off — one save.
  await fill({ chargeAmount: "", txnDate: LATER_DAY });
  await page.evaluate(() => {
    const box = [...document.querySelectorAll("[data-popup]")].pop();
    box.querySelector('[data-attached="stored"] button[aria-label^="Remove"]')?.click();
  });
  await settle(200);
  await press(/Save changes/);
  await waitFor(() => !document.querySelector("[data-popup]"), undefined, 20000);
  const moved = await q(
    `select txn_date::text d from transactions where transfer_group_id = (select transfer_group_id from transactions where id = $1) and deleted_at is null`,
    [outId],
  );
  check("both halves re-dated together", moved.length === 2 && moved.every((r) => r.d === LATER_DAY), JSON.stringify(moved));
  const charge3 = await q(`select id from transactions where charge_for_id = $1 and deleted_at is null`, [outId]);
  check("an emptied charge box takes the charge off", charge3.length === 0, `${charge3.length} live charge row(s)`);
  const slips = await q(`select id from files where transaction_id = $1 and deleted_at is null`, [outId]);
  check("the slip marked for removal is gone", slips.length === 0, `${slips.length} live file(s)`);

  /* The receiving side is watched too: correcting DOWN after it was spent. */
  const spent = await call("POST", "/transactions", {
    accountId: dollar, direction: "out", txnDate: LATER_DAY, amount: "7000.00", categoryId: outCat.id,
    description: `${MARK} spent from the card`, paymentMethod: "card", usdRate: "121.50",
  });
  check("fixture: ৳7,000 spent from the receiving account", spent.status < 300, `HTTP ${spent.status}`);
  const down = await call("PATCH", `/transactions/transfer/${outId}`, {
    txnDate: LATER_DAY, amount: "1000.00", usdRate: "121.5", description: `${MARK} sixty dollars`, paymentMethod: "bank_transfer",
  });
  check(
    "correcting it down below what the receiving account already spent is refused",
    down.status === 400 && /TEQA Dollar does not hold enough money/.test(msgOf(down)),
    msgOf(down).trim(),
  );
  const up2 = await call("PATCH", `/transactions/transfer/${outId}`, {
    txnDate: LATER_DAY, amount: "600000.00", usdRate: "121.5", description: `${MARK} sixty dollars`, paymentMethod: "bank_transfer",
  });
  check("correcting it up past what the paying account holds is refused", up2.status === 400 && /TEQA Exprovia does not hold enough money/.test(msgOf(up2)), msgOf(up2).trim());
  const unchanged = await q(`select amount::text a from transactions where id = $1`, [outId]);
  check("and a refused correction changes nothing", unchanged[0]?.a === "7290.00", unchanged[0]?.a);

  /* Half a transfer can no longer be edited alone. */
  const half = await call("PATCH", `/transactions/${inId}`, { description: `${MARK} one half only` });
  check("the ordinary edit refuses half a transfer, and says where to go", half.status === 400 && /Money Transfer/.test(msgOf(half)), msgOf(half).trim());
  await page.goto(`${WEB}/transactions`, { waitUntil: "networkidle0", timeout: 120000 });
  await waitFor((id) => Boolean(document.querySelector(`tbody tr[data-row-id="${id}"]`)), outId);
  const onLedger = await page.evaluate((ids) =>
    ids.map((id) => {
      const b = document.querySelector(`tbody tr[data-row-id="${id}"] button[aria-label="Edit"]`);
      return b ? b.disabled : null;
    }), [outId, inId]);
  // Absent, not greyed: a row button with no handler is not drawn at all
  // (row-actions.tsx, the owner's rule), the same as on a voided entry.
  const seen = onLedger.every((d) => d === null)
    ? ""
    : await page.evaluate(() => {
        const trs = [...document.querySelectorAll("tbody tr[data-row-id]")];
        return `${trs.length} rows; first: ${trs.slice(0, 4).map((tr) => (tr.innerText || "").replace(/\s+/g, " ").slice(0, 60)).join(" | ")}`;
      });
  const ledgerRows = await page.evaluate((ids) => ids.map((id) => Boolean(document.querySelector(`tbody tr[data-row-id="${id}"]`))), [outId, inId]);
  check("All transactions offers no Edit on either half", ledgerRows.every(Boolean) && onLedger.every((d) => d === null), JSON.stringify(onLedger) + (seen ? ` — ${seen}` : ""));

  /* A voided transfer is closed to edits. The spend from the receiving side
     goes first: voiding the transfer while it stands would take that account
     below zero, which the rule refuses — rightly. */
  await call("POST", `/transactions/${spent.body.id}/void`, { reason: `${MARK} clearing the way` });
  const voided = await call("POST", `/transactions/${outId}/void`, { reason: `${MARK} voided for the check` });
  check("fixture: the transfer voided", voided.status < 300, `HTTP ${voided.status} ${msgOf(voided).trim()}`);
  const onVoided = await call("PATCH", `/transactions/transfer/${outId}`, {
    txnDate: LATER_DAY, amount: "7290.00", usdRate: "121.5", description: `${MARK} x`, paymentMethod: "bank_transfer",
  });
  check("a voided transfer cannot be edited", onVoided.status === 400 && /voided/i.test(msgOf(onVoided)), msgOf(onVoided).trim());
  await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
  await waitFor((id) => Boolean(document.querySelector(`tbody tr[data-row-id="${id}"]`)), outId);
  const voidedEdit = await page.evaluate((id) => document.querySelector(`tbody tr[data-row-id="${id}"] button[aria-label="Edit"]`)?.disabled ?? null, outId);
  check("and its row offers no Edit", voidedEdit === null, String(voidedEdit));

  check("no page errors, no 5xx on the way", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await wipe();
  const left = (await q(`select count(*)::int n from accounts where name like $1`, [`${MARK} %`]))[0].n;
  console.log(`\n  cleaned up: ${left === 0 ? "nothing left behind" : `${left} account(s) left`}`);
  await db.end();
}

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
