/**
 * The Invoice Builder (#116).
 *
 * The owner, 28 Sep 2026, with `invoice_builder_ShareViral.html` attached:
 * *"amar application a notun ekta features anbo. eta sidebar a add koro eta
 * hobe invoice builder name. eta toiri kore felo"*.
 *
 * In a real browser, against the running app:
 *   - the rail carries "Invoice Builder" for the roles that write to the books
 *     and not for the others; a role without it is turned away at the URL;
 *   - the sheet follows the form: number, dates, status badge and its colour,
 *     the primary colour, bill lines (text, bold, size, add), line items with
 *     fractional quantities, the total to the poisha, the dollar equivalent,
 *     "BDT only" dropping the dollar columns, each eye button, the bank rows;
 *   - a logo upload reaches the sheet;
 *   - the draft survives a reload, and Reset puts the defaults back;
 *   - Download builds a print frame holding the sheet alone, titled with the
 *     invoice number, which prints to exactly one A4 page;
 *   - nothing scrolls sideways at 1440 or on a phone, and nothing errors.
 *
 *     node .invoiceqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .invoiceqa.mjs   also saves screenshots and the PDF
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
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const who = async (role) =>
  (await q(`select id, role, token_version from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role]))[0];
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const users = {
  super_admin: await who("super_admin"),
  cfo: await who("cfo"),
  ceo: await who("ceo"),
  hr: await who("hr"),
};
const format = (await q(`select number_format::text as f from app_settings limit 1`))[0]?.f ?? "bangladeshi";
const rateRow = (await q(`select rate::text as rate from fx_rates order by rate_date desc, created_at desc limit 1`).catch(() => []))[0];
await db.end();

/* The app's own grouping, from the built shared package. */
const { formatMoney } = await import("./packages/shared/dist/index.js");
const taka = (minor) => formatMoney(`${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`, { format });
const usd = (minor, rate) => formatMoney((Number(minor) / 100 / rate).toFixed(2), { currency: "USD" });

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, url = "/invoice-builder", width = 1440) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Encountered two children/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(1000);
  return { page, context };
};

/** Types into a box the way a person does: select all, then the new text. */
const typeInto = async (page, selector, text) => {
  const box = await page.$(selector);
  if (!box) throw new Error(`no ${selector}`);
  await box.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  if (text) await box.type(text);
  await settle(150);
};
const sheet = (page, fn) => page.evaluate(fn);
const railHas = (page) =>
  page.evaluate(() => [...document.querySelectorAll("a[href='/invoice-builder']")].some((a) => a.textContent.includes("Invoice Builder")));

try {
  /* ------------------------------------------------------------------ */
  console.log("\nWho sees it");
  for (const role of ["super_admin", "cfo", "ceo", "hr"]) {
    const user = users[role];
    if (!user) {
      console.log(`  (no active ${role} in this database — skipped)`);
      continue;
    }
    const { page, context } = await open(user, "/");
    const inRail = await railHas(page);
    await page.goto(`${WEB}/invoice-builder`, { waitUntil: "networkidle0", timeout: 120000 });
    await settle(600);
    const landed = new URL(page.url()).pathname;
    const writes = role === "super_admin" || role === "cfo";
    check(
      `${role}: ${writes ? "in the rail, and the page opens" : "not in the rail, and the URL is turned away"}`,
      writes ? inRail && landed === "/invoice-builder" : !inRail && landed === "/no-access",
      `rail ${inRail}, landed ${landed}`,
    );
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nThe sheet follows the form (super admin, 1440)");
  const { page, context } = await open(users.super_admin);
  await page.evaluate(() => localStorage.removeItem("sfm.invoice-builder.v1"));
  await page.reload({ waitUntil: "networkidle0" });
  await settle(800);

  const first = await sheet(page, () => {
    const s = document.querySelector("[data-invoice-sheet]");
    return {
      title: s?.querySelector(".inv-title")?.textContent,
      number: s?.querySelector(".inv-head-meta")?.textContent,
      badge: s?.querySelector(".inv-badge")?.textContent,
      rows: s?.querySelectorAll(".inv-table tbody tr").length,
      total: s?.querySelector(".inv-total span:last-child")?.textContent,
      rate: document.querySelector("[data-invoice-field='usdRate']")?.value,
      breadcrumb: document.querySelector("nav[aria-label='Breadcrumb']")?.textContent,
    };
  });
  check("the sheet draws, with the defaults", first.title === "Invoice" && first.number?.includes("INV-001") && first.badge === "SENT" && first.rows === 1, JSON.stringify(first));
  check("the default total is ৳18 lakh in the company's grouping", first.total === taka(180000000n), `${first.total} vs ${taka(180000000n)}`);
  const expectRate = rateRow ? Number(rateRow.rate).toFixed(2) : "120";
  check("the USD rate starts at the latest rate on file", first.rate === expectRate, `${first.rate} vs ${expectRate}`);
  check("the breadcrumb names the page", /Invoice Builder/.test(first.breadcrumb ?? ""), first.breadcrumb);

  // Number and status.
  await typeInto(page, "[data-invoice-field='number']", "INV-2026-044");
  await page.select("[data-invoice-field='status']", "PAID");
  await settle(200);
  const head = await sheet(page, () => {
    const s = document.querySelector("[data-invoice-sheet]");
    return {
      meta: s.querySelector(".inv-head-meta").textContent,
      footer: s.querySelector(".inv-footer").textContent,
      badge: s.querySelector(".inv-badge").textContent,
      badgeBg: getComputedStyle(s.querySelector(".inv-badge")).backgroundColor,
    };
  });
  check("the number reaches the header and the footer", head.meta.includes("INV-2026-044") && head.footer.includes("INV-2026-044"), head.footer);
  check("PAID is green", head.badge === "PAID" && head.badgeBg === "rgb(34, 197, 94)", `${head.badge} ${head.badgeBg}`);

  // Dates.
  await page.evaluate(() => {
    const set = (sel, value) => {
      const el = document.querySelector(sel);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("[data-invoice-field='issuedOn']", "2026-05-19");
    set("[data-invoice-field='dueOn']", "2026-06-19");
  });
  await settle(200);
  const dates = await sheet(page, () => document.querySelector(".inv-meta").textContent);
  check("the dates read 19 May 2026 and 19 Jun 2026", dates.includes("19 May 2026") && dates.includes("19 Jun 2026"), dates);

  // Primary colour, by hex.
  await typeInto(page, "input[aria-label='Primary colour as hex']", "#123456");
  const head2 = await sheet(page, () => getComputedStyle(document.querySelector(".inv-table thead tr")).backgroundColor);
  check("the primary colour paints the table head", head2 === "rgb(18, 52, 86)", head2);

  // Bill lines: edit, bold, size, add.
  await typeInto(page, "[data-invoice-line='billTo'] input[aria-label='Line 1']", "Acme Holdings Ltd");
  const lineCount = await page.$$eval("[data-invoice-line='billTo']", (rows) => rows.length);
  await page.evaluate(() => [...document.querySelectorAll("[data-invoice-line='billTo']")][1].querySelector("button[aria-label='Bold']").click());
  await typeInto(page, `[data-invoice-line='billTo']:nth-child(2) input[aria-label='Font size in px']`, "16");
  await page.evaluate(() => [...document.querySelectorAll("[data-invoice-section='to'] button")].find((b) => b.textContent.includes("Add line")).click());
  await settle(200);
  await typeInto(page, `[data-invoice-line='billTo'] input[aria-label='Line ${lineCount + 1}']`, "VAT reg 0012345");
  const bill = await sheet(page, () =>
    [...document.querySelectorAll(".inv-bill > div:first-child .inv-bill-line")].map((l) => ({
      text: l.textContent,
      weight: getComputedStyle(l).fontWeight,
      size: getComputedStyle(l).fontSize,
    })),
  );
  check("a bill line's text reaches the sheet", bill[0]?.text === "Acme Holdings Ltd", bill[0]?.text);
  check("Bold and the size apply to their line", bill[1]?.weight === "700" && bill[1]?.size === "16px", JSON.stringify(bill[1]));
  check("an added line prints", bill.at(-1)?.text === "VAT reg 0012345" && bill.length === lineCount + 1, `${bill.length} lines`);

  // Line items: 2.5 × 1,000.10 and 3 × 0.10 → 2,500.25 + 0.30.
  await typeInto(page, "[data-invoice-item] [data-invoice-item-field='qty']", "2.5");
  await typeInto(page, "[data-invoice-item] [data-invoice-item-field='price']", "1,000.10");
  await page.click("[data-invoice-add-item]");
  await settle(200);
  const items = await page.$$("[data-invoice-item]");
  const second = items[1];
  await (await second.$("[data-invoice-item-field='description']")).type("Hosting");
  await (await second.$("[data-invoice-item-field='qty']")).click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type("3");
  await (await second.$("[data-invoice-item-field='price']")).type("0.10");
  await typeInto(page, "[data-invoice-field='usdRate']", "120");
  await settle(200);
  const total = 250025n + 30n;
  const figures = await sheet(page, () => {
    const s = document.querySelector("[data-invoice-sheet]");
    return {
      rows: [...s.querySelectorAll(".inv-table tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent)),
      heads: s.querySelectorAll(".inv-table thead th").length,
      total: s.querySelector(".inv-total span:last-child").textContent,
      usd: s.querySelector(".inv-usd span:last-child")?.textContent,
      formTotal: document.querySelector("[data-invoice-total]")?.textContent,
    };
  });
  check("2.5 × ৳1,000.10 is ৳2,500.25", figures.rows[0]?.[5] === taka(250025n), figures.rows[0]?.[5]);
  check("its dollar amount is at the rate", figures.rows[0]?.[6] === usd(250025n, 120), `${figures.rows[0]?.[6]} vs ${usd(250025n, 120)}`);
  check("3 × ৳0.10 is ৳0.30 — no float drift", figures.rows[1]?.[5] === taka(30n), figures.rows[1]?.[5]);
  check("the total is to the poisha", figures.total === taka(total) && figures.formTotal === `${taka(total)} BDT`, `${figures.total} / ${figures.formTotal}`);
  check("with its USD equivalent", figures.usd === `≈ ${usd(total, 120)} USD`, figures.usd);
  check("seven columns while USD shows", figures.heads === 7, String(figures.heads));

  await page.select("[data-invoice-field='showUsd']", "no");
  await settle(200);
  const bdtOnly = await sheet(page, () => ({
    heads: document.querySelectorAll(".inv-table thead th").length,
    usd: Boolean(document.querySelector(".inv-usd")),
  }));
  check("BDT only drops the dollar columns and the USD line", bdtOnly.heads === 5 && !bdtOnly.usd, JSON.stringify(bdtOnly));
  await page.select("[data-invoice-field='showUsd']", "yes");

  // A bad amount is flagged, not silently summed.
  await typeInto(page, "[data-invoice-item] [data-invoice-item-field='price']", "12abc");
  const flagged = await page.$eval("[data-invoice-item] [data-invoice-item-field='price']", (el) => el.getAttribute("aria-invalid"));
  check("a price that is not an amount is marked", flagged === "true", flagged);
  await typeInto(page, "[data-invoice-item] [data-invoice-item-field='price']", "1000.10");

  // The eye buttons.
  const blocks = { "Meta row": ".inv-meta", "Bill section": ".inv-bill", "Pay terms": ".inv-terms", "Bank info": ".inv-bank", Notes: ".inv-notes" };
  for (const [label, selector] of Object.entries(blocks)) {
    const before = await page.$(`[data-invoice-sheet] ${selector}`);
    await page.click(`[data-invoice-eye='${label}']`);
    await settle(150);
    const hidden = !(await page.$(`[data-invoice-sheet] ${selector}`));
    await page.click(`[data-invoice-eye='${label}']`);
    await settle(150);
    const back = Boolean(await page.$(`[data-invoice-sheet] ${selector}`));
    check(`the ${label} eye hides and restores its block`, Boolean(before) && hidden && back);
  }

  // The logo.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const logoPath = path.join(process.env.TEMP || ".", "invoiceqa-logo.png");
  fs.writeFileSync(logoPath, png);
  await (await page.$("[data-invoice-logo]")).uploadFile(logoPath);
  await settle(600);
  const logo = await sheet(page, () => document.querySelector(".inv-logo img")?.getAttribute("src")?.slice(0, 22));
  check("an uploaded logo reaches the sheet", logo === "data:image/png;base64,", logo);

  // Sideways scroll.
  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("nothing scrolls sideways at 1440", wide);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "builder-1440.png"), fullPage: false });

  /* ------------------------------------------------------------------ */
  console.log("\nKept, and reset");
  await settle(700); // past the save's pause
  await page.reload({ waitUntil: "networkidle0" });
  await settle(900);
  const kept = await sheet(page, () => ({
    number: document.querySelector("[data-invoice-field='number']")?.value,
    rows: document.querySelectorAll(".inv-table tbody tr").length,
    logo: document.querySelector(".inv-logo img")?.getAttribute("src")?.slice(0, 22),
  }));
  check("a reload keeps the draft — number, items, logo", kept.number === "INV-2026-044" && kept.rows === 2 && kept.logo === "data:image/png;base64,", JSON.stringify(kept));

  /* ------------------------------------------------------------------ */
  console.log("\nDownload");
  /* The frame as it is when print is called — after the fit — with the
     browser's dialog stubbed out. */
  const catchPrint = () =>
    page.evaluate(() => {
      window.__invoiceFrame = null;
      const append = document.body.appendChild.bind(document.body);
      document.body.appendChild = (node) => {
        if (node.tagName === "IFRAME") {
          node.addEventListener("load", () => {
            node.contentWindow.print = () => {
              window.__invoiceFrame = node.contentDocument.documentElement.outerHTML;
            };
          });
        }
        return append(node);
      };
    });
  const printed = async () => {
    await page.click("[data-invoice-download]");
    for (let i = 0; i < 40 && !(await page.evaluate(() => window.__invoiceFrame)); i++) await settle(250);
    return page.evaluate(() => window.__invoiceFrame);
  };
  const pagesOf = async (html, file) => {
    const printPage = await context.newPage();
    printPage.on("pageerror", (e) => errors.push(`print frame: ${e}`));
    await printPage.goto(`${WEB}/no-access`, { waitUntil: "networkidle0" });
    await printPage.setContent(html, { waitUntil: "load" });
    await printPage.evaluate(() => document.fonts.ready);
    await printPage.emulateMediaType("print");
    const pdf = await printPage.pdf({ printBackground: true, preferCSSPageSize: true });
    const font = await printPage.evaluate(() => getComputedStyle(document.querySelector(".inv-sheet")).fontFamily);
    const zoom = await printPage.evaluate(() => Number(getComputedStyle(document.querySelector(".inv-sheet")).zoom));
    if (SHOTS && file) fs.writeFileSync(path.join(SHOTS, file), pdf);
    await printPage.close();
    return { pages: (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length, font, zoom };
  };
  await catchPrint();
  const srcdoc = await printed();
  check("Download builds a print frame", Boolean(srcdoc));
  if (srcdoc) {
    const title = /<title>([^<]*)<\/title>/.exec(srcdoc)?.[1];
    check("titled with the invoice number, the PDF's file name", title === "INV-2026-044", title);
    const body = srcdoc.slice(srcdoc.indexOf("<body>"));
    check("holding the sheet and nothing of the app", body.includes("data-invoice-sheet") && !body.includes("<aside") && !body.includes("Breadcrumb"));
    const two = await pagesOf(srcdoc, "invoice.pdf");
    check("two items and six address lines still print to one A4 page, fitted", two.pages === 1 && two.zoom < 1 && two.zoom >= 0.8, JSON.stringify(two));
    check("in the app's font", /Jakarta/i.test(two.font), two.font);
  }

  // A long invoice runs on, at full size.
  for (let i = 0; i < 10; i++) await page.click("[data-invoice-add-item]");
  await settle(300);
  await catchPrint();
  const long = await printed();
  if (long) {
    const run = await pagesOf(long, "invoice-long.pdf");
    check("twelve items run on to a second page at full size", run.pages === 2 && run.zoom === 1, JSON.stringify(run));
  } else check("twelve items run on to a second page at full size", false, "no frame");

  await page.click("[data-invoice-reset]");
  await settle(200);
  await page.click("[data-invoice-reset-confirm]");
  await settle(700);
  const reset = await sheet(page, () => ({
    number: document.querySelector("[data-invoice-field='number']")?.value,
    rows: document.querySelectorAll(".inv-table tbody tr").length,
    logo: document.querySelector(".inv-logo img")?.getAttribute("src")?.slice(0, 22),
    hex: document.querySelector("input[aria-label='Primary colour as hex']")?.value,
  }));
  check("Reset puts the defaults back — colours' boxes too", reset.number === "INV-001" && reset.rows === 1 && reset.logo !== "data:image/png;base64," && reset.hex === "#0a0a0a", JSON.stringify(reset));
  await context.close();

  /* ------------------------------------------------------------------ */
  console.log("\nOn a phone");
  const phone = await open(users.super_admin, "/invoice-builder", 390);
  const narrow = await phone.page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= window.innerWidth,
    zoom: Number(getComputedStyle(document.querySelector("[data-invoice-preview]")).zoom),
    sheetRight: document.querySelector("[data-invoice-sheet]").getBoundingClientRect().right,
  }));
  check("nothing scrolls sideways at 390, the sheet shrunk to fit", narrow.fits && narrow.zoom < 1 && narrow.sheetRight <= 390, JSON.stringify(narrow));
  if (SHOTS) await phone.page.screenshot({ path: path.join(SHOTS, "builder-390.png"), fullPage: true });
  await phone.context.close();

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
