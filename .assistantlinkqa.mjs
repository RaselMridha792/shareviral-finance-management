/**
 * A Google Sheet, Doc or Drive file read by its link, in the Assistant.
 * docs/briefs/2026-10-02-assistant-powerful.md, piece A3.
 *
 * Neither Google nor a model is asked here. Two stand-ins answer instead:
 *
 *   - Google: the API this script starts is preloaded with a few lines that
 *     send every *.googleapis.com request to a local server, and give the
 *     service account a made-up token. The app's own code — which URL it
 *     asks, what it makes of the answer, the words a refusal becomes — runs
 *     as it would on the live site. The preload lives in the temp folder for
 *     the run, never in the app.
 *   - the model: a stand-in for Anthropic's API, as in .assistantlearnqa.mjs.
 *
 * What is measured:
 *   A. the endpoint: no key, then a Sheet's tab (named, and the first when
 *      none is named), a Doc, a CSV in Drive, and each refusal in words:
 *      not shared (with the address), a folder, a picture, not a Google
 *      link; a role without the Assistant is refused; a Doc cannot go to
 *      Import;
 *   B. what the model is told: a Sheet as FILE ATTACHED with both file
 *      tools, a Doc as its own text with read_attachment alone, a plan for
 *      Import dropped for a Doc, that it cannot open a link;
 *   C. the page: a link pasted and sent is read first and goes with the
 *      message; one not shared puts the message back with the reason and
 *      sends nothing; two links are refused; a Doc's card; a phone's width.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantlinkqa.mjs                  (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantlinkqa.mjs   also saves screenshots
 *
 * Starts its own API on :4015, so the dev API on :4001 is left alone. Puts a
 * made-up Anthropic key and a made-up Google key in the local app_settings
 * while it runs and puts back what was there. Everything it makes carries
 * LINKQA and is deleted at the end.
 */
import { spawn } from "node:child_process";
import { createCipheriv, createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const DEV_API = "http://localhost:4001";
const PORT = 4015;
const API = `http://localhost:${PORT}/api`;
const MODEL_PORT = 4596;
const GOOGLE_PORT = 4597;
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
const finance = await person("finance");
if (!admin) throw new Error("The local books need an active super_admin.");
const tokenFor = (user) => jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const callAs = (bearer) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const call = callAs(tokenFor(admin));

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------------ */
/*  The files the owner "shared"                                             */
/* ------------------------------------------------------------------------ */

const SHEET_ID = "1LinkqaSheetLinkqaSheetLinkqaSheet0000000001";
const DOC_ID = "1LinkqaDocLinkqaDocLinkqaDocLinkqaDoc0000002";
const CSV_ID = "1LinkqaCsvLinkqaCsvLinkqa0000003";
const IMAGE_ID = "1LinkqaImageLinkqaImageLinkq00004";
const UNSHARED_ID = "1LinkqaNotSharedNotSharedNotSh0005";
const FOLDER_ID = "1LinkqaFolderLinkqaFolderLinkq0006";
const FEB_GID = "1834620192";

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${FEB_GID}#gid=${FEB_GID}`;
const SHEET_FIRST_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const DOC_URL = `https://docs.google.com/document/d/${DOC_ID}/edit?tab=t.0`;
const CSV_URL = `https://drive.google.com/file/d/${CSV_ID}/view?usp=sharing`;
const IMAGE_URL = `https://drive.google.com/file/d/${IMAGE_ID}/view`;
const UNSHARED_URL = `https://drive.google.com/file/d/${UNSHARED_ID}/view?usp=sharing`;
const FOLDER_URL = `https://drive.google.com/drive/folders/${FOLDER_ID}`;

const TABS = {
  Jan: [["Date", "Details", "Amount"], ["05/01/2026", "LINKQA Hostinger", 4500]],
  Feb: [
    ["Date", "Details", "Amount"],
    ["17/02/2026", "LINKQA Netflix", 1200.5],
    ["18/02/2026", "LINKQA ChatGPT Plus", 2400],
    [],
    ["19/02/2026", "LINKQA Claude Max", 24000],
  ],
};
const paragraph = (text, bullet = false) => ({ paragraph: { elements: [{ textRun: { content: text } }], ...(bullet ? { bullet: { listId: "a" } } : {}) } });
const cell = (text) => ({ content: [paragraph(`${text}\n`)] });
const DOC = {
  title: "LINKQA Board notes",
  tabs: [
    {
      tabProperties: { title: "September" },
      documentTab: {
        body: {
          content: [
            paragraph("LINKQA payments this month\n"),
            paragraph("Claude Max renewed on the 2nd\n", true),
            { table: { tableRows: [{ tableCells: [cell("Vendor"), cell("Amount")] }, { tableCells: [cell("Hostinger"), cell("4,500")] }] } },
          ],
        },
      },
    },
  ],
};

const googleAsked = [];
const google = http.createServer((req, res) => {
  const url = new URL(req.url, "http://stand-in");
  googleAsked.push({ path: `${url.pathname}${url.search}`, auth: req.headers.authorization ?? null });
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const notFound = () => send(404, { error: { code: 404, message: "File not found." } });
  const p = decodeURIComponent(url.pathname);

  if (p === `/sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`) {
    return send(200, {
      properties: { title: "LINKQA Expenses" },
      sheets: [
        { properties: { sheetId: 0, title: "Jan", index: 0, sheetType: "GRID" } },
        { properties: { sheetId: Number(FEB_GID), title: "Feb", index: 1, sheetType: "GRID" } },
      ],
    });
  }
  const values = new RegExp(`^/sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/'(.+)'$`).exec(p);
  if (values && TABS[values[1]]) return send(200, { range: values[1], majorDimension: "ROWS", values: TABS[values[1]] });
  if (p === `/docs.googleapis.com/v1/documents/${DOC_ID}`) return send(200, DOC);

  const drive = /^\/www.googleapis.com\/drive\/v3\/files\/([^/]+)$/.exec(p);
  if (drive) {
    const id = drive[1];
    const media = url.searchParams.get("alt") === "media";
    if (id === CSV_ID) {
      if (media) {
        res.writeHead(200, { "content-type": "text/csv" });
        return res.end("Date,Narration,Debit\n01/07/2026,LINKQA rent,25000\n02/07/2026,LINKQA tea,350\n");
      }
      return send(200, { id, name: "LINKQA bank july", mimeType: "text/csv", size: "90" });
    }
    if (id === IMAGE_ID) return send(200, { id, name: "LINKQA slip.jpg", mimeType: "image/jpeg", size: "2000" });
  }
  return notFound();
});
await new Promise((resolve) => google.listen(GOOGLE_PORT, "127.0.0.1", resolve));

/* ------------------------------------------------------------------------ */
/*  A stand-in for the model                                                 */
/* ------------------------------------------------------------------------ */

let script = [];
const asked = [];
const model = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    asked.push(JSON.parse(raw || "{}"));
    const line = (script.length > 1 ? script.shift() : script[0]) ?? { draft: {}, missingFields: [], summary: "(the harness gave no answer)" };
    const use = line.tool
      ? { type: "tool_use", id: `toolu_${asked.length}`, name: line.tool, input: line.input ?? {} }
      : { type: "tool_use", id: `toolu_${asked.length}`, name: "answer", input: line };
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_linkqa" });
    res.end(JSON.stringify({ id: "msg_linkqa", type: "message", role: "assistant", model: "claude-opus-5", content: [use], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((resolve) => model.listen(MODEL_PORT, "127.0.0.1", resolve));
const plain = (summary) => ({ target: null, draft: {}, missingFields: [], summary });
const toolsOf = (request) => (request?.tools ?? []).map((tool) => tool.name);
const everything = (request) => JSON.stringify(request ?? {});

/* ------------------------------------------------------------------------ */
/*  The API, preloaded to ask the stand-in Google                            */
/* ------------------------------------------------------------------------ */

const preload = path.join(os.tmpdir(), `linkqa-preload-${process.pid}.cjs`);
fs.writeFileSync(
  preload,
  `// Written by .assistantlinkqa.mjs for one run, and deleted after it.
const { GoogleAuth } = require(require.resolve("google-auth-library", { paths: [${JSON.stringify(path.resolve("apps/api"))}] }));
GoogleAuth.prototype.getAccessToken = async function () { return "ya29.linkqa"; };
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const google = /^https:\\/\\/([a-z]+\\.googleapis\\.com)(\\/.*)$/.exec(url);
  return google ? real("http://127.0.0.1:${GOOGLE_PORT}/" + google[1] + google[2], init) : real(input, init);
};
`,
);

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = {
  type: "service_account",
  project_id: "sfm-linkqa",
  private_key_id: "0000000000000000000000000000000000000000",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  client_email: "sfm-linkqa@sfm-linkqa.iam.gserviceaccount.com",
  client_id: "100000000000000000000",
  token_uri: "https://oauth2.googleapis.com/token",
};
const seal = (plaintext) => {
  const source = env.SECRET_ENCRYPTION_KEY?.trim() || env.JWT_REFRESH_SECRET?.trim();
  const key = createHash("sha256").update(source, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
};
const [before] = await q(
  `select ai_provider, ai_model, ai_data_access, anthropic_api_key, anthropic_key_set_at, anthropic_key_set_by,
          google_service_account, google_key_set_at, google_key_set_by from app_settings where id = 1`,
);

if (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)) {
  throw new Error(`Something already answers on :${PORT}. Stop it and run this again.`);
}
const api = spawn(process.execPath, ["--enable-source-maps", "dist/main"], {
  cwd: "apps/api",
  env: {
    ...process.env,
    PORT: String(PORT),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${MODEL_PORT}`,
    ANTHROPIC_API_KEY: "",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require=${preload.replace(/\\/g, "/")}`.trim(),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let apiLog = "";
api.stdout.on("data", (chunk) => (apiLog += chunk));
api.stderr.on("data", (chunk) => (apiLog += chunk));

const sweep = async () => {
  await db.query(`delete from ai_chats where title like 'LINKQA%'`);
  await db.query(`delete from ai_attachments where filename like 'LINKQA%'`);
};

let browser;
try {
  for (let i = 0; i < 90; i += 1) {
    const up = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
    if (up) break;
    if (api.exitCode !== null || i === 89) throw new Error(`The API did not start on :${PORT}.\n${apiLog.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await sweep();

  /* ------------------------------------------------------------------ */
  console.log("\nA. The endpoint");
  await q(
    `update app_settings set ai_provider = 'anthropic', ai_model = 'claude-opus-5', ai_data_access = 'full',
            anthropic_api_key = $1, anthropic_key_set_at = now(), anthropic_key_set_by = $2,
            google_service_account = null, google_key_set_at = null, google_key_set_by = null where id = 1`,
    [seal("sk-ant-linkqa-0000000000000000000000"), admin.id],
  );
  const noKey = await call("POST", "/ai/attachments/link", { url: SHEET_URL });
  check("with no Google key: refused, saying where the key goes", noKey.status === 400 && /needs the Google Cloud key.*Settings → Connections/.test(noKey.body?.message ?? ""), `${noKey.status} ${noKey.body?.message}`);
  check("…and Google was not asked", googleAsked.length === 0, String(googleAsked.length));

  await q(`update app_settings set google_service_account = $1, google_key_set_at = now(), google_key_set_by = $2 where id = 1`, [seal(JSON.stringify(KEY)), admin.id]);

  const sheet = await call("POST", "/ai/attachments/link", { url: SHEET_URL });
  check(
    "a Sheet's link: the tab it names, named with its place among the tabs",
    sheet.status === 200 && sheet.body?.kind === "table" && sheet.body?.name === "LINKQA Expenses — Feb (tab 2 of 2)",
    `${sheet.status} ${sheet.body?.kind} ${sheet.body?.name ?? sheet.body?.message}`,
  );
  const amount = sheet.body?.columns?.find((column) => column.name === "Amount");
  check("its rows, the empty one skipped, totalled in code", sheet.body?.rowCount === 3 && amount?.kind === "number" && amount?.total === "27600.50", `${sheet.body?.rowCount} rows, Amount ${amount?.kind} ${amount?.total}`);
  check("its dates read day-first, as the column shows", sheet.body?.columns?.find((column) => column.name === "Date")?.dateOrder === "dmy");
  const asks = googleAsked.map((a) => decodeURIComponent(a.path));
  check(
    "Google was asked for the sheet's tabs, then that tab's values, unformatted",
    asks.some((a) => a.startsWith(`/sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=`)) && asks.some((a) => a.includes(`/values/'Feb'?valueRenderOption=UNFORMATTED_VALUE`)),
    asks.slice(-2).join(" | "),
  );
  check("with the service account's token, read-only", googleAsked.every((a) => a.auth === "Bearer ya29.linkqa"));
  const [kept] = await q(`select user_id, filename, total_rows from ai_attachments where id = $1`, [sheet.body?.id]);
  check("kept as the asker's own attachment", kept?.user_id === admin.id && kept?.total_rows === 3, JSON.stringify(kept));

  const first = await call("POST", "/ai/attachments/link", { url: SHEET_FIRST_URL });
  check("a Sheet's link naming no tab: the first", first.status === 200 && first.body?.name === "LINKQA Expenses — Jan (tab 1 of 2)", first.body?.name ?? first.body?.message);

  const doc = await call("POST", "/ai/attachments/link", { url: DOC_URL });
  const lines = (doc.body?.sample ?? []).map((row) => row.Text);
  check("a Doc's link: its text, a paragraph to a line", doc.status === 200 && doc.body?.kind === "text" && doc.body?.name === "LINKQA Board notes" && doc.body?.rowCount === 4, `${doc.status} ${doc.body?.kind} ${doc.body?.name ?? doc.body?.message} ${doc.body?.rowCount}`);
  check("a bullet marked, a table a row to a line", lines.includes("• Claude Max renewed on the 2nd") && lines.includes("Hostinger | 4,500"), JSON.stringify(lines));

  const csv = await call("POST", "/ai/attachments/link", { url: CSV_URL });
  check(
    "a CSV kept in Drive: downloaded and read as an upload, its type's extension added",
    csv.status === 200 && csv.body?.kind === "table" && csv.body?.name === "LINKQA bank july.csv" && csv.body?.rowCount === 2 && csv.body?.columns?.find((c) => c.name === "Debit")?.total === "25350.00",
    `${csv.status} ${csv.body?.name ?? csv.body?.message} ${csv.body?.rowCount}`,
  );

  const unshared = await call("POST", "/ai/attachments/link", { url: UNSHARED_URL });
  check(
    "a file never shared with the account: refused, with the address to share it with",
    unshared.status === 400 && (unshared.body?.message ?? "").startsWith(`Share this file with ${KEY.client_email} first (Viewer is enough)`),
    `${unshared.status} ${unshared.body?.message}`,
  );
  const asksBefore = googleAsked.length;
  const folder = await call("POST", "/ai/attachments/link", { url: FOLDER_URL });
  check("a folder: refused in words, before Google is asked", folder.status === 400 && /Drive folder/.test(folder.body?.message ?? "") && googleAsked.length === asksBefore, folder.body?.message);
  const image = await call("POST", "/ai/attachments/link", { url: IMAGE_URL });
  check("a picture: not read yet, said so", image.status === 400 && /"LINKQA slip\.jpg" is a picture/.test(image.body?.message ?? ""), image.body?.message);
  const notGoogle = await call("POST", "/ai/attachments/link", { url: "https://example.com/sheet.xlsx" });
  check("not a Google link: refused", notGoogle.status === 400 && /not a link to a Google Sheet, Doc or Drive file/.test(notGoogle.body?.message ?? ""), notGoogle.body?.message);
  if (finance) {
    const barred = await callAs(tokenFor(finance))("POST", "/ai/attachments/link", { url: SHEET_URL });
    check("a role without the Assistant is refused", barred.status === 403, String(barred.status));
  }
  const toImport = await call("POST", `/ai/attachments/${doc.body?.id}/to-import`, { plan: null });
  check("a Doc cannot be sent to Import", toImport.status === 400 && /document cannot be staged for Import/.test(toImport.body?.message ?? ""), `${toImport.status} ${toImport.body?.message}`);

  /* ------------------------------------------------------------------ */
  console.log("\nB. What the model is told");
  script = [plain("LINKQA Feb e 3 ta entry, 27,600.50 taka.")];
  let from = asked.length;
  const sheetTurn = await call("POST", "/ai/turn", { messages: [{ role: "user", content: `LINKQA ei sheet e koto? ${SHEET_URL}` }], attachmentId: sheet.body?.id });
  let request = asked[from];
  check("a Sheet: FILE ATTACHED, with its totals", sheetTurn.status === 200 && everything(request).includes("FILE ATTACHED: LINKQA Expenses — Feb (tab 2 of 2)") && everything(request).includes("total 27600.50"), String(sheetTurn.status));
  check("…worked as a file, with both file tools", everything(request).includes("WORKING FROM A FILE") && toolsOf(request).includes("read_attachment") && toolsOf(request).includes("group_attachment"), toolsOf(request).join(","));
  check("it is told it cannot open a link, and what a read one looks like", everything(request).includes("You cannot open a link.") && everything(request).includes("arrives below as\\n  FILE ATTACHED or DOCUMENT ATTACHED"));

  script = [
    { tool: "read_attachment", input: { offset: 2, limit: 5 } },
    { ...plain("LINKQA Hostinger 4,500."), importPlan: { accountName: "LINKQA", columnMap: { Text: "description" }, dateFormat: "dmy" } },
  ];
  from = asked.length;
  const docTurn = await call("POST", "/ai/turn", { messages: [{ role: "user", content: `LINKQA ei doc e ki ache? ${DOC_URL}` }], attachmentId: doc.body?.id });
  request = asked[from];
  check("a Doc: its own text, not a table", docTurn.status === 200 && everything(request).includes("DOCUMENT ATTACHED: LINKQA Board notes (a Google Doc)") && everything(request).includes("LINKQA payments this month"), String(docTurn.status));
  check("…worked as a document, never sent to Import", everything(request).includes("WORKING FROM A DOCUMENT") && !everything(request).includes("WORKING FROM A FILE"));
  check("…with read_attachment and not group_attachment", toolsOf(request).includes("read_attachment") && !toolsOf(request).includes("group_attachment"), toolsOf(request).join(","));
  const toolResult = everything(asked[from + 1]);
  check("read_attachment reads it on by paragraph", toolResult.includes("Paragraphs 3–4 of 4:") && toolResult.includes("Hostinger | 4,500"), toolResult.match(/Paragraphs[^"]{0,60}/)?.[0]);
  check("a plan for Import made of a Doc is dropped", docTurn.body?.importPlan === null || docTurn.body?.importPlan === undefined, JSON.stringify(docTurn.body?.importPlan));
  check("the answer is given", docTurn.body?.summary === "LINKQA Hostinger 4,500.", docTurn.body?.summary);

  /* ------------------------------------------------------------------ */
  console.log("\nC. The page");
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const openAs = async (user, width = 1440) => {
    const context = await browser.createBrowserContext();
    await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
    const page = await context.newPage();
    await page.setViewport({ width, height: 1000 });
    page.errors = [];
    page.sent = [];
    page.on("pageerror", (e) => page.errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", (intercepted) => {
      const url = intercepted.url();
      const base = [`${WEB}/api/`, `${DEV_API}/api/`].find((prefix) => url.startsWith(prefix));
      if (base && intercepted.method() === "POST") page.sent.push({ path: url.slice(base.length - 1), body: intercepted.postData() ?? "" });
      if (base) intercepted.continue({ url: url.replace(base, `${API}/`) });
      else intercepted.continue();
    });
    return page;
  };
  const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  const text = (page) => page.evaluate(() => document.body.innerText);
  const box = 'textarea[placeholder^="Type it"]';
  const paste = async (page, value) => {
    await page.click(box);
    await page.evaluate((selector, value) => {
      const input = document.querySelector(selector);
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, box, value);
  };

  const page = await openAs(admin);
  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  script = [plain("LINKQA Feb e 3 ta entry.")];
  const read = page.waitForResponse((r) => r.url().endsWith("/ai/attachments/link"), { timeout: 60000 });
  const answered = page.waitForResponse((r) => r.url().endsWith("/ai/turn") && r.request().method() === "POST", { timeout: 60000 });
  await paste(page, `LINKQA ei sheet ta dekho ${SHEET_URL}`);
  await page.keyboard.press("Enter");
  const readReply = await (await read).json().catch(() => null);
  await answered;
  await page.waitForFunction(() => document.body.innerText.includes("LINKQA Feb e 3 ta entry."), { timeout: 30000 }).catch(() => undefined);
  let shown = await text(page);
  await shot(page, "link-sheet");
  check("a pasted link is read, and its card shows", shown.includes("LINKQA Expenses — Feb (tab 2 of 2)") && /3\s+rows/.test(shown), shown.slice(0, 200).replace(/\n/g, " | "));
  const order = page.sent.map((s) => s.path);
  const turnBody = JSON.parse(page.sent.find((s) => s.path === "/ai/turn")?.body || "{}");
  check("the link was read before the message went, and the message carried the file", order.indexOf("/ai/attachments/link") > -1 && order.indexOf("/ai/attachments/link") < order.indexOf("/ai/turn") && turnBody.attachmentId === readReply?.id, `${order.join(" → ")} ${turnBody.attachmentId === readReply?.id}`);
  check("the answer shows", shown.includes("LINKQA Feb e 3 ta entry."));

  const sentBefore = page.sent.length;
  await paste(page, `LINKQA eta dekho ${UNSHARED_URL}`);
  const refused = page.waitForResponse((r) => r.url().endsWith("/ai/attachments/link"), { timeout: 60000 });
  await page.keyboard.press("Enter");
  await refused;
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes("Share this file with"), { timeout: 30000 }).catch(() => undefined);
  const alert = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? "");
  const boxValue = await page.$eval(box, (input) => input.value);
  await shot(page, "link-unshared");
  check("a file not shared: the reason shows, with the address", alert.includes(`Share this file with ${KEY.client_email} first`), alert);
  check("…the message is back in the box, and nothing was sent to the model", boxValue === `LINKQA eta dekho ${UNSHARED_URL}` && !page.sent.slice(sentBefore).some((s) => s.path === "/ai/turn"), `${boxValue.slice(0, 30)} | ${page.sent.slice(sentBefore).map((s) => s.path).join(",")}`);
  const inTranscript = await page.evaluate(() => [...document.querySelectorAll("p")].some((p) => p.textContent.startsWith("LINKQA eta dekho")));
  check("…and the transcript does not keep it", !inTranscript);

  const sentBeforeTwo = page.sent.length;
  await paste(page, `LINKQA duita ${SHEET_URL} ${DOC_URL}`);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes("more than one Google link"), { timeout: 10000 }).catch(() => undefined);
  check(
    "two links: refused, one at a time, and nothing sent",
    (await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? "")).includes("more than one Google link") && page.sent.length === sentBeforeTwo,
  );

  const docPage = await openAs(admin);
  await docPage.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  script = [plain("LINKQA doc e Hostinger 4,500.")];
  const docAnswered = docPage.waitForResponse((r) => r.url().endsWith("/ai/turn") && r.request().method() === "POST", { timeout: 60000 });
  await paste(docPage, `LINKQA ei doc ${DOC_URL}`);
  await docPage.keyboard.press("Enter");
  await docAnswered;
  await docPage.waitForFunction(() => document.body.innerText.includes("LINKQA doc e Hostinger"), { timeout: 30000 }).catch(() => undefined);
  shown = await text(docPage);
  await shot(docPage, "link-doc");
  check("a Doc's card: Google Doc, its paragraphs, how it begins", shown.includes("LINKQA Board notes") && /Google Doc · 4\s+paragraphs/.test(shown) && shown.includes("LINKQA payments this month"), shown.slice(0, 240).replace(/\n/g, " | "));
  check("…and no Send to Import on it", !shown.includes("Send to Import"));
  check("no page error", page.errors.length === 0 && docPage.errors.length === 0, [...page.errors, ...docPage.errors].slice(0, 2).join(" | "));

  const phone = await openAs(admin, 390);
  await phone.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  script = [plain("LINKQA phone.")];
  const phoneAnswered = phone.waitForResponse((r) => r.url().endsWith("/ai/turn") && r.request().method() === "POST", { timeout: 60000 });
  await paste(phone, `LINKQA ${DOC_URL}`);
  await phone.keyboard.press("Enter");
  await phoneAnswered;
  await phone.waitForFunction(() => document.body.innerText.includes("LINKQA phone."), { timeout: 30000 }).catch(() => undefined);
  const sideways = await phone.evaluate(() => {
    const scroller = [...document.querySelectorAll("div")].find((div) => getComputedStyle(div).overflowY === "auto" && div.scrollHeight > div.clientHeight);
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, inner: scroller ? scroller.scrollWidth - scroller.clientWidth : 0 };
  });
  await shot(phone, "link-doc-390");
  check("at 390px the Doc's card and the chat scroll nowhere sideways", sideways.page <= 0 && sideways.inner <= 0, JSON.stringify(sideways));
  // The transcript scrolls on its own, so a link running out of its bubble
  // never widens the page: the bubble itself is measured.
  const spills = async (p) =>
    p.evaluate(() =>
      [...document.querySelectorAll("p")]
        .filter((bubble) => bubble.textContent.includes("docs.google.com"))
        .map((bubble) => ({ over: bubble.scrollWidth - bubble.clientWidth, right: Math.round(bubble.getBoundingClientRect().right), window: window.innerWidth })),
    );
  const phoneBubbles = await spills(phone);
  const wideBubbles = await spills(docPage);
  check(
    "a pasted link wraps inside its bubble, at 390px and 1440px",
    phoneBubbles.length > 0 && wideBubbles.length > 0 && [...phoneBubbles, ...wideBubbles].every((b) => b.over <= 0 && b.right <= b.window),
    JSON.stringify({ phoneBubbles, wideBubbles }),
  );
} finally {
  await browser?.close().catch(() => undefined);
  await sweep().catch((error) => console.log(`  (could not sweep: ${error.message})`));
  await db.query(
    `update app_settings set ai_provider = $1, ai_model = $2, ai_data_access = $3, anthropic_api_key = $4, anthropic_key_set_at = $5, anthropic_key_set_by = $6,
            google_service_account = $7, google_key_set_at = $8, google_key_set_by = $9 where id = 1`,
    [before.ai_provider, before.ai_model, before.ai_data_access, before.anthropic_api_key, before.anthropic_key_set_at, before.anthropic_key_set_by, before.google_service_account, before.google_key_set_at, before.google_key_set_by],
  );
  const stopped = new Promise((resolve) => api.once("exit", resolve));
  api.kill();
  await stopped;
  model.close();
  google.close();
  fs.rmSync(preload, { force: true });
  const [left] = await q(
    `select (select count(*) from ai_attachments where filename like 'LINKQA%')::int as attachments,
            (select count(*) from ai_chats where title like 'LINKQA%')::int as chats,
            (select google_service_account is not distinct from $1 from app_settings where id = 1) as google_key_back`,
    [before.google_service_account],
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
