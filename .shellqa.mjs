/**
 * The shell and the palette, in the September 2026 design.
 *
 * Every claim here is about what is painted, so it is measured in a browser:
 * which theme a first visit gets, what colour the current row's edge really
 * came out, whether a hidden rail can still be tabbed into, and whether the
 * sign-in page stays light when the app is dark.
 *
 *     node .shellqa.mjs      (local only — reads, writes nothing)
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
  `select id, role, token_version, full_name, email from users
    where role = 'super_admin' and status = 'active' and deleted_at is null
    order by created_at limit 1`,
);
await db.end();
const me = rows[0];
const token = jwt.sign({ sub: me.id, role: me.role, tv: me.token_version }, env.JWT_ACCESS_SECRET, {
  expiresIn: "1h",
});

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const VIOLET = "rgb(133, 88, 236)";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

const fresh = async (width, height) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height });
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return { page, errors, context };
};
const open = async (page, path) => {
  await page.goto(`${WEB}${path}`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => document.fonts.ready);
};
const rail = (page) =>
  page.evaluate(() => {
    const aside = document.querySelector("aside.sv-rail");
    const r = aside.getBoundingClientRect();
    return { width: Math.round(r.width), inert: aside.inert, display: getComputedStyle(aside).display };
  });

try {
  /* ------------------------------------------------ 1. a first visit */
  console.log("\n1. A first visit, 1440 × 900");
  const { page, errors, context } = await fresh(1440, 900);
  await open(page, "/");
  const first = await page.evaluate(() => {
    const css = (el, p) => getComputedStyle(el).getPropertyValue(p);
    const aside = document.querySelector("aside.sv-rail");
    const active = document.querySelector('.sv-nav-row[aria-current="page"]');
    const idle = [...document.querySelectorAll(".sv-nav-row")].find((r) => !r.dataset.active);
    const card = document.querySelector(".sv-user-card");
    const crumbs = [...document.querySelectorAll('nav[aria-label="Breadcrumb"] li')].map((li) => li.textContent.trim());
    const last = document.querySelector('nav[aria-label="Breadcrumb"] [aria-current="page"]');
    return {
      theme: document.documentElement.dataset.theme,
      bodyBg: css(document.body, "background-color"),
      bodyFont: css(document.body, "font-family"),
      jakarta: document.fonts.check('700 16px "Plus Jakarta Sans Variable"'),
      railWidth: Math.round(aside.getBoundingClientRect().width),
      railBg: css(aside, "background-color"),
      railEdge: css(aside, "border-right-color"),
      activeLabel: active?.textContent.trim(),
      activeEdge: active && css(active, "border-left-color"),
      activeEdgeWidth: active && css(active, "border-left-width"),
      activeBg: active && css(active, "background-color"),
      activeTile: active && css(active.querySelector(".sv-nav-tile"), "background-color"),
      idleEdge: idle && css(idle, "border-left-color"),
      idleEdgeWidth: idle && css(idle, "border-left-width"),
      cardText: card?.innerText.replace(/\s+/g, " ").trim(),
      cardEdge: card && css(card, "border-top-color"),
      crumbs,
      lastWeight: last && css(last, "font-weight"),
      themeButton: document.querySelector('button[title="Switch theme"]')?.innerText.trim(),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  check("light unless somebody chose dark", first.theme === "light", first.theme);
  check("page ground is the design's #F1F3EC", first.bodyBg === "rgb(241, 243, 236)", first.bodyBg);
  check("one face, and it loaded", /Plus Jakarta Sans Variable/.test(first.bodyFont) && first.jakarta, first.bodyFont.split(",")[0]);
  check("rail 270px, white, hairline edge", first.railWidth === 270 && first.railBg === "rgb(255, 255, 255)" && first.railEdge === "rgb(231, 235, 224)", `${first.railWidth}px ${first.railBg} ${first.railEdge}`);
  check("the current page is Dashboard", first.activeLabel === "Dashboard", first.activeLabel);
  check("its 5px edge is violet", first.activeEdge === VIOLET && first.activeEdgeWidth === "5px", `${first.activeEdge} ${first.activeEdgeWidth}`);
  check("its row is violet-tint and its tile violet", first.activeBg === "rgb(241, 236, 254)" && first.activeTile === VIOLET, `${first.activeBg} / ${first.activeTile}`);
  check("other rows keep the 5px, transparent — nothing jumps", first.idleEdgeWidth === "5px" && first.idleEdge === "rgba(0, 0, 0, 0)", `${first.idleEdge} ${first.idleEdgeWidth}`);
  check("footer card names who is signed in", first.cardText?.includes(me.full_name) && first.cardText?.includes(me.email), first.cardText);
  check("footer card has the violet-tint edge", first.cardEdge === "rgb(223, 210, 251)", first.cardEdge);
  check("breadcrumb reads Finance › Dashboard", first.crumbs.join("|") === "Finance|Dashboard", first.crumbs.join(" › "));
  check("last crumb at 800", first.lastWeight === "800", first.lastWeight);
  check("theme switch offers the other theme by name", first.themeButton === "DARK", first.themeButton);
  check("no sideways scroll", first.overflow <= 0, `${first.overflow}px`);
  await page.screenshot({ path: `${SHOTS}/shell-light.png` });

  /* ------------------------------------------------ 2. the accordion */
  console.log("\n2. Accounts opens and closes");
  const kids = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("aside button[aria-expanded]")].find((x) => x.textContent.includes("Accounts"));
      const panel = document.getElementById(b.getAttribute("aria-controls"));
      return { expanded: b.getAttribute("aria-expanded"), shown: getComputedStyle(panel).display !== "none", rows: [...panel.querySelectorAll("a")].map((a) => a.textContent.trim()) };
    });
  const before = await kids();
  check("closed on a page it does not hold", before.expanded === "false" && !before.shown);
  await page.evaluate(() => [...document.querySelectorAll("aside button[aria-expanded]")].find((x) => x.textContent.includes("Accounts")).click());
  const after = await kids();
  check("opens to its three screens", after.shown && after.rows.join("|") === "Accounts overview|Cash In|Money Transfer", after.rows.join(", "));

  /* ------------------------------------------------ 3. hiding the rail */
  console.log("\n3. The menu button hides the rail — hidden, not narrowed");
  const mainBefore = await page.evaluate(() => document.querySelector("main").getBoundingClientRect().width);
  await page.click('button[aria-label="Hide the menu"]');
  await new Promise((r) => setTimeout(r, 700));
  let r = await rail(page);
  const mainAfter = await page.evaluate(() => document.querySelector("main").getBoundingClientRect().width);
  check("rail goes to 0px", r.width === 0, `${r.width}px`);
  check("and cannot be tabbed into", r.inert === true);
  check("the content takes the width", mainAfter > mainBefore, `${Math.round(mainBefore)} → ${Math.round(mainAfter)}px`);
  await page.screenshot({ path: `${SHOTS}/shell-hidden.png` });
  await open(page, "/");
  r = await rail(page);
  check("and stays hidden after a reload", r.width === 0, `${r.width}px`);
  await page.click('button[aria-label="Show the menu"]');
  await new Promise((r2) => setTimeout(r2, 700));
  r = await rail(page);
  check("the same button brings it back", r.width === 270 && r.inert === false, `${r.width}px`);

  /* ------------------------------------------------ 4. dark */
  console.log("\n4. Dark");
  await page.click('button[title="Switch theme"]');
  const dark = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    stored: localStorage.getItem("svf-theme-brand"),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    railBg: getComputedStyle(document.querySelector("aside.sv-rail")).backgroundColor,
    ink: getComputedStyle(document.body).color,
  }));
  check("the switch goes dark and remembers it", dark.theme === "dark" && dark.stored === "dark");
  check("dark ground and surface are the design's", dark.bodyBg === "rgb(12, 15, 8)" && dark.railBg === "rgb(20, 24, 15)", `${dark.bodyBg} / ${dark.railBg}`);
  check("dark ink is the design's", dark.ink === "rgb(236, 241, 226)", dark.ink);
  await page.screenshot({ path: `${SHOTS}/shell-dark.png` });
  await open(page, "/");
  check("dark survives a reload", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");

  /* ------------------------------------------------ 5. sign-in stays light */
  console.log("\n5. Sign-in is drawn light, whatever the theme");
  {
    const probe = await browser.createBrowserContext();
    const p = await probe.newPage();
    await p.setViewport({ width: 1440, height: 900 });
    await p.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    await p.evaluate(() => localStorage.setItem("svf-theme-brand", "dark"));
    await p.goto(`${WEB}/login`, { waitUntil: "networkidle0" });
    const l = await p.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      form: getComputedStyle(document.querySelector(".sv-login section")).backgroundColor,
      ink: getComputedStyle(document.querySelector("h1")).color,
      // The password box: the email one is autofocused, and focus turns it white.
      field: getComputedStyle(document.querySelector('input[name="password"]').closest(".sv-field")).backgroundColor,
    }));
    check("dark app, light sign-in", l.theme === "dark" && l.form === "rgb(255, 255, 255)" && l.ink === "rgb(6, 8, 0)" && l.field === "rgb(244, 246, 240)", `${l.form} ${l.ink} ${l.field}`);
    await probe.close();
  }
  await page.click('button[title="Switch theme"]');
  check("and back to light", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");

  /* ------------------------------------------------ 6. tables */
  console.log("\n6. Tables");
  await open(page, "/transactions");
  const t = await page.evaluate(() => {
    const table = document.querySelector("table.table-data");
    if (!table) return null;
    const head = table.querySelector("thead tr");
    const th = table.querySelector("thead th:nth-child(2)");
    const cells = [...table.querySelectorAll("tbody tr:first-child td")];
    return {
      headBg: getComputedStyle(head).backgroundColor,
      headRule: `${getComputedStyle(head).borderBottomWidth} ${getComputedStyle(head).borderBottomColor}`,
      th: `${getComputedStyle(th).color} ${getComputedStyle(th).fontWeight}`,
      rules: cells.slice(1).map((c) => getComputedStyle(c).borderLeftWidth),
      rows: table.querySelectorAll("tbody tr").length,
    };
  });
  if (!t) {
    check("a table to measure on /transactions", false);
  } else {
    check("header band is lime-tint over a lime rule", t.headBg === "rgb(246, 250, 234)" && /rgb\(227, 235, 200\)/.test(t.headRule), `${t.headBg} / ${t.headRule}`);
    check("headings violet-ink at 800", t.th === "rgb(75, 42, 158) 800", t.th);
    check("no vertical rules between columns", t.rules.every((w) => w === "0px"), t.rules.join(","));
    if (t.rows > 0) {
      await page.hover("table.table-data tbody tr:first-child td:nth-child(3)");
      await new Promise((r3) => setTimeout(r3, 200));
      const hover = await page.evaluate(() => getComputedStyle(document.querySelector("table.table-data tbody tr:first-child td")).boxShadow);
      check("hover puts the 4px violet bar on the row", /rgb\(133, 88, 236\) 4px 0px 0px 0px inset|inset 4px 0px 0px 0px rgb\(133, 88, 236\)/.test(hover), hover);
    }
  }
  await page.screenshot({ path: `${SHOTS}/shell-transactions.png` });

  /* ------------------------------------------------ 7. keyboard */
  console.log("\n7. Keyboard");
  await open(page, "/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return { what: el.tagName + " " + (el.getAttribute("aria-label") ?? el.textContent.trim()).slice(0, 30), outline: `${s.outlineStyle} ${s.outlineColor}` };
  });
  check("focus ring is violet, not lime", focus.outline === `solid ${VIOLET}`, `${focus.what}: ${focus.outline}`);
  check("no console errors on these screens", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();

  /* ------------------------------------------------ 8. phone */
  console.log("\n8. 390 × 844");
  {
    const { page: m, context: c2 } = await fresh(390, 844);
    await open(m, "/");
    const shut = await m.evaluate(() => ({
      rail: getComputedStyle(document.querySelector("aside.sv-rail")).display,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
    check("no rail on a phone", shut.rail === "none");
    check("no sideways scroll", shut.overflow <= 0, `${shut.overflow}px`);
    await m.click('button[aria-label="Open navigation"]');
    const drawer = await m.evaluate(() => {
      const nav = document.querySelectorAll('nav[aria-label="Main"]');
      const d = nav[nav.length - 1].closest("div.absolute");
      return { width: Math.round(d.getBoundingClientRect().width) };
    });
    check("the menu opens a 270px drawer", drawer.width === 270, `${drawer.width}px`);
    await m.screenshot({ path: `${SHOTS}/shell-phone-drawer.png` });
    await m.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main"] a')].reverse().find((a) => a.textContent.includes("All transactions")).click());
    await m.waitForFunction(() => location.pathname === "/transactions", { timeout: 60000 });
    await new Promise((r4) => setTimeout(r4, 300));
    check("a row navigates and the drawer closes", (await m.$('button[aria-label="Close navigation"]')) === null);
    await c2.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
