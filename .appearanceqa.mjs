/**
 * #124 — Settings → Appearance: the app's colours and type, for everybody.
 *
 *   A. the list is the stylesheet: every token's default is globals.css's own
 *      value, light and dark;
 *   B. the API: the Super Admin saves and resets; a palette nobody could
 *      read, or a value that is not a colour, is refused with a sentence;
 *      the CFO cannot write; every role reads it with the rest of /settings;
 *   C. the pages: nothing written at the design; a saved palette reaches
 *      every signed-in page in light and in dark, and not the sign-in page;
 *      type reaches headings, text and buttons; the body size zooms the page
 *      without anything scrolling sideways;
 *   D. every face on offer has tabular figures — a money column lines up;
 *   E. the panel: a live preview, the guard refusing before Save, Undo, Save
 *      and Reset read back from the database; not on the CFO's rail.
 *
 *     node .appearanceqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .appearanceqa.mjs   also saves screenshots
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

import {
  DEFAULT_THEME,
  DEFAULT_TYPOGRAPHY,
  FONT_CHOICES,
  THEME_TOKENS,
} from "./packages/shared/dist/index.js";

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
const users = { super_admin: await who("super_admin"), cfo: await who("cfo"), hr: await who("hr") };
const caller = (user) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const admin = caller(users.super_admin);

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
};
const copy = (v) => JSON.parse(JSON.stringify(v));
/* jsonb keeps its own key order, so compare as values, not as text. */
const same = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => same(a[k], b[k]));
};
const stored = async () => (await q(`select theme, typography from app_settings where id = 1`))[0];

const before = await stored();
const NAVY = copy(DEFAULT_THEME);
for (const mode of ["light", "dark"]) {
  NAVY[mode].accent = "#1e3a8a";
  NAVY[mode]["accent-hover"] = "#1e40af";
  NAVY[mode]["on-accent"] = "#ffffff";
}
NAVY.light.bg = "#eef2f9";
NAVY.dark.bg = "#070b14";
const TYPE = copy(DEFAULT_TYPOGRAPHY);
TYPE.body = { font: "inter", weight: 400, size: 16 };
TYPE.heading = { font: "manrope", weight: 700, size: 28 };
TYPE.button = { font: "inter", weight: 600, size: 14 };

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, url, { width = 1440, dark = false } = {}) => {
  const context = await browser.createBrowserContext();
  if (user) await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  if (dark) await page.evaluateOnNewDocument(() => localStorage.setItem("svf-theme-brand", "dark"));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Encountered two children/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  return { page, context };
};
const prop = (page, name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

try {
  /* ------------------------------------------------------------------ */
  console.log("\nA. The list is the stylesheet");
  const css = fs.readFileSync("apps/web/src/app/globals.css", "utf8");
  const blockOf = (selector) => {
    const at = css.indexOf(selector);
    return css.slice(at, css.indexOf("}", at));
  };
  const light = blockOf(":root,\n.sv-light {");
  const dark = blockOf(':root[data-theme="dark"] {');
  const valueIn = (block, token) => block.match(new RegExp(`--sv-${token}:\\s*(#[0-9a-f]{6});`))?.[1];
  const off = THEME_TOKENS.flatMap((t) => [
    valueIn(light, t) === DEFAULT_THEME.light[t] ? null : `light ${t}: css ${valueIn(light, t)} list ${DEFAULT_THEME.light[t]}`,
    valueIn(dark, t) === DEFAULT_THEME.dark[t] ? null : `dark ${t}: css ${valueIn(dark, t)} list ${DEFAULT_THEME.dark[t]}`,
  ]).filter(Boolean);
  check(`all ${THEME_TOKENS.length} tokens' defaults are globals.css's, light and dark`, off.length === 0, off.slice(0, 3).join("; "));
  const cssColours = [...light.matchAll(/--sv-([a-z-]+):\s*#/g)].map((m) => m[1]);
  const notEditable = cssColours.filter((t) => !THEME_TOKENS.includes(t));
  console.log(`   (in the stylesheet, not editable on purpose: ${notEditable.join(", ")})`);

  /* ------------------------------------------------------------------ */
  console.log("\nB. The API");
  await admin("DELETE", "/settings/theme");
  await admin("DELETE", "/settings/typography");
  const unread = copy(DEFAULT_THEME);
  unread.light.ink = "#ffffff";
  const refused = await admin("PUT", "/settings/theme", unread);
  check("white text is refused, in a sentence naming the pair and the ratio", refused.status === 400 && /^Light: Text \(#ffffff\) on Page/.test(refused.body?.message ?? ""), `${refused.status} ${refused.body?.message}`);
  const sneaky = copy(DEFAULT_THEME);
  sneaky.dark.bg = "#000000;}body{display:none";
  const notColour = await admin("PUT", "/settings/theme", sneaky);
  check("a value that is not #rrggbb never reaches the database", notColour.status === 400 && (await stored()).theme === null, `${notColour.status}`);
  const cfoTry = await caller(users.cfo)("PUT", "/settings/theme", NAVY);
  check("the CFO cannot change it (settings.write is the Super Admin's)", cfoTry.status === 403, `${cfoTry.status}`);
  const saved = await admin("PUT", "/settings/theme", NAVY);
  const row = await stored();
  check("the Super Admin saves a navy brand; stored as sent", saved.status === 200 && same(row.theme, NAVY) && saved.body?.theme?.light?.accent === "#1e3a8a", `${saved.status}`);
  const heavy = copy(TYPE);
  heavy.heading = { font: "ibm-plex-sans", weight: 800, size: 28 };
  const badType = await admin("PUT", "/settings/typography", heavy);
  check("a weight the face does not have is refused, by name", badType.status === 400 && /IBM Plex Sans comes in 100 to 700/.test(JSON.stringify(badType.body)), JSON.stringify(badType.body).slice(0, 160));
  const typeSaved = await admin("PUT", "/settings/typography", TYPE);
  check("type saved; stored as sent", typeSaved.status === 200 && same((await stored()).typography, TYPE), `${typeSaved.status}`);
  const hrRead = await caller(users.hr)("GET", "/settings");
  check("every role reads it with /settings (HR here), parsed", hrRead.status === 200 && hrRead.body?.theme?.light?.accent === "#1e3a8a" && hrRead.body?.typography?.body?.font === "inter", `${hrRead.status}`);
  const audit = (await q(`select summary from audit_logs where entity_table = 'app_settings' order by occurred_at desc limit 2`)).map((r) => r.summary);
  check("each change is in What changed", audit.includes("Changed the app's colours") && audit.includes("Changed the app's typefaces and type sizes"), audit.join(" | "));

  /* ------------------------------------------------------------------ */
  console.log("\nC. The pages");
  {
    const { page, context } = await open(users.super_admin, "/transactions");
    const styled = await page.evaluate(() => document.getElementById("sv-appearance")?.textContent.length ?? 0);
    const accent = await prop(page, "--sv-accent");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check("a signed-in page carries the style, and the accent is navy", styled > 0 && accent === "#1e3a8a", `${accent}`);
    check("the page ground is the chosen one", bg === "rgb(238, 242, 249)", bg);
    const typeSeen = await page.evaluate(() => ({
      body: getComputedStyle(document.body).fontFamily,
      zoom: getComputedStyle(document.documentElement).zoom,
      h1: (() => { const h = document.querySelector("h1"); return h ? { family: getComputedStyle(h).fontFamily, weight: getComputedStyle(h).fontWeight } : null; })(),
      num: (() => { const n = document.querySelector(".num"); return n ? getComputedStyle(n).fontFamily : null; })(),
      scroll: document.documentElement.scrollWidth <= window.innerWidth,
    }));
    check("text in Inter, figures too; the page zoomed 16/14.5", /^"Inter Variable"/.test(typeSeen.body) && (!typeSeen.num || /Inter Variable/.test(typeSeen.num)) && Math.abs(Number(typeSeen.zoom) - 1.103) < 0.001, JSON.stringify({ body: typeSeen.body.slice(0, 30), zoom: typeSeen.zoom }));
    check("the page title in Manrope at 700", /Manrope Variable/.test(typeSeen.h1?.family ?? "") && typeSeen.h1?.weight === "700", JSON.stringify(typeSeen.h1));
    check("nothing scrolls sideways at 1440, zoomed", typeSeen.scroll);
    await context.close();
  }
  {
    /* /transactions draws no <Button>; the settings page's proof sheet does. */
    const { page, context } = await open(users.super_admin, "/settings?tab=company");
    const button = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".sv-button")].find((el) => getComputedStyle(el).backgroundColor === "rgb(30, 58, 138)");
      return b ? { color: getComputedStyle(b).color, family: getComputedStyle(b).fontFamily, weight: getComputedStyle(b).fontWeight, zoom: getComputedStyle(b).zoom } : null;
    });
    check("a primary button is navy with white words, in Inter at 600, its size held at 14px", button?.color === "rgb(255, 255, 255)" && /Inter Variable/.test(button.family) && button.weight === "600" && Math.abs(Number(button.zoom) - 0.906) < 0.001, JSON.stringify(button));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "appearance-navy.png") });
    await context.close();
  }
  {
    const { page, context } = await open(users.super_admin, "/transactions", { dark: true });
    const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
    const bg = await prop(page, "--sv-bg");
    check("in dark, the dark half applies", themeAttr === "dark" && bg === "#070b14", `${themeAttr} ${bg}`);
    await context.close();
  }
  {
    const { page, context } = await open(users.super_admin, "/transactions", { width: 390 });
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check("nothing scrolls sideways at 390, zoomed", fits);
    await context.close();
  }
  {
    const { page, context } = await open(null, "/login");
    const accent = await page.evaluate(() => getComputedStyle(document.querySelector(".sv-login") ?? document.documentElement).getPropertyValue("--sv-accent").trim());
    const styled = await page.evaluate(() => Boolean(document.getElementById("sv-appearance")));
    const zoom = await page.evaluate(() => getComputedStyle(document.documentElement).zoom);
    check("the sign-in page keeps the design", !styled && accent === "#bfff00" && zoom === "1", `${styled} ${accent} ${zoom}`);
    await context.close();
  }
  await admin("DELETE", "/settings/theme");
  await admin("DELETE", "/settings/typography");
  {
    const { page, context } = await open(users.super_admin, "/transactions");
    const styled = await page.evaluate(() => Boolean(document.getElementById("sv-appearance")));
    const accent = await prop(page, "--sv-accent");
    check("reset: NULL in the database, and nothing written on the page", (await stored()).theme === null && !styled && accent === "#bfff00", `${styled} ${accent}`);
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nD. Tabular figures in every face");
  {
    const { page, context } = await open(users.super_admin, "/settings?tab=appearance");
    const widths = await page.evaluate(async (fonts) => {
      const out = [];
      for (const font of fonts) {
        await document.fonts.load(`16px "${font.family}"`, "0123456789");
        const span = document.createElement("span");
        span.style.cssText = `font-family:"${font.family}";font-size:40px;font-variant-numeric:tabular-nums;position:absolute;white-space:nowrap`;
        document.body.append(span);
        span.textContent = "111111";
        const ones = span.getBoundingClientRect().width;
        span.textContent = "000000";
        const zeros = span.getBoundingClientRect().width;
        span.textContent = "111111";
        span.style.fontVariantNumeric = "normal";
        const loaded = document.fonts.check(`16px "${font.family}"`);
        span.remove();
        out.push({ key: font.key, ones, zeros, loaded });
      }
      return out;
    }, FONT_CHOICES.map((f) => ({ key: f.key, family: f.family })));
    for (const w of widths) check(`${w.key}: loaded, and 111111 is as wide as 000000`, w.loaded && Math.abs(w.ones - w.zeros) < 0.5, `${w.ones.toFixed(1)} / ${w.zeros.toFixed(1)}`);
    await context.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\nE. The panel");
  {
    const { page, context } = await open(users.super_admin, "/settings?tab=appearance");
    await page.waitForSelector("[data-appearance-hex='accent']", { timeout: 20000 });
    const onRail = await page.evaluate(() => [...document.querySelectorAll("a")].some((a) => a.textContent.includes("Appearance") && a.href.includes("tab=appearance")));
    check("Appearance is on the Super Admin's settings rail", onRail);
    const typeHex = async (token, value) => {
      const box = await page.$(`[data-appearance-hex='${token}']`);
      await box.click();
      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await box.type(value);
    };
    await typeHex("accent", "#1e3a8a");
    await typeHex("on-accent", "#ffffff");
    const previewed = await until(async () => (await prop(page, "--sv-accent")) === "#1e3a8a");
    check("typing a colour previews it on the whole app before Save", Boolean(previewed) && (await stored()).theme === null);
    await typeHex("ink", "#ffffff");
    const blocked = await until(() => page.evaluate(() => Boolean(document.querySelector("[data-appearance-problem]")) && document.querySelector("[data-appearance-save='colours']").disabled));
    const problemText = await page.evaluate(() => document.querySelector("[data-appearance-problem]")?.textContent ?? "");
    check("white text: the guard names it and Save is held", Boolean(blocked) && /Text \(#ffffff\)/.test(problemText), problemText.slice(0, 90));
    const inkShown = await prop(page, "--sv-ink");
    check("…and the preview keeps the last readable colours, so the panel stays readable", inkShown === DEFAULT_THEME.light.ink && (await prop(page, "--sv-accent")) === "#1e3a8a", inkShown);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "appearance-guard.png"), fullPage: false });
    await typeHex("ink", "#060800");
    await page.click("[data-appearance-save='colours']");
    const savedTheme = await until(async () => (await stored()).theme?.light?.accent === "#1e3a8a" ? (await stored()).theme : null);
    check("Save stores it (read back), light and dark both", savedTheme?.light?.accent === "#1e3a8a" && savedTheme?.dark?.accent === "#bfff00" && savedTheme?.light?.ink === "#060800", JSON.stringify(savedTheme?.dark?.accent));
    // Dark tab.
    await page.evaluate(() => [...document.querySelectorAll("[role='tab']")].find((t) => t.textContent.trim() === "Dark").click());
    await until(async () => (await prop(page, "--sv-bg")) === DEFAULT_THEME.dark.bg);
    const darkShown = await page.evaluate(() => document.querySelector("[data-appearance-hex='bg']").value);
    check("the Dark tab shows the dark half, and previews it", darkShown === DEFAULT_THEME.dark.bg, darkShown);
    // Type.
    await page.select("[data-appearance-font='body']", "public-sans");
    const typePreview = await until(() => page.evaluate(() => /Public Sans Variable/.test(getComputedStyle(document.body).fontFamily)));
    check("choosing a face previews it", Boolean(typePreview));
    await page.select("[data-appearance-font='heading']", "ibm-plex-sans");
    const clamped = await page.evaluate(() => document.querySelector("[data-appearance-weight='heading']").value);
    check("a face without the weight takes its heaviest (800 → 700 for IBM Plex Sans)", clamped === "700", clamped);
    await page.click("[data-appearance-save='type']");
    const savedType = await until(async () => (await stored()).typography?.body?.font === "public-sans" ? (await stored()).typography : null);
    check("Save stores the type (read back)", savedType?.heading?.font === "ibm-plex-sans" && savedType?.heading?.weight === 700, JSON.stringify(savedType?.heading));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "appearance-panel.png"), fullPage: true });
    // Reset both.
    for (const what of ["colour", "typeface and size"]) {
      await page.click(`[data-appearance-reset='${what}']`);
      await page.waitForSelector(`[data-appearance-reset-confirm='${what}']`, { timeout: 5000 });
      await page.click(`[data-appearance-reset-confirm='${what}']`);
    }
    const nulls = await until(async () => { const s = await stored(); return s.theme === null && s.typography === null; });
    check("Reset to the design, asked once, puts NULL back for both", Boolean(nulls));
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check("the panel does not scroll sideways at 1440", fits);
    await context.close();
  }
  {
    const { page, context } = await open(users.cfo, "/settings?tab=appearance");
    const seen = await page.evaluate(() => ({ rail: [...document.querySelectorAll("a")].some((a) => a.href.includes("tab=appearance")), panel: Boolean(document.querySelector("[data-appearance-hex]")) }));
    check("the CFO has no Appearance on the rail and no panel", !seen.rail && !seen.panel, JSON.stringify(seen));
    await context.close();
  }

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await q(`update app_settings set theme = $1, typography = $2 where id = 1`, [before.theme === null ? null : JSON.stringify(before.theme), before.typography === null ? null : JSON.stringify(before.typography)]);
  const after = await stored();
  check("left as it was found", same(after, before));
  await db.end();
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
