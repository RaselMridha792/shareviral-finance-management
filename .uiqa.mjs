/**
 * The shared pieces under components/ui, on every screen that draws them.
 *
 * The cards, fields, SL boxes, row buttons, pills, tab groups, stat cards,
 * empty states, filter bar, pager and search box reach every screen at once,
 * so this walks all of them — detail pages with real ids, every Settings
 * section — and reads what was painted, rather than trusting the diff: a 28px
 * SL box, 32px row buttons with Phosphor icons, a lime active tab, a 1.5px
 * field border that turns violet while typing, no old icon font left in a
 * shared piece, nothing wider than the window, and no console errors.
 *
 *     node .uiqa.mjs      (local only — reads, writes nothing)
 *
 * Needs `npm run dev` running (web :3000, api :4001). Screenshots of each
 * screen go to .shots/ui-*.png.
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB ?? "http://localhost:3000";
const SHOTS = ".shots";
const ONLY = process.argv[2];

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
const person = await one(`select id from team_members where deleted_at is null order by created_at limit 1`);
await db.end();
const token = jwt.sign({ sub: admin.id, role: admin.role, tv: admin.token_version }, env.JWT_ACCESS_SECRET, {
  expiresIn: "1h",
});

const SETTINGS = ["company", "categories", "tax", "security", "users", "audit", "trashed", "assistant", "email", "notifications"];
const ROUTES = [
  "/",
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
  "/team",
  person && `/team/${person.id}`,
  "/payroll",
  run && `/payroll/${run.id}`,
  "/tax/withholding",
  "/reports",
  "/statement",
  "/assistant",
  "/data",
  ...SETTINGS.map((t) => `/settings?tab=${t}`),
]
  .filter(Boolean)
  .filter((r) => !ONLY || r.includes(ONLY));

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
let errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

const read = () =>
  page.evaluate(() => {
    const main = document.querySelector("main");
    const px = (el, p) => (el ? getComputedStyle(el)[p] : null);
    const serial = main.querySelector(".table-data tbody .sv-serial");
    const rowButton = main.querySelector(".sv-row-button");
    const activeTab = main.querySelector('.sv-card[role="tablist"] [aria-selected="true"]');
    const control = main.querySelector(".sv-control");
    const statCard = main.querySelector(".sv-tint-tile")?.closest(".sv-card");
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      serial: serial && `${px(serial, "height")} ${px(serial, "fontWeight")}`,
      bareSerials: [...main.querySelectorAll(".table-data tbody tr")].filter(
        (tr) => tr.children.length > 2 && /^\d+$/.test(tr.children[0].textContent.trim()) && !tr.querySelector(".sv-serial"),
      ).length,
      rowButton: rowButton && `${px(rowButton, "width")} ${Boolean(rowButton.querySelector("svg"))}`,
      lucideInRow: main.querySelectorAll(".table-data td:last-child svg.lucide").length,
      activeTab: activeTab && px(activeTab, "backgroundColor"),
      control: control && `${px(control, "borderTopWidth")} ${px(control, "borderTopLeftRadius")}`,
      statCard: Boolean(statCard),
      oldIconsInShared: main.querySelectorAll(".sv-tint-tile .ms-icon, .sv-empty-tile .ms-icon").length,
      cards: main.querySelectorAll(".sv-card").length,
    };
  });

try {
  for (const width of [1440, 390]) {
    console.log(`\n${width}px`);
    await page.setViewport({ width, height: 900 });
    for (const route of ROUTES) {
      errors = [];
      await page.goto(`${WEB}${route}`, { waitUntil: "networkidle0", timeout: 120000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
      const m = await read();
      const label = route.replace(/[0-9a-f-]{36}/, ":id");
      const bits = [
        m.serial && `SL ${m.serial}`,
        m.rowButton && `row button ${m.rowButton}`,
        m.activeTab && `tab ${m.activeTab}`,
        m.control && `field ${m.control}`,
        m.statCard && "stat card",
        `${m.cards} cards`,
      ].filter(Boolean);
      if (width === 1440) {
        const good =
          (!m.serial || m.serial === "28px 800") &&
          m.bareSerials === 0 &&
          (!m.rowButton || m.rowButton === "32px true") &&
          m.lucideInRow === 0 &&
          (!m.activeTab || m.activeTab === "rgb(191, 255, 0)") &&
          (!m.control || /^1(\.5)?px (11|8)px$/.test(m.control)) &&
          m.oldIconsInShared === 0 &&
          m.overflow <= 0 &&
          errors.length === 0;
        check(label, good, `${bits.join(", ")}${m.lucideInRow ? `, ${m.lucideInRow} lucide row icons` : ""}${m.bareSerials ? `, ${m.bareSerials} bare SL` : ""}${errors.length ? ` | ${errors[0].slice(0, 140)}` : ""}`);
        await page.screenshot({ path: `${SHOTS}/ui-${label.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.png`, fullPage: true });
      } else {
        check(`${label} fits at ${width}`, m.overflow <= 0 && errors.length === 0, `${m.overflow}px sideways${errors.length ? ` | ${errors[0].slice(0, 140)}` : ""}`);
      }
    }
  }

  // A field in a popup: 1.5px, 11px, violet while typing.
  if (!ONLY) {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0" });
    const add = await page.evaluateHandle(() =>
      [...document.querySelectorAll("main button")].find((b) => /bg-primary/.test(b.className)),
    );
    if (add.asElement()) {
      await add.asElement().click();
      await page.waitForSelector("[data-popup] .sv-control", { timeout: 15000 });
      const field = await page.$("[data-popup] input.sv-control:not([type=date])");
      const before = await page.evaluate((el) => getComputedStyle(el).borderTopColor, field);
      await field.focus();
      await new Promise((r) => setTimeout(r, 400));
      const after = await page.evaluate(
        (el) => ({ c: getComputedStyle(el).borderTopColor, w: getComputedStyle(el).borderTopWidth, r: getComputedStyle(el).borderTopLeftRadius, bg: getComputedStyle(el).backgroundColor }),
        field,
      );
      const label = await page.evaluate(() => {
        const l = document.querySelector("[data-popup] label > span");
        return `${getComputedStyle(l).fontSize} ${getComputedStyle(l).fontWeight}`;
      });
      // Chrome snaps a 1.5px border to whole device pixels: 1px at this density.
      check("a popup field is 1.5px on 11px corners", /^1(\.5)?px$/.test(after.w) && after.r === "11px", `${after.w} ${after.r}`);
      check("and turns violet on a white ground while typing", before !== after.c && after.c === "rgb(133, 88, 236)" && after.bg === "rgb(255, 255, 255)", `${before} -> ${after.c}, ${after.bg}`);
      check("its label is 13px/800", label === "13px 800", label);
      await page.screenshot({ path: `${SHOTS}/ui-popup-field.png` });
    }
  }
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
