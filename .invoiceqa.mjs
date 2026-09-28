/**
 * The Invoice Builder and its saved invoices (#116, #117, #118).
 *
 * The owner, 28 Sep 2026: *"amar application a notun ekta features anbo. eta
 * sidebar a add koro eta hobe invoice builder name"* — and on 29 Sep:
 * *"invoice builder take amra sidebar er Insight section a niye jabo ...
 * All Invoice / Add New ... All invoice a table format a invoice gula save
 * thakbe. okhan theke view kora jabe, edit kora jabe, delete kora jabe ...
 * table a jekono jaygay click korlei popup a invoice ta view kora jabe.
 * invoice builder theke save invoice a click korar por oita ekta modal a
 * success message dekhabe"*, with background and heading colours to choose.
 *
 * In a real browser, against the running app:
 *   A. the rail: Insight → Invoice Builder → All Invoices / Add New, for the
 *      roles that write to the books only; the old address redirects;
 *   B. the builder: the sheet follows the form — number, dates, badge,
 *      background and heading colours (and ink on a light background),
 *      bill lines, poisha-exact items and total, USD, BDT only, each eye, a
 *      large logo scaled down, the draft kept;
 *   C. Save: the success message, the address becomes the invoice's own, a
 *      second save edits rather than copies, Download prints one A4 page,
 *      a bad price is refused in words;
 *   D. All invoices: the row, search, status tab, a click opens the invoice
 *      as it prints, Download from there, Edit opens it saved, the bin sends
 *      it to the trash;
 *   E. Add New after a save starts a fresh invoice on the next number, and a
 *      taken number is refused in words;
 *   F. no empty band beside the sheet at 1440/1680/1920, nothing sideways on
 *      a phone, and no errors anywhere.
 *
 *     node .invoiceqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .invoiceqa.mjs   also saves screenshots and PDFs
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const API = "http://localhost:4001/api";
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
const users = { super_admin: await who("super_admin"), cfo: await who("cfo"), ceo: await who("ceo"), hr: await who("hr") };
const format = (await q(`select number_format::text as f from app_settings limit 1`))[0]?.f ?? "bangladeshi";
const api = async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(users.super_admin)}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json().catch(() => null);
};

const { formatMoney } = await import("./packages/shared/dist/index.js");
const taka = (minor) => formatMoney(`${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`, { format });
const usd = (minor, rate) => formatMoney((Number(minor) / 100 / rate).toFixed(2), { currency: "USD" });

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const TAG = `QAB${Date.now().toString(36).toUpperCase()}`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, url = "/invoices/new", width = 1440) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Encountered two children|409 \(Conflict\)|status of 409/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(1000);
  return { page, context };
};

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
const setDate = (page, selector, value) =>
  page.evaluate(
    (sel, v) => {
      const el = document.querySelector(sel);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );

/** Stubs the print dialog of the next frame, and hands back its HTML. */
const catchPrint = (page) =>
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
const printedAfter = async (page, click) => {
  await catchPrint(page);
  await page.click(click);
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.__invoiceFrame)); i++) await settle(250);
  return page.evaluate(() => window.__invoiceFrame);
};
const pagesOf = async (context, html, file) => {
  const printPage = await context.newPage();
  printPage.on("pageerror", (e) => errors.push(`print frame: ${e}`));
  await printPage.goto(`${WEB}/no-access`, { waitUntil: "networkidle0" });
  await printPage.setContent(html, { waitUntil: "load" });
  await printPage.evaluate(() => document.fonts.ready);
  await printPage.emulateMediaType("print");
  const pdf = await printPage.pdf({ printBackground: true, preferCSSPageSize: true });
  if (SHOTS && file) fs.writeFileSync(path.join(SHOTS, file), pdf);
  await printPage.close();
  return (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
};
const rgb = (hex) => {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
  return `rgb(${r}, ${g}, ${b})`;
};

let savedId = null;
try {
  /* ------------------------------------------------------------------ */
  console.log("\nA. The rail, and who sees it");
  for (const role of ["super_admin", "cfo", "ceo", "hr"]) {
    const user = users[role];
    if (!user) continue;
    const { page, context } = await open(user, "/");
    const rail = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      const all = [...(aside?.querySelectorAll("a, button") ?? [])].map((el) => el.textContent.trim());
      const parent = all.indexOf("Invoice Builder");
      return {
        parent: parent >= 0,
        afterStatement: all.indexOf("Bank statement") >= 0 && parent > all.indexOf("Bank statement"),
        beforeAssistant: parent < all.indexOf("AI Assistant"),
        oldLink: Boolean(aside?.querySelector("a[href='/invoice-builder']")),
      };
    });
    await page.goto(`${WEB}/invoices`, { waitUntil: "networkidle0", timeout: 120000 });
    await settle(500);
    const landed = new URL(page.url()).pathname;
    const writes = role === "super_admin" || role === "cfo";
    check(
      `${role}: ${writes ? "Invoice Builder under Insight, after Bank statement, and the pages open" : "no Invoice Builder, and /invoices is turned away"}`,
      writes
        ? rail.parent && rail.afterStatement && rail.beforeAssistant && !rail.oldLink && landed === "/invoices"
        : !rail.parent && landed === "/no-access",
      `${JSON.stringify(rail)} landed ${landed}`,
    );
    if (role === "super_admin") {
      await page.goto(`${WEB}/invoices/new`, { waitUntil: "networkidle0" });
      await settle(600);
      const kids = await page.evaluate(() =>
        [...document.querySelectorAll("aside a")]
          .filter((a) => ["/invoices", "/invoices/new"].includes(a.getAttribute("href")))
          .map((a) => `${a.getAttribute("href")}=${a.textContent.trim()}${a.getAttribute("aria-current") ? "*" : ""}`),
      );
      check("the parent opens on All Invoices and Add New, Add New lit here", kids.includes("/invoices=All Invoices") && kids.includes("/invoices/new=Add New*"), kids.join(", "));
      await page.goto(`${WEB}/invoice-builder`, { waitUntil: "networkidle0" });
      check("the old address goes to Add New", new URL(page.url()).pathname === "/invoices/new", page.url());
    }
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nB. The builder (super admin, 1440)");
  const expectedNext = (await api("GET", "/invoices/next-number"))?.number;
  const { page, context } = await open(users.super_admin);
  await page.evaluate(() => localStorage.removeItem("sfm.invoice-builder.v1"));
  await page.reload({ waitUntil: "networkidle0" });
  await settle(900);

  const first = await page.evaluate(() => ({
    number: document.querySelector("[data-invoice-field='number']")?.value,
    ref: [...document.querySelectorAll(".inv-bank-grid > div")].find((d) => d.textContent.startsWith("Payment Reference"))?.textContent,
    save: document.querySelector("[data-invoice-save]")?.textContent.trim(),
    download: [...document.querySelectorAll(".sv-page-head button")].some((b) => /Download/.test(b.textContent)),
    total: document.querySelector("[data-invoice-sheet] .inv-total span:last-child")?.textContent,
  }));
  check("a new invoice is offered the next number, and its payment reference", first.number === expectedNext && first.ref?.endsWith(expectedNext ?? "?"), `${first.number} / ${expectedNext}`);
  check("the header's button is Save invoice, not Download", first.save === "Save invoice" && !first.download, first.save);
  check("the default total is ৳18 lakh", first.total === taka(180000000n), first.total);

  await typeInto(page, "[data-invoice-field='number']", `${TAG}-001`);
  await setDate(page, "[data-invoice-field='issuedOn']", "2026-05-19");
  await setDate(page, "[data-invoice-field='dueOn']", "2026-06-19");
  await settle(200);
  const meta = await page.evaluate(() => document.querySelector(".inv-meta").textContent);
  check("the dates read 19 May 2026 and 19 Jun 2026", meta.includes("19 May 2026") && meta.includes("19 Jun 2026"));

  // Colours: background, heading.
  await typeInto(page, "input[aria-label='Background colour as hex']", "#123456");
  await typeInto(page, "input[aria-label='Heading colour as hex']", "#7a1f5c");
  const colours = await page.evaluate(() => {
    const s = document.querySelector("[data-invoice-sheet]");
    const c = (sel, p) => getComputedStyle(s.querySelector(sel))[p];
    const bold = [...s.querySelectorAll(".inv-bill-line")].find((l) => getComputedStyle(l).fontWeight === "700");
    return {
      logo: c(".inv-logo", "backgroundColor"),
      head: c(".inv-table thead tr", "backgroundColor"),
      total: c(".inv-total", "backgroundColor"),
      title: c(".inv-title", "color"),
      billBold: bold ? getComputedStyle(bold).color : null,
      project: c(".inv-order-name", "color"),
      terms: c(".inv-terms strong", "color"),
      headText: c(".inv-table thead th", "color"),
    };
  });
  check("the background colour paints the logo tile, the table head and the total", [colours.logo, colours.head, colours.total].every((c) => c === rgb("#123456")), JSON.stringify([colours.logo, colours.head, colours.total]));
  check("the heading colour paints the title, the company names, the project, Payment Terms", [colours.title, colours.billBold, colours.project, colours.terms].every((c) => c === rgb("#7a1f5c")), JSON.stringify(colours));
  check("white on a dark background", colours.headText === "rgb(255, 255, 255)", colours.headText);
  await typeInto(page, "input[aria-label='Background colour as hex']", "#f2f2f2");
  const light = await page.evaluate(() => ({
    headText: getComputedStyle(document.querySelector(".inv-table thead th")).color,
    figure: getComputedStyle(document.querySelector(".inv-total span:last-child")).color,
  }));
  check("ink on a light one — the head and the total stay readable", light.headText === "rgb(20, 24, 31)" && light.figure === rgb("#7a1f5c"), JSON.stringify(light));
  await typeInto(page, "input[aria-label='Background colour as hex']", "#0a0a0a");

  // Bill lines.
  await typeInto(page, "[data-invoice-line='billTo'] input[aria-label='Line 1']", "Acme Holdings Ltd");
  await page.evaluate(() => [...document.querySelectorAll("[data-invoice-line='billTo']")][1].querySelector("button[aria-label='Bold']").click());
  await typeInto(page, `[data-invoice-line='billTo']:nth-child(2) input[aria-label='Font size in px']`, "16");
  const bill = await page.evaluate(() =>
    [...document.querySelectorAll(".inv-bill > div:first-child .inv-bill-line")].map((l) => ({ text: l.textContent, weight: getComputedStyle(l).fontWeight, size: getComputedStyle(l).fontSize })),
  );
  check("bill lines: text, bold and size reach the sheet", bill[0]?.text === "Acme Holdings Ltd" && bill[1]?.weight === "700" && bill[1]?.size === "16px", JSON.stringify(bill.slice(0, 2)));

  // Items.
  await typeInto(page, "[data-invoice-item] [data-invoice-item-field='qty']", "2.5");
  await typeInto(page, "[data-invoice-item] [data-invoice-item-field='price']", "1,000.10");
  await page.click("[data-invoice-add-item]");
  await settle(200);
  const second = (await page.$$("[data-invoice-item]"))[1];
  await (await second.$("[data-invoice-item-field='description']")).type("Hosting");
  await (await second.$("[data-invoice-item-field='qty']")).click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type("3");
  await (await second.$("[data-invoice-item-field='price']")).type("0.10");
  await typeInto(page, "[data-invoice-field='usdRate']", "120");
  const total = 250025n + 30n;
  const figures = await page.evaluate(() => {
    const s = document.querySelector("[data-invoice-sheet]");
    return {
      rows: [...s.querySelectorAll(".inv-table tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent)),
      total: s.querySelector(".inv-total span:last-child").textContent,
      usd: s.querySelector(".inv-usd span:last-child")?.textContent,
    };
  });
  check("2.5 × ৳1,000.10 = ৳2,500.25 and 3 × ৳0.10 = ৳0.30, total to the poisha", figures.rows[0]?.[5] === taka(250025n) && figures.rows[1]?.[5] === taka(30n) && figures.total === taka(total), `${figures.rows[0]?.[5]} ${figures.rows[1]?.[5]} ${figures.total}`);
  check("with the USD equivalent at the typed rate", figures.usd === `≈ ${usd(total, 120)} USD`, figures.usd);
  await page.select("[data-invoice-field='showUsd']", "no");
  await settle(150);
  const bdtOnly = await page.evaluate(() => ({ heads: document.querySelectorAll(".inv-table thead th").length, usd: Boolean(document.querySelector(".inv-usd")) }));
  check("BDT only drops the dollar columns and line", bdtOnly.heads === 5 && !bdtOnly.usd, JSON.stringify(bdtOnly));
  await page.select("[data-invoice-field='showUsd']", "yes");

  for (const [label, selector] of Object.entries({ "Meta row": ".inv-meta", "Bill section": ".inv-bill", "Pay terms": ".inv-terms", "Bank info": ".inv-bank", Notes: ".inv-notes" })) {
    await page.click(`[data-invoice-eye='${label}']`);
    await settle(120);
    const hidden = !(await page.$(`[data-invoice-sheet] ${selector}`));
    await page.click(`[data-invoice-eye='${label}']`);
    await settle(120);
    check(`the ${label} eye hides and restores its block`, hidden && Boolean(await page.$(`[data-invoice-sheet] ${selector}`)));
  }

  // A large logo, scaled down to what prints.
  const big = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1800;
    c.height = 600;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, 1800, 600);
    g.addColorStop(0, "#bfff00");
    g.addColorStop(1, "#805cf6");
    x.fillStyle = g;
    x.fillRect(0, 0, 1800, 600);
    for (let i = 0; i < 400; i++) {
      x.fillStyle = `hsl(${i * 7},80%,50%)`;
      x.fillRect((i * 97) % 1800, (i * 53) % 600, 40, 40);
    }
    return c.toDataURL("image/png");
  });
  const logoPath = path.join(process.env.TEMP || ".", "invoiceqa-biglogo.png");
  fs.writeFileSync(logoPath, Buffer.from(big.split(",")[1], "base64"));
  await (await page.$("[data-invoice-logo]")).uploadFile(logoPath);
  await settle(1200);
  const logo = await page.evaluate(() => document.querySelector(".inv-logo img")?.getAttribute("src") ?? "");
  check("a 1800×600 logo is scaled to what prints — under 60,000 characters", /^data:image\/(webp|png)/.test(logo) && logo.length <= 60000, `${fs.statSync(logoPath).size} bytes in, ${logo.length} chars out`);

  await settle(700);
  await page.reload({ waitUntil: "networkidle0" });
  await settle(900);
  const kept = await page.evaluate(() => ({
    number: document.querySelector("[data-invoice-field='number']")?.value,
    rows: document.querySelectorAll(".inv-table tbody tr").length,
    heading: document.querySelector("input[aria-label='Heading colour as hex']")?.value,
  }));
  check("a reload keeps the unsaved draft — number, items, colours", kept.number === `${TAG}-001` && kept.rows === 2 && kept.heading === "#7a1f5c", JSON.stringify(kept));

  const wide = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check("nothing scrolls sideways at 1440", wide);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "new-1440.png") });

  /* ------------------------------------------------------------------ */
  console.log("\nC. Save");
  await typeInto(page, "[data-invoice-item] [data-invoice-item-field='price']", "12abc");
  await page.click("[data-invoice-save]");
  await settle(400);
  const bad = await page.evaluate(() => document.querySelector("[data-invoice-save-error]")?.textContent);
  const none = await q(`select count(*)::int as n from invoices where invoice_number ilike $1`, [`${TAG}%`]);
  check("a bad price is refused in words, and nothing is saved", /Item 1: the unit price is not an amount/.test(bad ?? "") && none[0].n === 0, bad);
  await typeInto(page, "[data-invoice-item] [data-invoice-item-field='price']", "1,000.10");

  await page.click("[data-invoice-save]");
  await page.waitForSelector("[data-invoice-saved]", { timeout: 20000 }).catch(() => {});
  await settle(500);
  const saved = await page.evaluate(() => ({
    modal: document.querySelector("[data-invoice-modal='narrow'] h2")?.textContent,
    body: document.querySelector("[data-invoice-saved]")?.textContent,
    id: document.querySelector("[data-invoice-saved]")?.getAttribute("data-invoice-saved"),
    path: location.pathname,
  }));
  savedId = saved.id;
  check("Save shows the success message, naming the invoice", saved.modal === "Invoice saved" && saved.body?.includes(`${TAG}-001`) && /is saved\./.test(saved.body ?? ""), saved.body);
  check("the address becomes the invoice's own", saved.path === `/invoices/${saved.id}/edit`, saved.path);
  const row = (await q(`select invoice_number, status, total_amount::text as total, client_name, document->>'heading' as heading from invoices where id = $1`, [saved.id]))[0];
  check("the database holds it — number, total in paisa, client, colours", row?.invoice_number === `${TAG}-001` && row?.total === "2500.55" && row?.client_name === "Acme Holdings Ltd" && row?.heading === "#7a1f5c", JSON.stringify(row));
  const leftDraft = await page.evaluate(() => localStorage.getItem("sfm.invoice-builder.v1"));
  check("the browser's draft is let go once saved", leftDraft === null);

  const html = await printedAfter(page, "[data-invoice-saved-download]");
  const title = /<title>([^<]*)<\/title>/.exec(html ?? "")?.[1];
  check("Download PDF from the message prints the sheet alone, titled with the number", Boolean(html) && title === `${TAG}-001` && !(html ?? "").slice((html ?? "").indexOf("<body")).includes("<aside"), title);
  if (html) {
    const pages = await pagesOf(context, html, "saved.pdf");
    check("on one A4 page", pages === 1, `${pages} page(s)`);
  }
  await page.click("[data-invoice-saved-close]");
  await settle(300);

  await page.select("[data-invoice-field='status']", "PAID");
  await page.click("[data-invoice-save]");
  await page.waitForSelector("[data-invoice-saved]", { timeout: 20000 }).catch(() => {});
  await settle(400);
  const again = await page.evaluate(() => document.querySelector("[data-invoice-saved]")?.textContent);
  const copies = await q(`select count(*)::int as n, max(status) as status from invoices where invoice_number ilike $1 and deleted_at is null`, [`${TAG}%`]);
  check("a second save edits the same invoice — one row, now PAID", copies[0].n === 1 && copies[0].status === "PAID" && /saved with your changes/.test(again ?? ""), JSON.stringify(copies[0]));
  await page.click("[data-invoice-saved-close]");
  await settle(200);

  /* ------------------------------------------------------------------ */
  console.log("\nD. All invoices");
  await page.goto(`${WEB}/invoices`, { waitUntil: "networkidle0" });
  await settle(800);
  const listed = await page.evaluate((id) => {
    const tr = document.querySelector(`tr[data-row-id='${id}']`);
    return tr ? [...tr.children].map((td) => td.textContent.trim()) : null;
  }, savedId);
  check(
    "the list shows it — number, client, project, dates, status, amount with its dollars",
    Boolean(listed) && listed[1] === `${TAG}-001` && listed[2] === "Acme Holdings Ltd" && listed[3] === "Pre-Acquisition (Legacy)" && listed[4] === "19/05/2026" && listed[6] === "Paid" && listed[7].startsWith(taka(total)) && listed[7].includes(usd(total, 120)),
    JSON.stringify(listed),
  );
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "list-1440.png") });

  await typeInto(page, "input[placeholder^='Number']", TAG);
  await settle(900);
  const searched = await page.$$eval("tr[data-row-id]", (trs) => trs.length);
  check("search finds it by number", searched === 1, String(searched));
  await page.evaluate(() => [...document.querySelectorAll("[role='tab']")].find((b) => b.textContent.trim() === "Sent")?.click());
  await settle(900);
  const sentOnly = await page.$$eval("tr[data-row-id]", (trs) => trs.length);
  check("the Sent tab leaves a paid one out", sentOnly === 0, String(sentOnly));
  await page.evaluate(() => [...document.querySelectorAll("[role='tab']")].find((b) => b.textContent.trim() === "All")?.click());
  await settle(900);

  await page.click(`tr[data-row-id='${savedId}'] td:nth-child(3)`);
  await page.waitForSelector("[data-invoice-modal='wide'] [data-invoice-sheet]", { timeout: 20000 }).catch(() => {});
  const viewed = await page.evaluate(() => {
    const modal = document.querySelector("[data-invoice-modal='wide']");
    return {
      title: modal?.querySelector("h2")?.textContent,
      sheet: modal?.querySelector("[data-invoice-sheet] .inv-head-meta")?.textContent,
      badge: modal?.querySelector("[data-invoice-sheet] .inv-badge")?.textContent,
    };
  });
  check("a click on the row opens the invoice as it prints", viewed.title === `Invoice ${TAG}-001` && (viewed.sheet ?? "").includes(`${TAG}-001`) && viewed.badge === "PAID", JSON.stringify(viewed));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "view-1440.png") });
  const viewHtml = await printedAfter(page, "[data-invoice-view-download]");
  check("Download PDF from the popup prints it", Boolean(viewHtml) && new RegExp(`<title>${TAG}-001</title>`).test(viewHtml ?? ""));
  await page.click("[data-invoice-view-edit]");
  await page.waitForFunction(() => location.pathname.endsWith("/edit"), { timeout: 20000 }).catch(() => {});
  await settle(1500);
  const reopened = await page.evaluate(() => ({
    path: location.pathname,
    number: document.querySelector("[data-invoice-field='number']")?.value,
    status: document.querySelector("[data-invoice-field='status']")?.value,
    heading: document.querySelector("input[aria-label='Heading colour as hex']")?.value,
    title: document.querySelector(".sv-page-head h1")?.textContent,
    reset: Boolean(document.querySelector("[data-invoice-reset]")),
  }));
  check("Edit opens it saved — number, status, colours; titled with its number; no Reset", reopened.path === `/invoices/${savedId}/edit` && reopened.number === `${TAG}-001` && reopened.status === "PAID" && reopened.heading === "#7a1f5c" && reopened.title === `Invoice ${TAG}-001` && !reopened.reset, JSON.stringify(reopened));

  /* ------------------------------------------------------------------ */
  console.log("\nE. Add New after a save, and a taken number");
  await page.goto(`${WEB}/invoices/new`, { waitUntil: "networkidle0" });
  await settle(900);
  const fresh = await page.evaluate(() => ({
    number: document.querySelector("[data-invoice-field='number']")?.value,
    rows: document.querySelectorAll(".inv-table tbody tr").length,
    title: document.querySelector(".sv-page-head h1")?.textContent,
  }));
  check("Add New starts a fresh invoice on the next number", fresh.number === `${TAG}-002` && fresh.rows === 1 && fresh.title === "Invoice Builder", JSON.stringify(fresh));
  await typeInto(page, "[data-invoice-field='number']", `${TAG.toLowerCase()}-001`);
  await page.click("[data-invoice-save]");
  await settle(1500);
  const taken = await page.evaluate(() => document.querySelector("[data-invoice-save-error]")?.textContent);
  check("a number another invoice has is refused in words, any case", /already the number of another invoice/.test(taken ?? ""), taken);
  await page.evaluate(() => localStorage.removeItem("sfm.invoice-builder.v1"));

  /* ------------------------------------------------------------------ */
  console.log("\nD. …and the bin");
  await page.goto(`${WEB}/invoices`, { waitUntil: "networkidle0" });
  await settle(800);
  await page.click(`tr[data-row-id='${savedId}'] button[aria-label='Move to trash']`);
  await settle(400);
  await page.click("[role='dialog'] input[type='checkbox']");
  await page.type("[role='dialog'] input.font-mono", "trash");
  await page.evaluate(() => [...document.querySelectorAll("[role='dialog'] button")].find((b) => /Yes, trash this invoice/.test(b.textContent))?.click());
  // The list reloads once the trash has answered — wait for that, not a clock.
  await page.waitForFunction((id) => !document.querySelector(`tr[data-row-id='${id}']`), { timeout: 20000 }, savedId).catch(() => {});
  const afterBin = await page.$(`tr[data-row-id='${savedId}']`);
  const binned = (await q(`select deleted_at is not null as gone from invoices where id = $1`, [savedId]))[0];
  check("Move to trash takes it off the list, into the trash", !afterBin && binned?.gone === true);
  await context.close();

  /* ------------------------------------------------------------------ */
  console.log("\nF. No empty band beside the sheet, and a phone");
  for (const [width, rail] of [[1440, false], [1680, false], [1680, true], [1920, false]]) {
    const view = await open(users.super_admin, "/invoices/new", width);
    if (rail) {
      await view.page.evaluate(() => localStorage.setItem("svf-sidebar", "rail"));
      await view.page.reload({ waitUntil: "networkidle0" });
      await settle(900);
    }
    const m = await view.page.evaluate(() => {
      const box = document.querySelector("[data-invoice-preview-box]").getBoundingClientRect();
      const sheet = document.querySelector("[data-invoice-sheet]").getBoundingClientRect();
      const main = document.querySelector("main");
      const pad = parseFloat(getComputedStyle(main).paddingRight);
      const form = document.querySelector("[data-invoice-section='brand']").getBoundingClientRect();
      return {
        left: Math.round(sheet.left - box.left),
        right: Math.round(box.right - sheet.right),
        edge: Math.round(main.getBoundingClientRect().right - pad - box.right),
        form: Math.round(form.width),
      };
    });
    check(`${width}px${rail ? ", rail folded" : ""}: the preview hugs the sheet at the right-hand edge`, m.left <= 32 && m.right <= 44 && Math.abs(m.edge) <= 1 && m.form >= 400, JSON.stringify(m));
    await view.context.close();
  }
  for (const url of ["/invoices/new", "/invoices"]) {
    const phone = await open(users.super_admin, url, 390);
    const fits = await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check(`${url} at 390px: nothing scrolls sideways`, fits);
    if (SHOTS) await phone.page.screenshot({ path: path.join(SHOTS, `phone${url.replace(/\//g, "-")}.png`) });
    await phone.context.close();
  }

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  const ids = (await q(`select id from invoices where invoice_number ilike $1`, [`${TAG}%`])).map((r) => r.id);
  for (const id of ids) {
    await api("POST", `/trash/invoice/${id}`, { reason: "harness" }).catch(() => {});
    await api("DELETE", `/trash/invoice/${id}`).catch(() => {});
  }
  await q(`delete from audit_logs where entity_table = 'invoices' and entity_id::text = any($1)`, [ids]).catch(() => {});
  await db.end();
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
