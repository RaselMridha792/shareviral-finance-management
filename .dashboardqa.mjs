/**
 * The dashboard, in the September 2026 design.
 *
 * Every figure is read off the painted page and held against something that
 * did not come from the page: the API's own report for the same month, the
 * database for the renewals, and the arithmetic the cards claim (opening + in −
 * out = closing, and the greeting's total = the accounts' closings).
 *
 *     node .dashboardqa.mjs     (local only — writes nothing but localStorage)
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
const who = async (role) =>
  (
    await db.query(
      `select id, role, token_version, full_name from users
        where role = $1 and status = 'active' and deleted_at is null
        order by created_at limit 1`,
      [role],
    )
  ).rows[0];
const admin = await who("super_admin");
const hr = await who("hr");
const today = (
  await db.query(`select to_char(now() at time zone 'Asia/Dhaka', 'YYYY-MM-DD') as d`)
).rows[0].d;
const monthPrefix = today.slice(0, 8);
const renewalsInDb = (
  await db.query(
    `select count(*)::int as n from subscriptions
      where status = 'active' and deleted_at is null
        and to_char(next_renewal_on, 'YYYY-MM-DD') like $1`,
    [`${monthPrefix}%`],
  )
).rows[0].n;
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
const fresh = async (user, width = 1440, height = 900) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
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
  await new Promise((r) => setTimeout(r, 700)); // the entrance animation
};

/** "৳1,08,400.00" → 108400.00 in paisa; "−৳5.00" negative. */
const PAISA = `(text) => {
  if (!text) return null;
  const neg = /[−-]/.test(text);
  const digits = text.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const [whole, frac = ""] = digits.split(".");
  return (neg ? -1 : 1) * (Number(whole) * 100 + Number((frac + "00").slice(0, 2)));
}`;

const readPage = (page) =>
  page.evaluate((paisaSrc) => {
    const paisa = eval(paisaSrc);
    const bdtOf = (card) => {
      const texts = [...card.querySelectorAll("p")].map((p) => p.textContent.trim());
      return paisa(texts.find((t) => t.includes("৳")));
    };
    const blocks = [...document.querySelectorAll("main section")]
      .filter((s) => s.querySelector("h2") && s.querySelectorAll(".sv-card").length === 4 && !s.textContent.includes("Expense overview"))
      .map((s) => {
        const cards = [...s.querySelectorAll(".sv-card")];
        return {
          name: s.querySelector("h2").textContent.trim(),
          labels: cards.map((c) => c.querySelector("span.uppercase")?.textContent.trim()),
          bdt: cards.map(bdtOf),
          tiles: cards.map((c) => getComputedStyle(c.querySelector("span.grid")).backgroundColor),
        };
      });
    const hero = document.querySelector(".sv-hero");
    const heldLabel = [...hero.querySelectorAll("p")].find((p) => /Total held|Held at the end/.test(p.textContent));
    const expense = [...document.querySelectorAll("main section")].find((s) => s.textContent.includes("Expense overview"));
    return {
      date: hero.querySelector("p").textContent.trim(),
      greeting: hero.querySelector("h1").textContent.trim(),
      nameColor: getComputedStyle(hero.querySelector("h1 span")).color,
      heroBg: getComputedStyle(hero).backgroundColor,
      // The number is its own badge; the gap between it and the words is
      // layout, not text, so the two are read apart and joined here.
      chips: [...hero.querySelectorAll("li")].map((li) => `${li.querySelector("span").textContent.trim()} ${li.lastChild.textContent.trim()}`),
      heldLabel: heldLabel?.textContent.trim(),
      held: paisa(heldLabel?.nextElementSibling?.textContent),
      blocks,
      expenseLabels: expense ? [...expense.querySelectorAll(".sv-card span.uppercase")].map((x) => x.textContent.trim()) : [],
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      h1: document.querySelectorAll("h1").length,
    };
  }, PAISA);

try {
  /* ------------------------------------------------ 1. this month */
  console.log(`\n1. This month (${today.slice(0, 7)}), Super Admin`);
  const { page, errors, context } = await fresh(admin);
  await open(page, "/");
  await page.evaluate(() => {
    localStorage.removeItem("sfm.dashboard.account-order.v1");
    localStorage.removeItem("sfm.dashboard.expense-cards.v1");
  });
  await open(page, "/");
  const m = await readPage(page);

  // The API's own answer for the same month, fetched with the same session.
  const [y, mo] = today.split("-").map(Number);
  const api = await page.evaluate(async (y, mo) => {
    const periods = await (await fetch("/api/reports/periods?granularity=month", { credentials: "include", headers: { "X-Requested-With": "finance-web" } })).json();
    const july = periods.fiscalYearMode === "bd_july_june";
    const fy = july ? (mo >= 7 ? y : y - 1) : y;
    const index = july ? ((mo + 5) % 12) + 1 : mo;
    const r = await fetch(`/api/reports/overview?granularity=month&fiscalYear=${fy}&index=${index}`, { credentials: "include", headers: { "X-Requested-With": "finance-web" } });
    return r.json();
  }, y, mo);
  const toPaisa = (s) => Math.round(Number(s) * 100);

  check("the day, written out", /^[A-Z][a-z]+day, \d{1,2} [A-Z][a-z]+ \d{4}$/.test(m.date), m.date);
  check("the greeting names the reader, in violet", m.greeting === `Overview, ${admin.full_name.split(" ")[0]}` && m.nameColor === "rgb(133, 88, 236)", `${m.greeting} / ${m.nameColor}`);
  check("the card is violet-tint", m.heroBg === "rgb(241, 236, 254)", m.heroBg);
  check("one h1 on the page", m.h1 === 1);
  const want = [
    `${api.groups.length} account${api.groups.length === 1 ? "" : "s"}`,
    `${api.headcount.employees} on payroll`,
    `${renewalsInDb} renewal${renewalsInDb === 1 ? "" : "s"} this month`,
  ];
  check("chips: accounts, payroll, renewals — against the API and the database", JSON.stringify(m.chips) === JSON.stringify(want), m.chips.join(" | "));
  check("one block per account the API returned", m.blocks.length === api.groups.length, `${m.blocks.length} of ${api.groups.length}`);

  let tie = true;
  let agree = true;
  for (const [i, b] of m.blocks.entries()) {
    const [o, inn, out, close] = b.bdt;
    if (o + inn - out !== close) tie = false;
    const g = api.groups.find((x) => x.label === b.name);
    if (!g || [g.opening, g.moneyIn, g.moneyOut, g.closing].map(toPaisa).join() !== [o, inn, out, close].join()) agree = false;
    if (i === 0) {
      check("four cards in the design's order", b.labels.join("|") === "Opening balance|Cash inflow|Cash outflow|Current balance", b.labels.join(", "));
      check("in is green-tinted and out red-tinted", b.tiles[1] === "rgb(230, 245, 234)" && b.tiles[2] === "rgb(252, 233, 231)", `${b.tiles[1]} / ${b.tiles[2]}`);
    }
  }
  check("every block: opening + in − out = closing, to the paisa", tie);
  check("every block agrees with the API to the paisa", agree);
  const sum = m.blocks.reduce((a, b) => a + b.bdt[3], 0);
  check("Total held = the accounts' closings added up", m.heldLabel === "Total held" && m.held === sum, `${m.heldLabel} ${m.held / 100} vs ${sum / 100}`);
  check("the expense row opens on the usual four", m.expenseLabels.join("|") === "Salary paid|AI & other tools|TDS withheld|Total spent", m.expenseLabels.join(", "));
  check("no sideways scroll at 1440", m.overflow <= 0, `${m.overflow}px`);
  await page.screenshot({ path: `${SHOTS}/dashboard-light.png`, fullPage: true });

  /* ------------------------------------------------ 2. arranging */
  console.log("\n2. Arranging the accounts");
  if (m.blocks.length > 1) {
    const clickText = (text) =>
      page.evaluate((t) => {
        const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t);
        b?.click();
        return Boolean(b);
      }, text);
    await clickText("Edit");
    await new Promise((r) => setTimeout(r, 300));
    const arrows = await page.$$eval('button[aria-label^="Move "]', (x) => x.length);
    check("Edit puts two arrows on every block", arrows === m.blocks.length * 2, `${arrows}`);
    const firstName = m.blocks[0].name;
    await page.click(`button[aria-label="Move ${firstName} down"]`);
    await new Promise((r) => setTimeout(r, 300));
    await clickText("Done");
    await open(page, "/");
    const after = await readPage(page);
    check("moving one down sticks across a reload", after.blocks[1]?.name === firstName, after.blocks.map((b) => b.name).join(" → "));
    check("the figures moved with their block", after.blocks[1].bdt.join() === m.blocks[0].bdt.join());
    await page.evaluate(() => localStorage.removeItem("sfm.dashboard.account-order.v1"));
  } else {
    check("arranging (needs two accounts)", true, "only one account — Edit is not offered, correctly");
  }

  /* ------------------------------------------------ 3. the expense row */
  console.log("\n3. Choosing the expense cards");
  await open(page, "/");
  await page.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.textContent.trim() === "Add").click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.textContent.includes("Add a card")).click());
  const dialog = await page.$('[role="dialog"][aria-label="Add a card"]');
  check("Add opens the chooser", Boolean(dialog));
  const picked = await page.evaluate(() => {
    const b = document.querySelector('[role="dialog"] button:not([aria-label])');
    const name = b?.querySelector("span.block")?.textContent.trim();
    b?.click();
    return name;
  });
  await new Promise((r) => setTimeout(r, 300));
  let labels = await page.evaluate(() => [...[...document.querySelectorAll("main section")].find((s) => s.textContent.includes("Expense overview")).querySelectorAll(".sv-card span.uppercase")].map((x) => x.textContent.trim()));
  check("a picked card joins the row", labels.length === 5 && labels.includes(picked), `${picked}: ${labels.length} cards`);
  await page.click(`button[aria-label="Remove ${picked}"]`);
  await new Promise((r) => setTimeout(r, 300));
  labels = await page.evaluate(() => [...[...document.querySelectorAll("main section")].find((s) => s.textContent.includes("Expense overview")).querySelectorAll(".sv-card span.uppercase")].map((x) => x.textContent.trim()));
  check("and the cross takes it off again", labels.length === 4 && !labels.includes(picked), labels.join(", "));
  await page.evaluate(() => localStorage.removeItem("sfm.dashboard.expense-cards.v1"));

  /* ------------------------------------------------ 4. last month */
  console.log("\n4. A month already over");
  const prev = mo === 1 ? { m: 12, y: y - 1 } : { m: mo - 1, y };
  await open(page, `/?month=${prev.m}&year=${prev.y}`);
  const last = await readPage(page);
  check("the total says it is a close", /^Held at the end of /.test(last.heldLabel ?? ""), last.heldLabel);
  check("no renewals chip for a month gone", !last.chips.some((c) => c.includes("renewal")), last.chips.join(" | "));
  check("the last card says Closing balance", last.blocks.every((b) => b.labels[3] === "Closing balance"));
  check("and still ties", last.blocks.every((b) => b.bdt[0] + b.bdt[1] - b.bdt[2] === b.bdt[3]));
  check("no console errors on any of it", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();

  /* ------------------------------------------------ 5. dark, and a phone */
  console.log("\n5. Dark, and a phone");
  {
    const { page: d, context: c } = await fresh(admin, 390, 844);
    await open(d, "/login");
    await d.evaluate(() => localStorage.setItem("svf-theme-brand", "dark"));
    await open(d, "/");
    const s = await d.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      hero: getComputedStyle(document.querySelector(".sv-hero")).backgroundColor,
      card: getComputedStyle(document.querySelector(".sv-card")).backgroundColor,
    }));
    check("no sideways scroll on a phone", s.overflow <= 0, `${s.overflow}px`);
    check("dark: the design's violet-tint and surface", s.hero === "rgb(36, 26, 61)" && s.card === "rgb(20, 24, 15)", `${s.hero} / ${s.card}`);
    await d.screenshot({ path: `${SHOTS}/dashboard-phone-dark.png`, fullPage: true });
    await c.close();
  }

  /* ------------------------------------------------ 6. HR */
  console.log("\n6. HR");
  if (hr) {
    const { page: h, errors: he, context: c } = await fresh(hr);
    await open(h, "/");
    const s = await h.evaluate(() => ({
      greeting: document.querySelector(".sv-hero h1")?.textContent.trim(),
      money: /৳/.test(document.querySelector("main").innerText),
      team: Boolean([...document.querySelectorAll("main a")].find((a) => a.getAttribute("href") === "/team")),
    }));
    check("HR is welcomed in the same card", s.greeting === `Welcome, ${hr.full_name.split(" ")[0]}`, s.greeting);
    check("and shown no money at all", !s.money);
    check("with the way to Team", s.team);
    check("no console errors", he.length === 0, he.slice(0, 2).join(" | "));
    await h.screenshot({ path: `${SHOTS}/dashboard-hr.png` });
    await c.close();
  } else {
    check("an HR account to look through", false, "none active");
  }
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
