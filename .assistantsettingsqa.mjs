/**
 * The Assistant's own settings, and the model each conversation keeps —
 * docs/briefs/2026-10-02-assistant-powerful.md, piece B2's code (3 Oct 2026).
 *
 * No model is asked here. A stand-in for Anthropic's API answers each turn,
 * as in .assistantwindowqa.mjs, and no Gemini is ever asked: a Google key is
 * stored so that Gemini is offered, but every turn sent goes to Claude. That
 * Gemini goes through Google Cloud is held by ai-model-route.spec.ts.
 *
 *   A. the API: the models with a working route; a turn put to the model
 *      picked, and the conversation keeping it; one nobody switched keeping
 *      none; a picked model that cannot be reached refused in words, with
 *      nothing asked and nothing kept; a Gemini default beside a Claude
 *      that goes by the Anthropic key;
 *   B. the chat: the picker lists the four, holds for the conversation,
 *      comes back with it from History, and a new chat starts on the
 *      default; the gear opens the settings;
 *   C. the settings page, as the Super Admin: the default and Claude's
 *      route change, the Anthropic key box only while Claude goes that way,
 *      the Google Cloud card, the instructions and the mistakes; with no
 *      Google key, Gemini cannot be the default;
 *   D. as the CFO: picks a model in the chat; reads the settings and
 *      changes nothing — no control, no key, no hint, no Google address; the
 *      rules and the mistakes on What the Assistant knows, without buttons;
 *   E. the old addresses: /settings?tab=assistant and ?tab=connections open
 *      the page; Settings lists neither any more;
 *   F. HR is kept out; G. a phone; H. the window's gear.
 *
 *     npm run build --workspace @finance/api   (this runs the BUILT api)
 *     node .assistantsettingsqa.mjs            (needs the web on :3000, and
 *                                               the dev API on :4001 on the
 *                                               same build: pages ask it)
 *
 * Starts its own API on :4023 pointed at the stand-in. Stores a made-up
 * Anthropic key and a made-up Google key in the local app_settings while it
 * runs and puts back what was there. Everything it makes is named B2QA and
 * deleted afterwards, and it prints what is left.
 */
import { spawn } from "node:child_process";
import { createCipheriv, createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = process.env.WEB || "http://localhost:3000";
const DEV_API = "http://localhost:4001";
const PORT = 4023;
const API = `http://localhost:${PORT}/api`;
const STUB_PORT = 4605;

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (probe, ms = 20000) => {
  const end = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value || Date.now() > end) return value;
    await sleep(250);
  }
};

const ALL = ["claude-opus-5", "gemini-3.8-flash", "gemini-3.1-pro-preview", "gemini-2.5-pro"];

/* ------------------------------------------------------------------------ */
/*  A stand-in for Anthropic: it says what it is told to                     */
/* ------------------------------------------------------------------------ */

const asked = [];
const stub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    asked.push(body);
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_b2qa" });
    res.end(
      JSON.stringify({
        id: "msg_b2qa",
        type: "message",
        role: "assistant",
        model: body.model ?? "claude-opus-5",
        content: [{ type: "tool_use", id: `toolu_${asked.length}`, name: "answer", input: { draft: {}, missingFields: [], summary: `B2QA answer ${asked.length}` } }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
});
await new Promise((resolve) => stub.listen(STUB_PORT, "127.0.0.1", resolve));

/* ------------------------------------------------------------------------ */
/*  Keys: made up, sealed as the API seals them                              */
/* ------------------------------------------------------------------------ */

const seal = (plaintext) => {
  const source = env.SECRET_ENCRYPTION_KEY?.trim() || env.JWT_REFRESH_SECRET?.trim();
  const key = createHash("sha256").update(source, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
};
const ANTHROPIC = seal("sk-ant-b2qa-0000000000000000000000000000B2QA");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const GOOGLE_EMAIL = "b2qa-assistant@b2qa-project.iam.gserviceaccount.com";
const GOOGLE = seal(
  JSON.stringify({
    type: "service_account",
    project_id: "b2qa-project",
    private_key_id: "0000000000000000000000000000000000000000",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: GOOGLE_EMAIL,
    client_id: "000000000000000000000",
    token_uri: `http://127.0.0.1:${STUB_PORT}/token`,
  }),
);

const COLUMNS = `ai_provider, ai_model, ai_data_access, anthropic_api_key, anthropic_key_set_at, anthropic_key_set_by,
                 google_service_account, google_key_set_at, google_key_set_by`;
const [before] = await q(`select ${COLUMNS} from app_settings where id = 1`);
const settingsRow = async () => (await q(`select ai_provider, ai_model from app_settings where id = 1`))[0];
const setRoute = (provider, model) => q(`update app_settings set ai_provider = $1, ai_model = $2 where id = 1`, [provider, model]);
const setGoogle = (on) =>
  q(`update app_settings set google_service_account = $1, google_key_set_at = $2, google_key_set_by = $3 where id = 1`, on ? [GOOGLE, new Date(), admin.id] : [null, null, null]);

const sweep = async () => {
  await db.query(`delete from ai_chats where title like 'B2QA%'`);
  await db.query(`delete from ai_corrections where said like 'B2QA%'`);
};

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

const call = async (user, method, route, body) => {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { cookie: `sfm_access=${tokenFor(user)}`, "content-type": "application/json", "x-requested-with": "finance-web" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, body: json };
};

let browser;
try {
  for (let i = 0; i < 90; i += 1) {
    if (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)) break;
    if (api.exitCode !== null || i === 89) throw new Error(`The API did not start on :${PORT}.\n${apiLog.slice(-2000)}`);
    await sleep(1000);
  }
  if (!(await fetch(`${DEV_API}/api/health`).then((r) => r.ok).catch(() => false))) {
    throw new Error(`The dev API on :4001 does not answer; the pages ask it.`);
  }
  await sweep();
  await q(
    `update app_settings set ai_provider = 'anthropic', ai_model = 'claude-opus-5', ai_data_access = 'full',
            anthropic_api_key = $1, anthropic_key_set_at = now(), anthropic_key_set_by = $2,
            google_service_account = $3, google_key_set_at = now(), google_key_set_by = $2 where id = 1`,
    [ANTHROPIC, admin.id, GOOGLE],
  );

  /* ---------------------------------------------------------------------- */
  console.log("\nA. The API");

  const seenAdmin = await call(admin, "GET", "/ai/availability");
  check("the picker's list: Claude and the three Geminis, both keys stored", seenAdmin.body?.models?.join() === ALL.join(), JSON.stringify(seenAdmin.body?.models));
  const seenCfo = await call(cfo, "GET", "/ai/availability");
  check("the CFO is sent the same list, and no key's hint", seenCfo.body?.models?.join() === ALL.join() && seenCfo.body?.keyHint === null && !JSON.stringify(seenCfo.body).includes("B2QA"), JSON.stringify(seenCfo.body));

  let n = asked.length;
  const nobody = await call(admin, "POST", "/ai/turn", { messages: [{ role: "user", content: "B2QA nobody switched" }] });
  const [nobodyRow] = await q(`select model from ai_chats where id = $1`, [nobody.body?.chatId ?? null]);
  check("a turn naming no model goes to the default and keeps no model on the chat", nobody.status === 200 && asked.length === n + 1 && asked.at(-1)?.model === "claude-opus-5" && nobodyRow && nobodyRow.model === null, `${nobody.status} ${JSON.stringify(nobodyRow)}`);

  // From here the default is a Gemini, and Claude goes by the Anthropic key:
  // a pair the settings refused before B2.
  const pair = await call(admin, "PATCH", "/ai/settings", { model: "gemini-3.8-flash", provider: "anthropic" });
  check("a Gemini default beside Claude on the Anthropic key is taken", pair.status === 200 && pair.body?.model === "gemini-3.8-flash" && pair.body?.provider === "anthropic" && pair.body?.configured === true, `${pair.status} ${pair.body?.message ?? ""}`);

  n = asked.length;
  const picked = await call(cfo, "POST", "/ai/turn", { messages: [{ role: "user", content: "B2QA picked by the CFO" }], model: "claude-opus-5" });
  const [pickedRow] = await q(`select model from ai_chats where id = $1`, [picked.body?.chatId ?? null]);
  check("a turn put to the model picked: Claude asked, through the Anthropic key, while the default is Gemini", picked.status === 200 && asked.length === n + 1 && asked.at(-1)?.model === "claude-opus-5", `${picked.status} ${picked.body?.message ?? ""}`);
  check("…and the conversation keeps it", pickedRow?.model === "claude-opus-5", JSON.stringify(pickedRow));
  const reopened = await call(cfo, "GET", `/ai/chats/${picked.body?.chatId}`);
  check("…and sends it back when it is opened again", reopened.body?.model === "claude-opus-5", JSON.stringify(reopened.body?.model));

  await q(
    `insert into ai_chats (user_id, title, messages, model) values ($1, 'B2QA retired gemini', '[{"role":"user","content":"B2QA retired gemini"}]', 'gemini-1.5-pro')`,
    [admin.id],
  );
  const [retired] = await q(`select id from ai_chats where title = 'B2QA retired gemini'`);
  const retiredSeen = await call(admin, "GET", `/ai/chats/${retired.id}`);
  check("a chat kept on a Gemini since taken off the list reads as the Gemini offered first", retiredSeen.body?.model === "gemini-3.8-flash", JSON.stringify(retiredSeen.body?.model));

  await setRoute("anthropic", "claude-opus-5");
  await setGoogle(false);
  n = asked.length;
  const chatsBefore = (await q(`select count(*)::int as n from ai_chats where title like 'B2QA%'`))[0].n;
  const unreachable = await call(cfo, "POST", "/ai/turn", { messages: [{ role: "user", content: "B2QA unreachable" }], model: "gemini-3.8-flash" });
  const chatsAfter = (await q(`select count(*)::int as n from ai_chats where title like 'B2QA%'`))[0].n;
  check(
    "a picked model with no key: refused in words, nothing asked, nothing kept",
    unreachable.status === 400 &&
      unreachable.body?.message === "Gemini 3.8 Flash goes through Google Cloud, and no Google Cloud key has been added. A Super Admin can add one in the Assistant's settings. Pick another model in the chat." &&
      asked.length === n &&
      chatsAfter === chatsBefore,
    `${unreachable.status} ${unreachable.body?.message}`,
  );
  const noGoogle = await call(admin, "PATCH", "/ai/settings", { model: "gemini-3.8-flash" });
  check("a Gemini default with no Google key is refused", noGoogle.status === 400 && /goes through Google Cloud\. Add the Google Cloud key first/.test(noGoogle.body?.message ?? ""), `${noGoogle.status} ${noGoogle.body?.message}`);
  const listNoGoogle = await call(admin, "GET", "/ai/availability");
  check("with the Anthropic key alone, the picker's list is Claude alone", listNoGoogle.body?.models?.join() === "claude-opus-5", JSON.stringify(listNoGoogle.body?.models));
  await setGoogle(true);
  await setRoute("anthropic", "gemini-3.8-flash");

  /* ---------------------------------------------------------------------- */

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
  const text = (page) => page.evaluate(() => document.body.innerText);
  const picker = (page) =>
    page.evaluate(() => {
      const select = document.querySelector("#assistant-model");
      return select ? { value: select.value, options: [...select.options].map((o) => o.value) } : null;
    });
  const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const BOX = 'textarea[placeholder^="Type it"]';
  const say = async (page, value) => {
    await page.click(BOX);
    await page.evaluate((selector, value) => {
      const input = document.querySelector(selector);
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, BOX, value);
    const before = asked.length;
    await page.keyboard.press("Enter");
    await until(() => asked.length > before);
    await page.waitForFunction((n) => document.body.innerText.includes(`B2QA answer ${n}`), { timeout: 30000 }, before + 1).catch(() => null);
  };
  const clickRail = (page, label) =>
    page.evaluate((label) => {
      const el = [...document.querySelectorAll("aside button")].find((b) => b.textContent.trim() === label);
      el?.click();
      return Boolean(el);
    }, label);

  /* ---------------------------------------------------------------------- */
  console.log("\nB. The chat, as the Super Admin");

  const chat = await openAs(admin);
  await go(chat, "/assistant");
  let seen = await picker(chat);
  check("the picker lists Claude and the three Geminis, on the default (Gemini 3.8 Flash)", seen?.options.join() === ALL.join() && seen?.value === "gemini-3.8-flash", JSON.stringify(seen));
  await chat.select("#assistant-model", "claude-opus-5");
  await say(chat, "B2QA picked opus on the page");
  const [pageRow] = await q(`select id, model from ai_chats where title like 'B2QA picked opus on the page%' and user_id = $1`, [admin.id]);
  check("picked Opus 5 and sent: Claude asked, and the conversation keeps it", asked.at(-1)?.model === "claude-opus-5" && pageRow?.model === "claude-opus-5", JSON.stringify(pageRow));
  await clickRail(chat, "New chat");
  seen = await picker(chat);
  check("a new chat starts on the default again: the pick held for that conversation only", seen?.value === "gemini-3.8-flash", JSON.stringify(seen));
  await clickRail(chat, "B2QA picked opus on the page");
  await until(async () => (await picker(chat))?.value === "claude-opus-5", 8000);
  seen = await picker(chat);
  check("opened again from History, it is on Opus 5", seen?.value === "claude-opus-5", JSON.stringify(seen));
  // A second turn on it: the pick goes with it, and the column stays.
  await say(chat, "B2QA and again");
  const [pageRow2] = await q(`select model from ai_chats where id = $1`, [pageRow?.id ?? null]);
  check("its next turn goes to Opus 5 too, and it still keeps it", asked.at(-1)?.model === "claude-opus-5" && pageRow2?.model === "claude-opus-5", JSON.stringify(pageRow2));
  await clickRail(chat, "B2QA nobody switched");
  await sleep(1500);
  seen = await picker(chat);
  check("a chat nobody switched opens on the default", seen?.value === "gemini-3.8-flash", JSON.stringify(seen));
  const gear = await chat.evaluate(() => {
    const a = document.querySelector('aside a[aria-label="Assistant settings"]');
    return a ? a.getAttribute("href") : null;
  });
  check("the gear in the rail leads to the Assistant's settings", gear === "/assistant/settings", String(gear));
  check("no page error on the chat", chat.errors.length === 0, chat.errors.join(" | "));

  /* ---------------------------------------------------------------------- */
  console.log("\nC. The settings page, as the Super Admin");

  await chat.click('aside a[aria-label="Assistant settings"]');
  await chat.waitForFunction(() => location.pathname === "/assistant/settings", { timeout: 60000 }).catch(() => null);
  await chat.waitForFunction(() => document.querySelectorAll("select").length >= 3, { timeout: 60000 }).catch(() => null);
  // The Google Cloud card asks for its own state once it is drawn.
  await chat.waitForFunction((email) => document.body.innerText.includes(email), { timeout: 15000 }, GOOGLE_EMAIL).catch(() => null);
  let body = await text(chat);
  check("the gear opened it: Assistant settings", new URL(chat.url()).pathname === "/assistant/settings" && /Assistant settings/.test(body), chat.url());
  const selects = async () =>
    chat.evaluate(() =>
      [...document.querySelectorAll("select")].map((s) => ({ value: s.value, disabled: [...s.options].filter((o) => o.disabled).map((o) => o.value) })),
    );
  let state = await selects();
  check("three choices: the default model, Claude's route, how much it may read", state.length === 3 && state[0].value === "gemini-3.8-flash" && state[1].value === "anthropic" && state[2].value === "full", JSON.stringify(state));
  check("the Anthropic key box, while Claude goes by the Anthropic key, with the key's hint", /Anthropic API key/.test(body) && /B2QA/.test(body), "");
  check("the Google Cloud card, with the address to share files with", /Google Cloud/.test(body) && body.includes(GOOGLE_EMAIL));
  check("what the chat's picker offers now, by name", body.includes("Opus 5, Gemini 3.8 Flash, Gemini 3.1 Pro Preview, Gemini 2.5 Pro"));
  check("the instructions, to edit, and the recent mistakes", /Instructions for the Assistant/.test(body) && (await chat.$('textarea[name="instructions"]')) !== null && /Its recent mistakes/.test(body));

  const selectHandles = await chat.$$("select");
  await selectHandles[1].select("vertex");
  await until(async () => (await settingsRow()).ai_provider === "vertex");
  await chat.waitForFunction(() => !document.body.innerText.includes("Anthropic API key"), { timeout: 10000 }).catch(() => null);
  body = await text(chat);
  check("Claude through Google Cloud: saved, and the Anthropic key box goes", (await settingsRow()).ai_provider === "vertex" && !/Anthropic API key/.test(body));
  await (await chat.$$("select"))[1].select("anthropic");
  await until(async () => (await settingsRow()).ai_provider === "anthropic");
  await chat.waitForFunction(() => document.body.innerText.includes("Anthropic API key"), { timeout: 10000 }).catch(() => null);
  check("back on the Anthropic key: saved, and its box is back", (await settingsRow()).ai_provider === "anthropic" && /Anthropic API key/.test(await text(chat)));
  await (await chat.$$("select"))[0].select("claude-opus-5");
  await until(async () => (await settingsRow()).ai_model === "claude-opus-5");
  check("the default changed to Opus 5", (await settingsRow()).ai_model === "claude-opus-5");
  check("nothing on the page scrolls sideways at 1440px", (await sideways(chat)) <= 0, String(await sideways(chat)));
  check("no page error on the settings", chat.errors.length === 0, chat.errors.join(" | "));

  await setGoogle(false);
  await go(chat, "/assistant/settings");
  state = await selects();
  body = await text(chat);
  check(
    "with no Google key: no Gemini can be the default, nor Claude go through Google Cloud",
    ALL.slice(1).every((m) => state[0]?.disabled.includes(m)) && state[1]?.disabled.join() === "vertex",
    JSON.stringify(state),
  );
  check("…and the picker offers Opus 5 alone, Gemini after the key", /Opus 5\. Gemini joins them once the Google Cloud key is added\./.test(body));
  await setGoogle(true);
  await setRoute("anthropic", "gemini-3.8-flash");

  /* ---------------------------------------------------------------------- */
  console.log("\nD. The CFO");

  await q(
    `insert into ai_corrections (kind, target, area, said, field, drafted, corrected, model, user_id)
     values ('reply', null, 'team', 'B2QA how many on the team', null, 'said "no tool"', 'B2QA count them', 'claude-opus-5', $1)`,
    [admin.id],
  );
  const cfoPage = await openAs(cfo);
  await go(cfoPage, "/assistant");
  seen = await picker(cfoPage);
  check("the CFO's picker lists the four too, on the default", seen?.options.join() === ALL.join() && seen?.value === "gemini-3.8-flash", JSON.stringify(seen));
  await cfoPage.select("#assistant-model", "claude-opus-5");
  await say(cfoPage, "B2QA cfo picked in the chat");
  const [cfoRow] = await q(`select model from ai_chats where title like 'B2QA cfo picked%' and user_id = $1`, [cfo.id]);
  const [defaultAfter] = await q(`select ai_model from app_settings where id = 1`);
  check("the CFO switched this conversation, and nobody's default changed", cfoRow?.model === "claude-opus-5" && defaultAfter.ai_model === "gemini-3.8-flash", JSON.stringify({ cfoRow, defaultAfter }));

  await go(cfoPage, "/assistant/settings");
  await cfoPage.waitForFunction(() => document.body.innerText.includes("B2QA how many on the team"), { timeout: 30000 }).catch(() => null);
  body = await text(cfoPage);
  const controls = await cfoPage.evaluate(() => ({
    selects: document.querySelectorAll("select").length,
    textareas: document.querySelectorAll("textarea").length,
    inputs: document.querySelectorAll("main input").length,
    rule: [...document.querySelectorAll("button")].filter((b) => /Make this a rule|^Remove$|Save the instructions|Connect|Switch it on/.test(b.textContent.trim())).length,
  }));
  check("the CFO reads it: told so, the default, Claude's route, how much it may read", /You can read these settings\. Only a Super Admin can change them\./.test(body) && /Gemini 3\.8 Flash/.test(body) && /Anthropic key/.test(body) && /On — it can read the books and answer questions/.test(body));
  check("…and changes nothing: no choice, no box, no button to save or make a rule", controls.selects === 0 && controls.textareas === 0 && controls.inputs === 0 && controls.rule === 0, JSON.stringify(controls));
  check("…and sees no key, no hint and no Google address", !/Anthropic API key|sk-ant|B2QA-0000|0000B2QA|Paste the JSON key/.test(body) && !body.includes(GOOGLE_EMAIL) && !body.includes("b2qa-project"));
  check("…but the instructions and the recent mistakes, as lists", /Instructions for the Assistant/.test(body) && /Its recent mistakes/.test(body) && /B2QA how many on the team/.test(body));
  check("no page error for the CFO", cfoPage.errors.length === 0, cfoPage.errors.join(" | "));

  await go(cfoPage, "/assistant/knowledge");
  await cfoPage.waitForFunction(() => document.body.innerText.includes("B2QA how many on the team"), { timeout: 30000 }).catch(() => null);
  body = await text(cfoPage);
  const knowledgeButtons = await cfoPage.evaluate(() => [...document.querySelectorAll("button, a")].filter((b) => /Make this a rule|Change them/.test(b.textContent.trim())).length);
  check("What the Assistant knows: the CFO reads the owner's rules and the mistakes, without a button", /The owner's rules/.test(body) && /B2QA how many on the team/.test(body) && knowledgeButtons === 0, String(knowledgeButtons));

  /* ---------------------------------------------------------------------- */
  console.log("\nE. The old addresses, and Settings");

  for (const tab of ["assistant", "connections"]) {
    await go(chat, `/settings?tab=${tab}`);
    check(`/settings?tab=${tab} opens the Assistant's settings`, new URL(chat.url()).pathname === "/assistant/settings" && /Assistant settings/.test(await text(chat)), chat.url());
  }
  await go(chat, "/settings?tab=company");
  const rail = await chat.evaluate(() => [...document.querySelectorAll("nav[aria-label=Settings] a")].map((a) => a.getAttribute("href")));
  check("Settings lists neither Assistant nor Connections, and still Email", !rail.some((h) => /tab=(assistant|connections)/.test(h ?? "")) && rail.includes("/settings?tab=email"), rail.join(" "));
  await go(chat, "/settings?tab=constructor");
  check("an odd ?tab= is not mistaken for a moved one", new URL(chat.url()).pathname === "/settings" && chat.errors.length === 0, chat.url());

  /* ---------------------------------------------------------------------- */
  console.log("\nF. HR");

  const hrPage = await openAs(hr);
  await go(hrPage, "/assistant/settings");
  check("HR does not get the page", new URL(hrPage.url()).pathname !== "/assistant/settings", hrPage.url());
  check("…nor the list", (await call(hr, "GET", "/ai/availability")).status === 403);

  /* ---------------------------------------------------------------------- */
  console.log("\nG. A phone");

  const phone = await openAs(admin, 390, 844);
  await go(phone, "/assistant");
  const strip = await phone.evaluate(() => {
    const a = [...document.querySelectorAll('a[aria-label="Assistant settings"]')].find((x) => x.getBoundingClientRect().width > 0);
    return a ? Math.round(a.getBoundingClientRect().right) : null;
  });
  check("the gear in the phone's top strip, on the screen", strip !== null && strip <= 390, String(strip));
  await go(phone, "/assistant/settings");
  check("the settings at 390px: nothing sideways", (await sideways(phone)) <= 0, String(await sideways(phone)));
  check("no page error on the phone", phone.errors.length === 0, phone.errors.join(" | "));

  /* ---------------------------------------------------------------------- */
  console.log("\nH. The window's gear");

  await go(chat, "/transactions");
  await chat.click('button[aria-label^="Open the Assistant"]');
  await chat.waitForSelector('[role="dialog"][aria-label="Assistant"] a[aria-label="Assistant settings"]', { timeout: 30000 }).catch(() => null);
  const inWindow = await chat.$('[role="dialog"][aria-label="Assistant"] a[aria-label="Assistant settings"]');
  check("the window's header has the gear", inWindow !== null);
  if (inWindow) {
    await inWindow.click();
    await chat.waitForFunction(() => location.pathname === "/assistant/settings", { timeout: 60000 }).catch(() => null);
    check("…which opens the settings, the window put away", new URL(chat.url()).pathname === "/assistant/settings" && (await chat.$('[role="dialog"][aria-label="Assistant"]')) === null, chat.url());
  }
} catch (error) {
  check("the run finished", false, error?.stack ?? String(error));
} finally {
  await browser?.close().catch(() => {});
  await sweep().catch(() => {});
  await q(
    `update app_settings set ai_provider = $1, ai_model = $2, ai_data_access = $3, anthropic_api_key = $4, anthropic_key_set_at = $5, anthropic_key_set_by = $6,
            google_service_account = $7, google_key_set_at = $8, google_key_set_by = $9 where id = 1`,
    [before.ai_provider, before.ai_model, before.ai_data_access, before.anthropic_api_key, before.anthropic_key_set_at, before.anthropic_key_set_by, before.google_service_account, before.google_key_set_at, before.google_key_set_by],
  ).catch((error) => console.log(`  could not put app_settings back: ${error.message}`));
  const [after] = await q(`select ${COLUMNS} from app_settings where id = 1`);
  const left = (await q(`select (select count(*) from ai_chats where title like 'B2QA%')::int as chats, (select count(*) from ai_corrections where said like 'B2QA%')::int as mistakes`))[0];
  const restored = Object.keys(before).every((key) => String(before[key]) === String(after[key]));
  console.log(`\n  left behind: ${left.chats} chats, ${left.mistakes} mistakes; app_settings ${restored ? "as it was" : "NOT as it was"}`);
  api.kill();
  stub.close();
  await db.end();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length && restored && !left.chats && !left.mistakes ? 0 : 1);
}
