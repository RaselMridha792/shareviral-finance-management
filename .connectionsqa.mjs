/**
 * #131 — Settings → Connections, and the Assistant through Google Cloud.
 *
 *   A. the API, with no key: who may ask; every malformed paste refused with
 *      a sentence and nothing stored; a well-formed key Google has never
 *      heard of refused by Google, and nothing stored; Google Cloud cannot be
 *      chosen without a key; the Test needs a key; /settings carries no key
 *      to any browser;
 *   B. with a key in the row (sealed here, the way secret-box seals — Google
 *      would never let this one through the front door): the card shows the
 *      address and the project; Google Cloud can be chosen; a turn goes to
 *      Google and comes back as words, not a 500; the Test answers four
 *      lines; Remove puts the assistant back on the Anthropic key; no audit
 *      row carries the key;
 *   C. the pages: the rail, the card, the Test, the Assistant's choice, the
 *      CFO's rail, and a phone's width.
 *
 *     node .connectionsqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .connectionsqa.mjs   also saves screenshots
 *
 * Touches app_settings' Google columns and ai_provider on the local database,
 * and puts them back as they were found.
 */
import { createCipheriv, createHash, generateKeyPairSync, randomBytes } from "node:crypto";
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
const users = { super_admin: await who("super_admin"), cfo: await who("cfo") };
const caller = (user) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const admin = caller(users.super_admin);
const cfo = caller(users.cfo);

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

/** secret-box's seal, byte for byte: v1.<iv>.<tag>.<ciphertext>, base64url. */
const seal = (plaintext) => {
  const source = env.SECRET_ENCRYPTION_KEY?.trim() || env.JWT_REFRESH_SECRET?.trim();
  const key = createHash("sha256").update(source, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
};

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = {
  type: "service_account",
  project_id: "sfm-qa-project",
  private_key_id: "0000000000000000000000000000000000000000",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  client_email: "sfm-qa@sfm-qa-project.iam.gserviceaccount.com",
  client_id: "100000000000000000000",
  token_uri: "https://oauth2.googleapis.com/token",
};
const SECRET_MARK = KEY.private_key.split("\n")[1];

const stored = async () =>
  (await q(`select ai_provider, google_service_account, google_key_set_at, google_key_set_by, vertex_region from app_settings where id = 1`))[0];
const before = await stored();

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, url, { width = 1440 } = {}) => {
  const context = await browser.createBrowserContext();
  if (user) await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Encountered two children/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  return { page, context };
};
const clickText = (page, text) =>
  page.evaluate((t) => {
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
    button?.click();
    return Boolean(button);
  }, text);
const textOf = (page) => page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);

try {
  /* ------------------------------------------------------------------ */
  console.log("\nA. The API, with no key");
  await q(`update app_settings set google_service_account = null, google_key_set_at = null, google_key_set_by = null, ai_provider = 'anthropic' where id = 1`);

  const none = await admin("GET", "/connections/google");
  check("the Super Admin reads the card: not configured, asked in global", none.status === 200 && none.body.configured === false && none.body.region === "global" && none.body.clientEmail === null, JSON.stringify(none.body));
  for (const [method, p] of [["GET", "/connections/google"], ["POST", "/connections/google/key"], ["DELETE", "/connections/google/key"], ["POST", "/connections/google/test"]]) {
    const r = await cfo(method, p, method === "POST" ? { serviceAccount: JSON.stringify(KEY) } : undefined);
    check(`the CFO is refused ${method} ${p}`, r.status === 403, String(r.status));
  }

  const refusals = [
    ["not JSON", "sk-ant-api03-abc", /not the JSON key/],
    ["an OAuth client's file", JSON.stringify({ installed: { client_id: "x" } }), /not a service-account key/],
    ["no private_key", JSON.stringify({ ...KEY, private_key: undefined }), /no private_key/],
    ["a person's address", JSON.stringify({ ...KEY, client_email: "owner@gmail.com" }), /not a service account's address/],
    ["a clipped private key", JSON.stringify({ ...KEY, private_key: KEY.private_key.slice(0, 200) }), /cannot be read/],
  ];
  for (const [what, text, said] of refusals) {
    const r = await admin("POST", "/connections/google/key", { serviceAccount: text });
    check(`${what}: refused with a sentence`, r.status === 200 && r.body.saved === false && said.test(r.body.message ?? ""), r.body?.message);
  }
  const empty = await admin("POST", "/connections/google/key", { serviceAccount: " " });
  check("an empty paste: 400 from the schema", empty.status === 400, String(empty.status));

  const unknown = await admin("POST", "/connections/google/key", { serviceAccount: JSON.stringify(KEY) });
  check(
    "a well-formed key Google never issued: Google asked, and refused (or not reached), in words",
    unknown.status === 200 && unknown.body.saved === false && /Google refused this key|Could not reach Google/.test(unknown.body.message ?? ""),
    unknown.body?.message,
  );
  check("…and nothing was stored", (await stored()).google_service_account === null);

  const vertexNoKey = await admin("PATCH", "/ai/settings", { provider: "vertex" });
  check("Google Cloud cannot be chosen with no key: 400 in words", vertexNoKey.status === 400 && /Connections first/.test(vertexNoKey.body?.message ?? ""), vertexNoKey.body?.message);
  check("…and the row still says anthropic", (await stored()).ai_provider === "anthropic");
  const badProvider = await admin("PATCH", "/ai/settings", { provider: "openai" });
  check("a provider that is not offered: 400", badProvider.status === 400, String(badProvider.status));

  const testNoKey = await admin("POST", "/connections/google/test");
  check("the Test needs a key: 400", testNoKey.status === 400, testNoKey.body?.message);

  const avail = await admin("GET", "/ai/availability");
  check("availability names the way and that no Google key is set", avail.body?.provider === "anthropic" && avail.body?.googleKeySet === false, JSON.stringify({ provider: avail.body?.provider, googleKeySet: avail.body?.googleKeySet }));

  /* ------------------------------------------------------------------ */
  console.log("\nB. With a key in the row");
  await q(`update app_settings set google_service_account = $1, google_key_set_at = now(), google_key_set_by = $2 where id = 1`, [seal(JSON.stringify(KEY)), users.super_admin.id]);

  const card = await admin("GET", "/connections/google");
  check("the card: configured, the address and the project, never the key", card.body?.configured === true && card.body.clientEmail === KEY.client_email && card.body.projectId === KEY.project_id && !JSON.stringify(card.body).includes(SECRET_MARK), JSON.stringify(card.body));

  for (const [label, r] of [["Super Admin", await admin("GET", "/settings")], ["CFO", await cfo("GET", "/settings")]]) {
    const body = JSON.stringify(r.body ?? {});
    check(`GET /settings as the ${label} carries no Google key or its ciphertext`, r.status === 200 && !("googleServiceAccount" in (r.body ?? {})) && !body.includes("v1.") && !body.includes(SECRET_MARK));
  }

  const chosen = await admin("PATCH", "/ai/settings", { provider: "vertex" });
  check("with a key, Google Cloud can be chosen", chosen.status === 200 && chosen.body?.provider === "vertex" && chosen.body?.configured === true, JSON.stringify({ status: chosen.status, provider: chosen.body?.provider, configured: chosen.body?.configured }));
  check("…and the row says vertex", (await stored()).ai_provider === "vertex");

  const turn = await admin("POST", "/ai/turn", { messages: [{ role: "user", content: "hello" }] });
  check(
    "a turn goes to Google and comes back as words, not a 500",
    turn.status === 503 && /Google refused the service-account key|Could not reach Google Cloud/.test(turn.body?.message ?? "") && /ordinary forms all still work/.test(turn.body?.message ?? ""),
    `${turn.status} ${turn.body?.message}`,
  );

  const test = await admin("POST", "/connections/google/test");
  const ids = (test.body?.checks ?? []).map((c) => c.id).join(",");
  check("the Test answers four lines: vertex, sheets, docs, drive", test.status === 200 && ids === "vertex,sheets,docs,drive", `${test.status} ${ids}`);
  check(
    "…each refused in words, none of them a stack trace",
    (test.body?.checks ?? []).every((c) => c.ok === false && /Google/.test(c.message) && !/at .*\.js/.test(c.message)),
    (test.body?.checks ?? []).map((c) => `${c.id}: ${c.message}`).join(" | "),
  );

  /* ------------------------------------------------------------------ */
  console.log("\nC. The pages");
  {
    const { page, context } = await open(users.super_admin, "/settings?tab=connections");
    const seen = await textOf(page);
    check("the card shows the address to share files with, and the project", seen.includes(KEY.client_email) && seen.includes(KEY.project_id));
    const rail = await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find((x) => x.href.includes("tab=connections"));
      return a ? a.innerText.replace(/\s+/g, " ").trim() : null;
    });
    check("the rail has Connections, with its badge", Boolean(rail) && /Connections/.test(rail) && /On/.test(rail), rail);
    await clickText(page, "Test");
    await page.waitForFunction(() => document.body.innerText.includes("Claude on Vertex AI."), { timeout: 60000 });
    const lines = await page.evaluate(() => [...document.querySelectorAll("main li strong")].map((s) => s.textContent));
    check("Test draws its four lines", ["Claude on Vertex AI.", "Google Sheets.", "Google Docs.", "Google Drive."].every((l) => lines.includes(l)), lines.join(" "));
    await shot(page, "connections-with-key");
    await context.close();
  }
  {
    const { page, context } = await open(users.super_admin, "/settings?tab=assistant");
    const select = await page.evaluate(() => {
      const label = [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Reach Claude through"));
      const s = label?.querySelector("select");
      return s ? { value: s.value, options: [...s.options].map((o) => `${o.value}:${o.disabled}`) } : null;
    });
    check("Assistant: the choice reads Google Cloud, both offered", select?.value === "vertex" && select.options.join() === "anthropic:false,vertex:false", JSON.stringify(select));
    const said = await textOf(page);
    check("…the Anthropic card says it is not in use, and the data warning names Google", /Not in use while the assistant goes through Google Cloud/.test(said) && /sent to Google Cloud \(Claude on Vertex AI\)/.test(said));
    await shot(page, "assistant-vertex");
    await context.close();
  }

  const removed = await admin("DELETE", "/connections/google/key");
  const after = await stored();
  check("Remove: the key gone, and the assistant back on the Anthropic key", removed.status === 200 && removed.body?.configured === false && after.google_service_account === null && after.ai_provider === "anthropic", JSON.stringify({ status: removed.status, provider: after.ai_provider }));

  const audit = await q(`select summary, before, after from audit_logs where entity_table = 'app_settings' and occurred_at > now() - interval '15 minutes' order by occurred_at desc limit 20`);
  const leaked = audit.filter((a) => JSON.stringify(a).includes(SECRET_MARK) || /v1\.[A-Za-z0-9_-]{10,}\./.test(JSON.stringify(a)));
  check("no audit row carries the key or its ciphertext", leaked.length === 0, `${audit.length} rows read`);
  check("the removal is in the audit log in words", audit.some((a) => a.summary === "Removed the Google Cloud key"));

  {
    const { page, context } = await open(users.super_admin, "/settings?tab=connections");
    const seen = await textOf(page);
    check("with no key: the paste box and Connect, no address", /Paste the JSON key/.test(seen) && !seen.includes(KEY.client_email));
    await shot(page, "connections-empty");
    await context.close();
  }
  {
    const { page, context } = await open(users.super_admin, "/settings?tab=assistant");
    const options = await page.evaluate(() => {
      const label = [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Reach Claude through"));
      return [...(label?.querySelector("select")?.options ?? [])].map((o) => `${o.value}:${o.disabled}`);
    });
    check("with no key, the Assistant offers Google Cloud disabled", options.join() === "anthropic:false,vertex:true", options.join());
    await context.close();
  }
  {
    const { page, context } = await open(users.cfo, "/settings?tab=connections");
    const seen = await page.evaluate(() => ({ rail: [...document.querySelectorAll("a")].some((a) => a.href.includes("tab=connections")), panel: document.body.innerText.includes("Paste the JSON key") }));
    check("the CFO has no Connections on the rail and no panel", !seen.rail && !seen.panel, JSON.stringify(seen));
    await context.close();
  }
  {
    const { page, context } = await open(users.super_admin, "/settings?tab=connections", { width: 390 });
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check("at 390px the panel does not scroll sideways", fits);
    await shot(page, "connections-phone");
    await context.close();
  }

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await q(
    `update app_settings set ai_provider = $1, google_service_account = $2, google_key_set_at = $3, google_key_set_by = $4, vertex_region = $5 where id = 1`,
    [before.ai_provider, before.google_service_account, before.google_key_set_at, before.google_key_set_by, before.vertex_region],
  );
  const restored = await stored();
  check("left as it was found", JSON.stringify(restored) === JSON.stringify(before));
  await db.end();
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
