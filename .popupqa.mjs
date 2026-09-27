/**
 * Every form opens in a popup now, not a slide-over — measured on the screens
 * that open them.
 *
 * What a popup has to get right, none of which a diff shows: it is centred and
 * inside the window; a long form scrolls inside it with the title and the
 * buttons still on screen; it wraps its text even when opened from a table
 * cell; Escape, the X and the backdrop all close it and give the page its
 * scroll back; and a popup opened from inside another one lands centred on the
 * window rather than trapped in the first.
 *
 *     node .popupqa.mjs      (local only — opens forms, saves nothing)
 *
 * Needs `npm run dev` running (web :3000, api :4001).
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB ?? "http://localhost:3000";
const SHOTS = ".shots";

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
const { rows } = await db.query(
  `select id, role, token_version from users
    where role = 'super_admin' and status = 'active' and deleted_at is null
    order by created_at limit 1`,
);
await db.end();
const token = jwt.sign({ sub: rows[0].id, role: rows[0].role, tv: rows[0].token_version }, env.JWT_ACCESS_SECRET, {
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
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const settle = (ms = 450) => new Promise((r) => setTimeout(r, ms));
const open = async (path) => {
  await page.goto(`${WEB}${path}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(600);
};
const clickText = (text, scope = "main") =>
  page.evaluate(
    (text, scope) => {
      const root = document.querySelector(scope) ?? document;
      const b = [...root.querySelectorAll("button, [role=tab], a")].find(
        (x) => x.textContent.trim() === text && !x.closest('[role="dialog"]'),
      );
      b?.click();
      return Boolean(b);
    },
    text,
    scope,
  );

/** The popup's geometry and the three ways of reading whether it is usable. */
const measure = () =>
  page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"][aria-labelledby]')];
    const d = dialogs[dialogs.length - 1];
    if (!d) return null;
    const panel = d.querySelector(".sv-popup-panel");
    const r = panel.getBoundingClientRect();
    const title = document.getElementById(d.getAttribute("aria-labelledby"))?.textContent;
    const footer = panel.querySelector("footer");
    const submit = panel.querySelector('button[type="submit"]') ?? footer?.querySelector("button:last-child");
    // Scrolled to, inside the popup, the way a person would reach it.
    submit?.scrollIntoView({ block: "nearest" });
    const sr = submit?.getBoundingClientRect();
    const s = getComputedStyle(d);
    return {
      count: dialogs.length,
      title,
      w: Math.round(r.width),
      cx: Math.round(r.left + r.width / 2 - innerWidth / 2),
      cy: Math.round(r.top + r.height / 2 - innerHeight / 2),
      inside: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
      submitVisible: sr ? sr.top >= 0 && sr.bottom <= innerHeight : null,
      wrap: s.whiteSpace,
      align: s.textAlign,
      bodyScrolls: (() => {
        const body = panel.children[1];
        return body.scrollHeight > body.clientHeight;
      })(),
      locked: document.body.style.overflow,
    };
  });
const gone = () => page.evaluate(() => ({ dialogs: document.querySelectorAll('[role="dialog"][aria-labelledby]').length, overflow: document.body.style.overflow }));

const CASES = [
  { path: "/accounts", button: "Add account", title: /account/i },
  { path: "/accounts/cash-in", button: "Add cash", title: /Add cash/ },
  { path: "/transfers", button: "New transfer", title: /Move money/ },
  { path: "/expenses/other", button: "Add expense", title: /Record a movement/ },
  { path: "/subscriptions", button: "Add a subscription", title: /subscription/i },
  { path: "/payroll", button: "New month", title: /payroll month/ },
];

try {
  await page.setViewport({ width: 1440, height: 900 });
  const closers = ["Escape", "X", "backdrop"];

  for (const [i, c] of CASES.entries()) {
    console.log(`\n${c.path} — ${c.button}`);
    await open(c.path);
    const clicked = await clickText(c.button);
    await settle();
    const m = await measure();
    if (!clicked || !m) {
      check("opens", false, clicked ? "no popup appeared" : `no "${c.button}" button`);
      continue;
    }
    check(`opens "${m.title}"`, c.title.test(m.title ?? ""));
    check("centred on the window", Math.abs(m.cx) <= 2 && Math.abs(m.cy) <= 2, `off by ${m.cx}, ${m.cy}px`);
    check("at most 560px, wholly inside the window", m.w <= 560 && m.inside, `${m.w}px`);
    check("the submit button can be reached inside the popup", m.submitVisible !== false, m.bodyScrolls ? "the form scrolls inside" : "fits");
    check("the page behind is held still", m.locked === "hidden");
    if (i === 3) await page.screenshot({ path: `${SHOTS}/popup-transaction.png` });
    if (i === 0) await page.screenshot({ path: `${SHOTS}/popup-account.png` });

    // Close it one of three ways, in turn.
    const how = closers[i % 3];
    if (how === "Escape") await page.keyboard.press("Escape");
    if (how === "X") await page.click('.sv-popup-panel header button[aria-label="Close"]');
    if (how === "backdrop") await page.mouse.click(12, 450);
    await settle(250);
    const g = await gone();
    check(`${how} closes it and gives the scroll back`, g.dialogs === 0 && g.overflow === "", `${g.dialogs} open, overflow "${g.overflow}"`);
  }

  /* ------------------------------------------------ a popup inside a popup */
  console.log("\n/expenses/other — a category added from inside the form");
  await open("/expenses/other");
  await clickText("Add expense");
  await settle();
  const opened = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes("Choose a category"));
    trigger?.click();
    return Boolean(trigger);
  });
  await settle(250);
  const created = await page.evaluate(() => {
    const add = [...document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="option"]')].find((b) => b.textContent.trim().startsWith("Add a category"));
    add?.click();
    return Boolean(add);
  });
  await settle();
  const nested = await measure();
  check("the category popup opens from inside the form", opened && created && nested?.count === 2, `${nested?.count ?? 0} popups`);
  if (nested) {
    check("and is centred on the window, not trapped in the form", Math.abs(nested.cx) <= 2 && Math.abs(nested.cy) <= 2 && nested.inside, `off by ${nested.cx}, ${nested.cy}px`);
    await page.screenshot({ path: `${SHOTS}/popup-nested.png` });

    // Submitting the category popup must not submit the form it was opened
    // from. Every write is refused at the network, so nothing is saved either
    // way; what is recorded is whether the transaction form TRIED.
    const outerBefore = await page.evaluate(() => document.querySelector("#txn-form")?.closest(".sv-popup-panel")?.innerText ?? "");
    const tried = [];
    await page.setRequestInterception(true);
    const onRequest = (req) => {
      if (req.method() === "POST" && /\/api\/(transactions|categories)/.test(req.url())) {
        tried.push(new URL(req.url()).pathname);
        req.abort();
      } else req.continue();
    };
    page.on("request", onRequest);
    await page.evaluate(() => {
      const panels = document.querySelectorAll(".sv-popup-panel");
      const inner = panels[panels.length - 1];
      const name = inner.querySelector('input[name="name"]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(name, "QA popup probe");
      name.dispatchEvent(new Event("input", { bubbles: true }));
      inner.querySelector("form").requestSubmit();
    });
    await settle(1200);
    page.off("request", onRequest);
    await page.setRequestInterception(false);
    const outerAfter = await page.evaluate(() => document.querySelector("#txn-form")?.closest(".sv-popup-panel")?.innerText ?? "");
    check("the category form did submit", tried.includes("/api/categories"), tried.join(", ") || "nothing sent");
    check("and the transaction form under it did NOT", !tried.includes("/api/transactions") && outerAfter === outerBefore, tried.includes("/api/transactions") ? "it POSTed a transaction" : outerAfter === outerBefore ? "untouched" : "it changed: an error appeared");

    await page.keyboard.press("Escape");
    await settle(250);
    check("Escape closed only the popup on top", (await gone()).dialogs === 1);
    await page.keyboard.press("Escape");
    await settle(250);
  }

  /* ------------------------------------------------ settings */
  console.log("\n/settings — two panels");
  await open("/settings");
  for (const [tab, button] of [["Categories", "Add heading"], ["People who can sign in", "Add someone"]]) {
    await clickText(tab, "body");
    await settle(900);
    const ok = await clickText(button);
    await settle();
    const m = await measure();
    check(`${button} opens as a centred popup`, ok && m && Math.abs(m.cx) <= 2 && Math.abs(m.cy) <= 2 && m.inside, m ? `${m.title}, ${m.w}px` : "none");
    await page.keyboard.press("Escape");
    await settle(250);
  }

  /* ------------------------------------------------ a phone */
  console.log("\nA phone, 390 × 844");
  await page.setViewport({ width: 390, height: 844 });
  await open("/expenses/other");
  await clickText("Add expense");
  await settle();
  const p = await measure();
  check("fills the width less its gutter, inside the window", p && p.inside && p.w >= 360, p ? `${p.w}px` : "none");
  check("the submit button is still reachable", p?.submitVisible !== false);
  await page.screenshot({ path: `${SHOTS}/popup-phone.png` });

  /* ------------------------------------------------ dark */
  console.log("\nDark");
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(() => localStorage.setItem("svf-theme-brand", "dark"));
  await open("/accounts/cash-in");
  await clickText("Add cash");
  await settle();
  const dark = await page.evaluate(() => getComputedStyle(document.querySelector(".sv-popup-panel")).backgroundColor);
  check("dark: the design's surface", dark === "rgb(20, 24, 15)", dark);
  await page.screenshot({ path: `${SHOTS}/popup-dark.png` });
  await page.evaluate(() => localStorage.removeItem("svf-theme-brand"));

  // The probe's own refused writes are logged as failed loads; nothing else may be.
  const real = errors.filter((e) => !/net::ERR_FAILED/.test(e));
  check("no console errors anywhere", real.length === 0, real.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
