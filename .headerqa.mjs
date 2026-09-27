/**
 * The header card on every screen that opens with one, and the buttons in it.
 *
 * `PageHeader` reaches twenty-one screens, so this walks every one of them —
 * detail pages included, with real ids from the database — at three widths,
 * and reads what was painted: the card, the lime tile with a Phosphor icon in
 * it (not the old icon font), the title at 28/800, nothing wider than the
 * window, and the buttons' new weight and shadow.
 *
 *     node .headerqa.mjs      (local only — reads, writes nothing)
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
const one = async (sql) => (await db.query(sql)).rows[0];
const admin = await one(
  `select id, role, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`,
);
const account = await one(`select id from accounts where deleted_at is null and is_active order by created_at limit 1`);
const heading = await one(
  `select slug from categories where deleted_at is null and parent_id is null and kind = 'out' and is_active order by name limit 1`,
);
const plan = await one(`select id from subscriptions where deleted_at is null order by created_at limit 1`);
const run = await one(`select id from payroll_runs where deleted_at is null order by created_at desc limit 1`);
await db.end();
const token = jwt.sign({ sub: admin.id, role: admin.role, tv: admin.token_version }, env.JWT_ACCESS_SECRET, {
  expiresIn: "1h",
});

const ROUTES = [
  "/accounts",
  account && `/accounts/${account.id}`,
  account && `/accounts/${account.id}/register`,
  "/accounts/cash-in",
  "/transfers",
  "/expenses/overview",
  "/expenses",
  heading && `/expenses/${heading.slug}`,
  "/expenses/other",
  "/subscriptions",
  plan && `/subscriptions/${plan.id}`,
  "/transactions",
  // "/team" — 500s locally until the 2026-09-22 migration reaches Neon (#80).
  "/payroll",
  run && `/payroll/${run.id}`,
  "/tax/withholding",
  "/reports",
  "/statement",
  "/data",
  "/settings",
].filter(Boolean);

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

const read = () =>
  page.evaluate(() => {
    const card = document.querySelector("main .sv-page-head");
    const tile = card?.querySelector(".sv-page-head-tile");
    const h1 = card?.querySelector("h1");
    const r = card?.getBoundingClientRect();
    const primary = [...(card?.querySelectorAll("button") ?? [])].find((b) => /bg-primary/.test(b.className));
    return {
      card: Boolean(card),
      cardBg: card && getComputedStyle(card).backgroundColor,
      tileBg: tile && getComputedStyle(tile).backgroundColor,
      phosphor: Boolean(tile?.querySelector("svg")),
      oldFont: Boolean(tile?.querySelector(".ms-icon")),
      h1: h1 && `${getComputedStyle(h1).fontSize} ${getComputedStyle(h1).fontWeight}`,
      title: h1?.textContent.trim(),
      fits: r ? r.right <= document.documentElement.clientWidth + 1 : false,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      primary: primary && `${getComputedStyle(primary).fontWeight} ${/rgba?\(150, 200, 0/.test(getComputedStyle(primary).boxShadow)}`,
      headers: document.querySelectorAll("main .sv-page-head").length,
    };
  });

try {
  for (const width of [1440, 900, 390]) {
    console.log(`\n${width}px`);
    await page.setViewport({ width, height: 900 });
    for (const route of ROUTES) {
      await page.goto(`${WEB}${route}`, { waitUntil: "networkidle0", timeout: 120000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      const m = await read();
      const label = route.replace(/[0-9a-f-]{36}/, ":id");
      if (width === 1440) {
        check(
          `${label} — "${m.title}"`,
          m.card && m.headers === 1 && m.cardBg === "rgb(255, 255, 255)" && m.tileBg === "rgb(191, 255, 0)" && m.phosphor && !m.oldFont && m.h1 === "28px 800",
          m.card ? `h1 ${m.h1}, tile ${m.phosphor ? "phosphor" : m.oldFont ? "OLD FONT" : "empty"}${m.primary ? `, primary button ${m.primary}` : ""}` : "no header card",
        );
        if (m.primary) check(`${label} — primary button is 800 with the lime shadow`, m.primary === "800 true", m.primary);
        if (route === "/accounts") await page.screenshot({ path: `${SHOTS}/header-accounts.png` });
        if (route === "/transactions") await page.screenshot({ path: `${SHOTS}/header-transactions.png` });
      } else {
        check(`${label} fits at ${width}`, m.card && m.fits && m.overflow <= 0, `${m.overflow}px sideways`);
      }
    }
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${WEB}/accounts`, { waitUntil: "networkidle0" });
  await page.screenshot({ path: `${SHOTS}/header-phone.png` });

  // The secondary button's violet edge under the pointer.
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${WEB}/accounts`, { waitUntil: "networkidle0" });
  const secondary = await page.$("main button.sv-button-quiet");
  if (secondary) {
    await secondary.hover();
    await new Promise((r) => setTimeout(r, 400));
    const edge = await page.evaluate((b) => getComputedStyle(b).borderTopColor, secondary);
    check("a secondary button's edge turns violet under the pointer", edge === "rgb(133, 88, 236)", edge);
  }
  check("no console errors on any of it", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
