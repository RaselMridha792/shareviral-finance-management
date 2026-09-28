/**
 * AI tools and subscriptions: a click opens the plan's record in a popup.
 *
 * The owner, 28 Sep 2026: *"Ai tools and subscription page tao thik korte
 * hobe. ekhane click korle single page a jabena sudhu popup open hobe ei table
 * er khetreo and ager gular moto table er row te click korlei jeno popup ta
 * ase"*. The tool's name used to go to `/subscriptions/[id]`.
 *
 * Checked here, on a plan made for the purpose and removed after:
 *   - the name opens the popup and the address does not change;
 *   - a click on a plain cell of the row opens it too; the tick box does not;
 *   - the popup carries what the plan's page carried — plan, cost, rate, taka,
 *     cycle, login, department, website, the invoice with its eye, the note;
 *   - its View opens the plan's invoice, its Edit opens the plan's form;
 *   - nothing errors on the way.
 *
 *     node .subspopupqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
const TOOL = "SUBPOPQA Tool";

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
const H = { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web" };
const today = (await q(`select (now() at time zone 'Asia/Dhaka')::date::text d`))[0].d;

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function wipe() {
  const subs = (await q(`select id from subscriptions where tool_name = $1`, [TOOL])).map((r) => r.id);
  if (!subs.length) return;
  const files = await q(`select id, deleted_at from files where subscription_id = any($1::uuid[])`, [subs]);
  for (const f of files.filter((f) => !f.deleted_at)) {
    await fetch(`${API}/files/${f.id}`, { method: "DELETE", headers: H }).catch(() => undefined);
  }
  const ids = [...subs, ...files.map((f) => f.id)];
  await q(`delete from audit_logs where entity_id = any($1::text[])`, [ids]);
  if (files.length) await q(`delete from files where id = any($1::uuid[])`, [files.map((f) => f.id)]);
  await q(`delete from subscription_users where subscription_id = any($1::uuid[])`, [subs]);
  await q(`delete from subscriptions where id = any($1::uuid[])`, [subs]);
}
await wipe();

const created = await fetch(`${API}/subscriptions`, {
  method: "POST",
  headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({
    toolName: TOOL,
    planName: "Max Plan 20x",
    category: "ai_tool",
    status: "active",
    costUsd: "20.00",
    usdRate: "122.50",
    billingCycle: "monthly",
    startDate: today,
    loginEmail: "subpopqa@shareviral.cash",
    boughtFor: "Engineering Core",
    websiteUrl: "https://example.com/subpopqa",
    notes: "SUBPOPQA the note, given room",
  }),
});
const plan = await created.json().catch(() => null);
check("fixture: a plan", created.status < 300 && Boolean(plan?.id), `HTTP ${created.status} ${plan?.id ? "" : JSON.stringify(plan)}`);

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR42mP8z8BQz0AEYBxVSF+FAAsLBAF6r4OeAAAAAElFTkSuQmCC", "base64");
const form = new FormData();
form.append("file", new Blob([PNG, Buffer.from("\nsubpopqa\n")], { type: "image/png" }), "subpopqa-invoice.png");
form.append("kind", "invoice");
const up = await fetch(`${API}/files/subscription/${plan.id}`, { method: "POST", headers: H, body: form });
check("fixture: an invoice on it", up.status < 300, `HTTP ${up.status}`);

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
try {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  const waitFor = (fn, arg, ms = 15000) =>
    page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg).then(() => true).catch(() => false);
  const popup = () =>
    page.evaluate(() => {
      const box = [...document.querySelectorAll("[data-popup]")].pop();
      if (!box) return null;
      return {
        title: box.querySelector("h2")?.textContent?.trim() ?? null,
        text: (box.innerText ?? "").replace(/\s+/g, " "),
        buttons: [...box.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()).filter(Boolean),
      };
    });
  const closeAll = async () => {
    for (let i = 0; i < 3 && (await page.$("[data-popup]")); i++) {
      await page.keyboard.press("Escape");
      await settle(300);
    }
  };

  await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
  const row = `tbody tr[data-row-id="${plan.id}"]`;
  check("the plan is on the register", await waitFor((sel) => Boolean(document.querySelector(sel)), row));

  /* The name. */
  const before = page.url();
  await page.evaluate((sel, tool) => {
    [...document.querySelectorAll(`${sel} button`)].find((b) => (b.textContent ?? "").trim() === tool)?.click();
  }, row, TOOL);
  await waitFor(() => Boolean(document.querySelector("[data-popup] h2")), undefined, 8000);
  await settle(400);
  let shown = await popup();
  check("the tool's name opens the popup", shown?.title === TOOL, JSON.stringify(shown?.title));
  check("and does not leave the register", page.url() === before, page.url());
  const text = shown?.text ?? "";
  for (const [what, re] of [
    ["the plan", /Plan Max Plan 20x/],
    ["the cost in dollars", /Cost \(USD\) \$20\.00/],
    ["the rate", /USD rate 122\.50/],
    ["the taka it comes to", /Equivalent \(BDT\) ৳2,450\.00/],
    ["the cycle", /Billing cycle Monthly/],
    ["the login", /Login accounts subpopqa@shareviral\.cash/],
    ["the department", /Department Engineering Core/],
    ["the website", /Open SUBPOPQA Tool/],
    ["the invoice, with its eye", /Invoice 1 attached View/],
    ["the note", /SUBPOPQA the note, given room/],
  ]) {
    check(`it carries ${what}`, re.test(text), re.test(text) ? "" : text.slice(0, 260));
  }
  // Renew and Upgrade since #111 — "Record a payment" was renamed on the
  // owner's word, and Upgrade changes the plan in place.
  check("its foot offers Renew, Upgrade and Edit", ["Renew", "Upgrade", "Edit"].every((b) => shown?.buttons.includes(b)), JSON.stringify(shown?.buttons));
  // SHOT_DIR=<folder> keeps a picture of the popup, for a person to look at.
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/subspopupqa-popup.png` });
    await page.evaluate(() => {
      const box = [...document.querySelectorAll("[data-popup]")].pop();
      const scroller = [...box.querySelectorAll("*")].find((el) => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== "visible");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await settle(300);
    await page.screenshot({ path: `${process.env.SHOT_DIR}/subspopupqa-popup-end.png` });
  }

  /* Its View opens the invoice. */
  await page.evaluate(() => {
    const box = [...document.querySelectorAll("[data-popup]")].pop();
    [...box.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "View")?.click();
  });
  const docs = await waitFor(() => /subpopqa-invoice\.png/.test(document.body.innerText), undefined, 8000);
  check("its View opens the plan's invoice", docs);
  await closeAll();

  /* A plain cell of the row. */
  const cellIndex = await page.evaluate((sel) => {
    const cells = [...document.querySelectorAll(`${sel} td`)];
    return cells.findIndex((td) => (td.textContent ?? "").trim() && !td.querySelector("a, button, input, select, label, [data-row-ignore]")) + 1;
  }, row);
  await page.click(`${row} td:nth-child(${cellIndex})`);
  await waitFor(() => Boolean(document.querySelector("[data-popup] h2")), undefined, 8000);
  shown = await popup();
  check("a click anywhere on the row opens it too", shown?.title === TOOL, `cell ${cellIndex}: ${JSON.stringify(shown?.title)}`);

  /* Edit from the popup. */
  await page.evaluate(() => {
    const box = [...document.querySelectorAll("[data-popup]")].pop();
    [...box.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Edit")?.click();
  });
  await waitFor(() => Boolean([...document.querySelectorAll("[data-popup]")].pop()?.querySelector("form")), undefined, 8000);
  shown = await popup();
  check("its Edit opens the plan's form, in place of the record", shown?.title === "Max Plan 20x" && (await page.$$("[data-popup]")).length === 1, JSON.stringify(shown?.title));
  await closeAll();

  /* The tick box keeps its own click. */
  await page.click(`${row} input[type="checkbox"]`);
  await settle(500);
  const ticked = await page.evaluate((sel) => document.querySelector(`${sel} input[type="checkbox"]`)?.checked ?? null, row);
  check("the tick box ticks and opens nothing", ticked === true && !(await page.$("[data-popup]")), `checked ${ticked}`);

  check("no page errors, no 5xx on the way", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  await wipe();
  const left = (await q(`select count(*)::int n from subscriptions where tool_name = $1`, [TOOL]))[0].n;
  console.log(`\n  cleaned up: ${left === 0 ? "nothing left behind" : `${left} plan(s) left`}`);
  await db.end();
}

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
