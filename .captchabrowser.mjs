/**
 * The sign-in's Turnstile box in a real browser, with Cloudflare's test keys.
 * Run from the repository root, after `npm run build:api`. Starts its own
 * API (:4016, from apps/api/dist) and web (:3011, next dev) per scenario,
 * and creates and deletes one account on the database apps/api/.env names.
 * Needs Chrome and the internet: Cloudflare's test keys answer for real.
 *
 * Site keys:   1x00000000000000000000AA passes   3x00000000000000000000FF asks for a click
 *              2x00000000000000000000AB blocks
 * Secret:      1x0000000000000000000000000000000AA passes
 */
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API_PORT = 4016;
const WEB_PORT = 3011;
const WEB = `http://localhost:${WEB_PORT}`;
const SHOTS = ".shots";
fs.mkdirSync(SHOTS, { recursive: true });

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
const email = "captchabrowser@demo.sharevirals.test";
const password = "captcha-qa-" + crypto.randomBytes(8).toString("hex");
await db.query("delete from users where email = $1", [email]);
await db.query(
  `insert into users (email, full_name, password_hash, role, status)
   values ($1, 'Captcha browser QA', $2, 'cfo', 'active')`,
  [email, await bcrypt.hash(password, 4)],
);

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}
const kill = (child) => {
  try {
    execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
  } catch {}
};
async function waitFor(url, tries = 240) {
  for (let i = 0; i < tries; i++) {
    const ok = await fetch(url).then((r) => r.status < 500, () => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

let api = null;
async function startApi(secret) {
  if (api) kill(api);
  await new Promise((r) => setTimeout(r, 1000));
  api = spawn(process.execPath, ["dist/main.js"], {
    cwd: "apps/api",
    env: {
      ...process.env,
      PORT: String(API_PORT),
      CORS_ORIGINS: WEB,
      ...(secret ? { TURNSTILE_SECRET_KEY: secret } : {}),
    },
    stdio: "ignore",
  });
  await waitFor(`http://localhost:${API_PORT}/api/health`);
}
await startApi("1x0000000000000000000000000000000AA");

let web = null;
async function startWeb(siteKey) {
  if (web) kill(web);
  await new Promise((r) => setTimeout(r, 1500));
  web = spawn(process.execPath, ["../../node_modules/next/dist/bin/next", "dev", "-p", String(WEB_PORT)], {
    cwd: "apps/web",
    env: {
      ...process.env,
      API_URL: `http://localhost:${API_PORT}/api`,
      NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}/api`,
      TURNSTILE_SITE_KEY: siteKey,
    },
    stdio: "ignore",
  });
  await waitFor(`${WEB}/login`);
}

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});

const BOX = '[role="status"]:has(> div > div)';
const boxText = (page) =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="status"]')].find((e) =>
      e.textContent.includes("Cloudflare Turnstile"),
    );
    return el ? el.textContent : null;
  });

async function freshPage(width = 1440, height = 900) {
  // Its own cookie jar: a page signed in by an earlier scenario would be sent past /login.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height });
  const posts = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/auth/login") && req.method() === "POST") {
      posts.push(JSON.parse(req.postData() || "{}"));
    }
  });
  return { page, posts };
}

try {
  /* ------------------------------------------------------------------ */
  console.log("\n1. Passing site key, interaction-only");
  await startWeb("1x00000000000000000000AA");
  {
    const { page, posts } = await freshPage();
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    const seen = new Set();
    for (let i = 0; i < 120; i++) {
      const t = await boxText(page);
      if (t) seen.add(t.includes("Success") ? "verified" : t.includes("Verifying") ? "verifying" : "other");
      if (t?.includes("Success")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    check("the box appears, and says verified only after Cloudflare answers", seen.has("verified"), [...seen].join(" → "));

    const m = await page.evaluate(() => {
      const box = [...document.querySelectorAll('[role="status"]')].find((e) =>
        e.textContent.includes("Cloudflare Turnstile"),
      );
      const r = (el) => el.getBoundingClientRect();
      const s = getComputedStyle(box);
      const circle = box.firstElementChild;
      const cs = getComputedStyle(circle);
      const title = box.children[1].firstElementChild;
      const frame = box.parentElement.querySelector("iframe");
      const pw = document.querySelector("#login-password").closest(".sv-field");
      const button = document.querySelector('button[type="submit"]');
      return {
        h: r(box).height,
        w: r(box).width,
        colW: r(box.closest("form")).width,
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        fieldBorder: `${getComputedStyle(pw).borderTopWidth} ${getComputedStyle(pw).borderTopStyle} ${getComputedStyle(pw).borderTopColor}`,
        radius: s.borderRadius,
        bg: s.backgroundColor,
        padX: `${s.paddingLeft} ${s.paddingRight}`,
        gap: s.columnGap,
        circle: `${r(circle).width}x${r(circle).height} ${cs.backgroundColor} ${parseFloat(cs.borderRadius) >= r(circle).width / 2 ? "round" : cs.borderRadius}`,
        titleFont: `${getComputedStyle(title).fontSize} ${getComputedStyle(title).fontWeight}`,
        frameH: frame ? r(frame).height : null,
        order: r(pw).bottom <= r(box).top && r(box).bottom <= r(button).top,
        wrapperH: r(box.parentElement).height,
      };
    });
    check("52px tall at 900px high (clamp 42–52, 6vh)", Math.abs(m.h - 52) < 0.6, `${m.h}`);
    check("the form's full width", Math.abs(m.w - m.colW) < 1, `${m.w} of ${m.colW}`);
    check("the same border as the fields (1.5px #E7EBE0 in CSS)", m.border === m.fieldBorder && m.border.endsWith("solid rgb(231, 235, 224)"), `${m.border} vs field ${m.fieldBorder}`);
    check("11px corners, white", m.radius === "11px" && m.bg === "rgb(255, 255, 255)", `${m.radius} ${m.bg}`);
    check("12px side padding, 11px gap", m.padX === "12px 12px" && m.gap === "11px", `${m.padX} / ${m.gap}`);
    check("26px violet tick circle", m.circle === "26x26 rgb(133, 88, 236) round", m.circle);
    check("13.5px / 800 line", m.titleFont === "13.5px 800", m.titleFont);
    check("between the password and Sign in", m.order);
    check("Cloudflare's own frame takes no room", m.wrapperH - m.h < 1, `wrapper ${m.wrapperH}, frame ${m.frameH}`);
    await page.screenshot({ path: `${SHOTS}/captcha-verified.png` });

    // A wrong password, then the right one, without reloading.
    await page.type('input[name="email"]', email);
    await page.type('input[name="password"]', "wrong-password");
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.body.innerText.includes("Email or password is incorrect"), { timeout: 15000 });
    const after = new Set();
    for (let i = 0; i < 120; i++) {
      const t = await boxText(page);
      if (t) after.add(t.includes("Success") ? "verified" : t.includes("Verifying") ? "verifying" : "other");
      if (t?.includes("Success") && after.has("verifying")) break;
      if (t?.includes("Success") && i > 20) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    check("refused: the box is reset and verifies again", after.has("verified"), [...after].join(" → "));
    await page.focus('input[name="password"]');
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname === "/", { timeout: 30000 }).catch(() => {});
    const alert2 = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? null);
    console.log("     after the second try: alert", alert2, "| passwords sent:", posts.map((p) => (p.password === password ? "right" : p.password === "wrong-password" ? "wrong" : "OTHER(" + p.password.length + ")")).join(", "));
    check("the right password then signs in, no reload", new URL(page.url()).pathname === "/", page.url());
    check("both tries carried a token", posts.length === 2 && posts.every((p) => typeof p.captchaToken === "string" && p.captchaToken.length > 0), JSON.stringify(posts.map((p) => Boolean(p.captchaToken))));
    await page.close();
  }

  {
    console.log("\n2. Cloudflare's script blocked");
    const { page, posts } = await freshPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => (req.url().includes("challenges.cloudflare.com") ? req.abort() : req.continue()));
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Couldn't verify"), { timeout: 20000 }).catch(() => {});
    check("the box says it could not verify", (await boxText(page))?.includes("Couldn't verify"), await boxText(page));
    await page.type('input[name="email"]', email);
    await page.type('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 2500));
    const said = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent);
    check(
      "secret on: goes without a token, refused with the sentence",
      said === "Email or password is incorrect" && posts.length === 1 && !posts[0].captchaToken,
      `${said} / ${posts.length} posts, token ${posts[0]?.captchaToken ?? "none"}`,
    );
    await page.close();
  }

  {
    console.log("\n2b. Cloudflare down and the secret taken off (the way out)");
    await startApi(null);
    const { page } = await freshPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => (req.url().includes("challenges.cloudflare.com") ? req.abort() : req.continue()));
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Couldn't verify"), { timeout: 20000 }).catch(() => {});
    await page.type('input[name="email"]', email);
    await page.type('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => location.pathname === "/", { timeout: 30000 }).catch(() => {});
    check("signs in, with only the secret taken off", new URL(page.url()).pathname === "/", page.url());
    await page.close();
    await startApi("1x0000000000000000000000000000000AA");
  }

  {
    console.log("\n2c. Sign in pressed before Cloudflare answers");
    const { page, posts } = await freshPage();
    await page.setRequestInterception(true);
    // Cloudflare's script held back for 8 s: the box is still verifying.
    page.on("request", (req) => {
      if (req.url().includes("challenges.cloudflare.com/turnstile/v0/api.js")) {
        setTimeout(() => req.continue(), 8000);
      } else req.continue();
    });
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('input[name="email"]');
    await page.type('input[name="email"]', email);
    await page.type('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await new Promise((r) => setTimeout(r, 600));
    const said = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent);
    check("says to wait, and sends nothing", said === "Wait for verification to finish." && posts.length === 0, `${said} / ${posts.length} posts`);
    await page.waitForFunction(() => document.body.innerText.includes("Success"), { timeout: 30000 }).catch(() => {});
    const cleared = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? null);
    check("the wait message goes once Cloudflare answers", cleared === null, String(cleared));
    await page.close();
  }

  {
    console.log("\n3. Phone width (375)");
    const { page } = await freshPage(375, 740);
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.body.innerText.includes("Success"), { timeout: 30000 }).catch(() => {});
    const m = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      h: [...document.querySelectorAll('[role="status"]')].find((e) => e.textContent.includes("Turnstile"))?.getBoundingClientRect().height,
    }));
    check("no sideways scroll, box 42–52px", m.scroll <= 0 && m.h >= 42 && m.h <= 52, JSON.stringify(m));
    await page.screenshot({ path: `${SHOTS}/captcha-phone.png` });
    await page.close();
  }

  /* ------------------------------------------------------------------ */
  console.log("\n4. A site key that asks for a click");
  await startWeb("3x00000000000000000000FF");
  {
    const { page } = await freshPage();
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 6000));
    const m = await page.evaluate(() => {
      // The Turnstile wrapper sits just before Sign in; its last child is Cloudflare's container.
      const frame = document.querySelector('button[type="submit"]').previousElementSibling?.lastElementChild;
      const box = [...document.querySelectorAll('[role="status"]')].find((e) => e.textContent.includes("Turnstile"));
      const fr = frame?.getBoundingClientRect();
      return { frame: fr ? `${Math.round(fr.width)}x${Math.round(fr.height)}` : null, box: Boolean(box) };
    });
    check("Cloudflare's frame shows, and the box stands aside", m.frame && !m.frame.endsWith("x0") && !m.box, JSON.stringify(m));
    await page.screenshot({ path: `${SHOTS}/captcha-interactive.png` });
    await page.close();
  }

  console.log("\n5. A site key that always blocks");
  await startWeb("2x00000000000000000000AB");
  {
    const { page } = await freshPage();
    await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 8000));
    const t = await boxText(page);
    check("never says verified", !t?.includes("Success"), t ?? "(box aside: Cloudflare showing its own frame)");
    await page.screenshot({ path: `${SHOTS}/captcha-blocked.png` });
    await page.close();
  }
} finally {
  await browser.close();
  if (web) kill(web);
  kill(api);
  await db.query("delete from users where email = $1", [email]);
  await db.end();
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
