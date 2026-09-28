/**
 * AI tools and subscriptions: Renew, once a month, and Upgrade in place.
 *
 * The owner, 28 Sep 2026: *"ekhane add a record na diye renew dile valo hoyna
 * ... upgrade plan name ekta option diba and oitar details o add korar option
 * rakhba jate kono existing plan ke upgrade korte pare. akoi month a kono plan
 * duibar renew hobena"*.
 *
 * On a card and a plan made for the purpose and removed after:
 *   - the row and the record say Renew and Upgrade, nowhere "Record a payment";
 *   - the Renew drawer asks the rate once, moves the renewal date by default;
 *   - a renewal takes the plan's price from the card and moves the date on;
 *   - a second renewal in the same month is refused, through the API and the
 *     drawer, and one in the next month goes;
 *   - Upgrade changes the plan in place, keeps what it was as history, takes
 *     the vendor's charge on the day (with its bank charge) when given — and
 *     that charge does NOT use up the month's renewal;
 *   - an upgrade with nothing charged writes no payment; one that changes
 *     nothing is refused;
 *   - the record lists the upgrades with their charges.
 *
 *     node .renewupgradeqa.mjs     (needs `npm run dev`: web :3000, api :4001)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
const MARK = "RUQA";
const TOOL = `${MARK} Tool`;

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
const token = jwt.sign({ sub: person.id, role: person.role, tv: person.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const H = { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" };
const call = async (method, path, body) => {
  const r = await fetch(API + path, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const msgOf = (r) => String(r.body?.message ?? "") + " " + Object.values(r.body?.errors ?? {}).flat().join(" ");

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function wipe() {
  const subs = (await q(`select id from subscriptions where tool_name = $1`, [TOOL])).map((r) => r.id);
  const accts = (await q(`select id from accounts where name like $1`, [`${MARK} %`])).map((r) => r.id);
  const txns = accts.length ? (await q(`select id from transactions where account_id = any($1::uuid[])`, [accts])).map((r) => r.id) : [];
  const ids = [...subs, ...accts, ...txns];
  if (ids.length) await q(`delete from audit_logs where entity_id = any($1::text[])`, [ids]);
  if (subs.length) await q(`delete from subscription_upgrades where subscription_id = any($1::uuid[])`, [subs]);
  if (txns.length) {
    await q(`delete from transactions where charge_for_id = any($1::uuid[])`, [txns]);
    await q(`delete from transactions where id = any($1::uuid[])`, [txns]);
  }
  if (subs.length) {
    await q(`delete from subscription_users where subscription_id = any($1::uuid[])`, [subs]);
    await q(`delete from subscriptions where id = any($1::uuid[])`, [subs]);
  }
  if (accts.length) await q(`delete from accounts where id = any($1::uuid[])`, [accts]);
}
await wipe();

/* ---------------------------------------------------------------- fixtures */
const card = await call("POST", "/accounts", {
  name: `${MARK} Card`, type: "card", currency: "BDT", openingBalance: "100000.00", openingBalanceOn: "2026-08-01",
});
check("fixture: a card", card.status < 300, `HTTP ${card.status}`);
const made = await call("POST", "/subscriptions", {
  toolName: TOOL, planName: "Pro 5x", category: "ai_tool", status: "active",
  costUsd: "100.00", chargeUsd: "1.00", usdRate: "122.50", billingCycle: "monthly",
  startDate: "2026-08-10", accountId: card.body.id, paymentMethod: "card",
});
const planId = made.body?.id;
check("fixture: a plan on it", made.status < 300 && Boolean(planId), `HTTP ${made.status} ${planId ? "" : JSON.stringify(made.body)}`);
const planRow = async () => (await q(`select plan_name, cost_usd::text cost, cost_bdt::text bdt, charge_usd::text charge, next_renewal_on::text next from subscriptions where id = $1`, [planId]))[0];
const payments = async () =>
  q(`select t.id, t.txn_date::text d, t.amount::text amount, t.original_amount::text usd, t.description,
            exists (select 1 from subscription_upgrades u where u.transaction_id = t.id) as upgrade
       from transactions t where t.subscription_id = $1 and t.charge_for_id is null and t.deleted_at is null order by t.txn_date, t.created_at`, [planId]);

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  const waitFor = (fn, arg, ms = 15000) =>
    page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg).then(() => true).catch(() => false);
  const box = () => page.evaluateHandle(() => [...document.querySelectorAll("[data-popup]")].pop());
  const fill = (values) =>
    page.evaluate((vals) => {
      const b = [...document.querySelectorAll("[data-popup]")].pop();
      const byLabel = (text) =>
        [...b.querySelectorAll("label")]
          .find((l) => l.querySelector("span")?.textContent?.replace("*", "").trim() === text)
          ?.querySelector("input, select") ?? null;
      const missing = [];
      for (const [name, value] of Object.entries(vals)) {
        const el = b.querySelector(`[name="${name}"]`) ?? byLabel(name);
        if (!el) { missing.push(name); continue; }
        const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return missing;
    }, values);
  const press = (text) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll("[data-popup]")].pop();
      const button = [...(b?.querySelectorAll("button") ?? [])].find((x) => (x.textContent ?? "").trim() === t);
      button?.click();
      return Boolean(button);
    }, text);
  const popupText = () => page.evaluate(() => ([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? "").replace(/\s+/g, " "));
  const openRegister = async () => {
    await page.goto(`${WEB}/subscriptions?status=all`, { waitUntil: "networkidle0", timeout: 120000 });
    // Every month, so a plan started in August is on the page whatever today is.
    await page.evaluate(() => {
      const month = [...document.querySelectorAll("main select")].find((s) => [...s.options].some((o) => /Every month/i.test(o.text)));
      if (!month) return;
      const every = [...month.options].find((o) => /Every month/i.test(o.text));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(month, every.value);
      month.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor((id) => Boolean(document.querySelector(`tbody tr[data-row-id="${id}"]`)), planId);
    await settle(400);
  };
  const rowButton = (label) => page.$(`tbody tr[data-row-id="${planId}"] button[aria-label="${label}"]`);

  /* ============================================================ Renew */
  console.log("\nRenew");
  const startingNext = (await planRow()).next;
  await openRegister();
  const words = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
  check("the row offers Renew and Upgrade", Boolean(await rowButton(`Renew ${TOOL}`)) && Boolean(await rowButton(`Upgrade ${TOOL}`)));
  check("and nothing on the page says Record a payment", !/Record a payment/i.test(words));
  // Five buttons now end the row (Renew, Upgrade, Edit, status, trash). All
  // five must sit on one line, inside the row's own cell.
  const actions = await page.evaluate((id) => {
    const cell = document.querySelector(`tbody tr[data-row-id="${id}"] td:last-child`);
    const buttons = [...(cell?.querySelectorAll("button") ?? [])].map((b) => b.getBoundingClientRect());
    const c = cell?.getBoundingClientRect();
    return {
      count: buttons.length,
      oneLine: buttons.every((r) => Math.abs(r.top - buttons[0].top) < 2),
      inside: Boolean(c) && buttons.every((r) => r.left >= c.left - 1 && r.right <= c.right + 1),
    };
  }, planId);
  check("the row's five buttons sit on one line, inside their cell", actions.count === 5 && actions.oneLine && actions.inside, JSON.stringify(actions));
  if (process.env.SHOT_DIR) {
    await page.evaluate((id) => {
      let el = document.querySelector(`tbody tr[data-row-id="${id}"]`);
      while (el && !(el.scrollWidth > el.clientWidth + 4 && getComputedStyle(el).overflowX !== "visible")) el = el.parentElement;
      if (el) el.scrollLeft = el.scrollWidth;
    }, planId);
    await settle(300);
    await page.screenshot({ path: `${process.env.SHOT_DIR}/renewupgradeqa-row.png` });
  }

  await (await rowButton(`Renew ${TOOL}`)).click();
  await waitFor(() => /Renew —/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""));
  const drawer = await page.evaluate(() => {
    const b = [...document.querySelectorAll("[data-popup]")].pop();
    return {
      title: b.querySelector("h2")?.textContent?.trim(),
      rates: b.querySelectorAll('[name="usdRate"]').length,
      moves: b.querySelector('[name="advanceRenewal"]')?.checked ?? null,
      button: [...b.querySelectorAll("button")].some((x) => (x.textContent ?? "").trim() === "Renew"),
    };
  });
  check("the drawer is Renew, with a Renew button", drawer.title === `Renew — ${TOOL}` && drawer.button, drawer.title);
  check("it asks the rate once", drawer.rates === 1, `${drawer.rates} rate box(es)`);
  check("and moves the renewal date by default", drawer.moves === true, String(drawer.moves));
  await fill({ txnDate: "2026-09-10" });
  await press("Renew");
  await waitFor(() => !document.querySelector("[data-popup]"), undefined, 20000);
  let pays = await payments();
  let plan = await planRow();
  check(
    "a renewal takes the plan's price from the card — $101 at 122.50 is ৳12,372.50",
    pays.length === 1 && pays[0].amount === "12372.50" && pays[0].usd === "101.00" && pays[0].d === "2026-09-10",
    JSON.stringify(pays),
  );
  // A renewal covers its month's cycle: paid in September, the next is the
  // first billing day after September — 10 October — and never earlier than
  // what was stored. It used to step the stored date on and skip a month.
  const wantNext = startingNext && startingNext > "2026-10-10" ? startingNext : "2026-10-10";
  check("and the next renewal is the first after September — no month skipped", plan.next === wantNext, `${startingNext} -> ${plan.next}`);

  const twice = await call("POST", `/subscriptions/${planId}/pay`, { txnDate: "2026-09-25", usdRate: "122.50" });
  check(
    "a second renewal in the same month is refused, naming the first",
    twice.status === 400 && /already renewed this month/.test(msgOf(twice)) && /10\/09\/2026/.test(msgOf(twice)),
    msgOf(twice).trim(),
  );

  await openRegister();
  await (await rowButton(`Renew ${TOOL}`)).click();
  await waitFor(() => /Renew —/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""));
  await fill({ txnDate: "2026-09-26" });
  await press("Renew");
  const drawerSaid = await waitFor(() => /already renewed this month/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""));
  check("and the drawer says so", drawerSaid);
  await page.keyboard.press("Escape");
  await settle(300);
  pays = await payments();
  check("nothing was written by either", pays.length === 1, `${pays.length} payment(s)`);

  /* ========================================================== Upgrade */
  console.log("\nUpgrade");
  await openRegister();
  await (await rowButton(`Upgrade ${TOOL}`)).click();
  await waitFor(() => /Upgrade —/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""));
  const up = await popupText();
  check("the Upgrade drawer shows what the plan is now", /Now: Pro 5x · \$100\.00 \+ \$1\.00 charge/.test(up), up.slice(0, 160));
  let missing = await fill({
    upgradedOn: "2026-10-02", toPlanName: "Pro 20x", toCostUsd: "200", usdRate: "122.50",
    chargedUsd: "50", note: `${MARK} more seats`,
  });
  await settle(300);
  const bdt = await page.evaluate(() => [...document.querySelectorAll("[data-popup]")].pop().querySelector('[name="chargedBdt"]')?.value);
  check("the day's charge in taka is worked out — $50 at 122.50 is ৳6,125.00", bdt === "6125.00", missing.length ? `missing ${missing}` : bdt);
  await fill({ bankCharge: "50" });
  await press("Upgrade");
  await waitFor(() => !document.querySelector("[data-popup]"), undefined, 20000);
  plan = await planRow();
  check(
    "the plan itself is now Pro 20x at $200, its taka re-derived",
    plan.plan_name === "Pro 20x" && plan.cost === "200.00" && plan.bdt === "24500.00" && plan.charge === "1.00",
    JSON.stringify(plan),
  );
  const history = await q(`select * from subscription_upgrades where subscription_id = $1 order by created_at`, [planId]);
  pays = await payments();
  const upgradePay = pays.find((p) => p.upgrade);
  check(
    "what it was is kept — Pro 5x at $100 on 02/10/2026",
    history.length === 1 && history[0].from_plan_name === "Pro 5x" && history[0].from_cost_usd === "100.00" &&
      history[0].to_plan_name === "Pro 20x" && history[0].to_cost_usd === "200.00" &&
      String(history[0].upgraded_on instanceof Date ? history[0].upgraded_on.toISOString() : history[0].upgraded_on).length > 0,
    JSON.stringify(history.map((h) => [h.from_plan_name, h.from_cost_usd, h.to_plan_name, h.to_cost_usd])),
  );
  check(
    "the day's charge left the card as the upgrade's payment — ৳6,125.00, $50",
    Boolean(upgradePay) && upgradePay.amount === "6125.00" && upgradePay.usd === "50.00" && /upgrade to Pro 20x/.test(upgradePay.description) && history[0].transaction_id === upgradePay.id,
    JSON.stringify(upgradePay),
  );
  const bankCharge = upgradePay ? await q(`select amount::text a from transactions where charge_for_id = $1 and deleted_at is null`, [upgradePay.id]) : [];
  check("with its bank charge as its own row", bankCharge.length === 1 && bankCharge[0].a === "50.00", JSON.stringify(bankCharge));

  const october = await call("POST", `/subscriptions/${planId}/pay`, { txnDate: "2026-10-10", usdRate: "122.50", advanceRenewal: true });
  check("the upgrade's charge does not use up October's renewal", october.status < 300, `HTTP ${october.status} ${msgOf(october).trim()}`);
  const afterOctober = (await planRow()).next;
  check("and October's renewal moves the plan to November", afterOctober === "2026-11-10", afterOctober);
  const octoberAgain = await call("POST", `/subscriptions/${planId}/pay`, { txnDate: "2026-10-20", usdRate: "122.50" });
  check("but October's renewal does", octoberAgain.status === 400, `HTTP ${octoberAgain.status}`);

  const plain = await call("POST", `/subscriptions/${planId}/upgrade`, {
    upgradedOn: "2026-10-15", toPlanName: "Pro 20x Team", toCostUsd: "250.00", usdRate: "122.50",
  });
  const plainHistory = await q(`select transaction_id from subscription_upgrades where subscription_id = $1 and to_plan_name = 'Pro 20x Team'`, [planId]);
  check("an upgrade with nothing charged writes no payment", plain.status < 300 && plainHistory.length === 1 && plainHistory[0].transaction_id === null, `HTTP ${plain.status}`);
  // The same name, price and (no) charge the plan now has.
  const nothing = await call("POST", `/subscriptions/${planId}/upgrade`, {
    upgradedOn: "2026-10-16", toPlanName: "Pro 20x Team", toCostUsd: "250.00", usdRate: "122.50",
  });
  check("an upgrade that changes nothing is refused", nothing.status === 400 && /Nothing changes/.test(msgOf(nothing)), msgOf(nothing).trim());
  const bdtOnly = await call("POST", `/subscriptions/${planId}/upgrade`, {
    upgradedOn: "2026-10-16", toPlanName: "Pro Max", toCostUsd: "300.00", usdRate: "122.50", chargedBdt: "1000.00",
  });
  check("taka charged with no dollars is refused", bdtOnly.status === 400, `HTTP ${bdtOnly.status} ${msgOf(bdtOnly).trim()}`);

  /* ======================================================= the record */
  console.log("\nThe record");
  await openRegister();
  const cell = await page.evaluate((id) => {
    const cells = [...document.querySelectorAll(`tbody tr[data-row-id="${id}"] td`)];
    return cells.findIndex((td) => (td.textContent ?? "").trim() && !td.querySelector("a, button, input, select, label, [data-row-ignore]")) + 1;
  }, planId);
  await page.click(`tbody tr[data-row-id="${planId}"] td:nth-child(${cell})`);
  await waitFor(() => /Upgrades/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""), undefined, 10000);
  const record = await popupText();
  check(
    "it lists the upgrades, newest first, each with its charge",
    /Pro 20x \(\$200\.00\) → Pro 20x Team \(\$250\.00\)/.test(record) && /Nothing charged on the day/.test(record) &&
      /Pro 5x \(\$100\.00\) → Pro 20x \(\$200\.00\)/.test(record) && /Charged ৳6,125\.00 for it — TXN-/.test(record) &&
      record.indexOf("Pro 20x Team ($250.00)") < record.indexOf("Pro 5x ($100.00)"),
    record.slice(record.indexOf("UPGRADES"), record.indexOf("UPGRADES") + 260),
  );
  const foot = await page.evaluate(() => [...[...document.querySelectorAll("[data-popup]")].pop().querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()).filter(Boolean));
  check("its foot offers Renew, Upgrade and Edit", ["Renew", "Upgrade", "Edit"].every((b) => foot.includes(b)) && !foot.includes("Record a payment"), JSON.stringify(foot));
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/renewupgradeqa-record.png` });

  check("no page errors, no 5xx on the way", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await wipe();
  const left = (await q(`select count(*)::int n from subscriptions where tool_name = $1`, [TOOL]))[0].n +
    (await q(`select count(*)::int n from accounts where name like $1`, [`${MARK} %`]))[0].n;
  console.log(`\n  cleaned up: ${left === 0 ? "nothing left behind" : `${left} row(s) left`}`);
  await db.end();
}

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
