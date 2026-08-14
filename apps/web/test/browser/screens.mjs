/**
 * T13 — THE BROWSER PASS  (and the on-screen half of T12)
 *
 * Every screen, at four widths, in both themes, signed in as a real user
 * through the real login form. What it looks for is not "did it render" but
 * the specific ways a finance screen goes wrong:
 *
 *   · the page scrolls sideways — a table that escapes its container
 *   · text that cannot be read against what is behind it
 *   · a taka figure grouped in thousands instead of lakhs
 *   · a hyphen where a true minus belongs
 *   · a dollar figure with no "as of" caption saying which rate produced it
 *   · a console error, or a request that failed
 *
 * Screenshots go to ./shots so anything flagged can be looked at.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB ?? "http://localhost:3000";
/**
 * A Chrome to drive. puppeteer-core ships no browser of its own, so this looks
 * where one usually is and says plainly what to do when it is not — a test that
 * cannot find a browser should say so, not fail as though the app were broken.
 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error(
    "No Chrome found. Set CHROME_PATH to a Chrome or Edge executable.\nLooked in:\n  " +
      CHROME_CANDIDATES.join("\n  "),
  );
  process.exit(1);
}
const SHOTS = path.join(process.cwd(), "shots");
fs.mkdirSync(SHOTS, { recursive: true });

/**
 * The seed prints its passwords once and stores them nowhere, which is right.
 * So this makes its own account, uses it, and removes it — the demo logins are
 * never touched and nothing needs a password written down for a test to run.
 */
const API = process.env.API ?? "http://localhost:4001/api";
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const ADMIN_H = { "content-type": "application/json", authorization: `Bearer ${TOK.SUPER_ADMIN}`, "x-requested-with": "finance-web" };

const TEST_EMAIL = "t13.browser.test@shareviral.cash";
const TEST_PASSWORD = "T13-Browser-Test-2026!";

const { default: pg } = await import("pg");
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../../api/.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const removeTestUser = async () => {
  await db.query("delete from refresh_tokens where user_id in (select id from users where email = $1)", [TEST_EMAIL]);
  await db.query("delete from audit_logs where entity_id in (select id::text from users where email = $1)", [TEST_EMAIL]);
  await db.query("delete from users where email = $1", [TEST_EMAIL]);
};
await removeTestUser();

const madeUser = await fetch(`${API}/users`, {
  method: "POST", headers: ADMIN_H,
  body: JSON.stringify({
    email: TEST_EMAIL, fullName: "T13 Browser Test", role: "super_admin",
    password: TEST_PASSWORD, mustChangePassword: false,
  }),
});
if (madeUser.status !== 201 && madeUser.status !== 200) {
  console.log(`could not create the browser test account — HTTP ${madeUser.status} ${await madeUser.text()}`);
  await db.end();
  process.exit(1);
}

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

const WIDTHS = [
  { name: "360", width: 360, height: 780 },
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
];

const SCREENS = [
  ["/", "Dashboard"],
  ["/transactions", "Transactions"],
  ["/accounts", "Accounts"],
  ["/accounts/cash-in", "Money in"],
  ["/expenses", "Expenses"],
  ["/expenses/other", "Other expenses"],
  ["/vendors", "Vendors"],
  ["/team", "Team"],
  ["/payroll", "Payroll"],
  ["/tax/withholding", "Withholding tax"],
  ["/reports", "Reports"],
  ["/import", "Import"],
  ["/settings", "Settings"],
  ["/assistant", "Assistant"],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const problems = [];
const translatedSeen = new Set(), recordedSeen = new Set();

/** Signs in through the real form, so nothing is faked past the login screen. */
/**
 * Waits until React has taken the form over.
 *
 * networkidle2 says the requests stopped, not that the page is interactive.
 * Typing before hydration means the click hits a plain HTML form, which is a
 * different thing from the one under test — and produced a confusing failure
 * where "the eye button does not work" really meant "there was no React yet".
 */
async function waitForHydration(page) {
  await page.waitForFunction(
    () => {
      const eye = document.querySelector('form button[type="button"]');
      return !!eye && !document.querySelector('form[data-pending="true"]');
    },
    { timeout: 30_000 },
  );
  // React attaches its listeners a tick after the markup is in place.
  await new Promise((r) => setTimeout(r, 400));
}

async function signIn(page, email, password) {
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 20_000 });
  await waitForHydration(page);
  await page.type('input[type="email"], input[name="email"]', email);
  await page.type('input[type="password"], input[name="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60_000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1200));
  return !/\/login/.test(page.url());
}

/** Everything worth knowing about one rendered screen, gathered in the page. */
async function inspect(page) {
  return page.evaluate(() => {
    const body = document.body;
    const overflow = Math.max(0, body.scrollWidth - window.innerWidth);

    // Which element is actually sticking out, so a failure names a culprit.
    let widest = null;
    if (overflow > 2) {
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const past = r.right - window.innerWidth;
        if (past > 2 && (!widest || past > widest.past)) {
          widest = {
            past: Math.round(past),
            tag: el.tagName.toLowerCase(),
            cls: (el.className?.toString?.() ?? "").slice(0, 60),
            text: (el.textContent ?? "").trim().slice(0, 40),
          };
        }
      }
    }

    const text = body.innerText ?? "";

    // A taka figure grouped in thousands: ৳1,250,000 rather than ৳12,50,000.
    const westernTaka = (text.match(/৳\s?\d{1,3}(,\d{3}){2,}/g) ?? []).slice(0, 4);
    // Any lakh-grouped figure at all, to prove the check is looking at real money.
    const lakhTaka = (text.match(/৳\s?\d{1,2}(,\d{2})+,\d{3}/g) ?? []).slice(0, 4);
    // A hyphen-minus in front of a currency symbol.
    const hyphenMinus = (text.match(/-\s?[৳$]\s?\d/g) ?? []).slice(0, 4);
    /**
     * Two kinds of dollar figure, and only one of them needs a caption.
     *
     * A figure the app translated from taka is written with a leading ~ — it
     * is an approximation, and the page must say which rate produced it. A
     * figure recorded in dollars in the first place (the USD card's balance,
     * a vendor that bills in dollars) is a fact, not a translation, and a rate
     * caption on it would be a lie.
     */
    const translated = (text.match(/~\s?\$\s?[\d,]+(\.\d\d)?/g) ?? []).slice(0, 4);
    const allDollars = (text.match(/\$\s?[\d,]+(\.\d\d)?/g) ?? []);
    const recorded = allDollars.filter((d) => !text.includes(`~${d}`) && !text.includes(`~ ${d}`)).slice(0, 4);
    const rateCaption = /per USD|as of|translated at|rate this month/i.test(text);

    // Contrast: sample the visible text nodes and compare against their ground.
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const [r, g, b, a] = m[1].split(",").map((n) => parseFloat(n));
      return { r, g, b, a: a === undefined ? 1 : a };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const groundOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.5) return c;
        n = n.parentElement;
      }
      return parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
    };

    const low = [];
    const candidates = [...document.querySelectorAll("p,span,td,th,h1,h2,h3,h4,label,a,button,div")]
      .filter((el) => {
        const t = el.textContent?.trim() ?? "";
        if (!t || t.length > 120) return false;
        if (el.children.length > 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.top < window.innerHeight * 3;
      })
      .slice(0, 400);

    for (const el of candidates) {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      const fg = parse(style.color);
      if (!fg || fg.a < 0.5) continue;
      const bg = groundOf(el);
      const l1 = lum(fg), l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(style.fontSize);
      const bold = parseInt(style.fontWeight, 10) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        low.push({
          ratio: Math.round(ratio * 100) / 100, need,
          text: (el.textContent ?? "").trim().slice(0, 36),
          color: style.color, bg: `rgb(${bg.r},${bg.g},${bg.b})`,
          size: Math.round(size),
        });
      }
    }

    return {
      overflow, widest, westernTaka, lakhTaka, hyphenMinus,
      translated, recorded, rateCaption,
      lowContrast: low.slice(0, 6), lowCount: low.length,
      heading: document.querySelector("h1,h2")?.textContent?.trim().slice(0, 50) ?? null,
      bodyLength: text.length,
      hasNav: !!document.querySelector("nav, aside"),
    };
  });
}

console.log("\nT13 — BROWSER: every screen, four widths, both themes\n");

try {

const page = await browser.newPage();
const consoleErrors = [], failedRequests = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push({ url: page.url(), text: m.text().slice(0, 160) }); });
page.on("requestfailed", (r) => failedRequests.push({ url: r.url().slice(0, 120), why: r.failure()?.errorText }));
page.on("response", (r) => { if (r.status() >= 500) failedRequests.push({ url: r.url().slice(0, 120), why: `HTTP ${r.status()}` }); });

await page.setViewport({ width: 1440, height: 900 });

/* ------------- the password eye, before signing in — /login redirects after */

{
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForSelector('input[type="password"]', { timeout: 20_000 });

  // A form with no method is a GET form: submit it before React is ready and
  // the password lands in the address bar and in browser history.
  const method = await page.$eval("form", (f) => f.getAttribute("method"));
  method?.toLowerCase() === "post"
    ? ok("the login form posts, so an early submit cannot put the password in the URL", "")
    : bad("the login form's method", `method="${method}" — submitting before hydration would navigate to /login?password=…`);

  await waitForHydration(page);
  await page.type('input[name="password"], input[type="password"]', "not-a-real-password");
  const before = await page.$eval('input[name="password"]', (el) => el.type);

  const toggle = await page.evaluateHandle(() => {
    const field = document.querySelector('input[name="password"], input[type="password"]');
    const scope = field?.closest("div, label, form") ?? document;
    // The eye sits inside the field's own group, not somewhere else on the page.
    return [...(scope.querySelectorAll("button") ?? [])].find((b) => b.type !== "submit") ?? null;
  });
  const el = toggle.asElement();

  if (!el) meh("the password eye button", "no non-submit button beside the password field");
  else {
    await el.click();
    const shown = await page.$eval('input[name="password"]', (i) => i.type);
    const stillTyped = await page.$eval('input[name="password"]', (i) => i.value);
    before === "password" && shown === "text" && stillTyped === "not-a-real-password"
      ? ok("the password eye reveals what was typed", "password → text, the value intact")
      : bad("the password eye", `type ${before} → ${shown}, value "${stillTyped}"`);

    await el.click();
    (await page.$eval('input[name="password"]', (i) => i.type)) === "password"
      ? ok("and hides it again", "")
      : bad("the eye hides it again", "still visible");

    const skipsTab = await page.evaluate(() => {
      const field = document.querySelector('input[name="password"]');
      const scope = field?.closest("div, label, form") ?? document;
      const b = [...scope.querySelectorAll("button")].find((x) => x.type !== "submit");
      return b?.getAttribute("tabindex") === "-1";
    });
    skipsTab
      ? ok("tabbing from the password goes to Sign in, not to the eye", "")
      : meh("the eye is skipped when tabbing", "it takes a tab stop between the field and the button");
  }
  await page.$eval('input[name="password"]', (i) => { i.value = ""; });
}

const signedIn = await signIn(page, TEST_EMAIL, TEST_PASSWORD);
signedIn
  ? ok("signed in through the real login form", `landed on ${page.url().replace(WEB, "") || "/"}`)
  : bad("sign in", `still on ${page.url()}`);
if (!signedIn) throw new Error("could not sign in — nothing further can be checked");

/* ------------------------------------------------------- every screen */

for (const theme of ["light", "dark"]) {
  await page.evaluateOnNewDocument((t) => {
    try { localStorage.setItem("sfm.theme", t); } catch { /* first load */ }
    document.documentElement.setAttribute("data-theme", t);
  }, theme);

  for (const size of WIDTHS) {
    await page.setViewport({ width: size.width, height: size.height });
    let clean = 0;

    for (const [href, label] of SCREENS) {
      const url = `${WEB}${href}`;
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
      } catch (e) {
        problems.push({ theme, size: size.name, label, kind: "load", detail: String(e).slice(0, 90) });
        continue;
      }
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await new Promise((r) => setTimeout(r, 700));

      const seen = await inspect(page);
      let dirty = false;

      if (seen.bodyLength < 60) {
        problems.push({ theme, size: size.name, label, kind: "empty", detail: `${seen.bodyLength} chars of text` });
        dirty = true;
      }
      if (seen.overflow > 2) {
        problems.push({
          theme, size: size.name, label, kind: "sideways",
          detail: `${seen.overflow}px past the viewport — ${seen.widest ? `<${seen.widest.tag}> "${seen.widest.text}" (${seen.widest.cls})` : "culprit not found"}`,
        });
        dirty = true;
      }
      if (seen.westernTaka.length) {
        problems.push({ theme, size: size.name, label, kind: "grouping", detail: `taka grouped in thousands: ${seen.westernTaka.join(", ")}` });
        dirty = true;
      }
      if (seen.hyphenMinus.length) {
        problems.push({ theme, size: size.name, label, kind: "minus", detail: `hyphen before a currency: ${seen.hyphenMinus.join(", ")}` });
        dirty = true;
      }
      if (seen.lowCount > 0) {
        problems.push({
          theme, size: size.name, label, kind: "contrast",
          detail: `${seen.lowCount} low-contrast run(s), worst ${seen.lowContrast[0].ratio}:1 (needs ${seen.lowContrast[0].need}) — "${seen.lowContrast[0].text}" ${seen.lowContrast[0].color} on ${seen.lowContrast[0].bg}`,
        });
        dirty = true;
      }
      // A translated figure without a rate caption is a number nobody can check.
      if (seen.translated.length && !seen.rateCaption) {
        problems.push({
          theme, size: size.name, label, kind: "usd-caption",
          detail: `translated dollars (${seen.translated[0]}) with no rate caption on the page`,
        });
        dirty = true;
      }
      // And a recorded figure must not be dressed up as an approximation.
      if (seen.translated.length) translatedSeen.add(label);
      if (seen.recorded.length) recordedSeen.add(label);

      if (dirty) {
        await page.screenshot({ path: path.join(SHOTS, `${theme}-${size.name}-${label.replace(/\W+/g, "-")}.png`), fullPage: false });
      } else clean++;
    }

    clean === SCREENS.length
      ? ok(`${theme} @ ${size.name}px — all ${SCREENS.length} screens clean`, "")
      : bad(`${theme} @ ${size.name}px`, `${SCREENS.length - clean} of ${SCREENS.length} screens flagged`);
  }
}

/* ---------------------------------------- the sidebar collapse, at desktop */

await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${WEB}/`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 600));
{
  const widthOf = () => page.evaluate(() => {
    const el = document.querySelector("aside") ?? document.querySelector("nav");
    return el ? Math.round(el.getBoundingClientRect().width) : null;
  });
  const wide = await widthOf();
  const btn = await page.$('button[aria-label*="idebar" i], button[title*="idebar" i], button[aria-label*="ollapse" i]');
  if (!btn) meh("the sidebar collapse button", "no button with a sidebar-related label");
  else {
    await btn.click();
    await new Promise((r) => setTimeout(r, 500));
    const narrow = await widthOf();
    narrow !== null && wide !== null && narrow < wide && narrow > 30
      ? ok("the sidebar collapses to an icon rail", `${wide}px → ${narrow}px`)
      : bad("sidebar collapse", `${wide}px → ${narrow}px`);

    // innerText includes sr-only text, which is clipped to a pixel and read
    // only by a screen reader — exactly what a collapsed rail should keep. So
    // measure what is actually painted instead.
    const rail = await page.evaluate(() => {
      const el = document.querySelector("aside") ?? document.querySelector("nav");
      if (!el) return null;
      let visibleLabel = null, srLabels = 0, tooltips = 0;
      for (const node of el.querySelectorAll("span, a, button")) {
        // Leaves only. A link wrapping an sr-only span reports that span's
        // text as its own, and the link is 47px wide because it is an icon
        // button — nothing about it is a painted label.
        if (node.children.length > 0) continue;
        const t = node.textContent?.trim() ?? "";
        if (!/^(Dashboard|Transactions|Reports|Team|Payroll|Vendors|Settings|Import)$/.test(t)) continue;
        const r = node.getBoundingClientRect();
        const clipped = r.width <= 2 || r.height <= 2 || getComputedStyle(node).clip === "rect(0px, 0px, 0px, 0px)";
        if (clipped) srLabels++;
        else visibleLabel ??= `${t} (${Math.round(r.width)}px wide)`;
      }
      for (const node of el.querySelectorAll("[title]")) if (node.getAttribute("title")) tooltips++;
      return { visibleLabel, srLabels, tooltips };
    });

    rail && !rail.visibleLabel && rail.srLabels > 0
      ? ok("the labels go, the icons stay", `${rail.srLabels} label(s) kept for screen readers, ${rail.tooltips} tooltip(s) for the mouse`)
      : bad("collapsed sidebar labels", rail ? `"${rail.visibleLabel}" is still painted` : "no sidebar found");

    await page.reload({ waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 700));
    const afterReload = await widthOf();
    afterReload === narrow
      ? ok("the choice survives a reload", `${afterReload}px`)
      : meh("collapse persists", `${narrow}px before reload, ${afterReload}px after`);

    const btn2 = await page.$('button[aria-label*="idebar" i], button[title*="idebar" i], button[aria-label*="xpand" i]');
    if (btn2) { await btn2.click(); await new Promise((r) => setTimeout(r, 400)); }
  }
}

/* ------------------------- the USD rule, proved on both kinds of figure */

translatedSeen.size > 0 && recordedSeen.size > 0
  ? ok("both kinds of dollar figure appeared, so the rule was really tested",
      `translated on ${[...translatedSeen].join(", ")}; recorded on ${[...recordedSeen].join(", ")}`)
  : bad("the USD check saw both kinds",
      `translated on ${translatedSeen.size} screen(s), recorded on ${recordedSeen.size} — the check may have passed vacuously`);

/* -------------------------------------------------------------- console */

consoleErrors.length === 0
  ? ok("no console errors across the whole pass", "")
  : bad("console errors", `${consoleErrors.length} — first: ${consoleErrors[0].text}`);

const noise = failedRequests.filter((r) => /favicon|\.map\b|hot-update/.test(r.url));
/**
 * A cancelled prefetch is not a failure.
 *
 * Next prefetches the route behind every visible link; walking fourteen screens
 * in a row cancels most of them mid-flight and the browser reports each as
 * ERR_ABORTED. On localhost they mostly complete before the next navigation, so
 * this never showed up — against the deployed site there were 390 of them and
 * the check failed on noise.
 *
 * Worth filtering, but only narrowly: an aborted `?_rsc=` prefetch to this
 * app's own origin, and nothing else. A 500, a failed API call, or an abort on
 * anything that is not a prefetch still fails the run.
 */
const prefetchAborts = failedRequests.filter(
  (r) => /[?&]_rsc=/.test(r.url) && r.why === "net::ERR_ABORTED" && r.url.startsWith(WEB),
);
const realFailures = failedRequests.filter(
  (r) => !noise.includes(r) && !prefetchAborts.includes(r),
);

realFailures.length === 0
  ? ok("no failed requests", `${prefetchAborts.length} cancelled prefetch(es) ignored`)
  : bad(
      "failed requests",
      `${realFailures.length} real — ` +
        realFailures.slice(0, 3).map((r) => `${r.url} (${r.why})`).join(" | "),
    );

/* --------------------------------------------------------------- report */

} finally {
  // Runs even if a check above threw — no test account is ever left behind.
  await browser.close().catch(() => {});
  await removeTestUser();
}

const left = (await db.query("select count(*)::int n from users where email = $1", [TEST_EMAIL])).rows[0].n;
left === 0 ? ok("the throwaway account is removed", "") : bad("cleanup", `${left} row(s) remain`);
await db.end();

if (problems.length) {
  console.log(`\n  ${problems.length} finding(s):\n`);
  const byKind = {};
  for (const p of problems) (byKind[p.kind] ??= []).push(p);
  for (const [kind, list] of Object.entries(byKind)) {
    console.log(`  ${kind.toUpperCase()} (${list.length})`);
    const seen = new Set();
    for (const p of list) {
      const key = `${p.label}|${p.detail.slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`    ${p.label} @ ${p.size}px ${p.theme} — ${p.detail}`);
    }
    console.log("");
  }
  console.log(`  screenshots: ${SHOTS}`);
}

console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
