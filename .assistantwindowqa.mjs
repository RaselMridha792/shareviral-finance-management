/**
 * The Assistant's floating window — docs/briefs/2026-10-02-assistant-powerful.md,
 * piece B4 (3 Oct 2026).
 *
 * No model is asked here. A stand-in for Anthropic's API answers each turn,
 * as in .assistantconfirmqa.mjs. What is measured is the window and the
 * launcher, on the real pages:
 *
 *   A. who has it: the Super Admin and the CFO on every page, nobody else;
 *      not on the Assistant's own pages; the room a page leaves at its foot
 *      only where the launcher is drawn;
 *   B. it covers nothing: on every screen and every Settings section, at
 *      1440px and at 390px, scrolled to its end, no link, button or box of
 *      the page lies under the launcher, and nothing scrolls sideways;
 *   C. the window: opens above the launcher, clear of the top bar; a
 *      greeting that fits; a file and a draft; expanded to the page and
 *      back, the same conversation, file, draft and the figure typed over;
 *      kept across a navigation; Confirm and save from the window, its link
 *      closing the window; a reply arriving while it is minimised; Escape;
 *      History and New; under a popup;
 *   D. a phone: the window is the screen, and minimises.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantwindowqa.mjs                (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantwindowqa.mjs  also saves screenshots
 *     SKIP_SWEEP=1 node .assistantwindowqa.mjs    leaves out B (it is slow)
 *     WEB=http://localhost:3100 node .assistantwindowqa.mjs  against a
 *                                                `next start` build instead
 *     WEB=http://localhost:3100 node .assistantwindowqa.mjs   a `next start` build
 *
 * Starts its own API on :4022 pointed at the stand-in, so the dev API on
 * :4001 is left alone. Puts a made-up Anthropic key in the local
 * app_settings while it runs and puts back what was there. Everything it
 * makes is named WINDOWQA and deleted afterwards, and it prints what is left.
 */
import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB || "http://localhost:3000";
const DEV_API = "http://localhost:4001";
const PORT = 4022;
const API = `http://localhost:${PORT}/api`;
const STUB_PORT = 4604;
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

const person = async (role) =>
  (await q(`select id, role, full_name, token_version from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role]))[0];
const admin = await person("super_admin");
const cfo = await person("cfo");
const hr = await person("hr");
if (!admin || !cfo || !hr) throw new Error("The local books need an active super_admin, a cfo and an hr user.");
const tokenFor = (user) => jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });

const results = [];
process.on("unhandledRejection", (error) => console.log(`  (a wait gave up: ${error?.message ?? error})`));
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------------ */
/*  The books this runs against                                              */
/* ------------------------------------------------------------------------ */

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const accounts = await q(
  `select a.id, a.name, a.currency,
          (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null and t.deleted_at is null), 0))::numeric as balance
     from accounts a left join transactions t on t.account_id = a.id
    where a.is_active and a.deleted_at is null group by a.id order by a.name`,
);
const CARD = accounts.filter((a) => a.currency !== "USD").sort((a, b) => Number(b.balance) - Number(a.balance))[0];
if (!CARD || Number(CARD.balance) < 20000) throw new Error("The local books need a taka account holding 20,000.");
const [PLAIN] = await q(
  `select c.id, c.name from categories c join categories p on p.id = c.parent_id
    where c.is_active and c.deleted_at is null and c.kind <> 'in'
      and c.name !~* 'ai\\s*tool|subscription|software|hosting|server|domain'
      and p.name !~* 'ai\\s*tool|subscription|software|hosting|server|domain'
      and not exists (select 1 from categories o where o.id <> c.id and lower(o.name) = lower(c.name))
    order by c.name limit 1`,
);
if (!PLAIN) throw new Error("The local books need a plain money-out sub-category.");
const [member] = await q(`select id from team_members where deleted_at is null order by created_at limit 1`);
const [plan] = await q(`select id from subscriptions where deleted_at is null order by created_at limit 1`);
const [run] = await q(`select id from payroll_runs order by created_at limit 1`).catch(() => []);
const [invoice] = await q(`select id from invoices where deleted_at is null order by created_at limit 1`).catch(() => []);
const [advice] = await q(`select id from bank_advices order by created_at limit 1`).catch(() => []);

/* ------------------------------------------------------------------------ */
/*  A stand-in for the model: it says what it is told to, when it is told    */
/* ------------------------------------------------------------------------ */

let answer = null;
let delay = 0;
const asked = [];
const stub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    asked.push(JSON.parse(raw || "{}"));
    const input = answer ?? { draft: {}, missingFields: [], summary: "(the harness gave no answer)" };
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json", "request-id": "req_windowqa" });
      res.end(
        JSON.stringify({
          id: "msg_windowqa",
          type: "message",
          role: "assistant",
          model: "claude-opus-5",
          content: [{ type: "tool_use", id: `toolu_${asked.length}`, name: "answer", input }],
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    }, delay);
  });
});
await new Promise((resolve) => stub.listen(STUB_PORT, "127.0.0.1", resolve));

const DRAFT = {
  area: "expenses",
  target: "transaction_out",
  draft: { amount: "1234.50", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: "WINDOWQA courier" },
  missingFields: [],
  summary: "WINDOWQA here is the draft.",
};

/* ------------------------------------------------------------------------ */

const seal = (plaintext) => {
  const source = env.SECRET_ENCRYPTION_KEY?.trim() || env.JWT_REFRESH_SECRET?.trim();
  const key = createHash("sha256").update(source, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
};
const [before] = await q(
  `select ai_provider, ai_model, ai_data_access, anthropic_api_key, anthropic_key_set_at, anthropic_key_set_by from app_settings where id = 1`,
);

if (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)) {
  throw new Error(`Something already answers on :${PORT}. Stop it and run this again.`);
}
const api = spawn(process.execPath, ["--enable-source-maps", "dist/main"], {
  cwd: "apps/api",
  env: { ...process.env, PORT: String(PORT), ANTHROPIC_BASE_URL: `http://127.0.0.1:${STUB_PORT}`, ANTHROPIC_API_KEY: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
let apiLog = "";
api.stdout.on("data", (chunk) => (apiLog += chunk));
api.stderr.on("data", (chunk) => (apiLog += chunk));

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "windowqa-"));
const CSV = path.join(scratch, "WINDOWQA payments.csv");
fs.writeFileSync(CSV, "Date,Paid to,Amount\n03/09/2026,WINDOWQA Hostinger,4500\n09/09/2026,WINDOWQA Courier,640\n");

const sweepRows = async () => {
  await db.query(`delete from transactions where description like 'WINDOWQA%'`);
  await db.query(`delete from ai_corrections where said like '%WINDOWQA%' or corrected like '%WINDOWQA%' or drafted like '%WINDOWQA%'`);
  await db.query(`delete from ai_chats where title like 'WINDOWQA%'`);
  await db.query(`delete from ai_attachments where filename like 'WINDOWQA%'`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let browser;
try {
  for (let i = 0; i < 90; i += 1) {
    const up = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
    if (up) break;
    if (api.exitCode !== null || i === 89) throw new Error(`The API did not start on :${PORT}.\n${apiLog.slice(-2000)}`);
    await sleep(1000);
  }
  await sweepRows();
  await q(
    `update app_settings set ai_provider = 'anthropic', ai_model = 'claude-opus-5', ai_data_access = 'full',
            anthropic_api_key = $1, anthropic_key_set_at = now(), anthropic_key_set_by = $2 where id = 1`,
    [seal("sk-ant-windowqa-00000000000000000000"), admin.id],
  );

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const openAs = async (user, width = 1440, height = 900) => {
    const context = await browser.createBrowserContext();
    await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
    const page = await context.newPage();
    await page.setViewport({ width, height });
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", (intercepted) => {
      const url = intercepted.url();
      const base = [`${WEB}/api/`, `${DEV_API}/api/`].find((prefix) => url.startsWith(prefix));
      if (base) intercepted.continue({ url: url.replace(base, `${API}/`) });
      else intercepted.continue();
    });
    return page;
  };
  const go = (page, route) => page.goto(`${WEB}${route}`, { waitUntil: "networkidle0", timeout: 180000 });
  const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const LAUNCHER = 'button[aria-label^="Open the Assistant"], button[aria-label="Minimise the Assistant"][aria-expanded]';
  const WINDOW = '[role="dialog"][aria-label="Assistant"]';
  const rectOf = (page, selector) =>
    page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || !r.width) return null;
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
    }, selector);
  const footRoom = (page) => page.evaluate(() => getComputedStyle(document.querySelector("main")).paddingBottom);
  const windowText = (page) => page.evaluate((s) => document.querySelector(s)?.innerText ?? "", WINDOW);
  const BOX = 'textarea[placeholder^="Type it"]';
  const typeIn = async (page, value) => {
    await page.click(BOX);
    await page.evaluate((selector, value) => {
      const input = document.querySelector(selector);
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, BOX, value);
  };
  /** The draft card's description box: its value, and how many columns its grid draws. */
  const draftOf = (page, scope = "body") =>
    page.evaluate((scope) => {
      const root = document.querySelector(scope);
      const box = root?.querySelector('input[name="description"]');
      const grid = box?.closest("form")?.querySelector(".grid");
      return box ? { value: box.value, columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length } : null;
    }, scope);
  const clickText = (page, scope, text) =>
    page.evaluate(
      (scope, text) => {
        const el = [...document.querySelectorAll(`${scope} button, ${scope} a`)].find((b) => b.textContent.trim().startsWith(text));
        el?.click();
        return Boolean(el);
      },
      scope,
      text,
    );

  /* ------------------------------------------------------------------ */
  console.log("\nA. Who has it");
  const page = await openAs(admin);
  await go(page, "/transactions");
  const launcher = await rectOf(page, LAUNCHER);
  check(
    "the Super Admin: a 52px launcher at the foot of the screen, 20px from the corner",
    launcher && launcher.width === 52 && launcher.height === 52 && launcher.right === 1420 && launcher.bottom === 880,
    JSON.stringify(launcher),
  );
  check("the page leaves 92px at its foot for it", (await footRoom(page)) === "92px", await footRoom(page));
  const cfoPage = await openAs(cfo);
  await go(cfoPage, "/transactions");
  check("the CFO: the launcher too", Boolean(await rectOf(cfoPage, LAUNCHER)));
  const hrPage = await openAs(hr);
  await go(hrPage, "/hr-requests");
  check("HR: no launcher, and the page's foot as it was (24px)", !(await rectOf(hrPage, LAUNCHER)) && (await footRoom(hrPage)) === "24px", await footRoom(hrPage));
  await hrPage.browserContext().close();
  await go(page, "/assistant");
  check("not on the Assistant page, where the conversation is the page", !(await rectOf(page, LAUNCHER)));
  await go(page, "/assistant/knowledge");
  check("nor on What the Assistant knows", !(await rectOf(page, LAUNCHER)));

  /* ------------------------------------------------------------------ */
  if (!process.env.SKIP_SWEEP) {
    console.log("\nB. It covers nothing — every screen, scrolled to its end");
    const routes = [
      "/", "/accounts", "/accounts/cash-in", "/transfers", "/expenses/overview", "/expenses", "/expenses/other",
      "/subscriptions", "/transactions", "/team", "/payroll", "/payroll/bank-advice", "/hr-requests", "/hr-budget",
      "/tax/withholding", "/reports", "/statement", "/invoices", "/invoices/new", "/invoice-builder", "/data", "/import",
      `/accounts/${CARD.id}`, `/accounts/${CARD.id}/register`,
      ...(member ? [`/team/${member.id}`] : []),
      ...(plan ? [`/subscriptions/${plan.id}`] : []),
      ...(run ? [`/payroll/${run.id}`] : []),
      ...(invoice ? [`/invoices/${invoice.id}/edit`] : []),
      ...(advice ? [`/payroll/bank-advice/${advice.id}`] : []),
      "/settings",
      ...["company", "appearance", "categories", "tax", "security", "users", "audit", "trashed", "assistant", "connections", "email", "notifications"].map((tab) => `/settings?tab=${tab}`),
    ];
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const sweeper = await openAs(admin, width, height);
      const bad = [];
      for (const route of routes) {
        try {
          await go(sweeper, route);
        } catch (error) {
          bad.push(`${route}: did not load (${error.message})`);
          continue;
        }
        // A screen that sends itself on (a tab chosen for it, a redirect)
        // destroys what was being measured; it is measured again where it
        // landed.
        let found = null;
        for (let attempt = 0; attempt < 4 && !found; attempt += 1) {
          try {
            await sleep(400);
            await sweeper.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
            await sleep(300);
            found = await sweeper.evaluate((LAUNCHER) => {
              const button = document.querySelector(LAUNCHER);
              if (!button) return { missing: true };
              const l = button.getBoundingClientRect();
              const under = [...document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], summary')]
                .filter((el) => el !== button && !button.contains(el))
                .filter((el) => {
                  const r = el.getBoundingClientRect();
                  const style = getComputedStyle(el);
                  if (!r.width || !r.height || style.visibility === "hidden" || style.display === "none") return false;
                  return r.left < l.right && r.right > l.left && r.top < l.bottom && r.bottom > l.top;
                })
                .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().slice(0, 30)}"`);
              return { under, sideways: document.scrollingElement.scrollWidth - window.innerWidth };
            }, LAUNCHER);
          } catch (error) {
            if (!/context was destroyed|detached/i.test(error.message)) throw error;
            await sweeper.waitForNetworkIdle({ idleTime: 500, timeout: 60000 }).catch(() => undefined);
          }
        }
        if (!found) {
          bad.push(`${route}: could not be measured`);
          continue;
        }
        if (found.missing) bad.push(`${route}: no launcher`);
        else if (found.under.length) bad.push(`${route}: under it — ${found.under.join(", ")}`);
        if (found.sideways > 0) bad.push(`${route}: scrolls sideways by ${found.sideways}px`);
        if (sweeper.errors.length) bad.push(`${route}: ${sweeper.errors.splice(0).join(" | ").slice(0, 160)}`);
      }
      check(`at ${width}px, on ${routes.length} screens: nothing of the page under the launcher at the end, nothing sideways, no page error`, bad.length === 0, bad.join("; ").slice(0, 1500));
      await sweeper.browserContext().close();
    }
  }

  /* ------------------------------------------------------------------ */
  console.log("\nC. The window");
  await go(page, "/transactions");
  await page.click(LAUNCHER);
  await page.waitForSelector(WINDOW, { timeout: 20000 });
  await page.waitForSelector(`${WINDOW} ${BOX}`, { timeout: 20000 });
  // Its rise is 0.55s; measured before the end, it is still on its way up.
  await sleep(800);
  const win = await rectOf(page, WINDOW);
  const bar = await rectOf(page, "header");
  check(
    "it opens 400px wide above the launcher, its foot 88px up, clear of the top bar",
    win && win.width === 400 && win.right === 1420 && win.bottom === 812 && bar && win.top >= bar.bottom + 8,
    JSON.stringify({ win, bar: bar?.bottom }),
  );
  const greeting = await windowText(page);
  check(
    "a greeting that fits: the examples, without the page's three cards",
    /Good (morning|afternoon|evening)|Still up/.test(greeting) && /try one/i.test(greeting) && !greeting.includes("Write it down"),
    greeting.slice(0, 120).replace(/\n/g, " | "),
  );
  check("the message box has the focus", await page.evaluate((s) => document.activeElement?.matches(s), BOX));
  /* The owner, 3 Oct: a violet rectangle round the textarea inside the box
     read as a stray border. The box's own edge shows the focus instead,
     by mouse and by keyboard alike. */
  const ring = async () =>
    page.evaluate((s) => {
      const box = document.querySelector(`${s} textarea`);
      const edge = box.closest(".sv-composer");
      return {
        textarea: getComputedStyle(box).outlineStyle,
        edge: edge ? getComputedStyle(edge).borderTopColor : null,
        violet: getComputedStyle(document.documentElement).getPropertyValue("--sv-violet").trim(),
      };
    }, WINDOW);
  await page.click(`${WINDOW} ${BOX}`);
  const byMouse = await ring();
  await page.evaluate(() => document.activeElement?.blur());
  await page.focus(`${WINDOW} ${BOX}`);
  await page.keyboard.press("Shift");
  const byKeys = await ring();
  check(
    "focused, the textarea draws no ring of its own and the box's edge turns violet",
    byMouse.textarea === "none" && byKeys.textarea === "none" && byMouse.edge !== null && byMouse.edge === byKeys.edge && byMouse.edge !== "rgb(0, 0, 0)",
    JSON.stringify({ byMouse, byKeys }),
  );
  const fits = await page.evaluate((s) => {
    const form = document.querySelector(`${s} form`);
    const row = form?.querySelector("textarea")?.parentElement?.lastElementChild;
    return { tall: row?.getBoundingClientRect().height, wide: form?.scrollWidth - form?.clientWidth };
  }, WINDOW);
  check("the message box's controls on one line, nothing sideways", fits.tall <= 44 && fits.wide <= 0, JSON.stringify(fits));
  await shot(page, "window-open");

  const fileInput = await page.$(`${WINDOW} input[type="file"]`);
  const attached = page.waitForResponse((r) => r.url().endsWith("/ai/attachments") && r.request().method() === "POST", { timeout: 60000 });
  await fileInput.uploadFile(CSV);
  await attached;
  await page.waitForFunction((s) => document.querySelector(s)?.innerText.includes("WINDOWQA payments.csv"), { timeout: 20000 }, WINDOW);
  check("a file attached in the window shows its card there", (await windowText(page)).includes("WINDOWQA payments.csv"));

  answer = DRAFT;
  await typeIn(page, "WINDOWQA courier 1234.50 diyechi");
  await page.keyboard.press("Enter");
  await page.waitForSelector(`${WINDOW} input[name="description"]`, { timeout: 60000 });
  let draft = await draftOf(page, WINDOW);
  check("the draft card in the window, one column in its 400px", draft?.value === "WINDOWQA courier" && draft.columns === 1, JSON.stringify(draft));
  await page.click(`${WINDOW} input[name="description"]`);
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.type("WINDOWQA courier, corrected");
  await shot(page, "window-draft");

  await page.click(`${WINDOW} button[aria-label="Expand to the Assistant page"]`);
  await page.waitForFunction(() => location.pathname === "/assistant", { timeout: 60000 });
  await page.waitForSelector('input[name="description"]', { timeout: 60000 });
  let shown = await page.evaluate(() => document.body.innerText);
  draft = await draftOf(page);
  check(
    "Expand: the Assistant page, on the same conversation — the message, the file, the draft with the figure typed over",
    shown.includes("WINDOWQA courier 1234.50 diyechi") && shown.includes("WINDOWQA payments.csv") && draft?.value === "WINDOWQA courier, corrected",
    JSON.stringify(draft),
  );
  check("on the page the draft has its two columns again", draft?.columns === 2, String(draft?.columns));
  check("and no launcher or window on it", !(await rectOf(page, LAUNCHER)) && !(await rectOf(page, WINDOW)));
  await shot(page, "expanded");

  await page.click('aside button[aria-label="Open as a window"]');
  await page.waitForFunction(() => location.pathname === "/transactions", { timeout: 60000 });
  await page.waitForSelector(`${WINDOW} input[name="description"]`, { timeout: 60000 });
  draft = await draftOf(page, WINDOW);
  shown = await windowText(page);
  check(
    "Open as a window: back on All transactions, the window open on the same conversation, the figure still typed over",
    shown.includes("WINDOWQA courier 1234.50 diyechi") && shown.includes("WINDOWQA payments.csv") && draft?.value === "WINDOWQA courier, corrected",
    JSON.stringify(draft),
  );

  await page.click('nav[aria-label="Main"] a[href="/team"]');
  await page.waitForFunction(() => location.pathname === "/team", { timeout: 60000 });
  await sleep(500);
  draft = await draftOf(page, WINDOW);
  check("a page changed with the window open: still open, the same draft", draft?.value === "WINDOWQA courier, corrected", JSON.stringify(draft));

  const saved = page.waitForResponse((r) => r.url().endsWith("/ai/confirm") && r.request().method() === "POST", { timeout: 60000 });
  await clickText(page, WINDOW, "Confirm and save");
  const savedRes = await saved;
  await page.waitForFunction((s) => /Open /.test(document.querySelector(s)?.innerText ?? ""), { timeout: 30000 }, WINDOW).catch(() => undefined);
  const [row] = await q(`select description, created_via as origin, amount::text from transactions where description like 'WINDOWQA%' order by created_at desc limit 1`);
  check(
    "Confirm and save in the window: saved as typed over, its origin the Assistant",
    savedRes.status() === 200 && row?.description === "WINDOWQA courier, corrected" && row?.origin === "ai_intake",
    JSON.stringify({ status: savedRes.status(), row }),
  );
  shown = await windowText(page);
  const link = await page.evaluate((s) => [...document.querySelectorAll(`${s} a`)].find((a) => a.textContent.startsWith("Open "))?.getAttribute("href"), WINDOW);
  check("the window says what was saved and links where it shows", Boolean(link), `${link} · ${shown.split("\n").slice(-6).join(" | ")}`);
  await shot(page, "window-saved");
  await clickText(page, WINDOW, "Open ");
  await page.waitForFunction((href) => location.pathname === href.split("?")[0], { timeout: 60000 }, link ?? "/");
  await sleep(300);
  check("following that link closes the window; the launcher waits", !(await rectOf(page, WINDOW)) && Boolean(await rectOf(page, LAUNCHER)), page.url());

  // A reply still on its way when the window is minimised.
  delay = 2500;
  answer = { target: null, draft: {}, missingFields: [], summary: "WINDOWQA the answer came while you were away." };
  await page.click(LAUNCHER);
  await page.waitForSelector(`${WINDOW} ${BOX}`, { timeout: 20000 });
  await typeIn(page, "WINDOWQA ki obostha?");
  await page.keyboard.press("Enter");
  await sleep(300);
  await page.click(`${WINDOW} button[aria-label="Minimise the Assistant"]`);
  await sleep(200);
  const spinning = await page.evaluate((s) => Boolean(document.querySelector(s)?.querySelector(".animate-spin")), LAUNCHER);
  check("minimised while it thinks: the launcher turns", spinning);
  await page.waitForSelector('button[aria-label="Open the Assistant — a new answer is waiting"]', { timeout: 20000 }).catch(() => undefined);
  check("the answer arrives: the launcher is marked", Boolean(await page.$('button[aria-label="Open the Assistant — a new answer is waiting"]')));
  delay = 0;
  await page.click(LAUNCHER);
  await page.waitForSelector(WINDOW, { timeout: 20000 });
  check(
    "opened, the answer is there and the mark gone",
    (await windowText(page)).includes("WINDOWQA the answer came while you were away.") && !(await page.$('button[aria-label="Open the Assistant — a new answer is waiting"]')),
  );

  await page.focus(BOX);
  await page.keyboard.press("Escape");
  await sleep(200);
  check(
    "Escape minimises it, and the focus goes back to the launcher",
    !(await rectOf(page, WINDOW)) && (await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).startsWith("Open the Assistant"),
  );

  await page.click(LAUNCHER);
  await page.waitForSelector(`${WINDOW} button[aria-label="History"]`, { timeout: 20000 });
  await page.click(`${WINDOW} button[aria-label="History"]`);
  await page.waitForFunction((s) => (document.querySelector(s)?.innerText ?? "").includes("New chat"), { timeout: 20000 }, WINDOW);
  const rail = await page.evaluate((s) => document.querySelector(`${s} .absolute.inset-0`)?.innerText ?? "", WINDOW);
  check(
    "History lists the conversations inside the window, over the chat",
    rail.includes("WINDOWQA courier 1234.50") && rail.includes("What the Assistant knows"),
    rail.slice(0, 160).replace(/\n/g, " | "),
  );
  await shot(page, "window-history");
  await clickText(page, WINDOW, "New chat");
  await sleep(300);
  check("New chat: the greeting again", /try one/i.test(await windowText(page)));

  // A popup the page opens sits over the launcher and the window.
  await page.click(`${WINDOW} button[aria-label="Minimise the Assistant"]`);
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  await page.click('button[aria-label="Open navigation"]');
  await sleep(400);
  const coveredBy = await page.evaluate((LAUNCHER) => {
    const r = document.querySelector(LAUNCHER).getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top?.closest(LAUNCHER) ? "the launcher" : top?.tagName.toLowerCase();
  }, LAUNCHER);
  check("a popup from the page (the navigation drawer) covers the launcher", coveredBy !== "the launcher", coveredBy);
  await page.keyboard.press("Escape");
  await page.click('button[aria-label="Close navigation"]').catch(() => undefined);

  /* ------------------------------------------------------------------ */
  console.log("\nD. A phone");
  const phone = await openAs(admin, 390, 844);
  await go(phone, "/transactions");
  const small = await rectOf(phone, LAUNCHER);
  check("the launcher 16px from the corner", small && small.right === 374 && small.bottom === 828, JSON.stringify(small));
  await phone.click(LAUNCHER);
  await phone.waitForSelector(`${WINDOW} ${BOX}`, { timeout: 20000 });
  await sleep(800);
  const full = await rectOf(phone, WINDOW);
  // What spills past the window's right edge, rather than scrolling inside
  // its own box as a table does.
  const spills = await phone.evaluate((s) => {
    const edge = document.querySelector(s).getBoundingClientRect().right;
    return [...document.querySelectorAll(`${s} *`)]
      .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > edge + 0.5)
      .filter((el) => !el.closest(".overflow-x-auto"))
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`)
      .slice(0, 4);
  }, WINDOW);
  check(
    "opened, the window is the whole screen and the launcher steps aside",
    full && full.left === 0 && full.top === 0 && full.width === 390 && full.height === 844 && !(await rectOf(phone, LAUNCHER)),
    JSON.stringify(full),
  );
  check(
    "nothing in it runs past the screen's edge",
    spills.length === 0 && (await phone.evaluate((s) => document.querySelector(s).scrollWidth, WINDOW)) <= 390,
    spills.join(", "),
  );
  await shot(phone, "phone-window");
  await phone.click(`${WINDOW} button[aria-label="Minimise the Assistant"]`);
  await sleep(200);
  check("Minimise: back to the page, the launcher there", !(await rectOf(phone, WINDOW)) && Boolean(await rectOf(phone, LAUNCHER)));

  check("no page error", [page, cfoPage, phone].every((p) => p.errors.length === 0), [...page.errors, ...cfoPage.errors, ...phone.errors].slice(0, 3).join(" | "));
} catch (error) {
  results.push(false);
  console.log(`  FAIL  the run stopped: ${error?.stack ?? error}`);
} finally {
  await browser?.close().catch(() => undefined);
  await sweepRows().catch((error) => console.log(`  (could not sweep: ${error.message})`));
  await db.query(
    `update app_settings set ai_provider = $1, ai_model = $2, ai_data_access = $3, anthropic_api_key = $4, anthropic_key_set_at = $5, anthropic_key_set_by = $6 where id = 1`,
    [before.ai_provider, before.ai_model, before.ai_data_access, before.anthropic_api_key, before.anthropic_key_set_at, before.anthropic_key_set_by],
  );
  const stopped = new Promise((resolve) => api.once("exit", resolve));
  api.kill();
  await stopped;
  stub.close();
  fs.rmSync(scratch, { recursive: true, force: true });
  const [left] = await q(
    `select (select count(*) from transactions where description like 'WINDOWQA%')::int as entries,
            (select count(*) from ai_chats where title like 'WINDOWQA%')::int as chats,
            (select count(*) from ai_attachments where filename like 'WINDOWQA%')::int as attachments,
            (select count(*) from ai_corrections where said like '%WINDOWQA%' or corrected like '%WINDOWQA%')::int as lessons,
            (select anthropic_api_key is not distinct from $1 from app_settings where id = 1) as key_back`,
    [before.anthropic_api_key],
  );
  console.log(`\n  left behind: ${JSON.stringify(left)}`);
  await db.end();
}

const failed = results.filter((pass) => !pass).length;
if (failed) {
  const said = apiLog
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""))
    .filter((line) => /ERROR|WARN|Error|error/.test(line));
  console.log(`\n--- the API's log, its last lines ---\n${said.slice(-14).join("\n")}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
