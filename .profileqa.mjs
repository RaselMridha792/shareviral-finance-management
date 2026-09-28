/**
 * A team member's profile, in the layout of the HR portal's (#113).
 *
 * The owner, 28 Sep 2026: *"single team page tao ektu design improve korte
 * hobe. kono existing field change hobena sudhu design improve hobe existing
 * functionalities thik rekhe ... screenshots a jevabe header sundor vabe add
 * kora tarpor section gular jonne sundor nevigation. prottekta item er jonne
 * icons"*.
 *
 * Read-only, on the people already in the local database:
 *   - the banner names the person, with the chips the record holds;
 *   - the two figures are the database's: papers on file of those expected,
 *     and details filled of the fifteen counted;
 *   - each tab shows its sections and only those; Overview shows them all;
 *   - every fact row carries its icon;
 *   - Edit record and Change status still open their drawers;
 *   - HR sees what the super admin sees — every live role holds
 *     `team.compensation.read` (only the withdrawn admin/finance roles do not,
 *     and they cannot open Team at all), so the locked pay card is unchanged
 *     and unreachable today;
 *   - nothing scrolls sideways at 1440 or on a phone, and nothing errors.
 *
 *     node .profileqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
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
const who = async (role) =>
  (await q(`select id, role, token_version from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role]))[0];
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const admin = await who("super_admin");
const hr = await who("hr");

const member = (
  // Dates as text: `pg` reads a `date` as local midnight, which prints a day
  // early in Dhaka.
  await q(`select *, joined_on::text as joined_on from team_members where deleted_at is null order by created_at limit 1`)
)[0];
const FIELDS = [
  "employee_code", "designation", "department", "date_of_birth", "gender", "blood_group", "nid", "phone",
  "personal_email", "work_email", "address", "permanent_address", "education_level", "bank_name", "bank_account_number",
];
const filled = FIELDS.filter((f) => member[f] !== null && member[f] !== undefined && String(member[f]).trim() !== "").length;
const working = member.status === "active" || member.status === "on_leave";
const KINDS = ["cv", "appointment_letter", "salary_certificate", "nid", "etin_certificate", "e_return",
  "education_certificate", "experience_letter", "release_letter", "bank_details"];
const kinds = (await q(`select distinct kind from files where team_member_id = $1 and deleted_at is null`, [member.id])).map((r) => r.kind);
const expected = [...KINDS, ...(!working || kinds.includes("resignation_letter") ? ["resignation_letter"] : [])];
const received = expected.filter((k) => kinds.includes(k)).length;
await db.end();

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const dmy = (d) => {
  const iso = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  const [y, m, day] = iso.split("-");
  return `${day}/${m}/${y}`;
};

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, width = 1440) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}/team/${member.id}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(1200);
  return { page, context };
};
const titles = (page) =>
  page.evaluate(() => [...document.querySelectorAll(".sv-profile .sv-panel-head h2")].map((h) => h.textContent.trim()));
const tabTo = async (page, label) => {
  await page.evaluate((t) => [...document.querySelectorAll(".sv-profile-tab")].find((b) => b.textContent.trim() === t)?.click(), label);
  await settle(500);
};

try {
  console.log(`\n${member.full_name}, as the super admin`);
  const { page, context } = await open(admin);

  /* The banner. */
  const hero = await page.evaluate(() => {
    const card = document.querySelector(".sv-profile-hero");
    return {
      banner: Boolean(card?.querySelector(".sv-profile-banner")),
      name: card?.querySelector("h1")?.textContent.trim(),
      chips: [...(card?.querySelectorAll(".sv-profile-chip") ?? [])].map((c) => c.textContent.trim()),
      pill: Boolean(card?.querySelector("[class*='rounded-full']")),
    };
  });
  check("the banner names the person", hero.banner && hero.name === member.full_name, hero.name);
  const wantChips = [
    ...(member.employee_code ? [member.employee_code] : []),
    ...(member.employment_type ? ["(type)"] : []),
    `Joined ${dmy(member.joined_on)}`,
  ];
  check(
    "with the chips the record holds — code, type, joining date",
    hero.chips.length === wantChips.length && hero.chips.at(-1) === `Joined ${dmy(member.joined_on)}` &&
      (!member.employee_code || hero.chips[0] === member.employee_code),
    JSON.stringify(hero.chips),
  );

  /* The two figures. */
  const figures = await page.evaluate(() =>
    [...document.querySelectorAll('[role="progressbar"]')].map((bar) => {
      const card = bar.closest(".sv-card");
      return { label: bar.getAttribute("aria-label"), value: card?.querySelector("p:nth-of-type(2)")?.textContent.trim(), now: Number(bar.getAttribute("aria-valuenow")) };
    }),
  );
  const docsFig = figures.find((f) => f.label === "Documents");
  const recordFig = figures.find((f) => f.label === "Record");
  check(
    "Documents is the database's — papers on file of those expected",
    docsFig?.value === `${received} of ${expected.length}`,
    `${docsFig?.value} vs ${received} of ${expected.length}`,
  );
  check(
    "Record is the database's — details filled of the fifteen",
    recordFig?.value === `${Math.round((filled / FIELDS.length) * 100)}%`,
    `${recordFig?.value} vs ${filled}/${FIELDS.length}`,
  );

  /* The tabs. */
  const tabs = await page.evaluate(() => [...document.querySelectorAll(".sv-profile-tab")].map((b) => ({ label: b.textContent.trim(), icon: Boolean(b.querySelector("svg")) })));
  check(
    "six tabs, each with its icon",
    tabs.map((t) => t.label).join("|") === "Overview|Personal|Employment|Pay & bank|Documents|Paid tools" && tabs.every((t) => t.icon),
    tabs.map((t) => t.label).join(", "),
  );
  const all = await titles(page);
  const WANT = {
    Personal: ["Employee details", "Contact", "Social media"],
    Employment: ["Employment", "Record", "Notes"],
    "Pay & bank": ["Tax", "Where they are paid", "Pay", "E-Return", "Payslips"],
    Documents: ["Documents"],
    "Paid tools": ["Paid tools"],
  };
  const everything = [...new Set(Object.values(WANT).flat())];
  check("Overview shows every section", everything.every((t) => all.includes(t)), all.join(", "));
  for (const [label, want] of Object.entries(WANT)) {
    await tabTo(page, label);
    const shown = (await titles(page)).filter((t) => t !== "Salary changes");
    check(`${label} shows its sections and only those`, JSON.stringify(shown) === JSON.stringify(want), shown.join(", "));
  }
  await tabTo(page, "Overview");

  /* Every fact row carries its icon. */
  const rows = await page.evaluate(() => [...document.querySelectorAll(".sv-profile-row")].map((r) => Boolean(r.querySelector("svg"))));
  check("every fact row carries its icon", rows.length >= 25 && rows.every(Boolean), `${rows.filter(Boolean).length} of ${rows.length}`);

  /* The acts. */
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Edit record")?.click());
  const edits = await page.waitForSelector("[data-popup] form", { timeout: 10000 }).then(() => true).catch(() => false);
  check("Edit record opens the form", edits);
  await page.keyboard.press("Escape");
  await settle(500);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Change status")?.click());
  const status = await page.waitForFunction(() => /Change status/.test([...document.querySelectorAll("[data-popup]")].pop()?.innerText ?? ""), { timeout: 10000 }).then(() => true).catch(() => false);
  check("Change status opens its drawer", status);
  await page.keyboard.press("Escape");
  await settle(400);

  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("nothing scrolls sideways at 1440", sideways <= 0, `${sideways}px`);
  await context.close();

  /* A phone. */
  const phone = await open(admin, 390);
  const phoneSideways = await phone.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("nor on a phone", phoneSideways <= 0, `${phoneSideways}px`);
  await phone.context.close();

  /* HR holds the pay permissions, so sees the same page. */
  if (hr) {
    console.log("\nas HR");
    const h = await open(hr);
    const hrAll = await titles(h.page);
    check("HR sees the same sections the super admin does", JSON.stringify(hrAll) === JSON.stringify(all), hrAll.join(", "));
    await h.context.close();
  }

  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
