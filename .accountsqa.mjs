/**
 * Accounts and an account's own page, in the September 2026 design.
 *
 * Every balance is read off the painted page and held against the API's own
 * answer for the same moment — now, and at the end of last month — and the
 * "Total held" figure against the cards under it, added in paisa.
 *
 *     node .accountsqa.mjs      (local only — reads, writes nothing)
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
const admin = (
  await db.query(
    `select id, role, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`,
  )
).rows[0];
await db.end();
const token = jwt.sign({ sub: admin.id, role: admin.role, tv: admin.token_version }, env.JWT_ACCESS_SECRET, {
  expiresIn: "1h",
});

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const paisaOf = (text) => {
  if (!text) return null;
  const neg = /[−-]/.test(text);
  const digits = text.replace(/[^0-9.]/g, "");
  const [whole, frac = ""] = digits.split(".");
  return (neg ? -1 : 1) * (Number(whole) * 100 + Number((frac + "00").slice(0, 2)));
};
const toPaisa = (s) => Math.round(Number(s) * 100);

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
const open = async (path) => {
  await page.goto(`${WEB}${path}`, { waitUntil: "networkidle0", timeout: 120000 });
  await new Promise((r) => setTimeout(r, 800));
};
const api = (path) =>
  page.evaluate(async (path) => {
    const r = await fetch(`/api${path}`, { credentials: "include", headers: { "X-Requested-With": "finance-web" } });
    return r.json();
  }, path);

/** What the list page shows: the band, and every card's name and taka figure. */
const readList = () =>
  page.evaluate(() => {
    const band = document.querySelector(".sv-total");
    // Read by the card's own hooks (`data-account-id`, `data-account-name`) since
    // the cards became drawn bank cards (#105) and their classes changed.
    const cards = [...document.querySelectorAll("main [data-account-id]")];
    return {
      bandLabel: band?.querySelector("p")?.textContent.trim(),
      bandFigure: band?.querySelector(".text-right")?.textContent.trim(),
      cards: cards.map((c) => {
        const figures = [...c.querySelectorAll(".col-amount")].map((x) => x.textContent.trim());
        return {
          name: c.querySelector("[data-account-name]")?.textContent.trim(),
          pill: c.querySelector(".sv-bankcard-pill")?.textContent.trim(),
          taka: figures.find((f) => f.includes("৳")),
          href: c.querySelector('a[href^="/accounts/"]')?.getAttribute("href"),
          archived: Boolean(c.closest(".sv-archived")),
        };
      }),
    };
  });

try {
  /* ------------------------------------------------ the list, now */
  console.log("\n/accounts — as it stands now");
  await page.setViewport({ width: 1440, height: 900 });
  await open("/accounts");
  const now = await readList();
  const fromApi = await api("/accounts?includeInactive=true");
  const active = fromApi.filter((a) => a.isActive);
  const shownActive = now.cards.filter((c) => !c.archived);

  check("one card per active account", shownActive.length === active.length, `${shownActive.length} of ${active.length}`);
  let agree = true;
  for (const a of active) {
    const c = shownActive.find((x) => x.name === a.name);
    if (!c || paisaOf(c.taka) !== toPaisa(a.balance) || c.href !== `/accounts/${a.id}`) agree = false;
  }
  check("every card's balance is the API's, to the paisa, and links to its page", agree);
  const sum = active.reduce((s, a) => s + toPaisa(a.balance), 0);
  const band = paisaOf(now.bandFigure?.split("≈")[0]);
  check("Total held = the active balances added, to the paisa", now.bandLabel === "Total held" && band === sum, `${band / 100} vs ${sum / 100}`);
  // The owner's drawing: a card says CARD, anything else the currency it holds.
  check(
    "each card carries its currency, or CARD, in a pill",
    shownActive.every((c) => {
      const a = active.find((x) => x.name === c.name);
      return a && c.pill === (a.type === "card" ? "CARD" : a.currency);
    }),
    shownActive.map((c) => c.pill).join(", "),
  );

  const card = await page.$("main .sv-card.sv-card-lift");
  await card.hover();
  await new Promise((r) => setTimeout(r, 600));
  const lift = await page.evaluate((el) => ({ border: getComputedStyle(el).borderTopColor, t: getComputedStyle(el).transform }), card);
  check("a card lifts with a violet-soft edge", lift.border === "rgb(205, 184, 251)" && /-2\)$/.test(lift.t), `${lift.border} ${lift.t}`);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${SHOTS}/accounts.png`, fullPage: true });

  /* ------------------------------------------------ the list, last month */
  console.log("\n/accounts — at the end of last month");
  const option = await page.evaluate(() => {
    const select = document.querySelector('select[aria-label="Balances as at"]');
    const o = select.options[1];
    return o ? { value: o.value, label: o.textContent.trim() } : null;
  });
  if (option) {
    await page.select('select[aria-label="Balances as at"]', option.value);
    await new Promise((r) => setTimeout(r, 2500));
    const then = await readList();
    const thenApi = await api(`/accounts?includeInactive=true&asOf=${option.value}`);
    const thenActive = thenApi.filter((a) => a.isActive);
    const thenSum = thenActive.reduce((s, a) => s + toPaisa(a.balance), 0);
    check("the band names the month", then.bandLabel === `Held at the end of ${option.label.replace(/^End of /, "")}`, then.bandLabel);
    check("and its total is the API's for that day", paisaOf(then.bandFigure?.split("≈")[0]) === thenSum, `${paisaOf(then.bandFigure?.split("≈")[0]) / 100} vs ${thenSum / 100}`);
  }

  /* ------------------------------------------------ an account's page */
  const first = active[0];
  console.log(`\n/accounts/${first.id.slice(0, 8)}… — ${first.name}`);
  await open(`/accounts/${first.id}`);
  const d = await page.evaluate(() => {
    const holds = document.querySelector(".sv-holds");
    const panels = [...document.querySelectorAll("main section.sv-card")].map((p) => p.querySelector("h2")?.textContent.trim());
    const rows = [...document.querySelectorAll("main section.sv-card .sv-row-rule")].map((r) => r.firstElementChild.textContent.trim());
    return {
      back: document.querySelector('main a[href="/accounts"]')?.textContent.trim(),
      title: document.querySelector("main .sv-page-head h1")?.textContent.trim(),
      holds: holds?.querySelector(".text-right")?.textContent.trim(),
      panels,
      rows,
      tiles: [...document.querySelectorAll("main .sv-tile p:first-child")].map((p) => p.textContent.trim()),
      copies: document.querySelectorAll('main button[aria-label^="Copy the"]').length,
    };
  });
  check("the way back to all accounts", d.back === "All accounts");
  check("the header names the account", d.title === first.name, d.title);
  check("what it holds is the API's balance", paisaOf(d.holds?.split("≈")[0]) === toPaisa(first.balance), d.holds);
  check("the Account panel and Where the records start", d.panels.includes("Account") && d.panels.includes("Where the records start"), d.panels.join(", "));
  check("the account's fields, in order", d.rows.slice(0, 3).join("|") === "Name|Type|Bank", d.rows.join(", "));
  check("the two opening tiles", d.tiles.join("|") === "Opening balance|Opening balance date", d.tiles.join(", "));
  await page.screenshot({ path: `${SHOTS}/account-detail.png`, fullPage: true });
  await page.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.textContent.includes("Entries and balance")).click());
  await page.waitForFunction(() => location.pathname.endsWith("/register"), { timeout: 30000 }).then(
    () => check("Entries and balance opens the register", true),
    () => check("Entries and balance opens the register", false),
  );

  const cardAccount = fromApi.find((a) => a.type === "card");
  if (cardAccount) {
    await open(`/accounts/${cardAccount.id}`);
    const panels = await page.evaluate(() => [...document.querySelectorAll("main section.sv-card h2")].map((h) => h.textContent.trim()));
    check("a card's page carries the Card panel", panels.includes("Card"), panels.join(", "));
  }

  /* ------------------------------------------------ narrow */
  for (const width of [900, 390]) {
    await page.setViewport({ width, height: 900 });
    for (const path of ["/accounts", `/accounts/${first.id}`]) {
      await open(path);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${path.replace(first.id, ":id")} at ${width}px: no sideways scroll`, over <= 0, `${over}px`);
    }
  }
  await page.setViewport({ width: 390, height: 844 });
  await open("/accounts");
  await page.screenshot({ path: `${SHOTS}/accounts-phone.png`, fullPage: true });

  check("no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
