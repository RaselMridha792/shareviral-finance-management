/**
 * The sign-in page and the preloader, in the September 2026 design.
 *
 * Measured in a real browser, because every claim here is about what gets
 * painted: which half is where, what colour a border actually came out, whether
 * the sign-in button is still on screen in a short window, and — the one that
 * matters most — that the preloader's tick only appears once the app has
 * really rendered underneath it.
 *
 *     node .loginqa.mjs      (local only — creates and deletes two accounts)
 *
 * Needs `npm run dev` running (web :3000, api :4001).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = process.env.WEB ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? ".shots";

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

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const PLAIN = "login-probe@local.test";
const TWO_STEP = "login-probe-2fa@local.test";
const secret = crypto.randomBytes(18).toString("base64url") + "aA1!"; // never printed

const wipe = async () => {
  for (const email of [PLAIN, TWO_STEP]) {
    const who = "(select id from users where email=$1)";
    await db.query(`delete from recovery_codes where user_id in ${who}`, [email]);
    await db.query(`delete from user_two_factor where user_id in ${who}`, [email]);
    await db.query(`delete from refresh_tokens where user_id in ${who}`, [email]);
    await db.query("delete from users where email=$1", [email]);
  }
};
const makeUser = async (email, name) =>
  db.query(
    `insert into users (email, password_hash, full_name, role, status, token_version, must_change_password)
     values ($1, $2, $3, 'cfo', 'active', 0, false)`,
    [email, await bcrypt.hash(secret, 10), name],
  );

/* RFC 6238, as the API does it: SHA-1, six digits, thirty seconds. */
const base32 = (s) => {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += abc.indexOf(c).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
};
const totp = (key, at = Date.now()) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = crypto.createHmac("sha1", base32(key)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
};

const cookiesOf = (res) =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const api = (path, body, cookie) =>
  fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "finance-web",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

await wipe();
await makeUser(PLAIN, "Login Probe");
await makeUser(TWO_STEP, "Login Probe Two");

// Enrol the second account in two-step sign-in, through the API as a person would.
const enrolled = await (async () => {
  const cookie = cookiesOf(await api("/auth/login", { email: TWO_STEP, password: secret }));
  const setup = await (await api("/auth/2fa/setup", { password: secret }, cookie)).json();
  const confirm = await api("/auth/2fa/confirm", { code: totp(setup.secret) }, cookie);
  return confirm.ok ? setup.secret : null;
})();

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

const fresh = async (width, height, deviceScaleFactor = 1) => {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  // At 1x Chrome floors a 1.5px border to 1px; at 2x it keeps it.
  await page.setViewport({ width, height, deviceScaleFactor });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return { page, errors, context };
};
const settle = (page) => page.evaluate(() => document.fonts.ready.then(() => true));

try {
  /* ------------------------------------------------ 1. desktop, as drawn */
  console.log("\n1. 1440 × 900");
  {
    const { page, errors, context } = await fresh(1440, 900, 2);
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    await settle(page);
    const m = await page.evaluate(() => {
      const box = (el) => el && el.getBoundingClientRect().toJSON();
      const css = (el, p) => el && getComputedStyle(el).getPropertyValue(p);
      const brand = document.querySelector(".sv-login-brand");
      const form = document.querySelector("form");
      const h1 = document.querySelector("h1");
      const submit = document.querySelector('button[type="submit"]');
      // The password box: the email one is autofocused, so it is already violet.
      const field = document.querySelector('input[name="password"]').closest(".sv-field");
      const tile = h1?.parentElement?.previousElementSibling;
      return {
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        overflowY: document.documentElement.scrollHeight - window.innerHeight,
        brand: box(brand),
        brandShown: brand && css(brand, "display") !== "none",
        form: box(form),
        h1: h1?.textContent,
        h1Font: css(h1, "font-family"),
        h1Weight: css(h1, "font-weight"),
        jakarta: document.fonts.check('800 16px "Plus Jakarta Sans Variable"'),
        submitBg: css(submit, "background-color"),
        submitText: submit?.textContent,
        tileBg: css(tile, "background-color"),
        fieldBorder: css(field, "border-top-color"),
        fieldBorderWidth: css(field, "border-top-width"),
        modules: [...document.querySelectorAll(".sv-module")].map((li) => li.querySelector("span span")?.textContent),
        text: document.body.innerText,
      };
    });
    check("no sideways scroll", m.overflowX <= 0, `${m.overflowX}px`);
    check("fits one screen, no vertical scroll", m.overflowY <= 0, `${m.overflowY}px`);
    check("brand panel shown on the right of the form", m.brandShown && m.brand.x > m.form.x, `form x ${Math.round(m.form.x)}, brand x ${Math.round(m.brand.x)}`);
    check("the page's h1 is Sign in", m.h1 === "Sign in", m.h1);
    check("set in Plus Jakarta Sans, and the face actually loaded", /Plus Jakarta Sans Variable/.test(m.h1Font) && m.jakarta, m.h1Font.split(",")[0]);
    check("headings at 800", m.h1Weight === "800", m.h1Weight);
    check("sign-in button is the lime #BFFF00", m.submitBg === "rgb(191, 255, 0)", m.submitBg);
    check("lock tile is the violet #8558EC", m.tileBg === "rgb(133, 88, 236)", m.tileBg);
    // Colour only: Chrome snaps a 1.5px border to whole device pixels, so the
    // width it reports says more about the screen than about the page.
    check("field border is the design's line colour, not globals.css's", m.fieldBorder === "rgb(231, 235, 224)", `${m.fieldBorder} ${m.fieldBorderWidth}`);
    check("four module cards, in the design's order", m.modules.join("|") === "Accounts & cash|Expenses|Payroll|Tax & reports", m.modules.join(", "));
    for (const phrase of [
      "The company’s books, in one place.",
      "Books, payroll and tax in one app",
      "Company use only. Every sign-in attempt is recorded.",
      "Encrypted connection · ShareViral Finance",
      "Need access?",
    ]) check(`reads "${phrase}"`, m.text.includes(phrase));
    check("no Turnstile box pretending to verify anybody", !/Turnstile|verified/i.test(m.text));
    check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.screenshot({ path: `${SHOTS}/login-1440.png` });

    // Hover lifts a module card and gives it the violet edge.
    const card = await page.$(".sv-module");
    await card.hover();
    await new Promise((r) => setTimeout(r, 600));
    const lifted = await page.evaluate((el) => ({ border: getComputedStyle(el).borderTopColor, t: getComputedStyle(el).transform }), card);
    check("a module card lifts and turns violet under the pointer", lifted.border === "rgb(133, 88, 236)" && /matrix\(1, 0, 0, 1, 0, -2\)/.test(lifted.t), `${lifted.border} ${lifted.t}`);

    // Focus puts the ring on the box, not on the input inside it.
    await page.focus('input[name="email"]');
    const ring = await page.evaluate(() => {
      const input = document.querySelector('input[name="email"]');
      const box = input.closest(".sv-field");
      return { box: getComputedStyle(box).boxShadow, border: getComputedStyle(box).borderTopColor, outline: getComputedStyle(input).outlineStyle };
    });
    check("focused field: violet border and ring on the box", ring.border === "rgb(133, 88, 236)" && /241, 236, 254/.test(ring.box), `${ring.border}`);
    check("focused field: no second outline on the input", ring.outline === "none", ring.outline);
    await context.close();
  }

  /* ------------------------------------------------ 2. phone */
  console.log("\n2. 390 × 844");
  {
    const { page, context } = await fresh(390, 844);
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    await settle(page);
    const m = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      brand: getComputedStyle(document.querySelector(".sv-login-brand")).display,
      submit: document.querySelector('button[type="submit"]').getBoundingClientRect().toJSON(),
    }));
    check("no sideways scroll", m.overflowX <= 0, `${m.overflowX}px`);
    check("only the form below 860px", m.brand === "none", m.brand);
    check("sign-in button on screen", m.submit.bottom <= 844 && m.submit.width > 300, `${Math.round(m.submit.width)}px wide, bottom ${Math.round(m.submit.bottom)}`);
    await page.screenshot({ path: `${SHOTS}/login-390.png` });
    await context.close();
  }

  /* ------------------------------------------------ 3. short window */
  console.log("\n3. 1280 × 520 — the parts drop out rather than being squeezed");
  {
    const { page, context } = await fresh(1280, 520);
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    await settle(page);
    const m = await page.evaluate(() => {
      const shown = (el) => el && getComputedStyle(el).display !== "none";
      return {
        badge: shown(document.querySelector(".sv-badge")),
        modules: shown(document.querySelector(".sv-module")?.closest("div")),
        tile: shown(document.querySelector("h1").parentElement.previousElementSibling),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    check("badge gone below 640px", !m.badge);
    check("module cards gone below 600px", !m.modules);
    check("lock tile gone below 560px", !m.tile);
    // The submit button is reachable — scroll to it if it has to be.
    const reach = await page.evaluate(() => {
      const b = document.querySelector('button[type="submit"]');
      b.scrollIntoView({ block: "nearest" });
      const r = b.getBoundingClientRect();
      return r.bottom <= window.innerHeight && r.top >= 0;
    });
    check("sign-in button reachable", reach);
    check("no sideways scroll", m.overflowX <= 0, `${m.overflowX}px`);
    await page.screenshot({ path: `${SHOTS}/login-short.png` });
    await context.close();
  }

  /* ------------------------------------------------ 4. notices and answers */
  console.log("\n4. The violet line");
  {
    const { page, context } = await fresh(1440, 900);
    const noteText = () => page.evaluate(() => document.querySelector(".sv-notice")?.innerText ?? null);
    await page.goto(`${WEB}/login?reason=idle`, { waitUntil: "networkidle0" });
    check("idle sign-out explains itself", (await noteText()) === "Your session expired. Please sign in again.", await noteText());
    await page.click('.sv-notice button[aria-label="Dismiss"]');
    check("and can be dismissed", (await noteText()) === null);
    await page.goto(`${WEB}/login?reason=signed-out`, { waitUntil: "networkidle0" });
    check("a deliberate sign-out says so", (await noteText()) === "You have signed out.", await noteText());
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    check("nothing when nothing sent them", (await noteText()) === null);
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Forgot password?").click());
    check("Forgot password? says who resets it", /Settings → People who can sign in/.test((await noteText()) ?? ""), await noteText());
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Contact admin")).click());
    check("Contact admin says who makes accounts", /administrator/.test((await noteText()) ?? ""), await noteText());
    await context.close();
  }

  /* ------------------------------------------------ 5. refusals */
  console.log("\n5. Refusals");
  {
    const { page, context } = await fresh(1440, 900);
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    const state = () =>
      page.evaluate(() => ({
        error: document.querySelector('[role="alert"]')?.innerText ?? null,
        emailBad: document.querySelector('input[name="email"]').closest(".sv-field").dataset.invalid,
        passwordBad: document.querySelector('input[name="password"]').closest(".sv-field").dataset.invalid,
        border: getComputedStyle(document.querySelector('input[name="email"]').closest(".sv-field")).borderTopColor,
        path: location.pathname,
      }));
    await page.click('button[type="submit"]');
    let s = await state();
    check("empty: asks for the email, and marks that box", s.error === "Enter your email address." && s.emailBad === "true", `${s.error}`);
    await page.type('input[name="email"]', PLAIN);
    s = await state();
    check("typing clears the complaint", s.error === null && s.emailBad === "false");
    await page.click('button[type="submit"]');
    s = await state();
    check("no password: asks for it, marks that box", s.error === "Enter your password." && s.passwordBad === "true", `${s.error}`);
    await page.type('input[name="password"]', "definitely-not-it");
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('[role="alert"]'), { timeout: 10000 });
    s = await state();
    check("wrong password: the API's own sentence, still on /login", Boolean(s.error) && s.path === "/login", s.error);
    // The eye shows and hides without moving focus off the keyboard path.
    await page.click('button[aria-label="Show the password"]');
    const type = await page.$eval('input[name="password"]', (i) => i.type);
    check("the eye shows the password", type === "text");
    await context.close();
  }

  /* ------------------------------------------------ 6. in, through the preloader */
  console.log("\n6. Signing in — the preloader");
  {
    const { page, errors, context } = await fresh(1440, 900);
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    await settle(page);
    // Record what the overlay says, and the path, every frame, from inside the page.
    await page.evaluate(() => {
      window.__log = [];
      const t0 = performance.now();
      const tick = () => {
        const o = document.querySelector(".sv-preloader");
        window.__log.push({
          t: Math.round(performance.now() - t0),
          path: location.pathname,
          on: Boolean(o),
          status: o?.querySelector('[role="status"] p:nth-of-type(2)')?.textContent ?? null,
          pct: o?.querySelector(".tabular-nums")?.textContent ?? null,
          leaving: o?.dataset.leaving ?? null,
          tick: Boolean(o?.querySelector("path.sv-pl-draw")),
        });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.type('input[name="email"]', PLAIN);
    await page.type('input[name="password"]', secret);
    await page.click('button[type="submit"]');
    await page.waitForSelector(".sv-preloader", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${SHOTS}/preloader-load.png` });
    await page.waitForFunction(() => document.querySelector(".sv-preloader path.sv-pl-draw"), { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 250));
    await page.screenshot({ path: `${SHOTS}/preloader-tick.png` });
    await page.waitForFunction(() => !document.querySelector(".sv-preloader"), { timeout: 30000 });
    const log = await page.evaluate(() => window.__log);
    const on = log.filter((f) => f.on);
    const firstOn = on[0];
    const arrived = log.find((f) => f.path !== "/login");
    const firstTick = log.find((f) => f.tick);
    const gone = log.find((f, i) => i > log.indexOf(firstOn) && !f.on);
    const statuses = [...new Set(on.map((f) => f.status).filter(Boolean))];
    const pcts = on.map((f) => parseInt(f.pct)).filter((n) => !Number.isNaN(n));
    check("the overlay appears on sign-in", Boolean(firstOn), `at ${firstOn?.t}ms`);
    check("the tick waits for the app: path changed before it", arrived && firstTick && arrived.t < firstTick.t, `path ${arrived?.path} at ${arrived?.t}ms, tick at ${firstTick?.t}ms`);
    check("the bar only ever climbs", pcts.every((n, i) => i === 0 || n >= pcts[i - 1]), `${pcts[0]}% → ${pcts.at(-1)}%`);
    check("reaches 100% before the tick", log.filter((f) => f.tick).every((f) => f.pct === "100%"));
    check("walks the handoff's lines, ending on welcome back", statuses.at(-1) === "Ready — welcome back" && statuses.includes("Opening the books…"), statuses.join(" → "));
    check("fades out and removes itself", Boolean(gone), `gone at ${gone?.t}ms, total ${gone ? gone.t - firstOn.t : "?"}ms`);
    const after = await page.evaluate(() => ({
      path: location.pathname,
      overflow: document.body.style.overflow,
      rail: Boolean(document.querySelector("aside, nav")),
    }));
    check("lands on the dashboard", after.path === "/" && after.rail, after.path);
    check("hands the scroll back", after.overflow === "", `body overflow "${after.overflow}"`);
    check("no console errors on the way", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.screenshot({ path: `${SHOTS}/after-signin.png` });

    // Navigating inside the app never shows it.
    await page.evaluate(() => {
      window.__seen = false;
      new MutationObserver(() => {
        if (document.querySelector(".sv-preloader")) window.__seen = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.evaluate(() => document.querySelector('a[href="/transactions"]')?.click());
    await page.waitForFunction(() => location.pathname === "/transactions", { timeout: 20000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    check("an ordinary navigation does not show it", !(await page.evaluate(() => window.__seen)));

    // Signing out lands back here with the line that says so.
    await page.click('button[aria-label="Sign out"]');
    await page.waitForFunction(() => location.pathname === "/login", { timeout: 20000 });
    await page.waitForSelector(".sv-notice", { timeout: 10000 }).catch(() => {});
    const out = await page.evaluate(() => ({ search: location.search, note: document.querySelector(".sv-notice")?.innerText }));
    check("sign-out comes back with \"You have signed out.\"", out.note === "You have signed out.", `${out.search} ${out.note}`);
    await context.close();
  }

  /* ------------------------------------------------ 7. the second step */
  console.log("\n7. Two-step sign-in");
  if (!enrolled) {
    check("the probe account enrolled in two-step sign-in", false, "setup/confirm refused");
  } else {
    const { page, errors, context } = await fresh(1440, 900);
    await page.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    await page.type('input[name="email"]', TWO_STEP);
    await page.type('input[name="password"]', secret);
    await page.click('button[type="submit"]');
    await page.waitForSelector('input[name="code"]', { timeout: 10000 });
    const step = await page.evaluate(() => ({
      h1: document.querySelector("h1").textContent,
      field: Boolean(document.querySelector('input[name="code"]').closest(".sv-field")),
      password: Boolean(document.querySelector('input[name="password"]')),
    }));
    check("asks for the code, in the same design", step.h1 === "Enter your code" && step.field, step.h1);
    check("the password is no longer on screen", !step.password);
    await page.screenshot({ path: `${SHOTS}/login-code.png` });
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Lost your phone")).click());
    check("the recovery-code way out is there", (await page.$eval("h1", (h) => h.textContent)) === "Use a recovery code");
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("Use my authenticator")).click());
    await page.type('input[name="code"]', "000000");
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.querySelector('[role="alert"]'), { timeout: 10000 });
    check("a wrong code is refused, in words", Boolean(await page.$eval('[role="alert"]', (e) => e.textContent)), await page.$eval('[role="alert"]', (e) => e.textContent));
    // The enrolment spent this window's code; wait for the next one.
    const wait = 30_000 - (Date.now() % 30_000) + 1500;
    await new Promise((r) => setTimeout(r, wait));
    await page.$eval('input[name="code"]', (i) => i.select());
    await page.type('input[name="code"]', totp(enrolled));
    await page.click('button[type="submit"]');
    await page.waitForSelector(".sv-preloader", { timeout: 10000 }).then(
      () => check("the right code goes through the preloader too", true),
      () => check("the right code goes through the preloader too", false),
    );
    await page.waitForFunction(() => !document.querySelector(".sv-preloader") && location.pathname === "/", { timeout: 30000 }).then(
      () => check("and lands on the dashboard", true),
      async () => check("and lands on the dashboard", false, await page.evaluate(() => location.href)),
    );
    // The wrong code above is a deliberate 401, and the browser logs every one.
    const other = errors.filter((e) => !/status of 401/.test(e));
    check("no console errors beyond the refused code", other.length === 0, other.slice(0, 2).join(" | "));
    await context.close();
  }
} finally {
  await browser.close();
  await wipe();
  const left = await db.query("select count(*)::int as n from users where email in ($1, $2)", [PLAIN, TWO_STEP]);
  check("both probe accounts removed", left.rows[0].n === 0);
  await db.end();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
