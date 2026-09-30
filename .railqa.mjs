/**
 * #127 — the rail's own switch, icons-only when hidden, ShareViral™, and the
 * dashboard's quick links. Measured in a browser.
 *
 *   - the switch sits in the rail's head, not in the top bar;
 *   - ShareViral carries a small TM;
 *   - hidden, the rail is an 80px strip of icons: no names on screen, each a
 *     link named on hover; a parent goes to its first screen; HR Requests
 *     keeps its count; it is remembered across a reload; shown again, 270px;
 *   - Settings' rail does the same;
 *   - the phone's drawer is always wide, with no switch in it;
 *   - the dashboard's four quick links, each to its screen, shown by
 *     permission;
 *   - nothing scrolls sideways; no errors.
 *
 *     node .railqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .railqa.mjs   also saves screenshots
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
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
const who = async (role) =>
  (await db.query(`select id, role, token_version from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role])).rows[0];
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const users = { super_admin: await who("super_admin"), hr: await who("hr") };
await db.end();

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
    await settle(200);
  }
};

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, url, width = 1440, rail = "full") => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  await page.evaluateOnNewDocument((r) => { if (!sessionStorage.getItem("railqa")) { localStorage.setItem("svf-sidebar", r); sessionStorage.setItem("railqa", "1"); } }, rail);
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Encountered two children/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  return { page, context };
};
const railWidth = (page) => page.evaluate(() => Math.round(document.querySelector("aside.sv-rail").getBoundingClientRect().width));

try {
  const { page, context } = await open(users.super_admin, "/");
  console.log("\nThe rail, wide");
  const head = await page.evaluate(() => ({
    toggleInRail: Boolean(document.querySelector("aside.sv-rail [data-rail-toggle]")),
    toggleInTopbar: [...document.querySelectorAll("header button")].some((b) => /menu/i.test(b.getAttribute("aria-label") ?? "") && getComputedStyle(b).display !== "none"),
    tm: document.querySelector("aside.sv-rail [data-trademark]")?.textContent ?? null,
    name: document.querySelector("aside.sv-rail [data-trademark]")?.parentElement?.textContent ?? null,
  }));
  check("the switch is in the rail's head, not the top bar", head.toggleInRail && !head.toggleInTopbar, JSON.stringify(head));
  check("ShareViral carries a small TM", head.tm === "TM" && head.name === "ShareViralTM", JSON.stringify(head));
  check("270px wide", (await railWidth(page)) === 270, String(await railWidth(page)));

  console.log("\nThe dashboard's quick links");
  const links = await page.evaluate(() => [...document.querySelectorAll("[data-quick-link]")].map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim() })));
  check("four links, in order, each to its screen", JSON.stringify(links.map((l) => l.href)) === JSON.stringify(["/hr-requests", "/payroll/bank-advice", "/payroll", "/invoices/new"]) && /^HR Requests/.test(links[0]?.text ?? ""), JSON.stringify(links));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "rail-wide.png") });
  await page.click("[data-quick-link='/payroll/bank-advice']");
  await until(() => page.url().includes("/payroll/bank-advice"));
  check("a quick link navigates", page.url().endsWith("/payroll/bank-advice"), page.url());
  await page.goto(`${WEB}/`, { waitUntil: "networkidle0" });

  console.log("\nHidden: icons only");
  await page.click("aside.sv-rail [data-rail-toggle]");
  await until(async () => (await railWidth(page)) === 80);
  const strip = await page.evaluate(() => {
    const nav = document.querySelector("aside.sv-rail nav[aria-label='Main']");
    const anchors = [...nav.querySelectorAll("a")];
    return {
      width: Math.round(document.querySelector("aside.sv-rail").getBoundingClientRect().width),
      visibleText: nav.innerText.replace(/\d+/g, "").trim(),
      links: anchors.length,
      named: anchors.every((a) => a.getAttribute("title") && a.getAttribute("aria-label")),
      payroll: anchors.find((a) => a.getAttribute("title") === "Payroll & Bank")?.getAttribute("href") ?? null,
      waiting: Boolean(nav.querySelector("a[title='HR Requests'] [data-hrr-waiting]")),
      tm: Boolean(document.querySelector("aside.sv-rail [data-trademark]")),
      toggle: Boolean(document.querySelector("aside.sv-rail [data-rail-toggle]")),
    };
  });
  check("80px, no names on screen, every icon a link named on hover", strip.width === 80 && strip.visibleText === "" && strip.links >= 10 && strip.named, JSON.stringify({ ...strip, visibleText: strip.visibleText.slice(0, 40) }));
  const waitingNow = await page.evaluate(async () => (await (await fetch("http://localhost:4001/api/hr-requests/waiting", { credentials: "include" })).json()).waiting);
  check("a parent goes to its first screen (Payroll & Bank → /payroll); HR Requests keeps its count when there is one", strip.payroll === "/payroll" && strip.waiting === waitingNow > 0, `${JSON.stringify(strip)} waiting=${waitingNow}`);
  check("the switch stays reachable; the name goes", strip.toggle && !strip.tm);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "rail-strip.png") });
  await page.click("aside.sv-rail a[title='HR Requests']");
  await until(() => page.url().includes("/hr-requests"));
  check("clicking an icon navigates", page.url().includes("/hr-requests"), page.url());
  await page.reload({ waitUntil: "networkidle0" });
  check("remembered across a reload", (await railWidth(page)) === 80, String(await railWidth(page)));
  const fitsStrip = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("nothing scrolls sideways with the strip", fitsStrip);

  console.log("\nSettings, hidden");
  await page.goto(`${WEB}/settings?tab=company`, { waitUntil: "networkidle0" });
  const settings = await page.evaluate(() => {
    const nav = document.querySelector("aside.sv-rail nav[aria-label='Settings']");
    return {
      text: nav.innerText.trim(),
      back: nav.querySelector("a[href='/']")?.getAttribute("title") ?? null,
      sections: [...nav.querySelectorAll("a[href^='/settings?tab=']")].map((a) => a.getAttribute("title")),
    };
  });
  check("Settings' rail: icons only, each named, the way back kept", settings.text === "" && settings.back === "Back to dashboard" && settings.sections.includes("Appearance"), JSON.stringify({ ...settings, sections: settings.sections.length }));
  await page.click("aside.sv-rail a[title='Categories']");
  await until(() => page.url().includes("tab=categories"));
  check("a Settings icon opens its section", page.url().includes("tab=categories"), page.url());
  const footer = await page.evaluate(() => ({ name: Boolean(document.querySelector(".sv-user-card p")), signOut: Boolean(document.querySelector(".sv-user-card button[aria-label='Sign out']")) }));
  check("the footer: initials and sign-out, no name", !footer.name && footer.signOut, JSON.stringify(footer));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "rail-settings-strip.png") });

  console.log("\nShown again");
  await page.click("aside.sv-rail [data-rail-toggle]");
  await until(async () => (await railWidth(page)) === 270);
  const back = await page.evaluate(() => document.querySelector("aside.sv-rail nav[aria-label='Settings']").innerText.includes("Company & formatting"));
  check("270px and the names are back", (await railWidth(page)) === 270 && back);
  await context.close();

  console.log("\nThe phone");
  {
    const phone = await open(users.super_admin, "/", 390, "rail");
    await phone.page.click("header button[aria-label='Open navigation']");
    await phone.page.waitForSelector("div.fixed.inset-0 nav[aria-label='Main']", { visible: true, timeout: 5000 });
    const drawer = await phone.page.evaluate(() => {
      const navs = [...document.querySelectorAll("nav[aria-label='Main']")].filter((n) => n.getBoundingClientRect().width > 0);
      const nav = navs[navs.length - 1];
      const box = nav.closest("div.absolute") ?? nav.parentElement;
      return { names: nav.innerText.includes("Accounts"), toggle: Boolean(box.querySelector("[data-rail-toggle]")), fits: document.documentElement.scrollWidth <= window.innerWidth };
    });
    check("the drawer is wide with names, no switch, and fits", drawer.names && !drawer.toggle && drawer.fits, JSON.stringify(drawer));
    await phone.context.close();
  }

  console.log("\nQuick links by permission");
  {
    const hrView = await open(users.hr, "/");
    const hrLinks = await hrView.page.evaluate(() => [...document.querySelectorAll("[data-quick-link]")].map((a) => a.getAttribute("href")));
    check("HR sees no quick link it cannot open (no HR Requests, no Invoice Builder)", !hrLinks.includes("/hr-requests") && !hrLinks.includes("/invoices/new"), JSON.stringify(hrLinks));
    await hrView.context.close();
  }

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
