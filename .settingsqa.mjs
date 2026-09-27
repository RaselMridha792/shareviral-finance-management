/**
 * Settings' own rail, as the September 2026 handoff draws it.
 *
 * On /settings the main nav steps aside for "Back to dashboard" and Settings'
 * sections, grouped, with hints and badges; the screen has no tab row left.
 * This clicks through every section from the rail and reads what changed —
 * the URL's ?tab=, the header's "Settings · <group>" and title, the violet
 * marker — then walks Back, opens a section by link, and checks a reader
 * without a permission does not see its section.
 *
 *     node .settingsqa.mjs      (local only — reads, writes nothing)
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
const userOf = async (role) =>
  (
    await db.query(
      `select id, role, token_version from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`,
      [role],
    )
  ).rows[0];
const admin = await userOf("super_admin");
const other = (await userOf("cfo")) ?? (await userOf("hr"));
const users = Number((await db.query(`select count(*) from users where deleted_at is null`)).rows[0].count);
await db.end();
const tokenFor = (u) =>
  jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

const read = (page) =>
  page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Settings"]');
    const head = document.querySelector("main .sv-page-head");
    return {
      url: location.pathname + location.search,
      mainNav: Boolean(document.querySelector('nav[aria-label="Main"]')),
      back: nav?.querySelector('a[href="/"]')?.textContent.trim(),
      groups: [...(nav?.querySelectorAll("p.uppercase") ?? [])].map((p) => p.textContent.trim()),
      items: [...(nav?.querySelectorAll("a[href^='/settings']") ?? [])].map((a) => ({
        id: new URL(a.href).searchParams.get("tab"),
        label: a.querySelector("span.block")?.textContent.trim(),
        hint: a.querySelectorAll("span.block")[1]?.textContent.trim(),
        badge: a.querySelector("span.rounded-full")?.textContent.trim(),
        active: a.hasAttribute("data-active"),
      })),
      eyebrow: head?.querySelector("p.uppercase")?.textContent.trim(),
      title: head?.querySelector("h1")?.textContent.trim(),
      tabRow: Boolean(document.querySelector('main [aria-label="Settings sections"]')),
    };
  });

try {
  console.log("\nSuper Admin");
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(admin), domain: "localhost", path: "/" });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${WEB}/settings`, { waitUntil: "networkidle0", timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));

  let m = await read(page);
  check("the main nav steps aside", !m.mainNav && m.back === "Back to dashboard", m.back);
  check("four groups, in the handoff's order", m.groups.join("|") === "General|Access|Data|Integrations", m.groups.join(", "));
  check("all ten sections for a Super Admin, each with a hint", m.items.length === 10 && m.items.every((i) => i.hint), `${m.items.length}`);
  check("no row of tabs on the screen", !m.tabRow);
  check("opens on Company & formatting", m.items[0].active && m.title === "Company & formatting" && m.eyebrow === "Settings · General", `${m.eyebrow} / ${m.title}`);
  const people = m.items.find((i) => i.id === "users");
  check("People carries the count of accounts", people?.badge === String(users), `${people?.badge} vs ${users}`);
  check("Assistant and Email carry their state", ["On", "Off"].includes(m.items.find((i) => i.id === "assistant")?.badge) && ["Ready", "Not sending"].includes(m.items.find((i) => i.id === "email")?.badge));

  // A marker on the window survives a pushState and dies with a reload —
  // puppeteer's own "navigated" event fires for both.
  await page.evaluate(() => (window.__stillHere = true));
  const groupOf = { company: "General", categories: "General", tax: "General", security: "Access", users: "Access", audit: "Access", trashed: "Data", assistant: "Integrations", email: "Integrations", notifications: "Integrations" };
  let allGood = true;
  const bad = [];
  for (const item of m.items) {
    await page.click(`nav[aria-label="Settings"] a[href="/settings?tab=${item.id}"]`);
    await page.waitForFunction((id) => document.querySelector("main .sv-page-head h1")?.textContent && location.search === `?tab=${id}`, { timeout: 20000 }, item.id).catch(() => {});
    await new Promise((r) => setTimeout(r, 700));
    const now = await read(page);
    // The section already open is not pushed again, so the first one may
    // still read as plain /settings.
    const urlOk = now.url === `/settings?tab=${item.id}` || (item.active && now.url === "/settings");
    const good = urlOk && now.title === item.label && now.eyebrow === `Settings · ${groupOf[item.id]}` && now.items.filter((i) => i.active).map((i) => i.id).join() === item.id;
    if (!good) {
      allGood = false;
      bad.push(`${item.id}: ${now.url} ${now.eyebrow} / ${now.title}`);
    }
    if (item.id === "users") await page.screenshot({ path: `${SHOTS}/settings-users.png` });
  }
  check("every section opens from the rail: URL, header and marker agree", allGood, bad.join(" | "));
  const stillHere = await page.evaluate(() => window.__stillHere === true);
  check("switching sections does not reload the page", stillHere);

  await page.goBack();
  await new Promise((r) => setTimeout(r, 1200));
  m = await read(page);
  check("Back returns to the section before", m.url === "/settings?tab=email" && m.title === "Email", `${m.url} ${m.title}`);

  await page.goto(`${WEB}/settings?tab=audit`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 800));
  m = await read(page);
  check("a link to ?tab=audit opens What changed", m.title === "What changed" && m.items.find((i) => i.active)?.id === "audit");

  await page.click('nav[aria-label="Settings"] a[href="/"]');
  await page.waitForFunction(() => location.pathname === "/", { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  m = await read(page);
  check("Back to dashboard brings the main nav back", m.mainNav, m.url);
  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${WEB}/settings?tab=company`, { waitUntil: "networkidle0" });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("at 390px nothing runs sideways", over <= 0, `${over}px`);
  await context.close();

  if (other) {
    console.log(`\n${other.role}`);
    const ctx = await browser.createBrowserContext();
    await ctx.setCookie({ name: "sfm_access", value: tokenFor(other), domain: "localhost", path: "/" });
    const p2 = await ctx.newPage();
    await p2.setViewport({ width: 1440, height: 1000 });
    const res = await p2.goto(`${WEB}/settings?tab=users`, { waitUntil: "networkidle0", timeout: 120000 });
    await new Promise((r) => setTimeout(r, 1200));
    if (p2.url().includes("/settings")) {
      const r2 = await read(p2);
      check("People who can sign in is not offered", !r2.items.some((i) => i.id === "users"), r2.items.map((i) => i.id).join(","));
      check("and ?tab=users falls back to the first section", r2.title === r2.items[0]?.label, r2.title);
    } else {
      check(`${other.role} cannot open Settings at all`, true, `${res?.status()} -> ${p2.url()}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
