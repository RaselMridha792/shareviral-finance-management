/**
 * Empty sheets do not count, in the Assistant: a workbook or a Google Sheet
 * whose rows are all on one sheet or tab is read as that one.
 * docs/briefs/2026-10-02-assistant-powerful.md, piece A3d.
 *
 * Neither Google nor a model is asked here. Two stand-ins answer instead, as
 * in .assistantexcelqa.mjs: a local server for *.googleapis.com (the API this
 * script starts is preloaded to send Google's requests there), and a stand-in
 * for Anthropic's API.
 *
 * What is measured:
 *   A. the endpoint: an old workbook (Sheet1 of rows, Sheet2 empty, Sheet3 a
 *      heading alone) comes back as one file, its empty sheets named on the
 *      name's second line; one hidden sheet of data among 24 empty ones too,
 *      not refused for its count; a workbook with two sheets of data is still
 *      every sheet (A3c); a Google Sheet with one tab of data is one file, one
 *      with two is every tab (A3b); an .xlsx in Drive as the upload; Send to
 *      Import stages the sheet under its own name;
 *   B. what the model is told: FILE ATTACHED, the rest said to be empty,
 *      worked as a file, the tools asking for no file number, a plan for
 *      Import kept; the line in WHAT THIS APP CANNOT DO; reopened, the file;
 *   C. the page: one card headed by the file and its sheet, the empty ones in
 *      a line under it, no line of sheets above, Send to Import and the plan
 *      on the card; reopened from History; a phone's width with 24 names.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantemptyqa.mjs                 (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantemptyqa.mjs  also saves screenshots
 *
 * Starts its own API on :4021, so the dev API on :4001 is left alone. Puts a
 * made-up Anthropic key and a made-up Google key in the local app_settings
 * while it runs and puts back what was there. Everything it makes carries
 * EMPTYQA and is deleted at the end.
 */
import { spawn } from "node:child_process";
import { createCipheriv, createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const DEV_API = "http://localhost:4001";
const PORT = 4021;
const API = `http://localhost:${PORT}/api`;
const MODEL_PORT = 4601;
const GOOGLE_PORT = 4602;
const SHOTS = process.env.SHOT_DIR || null;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

const admin = (await q(`select id, role, full_name, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`))[0];
if (!admin) throw new Error("The local books need an active super_admin.");
const tokenFor = (user) => jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const call = async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(admin)}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
/** The paperclip's endpoint, multipart, as the page sends it. */
const upload = async (name, buffer) => {
  const body = new FormData();
  body.append("file", new Blob([buffer], { type: XLSX_TYPE }), name);
  const res = await fetch(`${API}/ai/attachments`, { method: "POST", headers: { Authorization: `Bearer ${tokenFor(admin)}`, "X-Requested-With": "finance-web" }, body });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
// A wait left pending when a page closes must not end the run before the
// settings it changed are put back.
process.on("unhandledRejection", (error) => console.log(`  (a wait gave up: ${error?.message ?? error})`));
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------------ */
/*  The workbooks                                                            */
/* ------------------------------------------------------------------------ */

async function workbook(sheets) {
  const book = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const added = book.addWorksheet(sheet.name, { state: sheet.state ?? "visible" });
    for (const row of sheet.rows) added.addRow(row);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
const PAYMENTS = [["Date", "Paid to", "Amount"], ["03/09/2026", "EMPTYQA Hostinger", 4500], ["09/09/2026", "EMPTYQA Courier", 640]];
const PEOPLE = [["Name", "Salary"], ["EMPTYQA Rahim", 45000]];
// An older workbook, as Excel makes one: the rows on Sheet1, Sheet2 never
// touched, Sheet3 with a heading somebody typed and nothing under it.
const OLD_BYTES = await workbook([
  { name: "Sheet1", rows: PAYMENTS },
  { name: "Sheet2", rows: [] },
  { name: "Sheet3", rows: [["Amount"]], state: "hidden" },
]);
const EMPTIES = Array.from({ length: 24 }, (_, at) => `E${at + 1}`);
const WIDE_BYTES = await workbook([...EMPTIES.map((name) => ({ name, rows: [] })), { name: "Data", rows: PEOPLE, state: "hidden" }]);
const MIXED_BYTES = await workbook([
  { name: "Payments", rows: PAYMENTS },
  { name: "Blank", rows: [] },
  { name: "People", rows: PEOPLE },
]);

const OLD = "EMPTYQA Old book.xlsx";
const OLD_NAME = `${OLD} — Sheet1\nSheet2, Sheet3: empty`;
const WIDE = "EMPTYQA Wide.xlsx";
const MIXED = "EMPTYQA Mixed.xlsx";

/* ------------------------------------------------------------------------ */
/*  A stand-in for Google                                                    */
/* ------------------------------------------------------------------------ */

const SHEET_ID = "1EmptyqaSheetEmptyqaSheetEmptyqaSheet000001";
const BOOK_ID = "1EmptyqaBookEmptyqaBookEmptyqaBookEmptyqa0002";
const DRIVE_ID = "1EmptyqaDriveEmptyqaDriveEmptyqa0003";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const BOOK_URL = `https://docs.google.com/spreadsheets/d/${BOOK_ID}/edit?usp=sharing`;
const DRIVE_URL = `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`;
// One tab of data, an empty one, and a hidden one with a heading alone.
const SHEET_TABS = { Jan: [["Date", "Details", "Amount"], ["05/01/2026", "EMPTYQA Netflix", 1200]], Feb: [], Notes: [["Amount"]] };
// Two tabs of data and an empty one: every tab, as A3b made it.
const BOOK_TABS = { Payments: PAYMENTS, People: PEOPLE, Blank: [] };

const googleAsked = [];
const google = http.createServer((req, res) => {
  const url = new URL(req.url, "http://stand-in");
  googleAsked.push(`${url.pathname}${url.search}`);
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const p = decodeURIComponent(url.pathname);
  const meta = (title, tabs) =>
    send(200, {
      properties: { title },
      sheets: Object.keys(tabs).map((name, index) => ({ properties: { sheetId: index, title: name, index, sheetType: "GRID", ...(name === "Notes" ? { hidden: true } : {}) } })),
    });
  if (p === `/sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`) return meta("EMPTYQA Expenses", SHEET_TABS);
  if (p === `/sheets.googleapis.com/v4/spreadsheets/${BOOK_ID}`) return meta("EMPTYQA Book", BOOK_TABS);
  // Every tab at once, answered in the order asked, as Google does. An
  // empty tab comes back with no values at all.
  const batch = new RegExp(`^/sheets.googleapis.com/v4/spreadsheets/(${SHEET_ID}|${BOOK_ID})/values:batchGet$`).exec(p);
  if (batch) {
    const tabs = batch[1] === SHEET_ID ? SHEET_TABS : BOOK_TABS;
    const ranges = url.searchParams.getAll("ranges").map((range) => range.replace(/^'|'$/g, ""));
    if (!ranges.length || ranges.some((range) => !tabs[range])) return send(400, { error: { code: 400, message: "Unable to parse range" } });
    return send(200, { spreadsheetId: batch[1], valueRanges: ranges.map((range) => ({ range, majorDimension: "ROWS", ...(tabs[range].length ? { values: tabs[range] } : {}) })) });
  }
  const drive = /^\/www.googleapis.com\/drive\/v3\/files\/([^/]+)$/.exec(p);
  if (drive && drive[1] === DRIVE_ID) {
    if (url.searchParams.get("alt") === "media") {
      res.writeHead(200, { "content-type": XLSX_TYPE });
      return res.end(OLD_BYTES);
    }
    return send(200, { id: DRIVE_ID, name: "EMPTYQA Drive old.xlsx", mimeType: XLSX_TYPE, size: String(OLD_BYTES.length) });
  }
  return send(404, { error: { code: 404, message: "File not found." } });
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
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_emptyqa" });
    res.end(JSON.stringify({ id: "msg_emptyqa", type: "message", role: "assistant", model: "claude-opus-5", content: [use], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((resolve) => model.listen(MODEL_PORT, "127.0.0.1", resolve));
const plain = (summary) => ({ target: null, draft: {}, missingFields: [], summary });
const everything = (request) => JSON.stringify(request ?? {});
const PLAN = { accountName: "EMPTYQA Cash", categoryName: "EMPTYQA Courier", columnMap: { Date: "date", "Paid to": "description", Amount: "amount" }, dateFormat: "dmy", assumeDirection: "out", usdRate: "122.50", note: "EMPTYQA two payments from Sheet1." };

/* ------------------------------------------------------------------------ */
/*  The API, preloaded to ask the stand-in Google                            */
/* ------------------------------------------------------------------------ */

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "emptyqa-"));
const preload = path.join(scratch, "preload.cjs");
fs.writeFileSync(
  preload,
  `// Written by .assistantemptyqa.mjs for one run, and deleted after it.
const { GoogleAuth } = require(require.resolve("google-auth-library", { paths: [${JSON.stringify(path.resolve("apps/api"))}] }));
GoogleAuth.prototype.getAccessToken = async function () { return "ya29.emptyqa"; };
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
  project_id: "sfm-emptyqa",
  private_key_id: "0000000000000000000000000000000000000000",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  client_email: "sfm-emptyqa@sfm-emptyqa.iam.gserviceaccount.com",
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
  await db.query(`delete from ai_chats where title like 'EMPTYQA%'`);
  await db.query(`delete from ai_attachments where filename like 'EMPTYQA%'`);
  await db.query(`delete from import_batches where filename like 'EMPTYQA%'`);
};
const total = (file, column) => file?.columns?.find((c) => c.name === column)?.total;
const names = (body) => (Array.isArray(body) ? body.map((f) => f.name).join(" | ") : body?.message);

let browser;
try {
  for (let i = 0; i < 90; i += 1) {
    const up = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
    if (up) break;
    if (api.exitCode !== null || i === 89) throw new Error(`The API did not start on :${PORT}.\n${apiLog.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await sweep();
  await q(
    `update app_settings set ai_provider = 'anthropic', ai_model = 'claude-opus-5', ai_data_access = 'full',
            anthropic_api_key = $1, anthropic_key_set_at = now(), anthropic_key_set_by = $2,
            google_service_account = $3, google_key_set_at = now(), google_key_set_by = $2 where id = 1`,
    [seal("sk-ant-emptyqa-000000000000000000000"), admin.id, seal(JSON.stringify(KEY))],
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA. The endpoint");
  const old = await upload(OLD, OLD_BYTES);
  check(
    "an old workbook, its rows on Sheet1 alone: one file, named by the file and its sheet, the empty sheets on its second line",
    old.status === 200 && Array.isArray(old.body) && old.body.length === 1 && old.body[0].name === OLD_NAME,
    `${old.status} ${JSON.stringify(names(old.body))}`,
  );
  check(
    "…counted as that sheet: 2 rows, ৳5,140, its own three columns",
    old.body?.[0]?.rowCount === 2 && total(old.body?.[0], "Amount") === "5140.00" && old.body?.[0]?.columns?.map((c) => c.name).join("/") === "Date/Paid to/Amount",
    JSON.stringify(old.body?.[0] && [old.body[0].rowCount, old.body[0].columns.map((c) => c.name)]),
  );
  const [oldKept] = await q(`select count(*)::int as n from ai_attachments where filename like $1`, [`${OLD}%`]);
  check("…kept as one row, nothing for the empty sheets", oldKept.n === 1, String(oldKept.n));

  const wide = await upload(WIDE, WIDE_BYTES);
  check(
    "one hidden sheet of data among 24 empty ones: that sheet, said to be hidden, not refused for the count",
    wide.status === 200 && wide.body?.length === 1 && wide.body[0].name === `${WIDE} — Data (hidden)\n${EMPTIES.join(", ")}: empty` && total(wide.body[0], "Salary") === "45000.00",
    `${wide.status} ${JSON.stringify(names(wide.body))}`,
  );

  const mixed = await upload(MIXED, MIXED_BYTES);
  check(
    "two sheets of data and an empty one: still every sheet, a file each, the empty one kept (A3c)",
    mixed.status === 200 && names(mixed.body) === `${MIXED} — Payments (sheet 1 of 3) | ${MIXED} — Blank (sheet 2 of 3) | ${MIXED} — People (sheet 3 of 3)` && mixed.body?.map((f) => f.rowCount).join(",") === "2,0,1",
    `${mixed.status} ${names(mixed.body)}`,
  );

  const sheet = await call("POST", "/ai/attachments/link", { url: SHEET_URL });
  check(
    "a Google Sheet with one tab of data: one file, its empty tabs named on its second line",
    sheet.status === 200 && sheet.body?.length === 1 && sheet.body[0].name === "EMPTYQA Expenses — Jan\nFeb, Notes: empty" && total(sheet.body[0], "Amount") === "1200.00",
    `${sheet.status} ${JSON.stringify(names(sheet.body))}`,
  );
  check(
    "…read from Google in the same two calls as before: the tabs, then their cells at once",
    googleAsked.filter((a) => a.includes(SHEET_ID)).length === 2 && googleAsked.some((a) => decodeURIComponent(a).includes(`${SHEET_ID}/values:batchGet?ranges='Jan'&ranges='Feb'&ranges='Notes'`)),
    googleAsked.filter((a) => a.includes(SHEET_ID)).map((a) => decodeURIComponent(a).slice(0, 110)).join(" ; "),
  );
  const book = await call("POST", "/ai/attachments/link", { url: BOOK_URL });
  check(
    "a Google Sheet with two tabs of data: every tab, as before (A3b)",
    book.status === 200 && names(book.body) === "EMPTYQA Book — Payments (tab 1 of 3) | EMPTYQA Book — People (tab 2 of 3) | EMPTYQA Book — Blank (tab 3 of 3)",
    `${book.status} ${names(book.body)}`,
  );
  const drive = await call("POST", "/ai/attachments/link", { url: DRIVE_URL });
  check(
    "an old workbook kept in Drive, by its link: one file, as the upload reads it",
    drive.status === 200 && drive.body?.length === 1 && drive.body[0].name === "EMPTYQA Drive old.xlsx — Sheet1\nSheet2, Sheet3: empty",
    `${drive.status} ${JSON.stringify(names(drive.body))}`,
  );

  const staged = await call("POST", `/ai/attachments/${drive.body?.[0]?.id}/to-import`, { plan: null });
  const [batch] = await q(`select filename, total_rows from import_batches where id = $1`, [staged.body?.batchId ?? "00000000-0000-4000-8000-000000000000"]);
  check(
    "Send to Import stages its rows under the file and sheet's own name, without the empty sheets' line",
    staged.status === 200 && batch?.filename === "EMPTYQA Drive old.xlsx — Sheet1" && batch?.total_rows === 2,
    `${staged.status} ${JSON.stringify(batch)}`,
  );

  /* ------------------------------------------------------------------ */
  console.log("\nB. What the model is told");
  script = [{ tool: "read_attachment", input: { offset: 0 } }, { ...plain("EMPTYQA 5,140 taka, two payments."), importPlan: PLAN }];
  let from = asked.length;
  const turn = await call("POST", "/ai/turn", { messages: [{ role: "user", content: "EMPTYQA ei file ta boi te tulo" }], attachmentIds: [old.body?.[0]?.id] });
  const told = everything(asked[from]);
  check(
    "FILE ATTACHED: the file and its sheet, and the rest said to be empty, by name",
    turn.status === 200 &&
      told.includes(`FILE ATTACHED: ${OLD} — Sheet1\\nThe rest of the file is empty: Sheet2, Sheet3 — no rows under a heading row, so nothing there was read. This is the only part of the file that holds data, so it is the whole file.\\n2 rows`),
    `${turn.status} ${turn.body?.message ?? told.match(/FILE ATTACHED[^"]{0,160}/)?.[0]}`,
  );
  check(
    "…worked as a file, not as a workbook's sheets, with no FILE numbers",
    told.includes("WORKING FROM A FILE") && !told.includes("WORKING FROM A WORKBOOK'S SHEETS") && !told.includes("FILE 1 ATTACHED") && told.includes("total 5140.00"),
  );
  check(
    "…told, once, that one tab or sheet of rows arrives as one FILE ATTACHED",
    told.includes("When only one tab or sheet holds any rows, it arrives as one FILE ATTACHED,\\n  which names the empty ones and says the rest of the file is empty."),
  );
  const fileTools = (asked[from]?.tools ?? []).filter((tool) => ["read_attachment", "group_attachment"].includes(tool.name));
  check(
    "the file tools ask for no file number, as one file's never did",
    fileTools.length === 2 && fileTools.every((tool) => !tool.input_schema?.properties?.file && !(tool.input_schema?.required ?? []).includes("file")),
    JSON.stringify(fileTools.map((tool) => [tool.name, tool.input_schema?.required ?? []])),
  );
  const result = (asked[from + 1]?.messages?.at(-1)?.content ?? []).filter?.((part) => part.type === "tool_result").map((part) => (typeof part.content === "string" ? part.content : JSON.stringify(part.content))).join("\n") ?? "";
  check("read_attachment with no file named reads the sheet's two rows", result.startsWith("Rows 1–2 of 2") && result.includes("EMPTYQA Hostinger"), result.slice(0, 80));
  check(
    "a plan for Import is kept, as it is for one file",
    turn.body?.importPlan?.accountName === "EMPTYQA Cash" && turn.body?.importPlan?.columnMap?.Amount === "amount",
    JSON.stringify(turn.body?.importPlan ?? null),
  );
  const reopened = await call("GET", `/ai/chats/${turn.body?.chatId}`);
  check(
    "the conversation reopened: the one file, its empty sheets still named",
    reopened.status === 200 && reopened.body?.attachments?.length === 1 && reopened.body.attachments[0].name === OLD_NAME,
    JSON.stringify(reopened.body?.attachments?.map((f) => f.name)),
  );

  script = [plain("EMPTYQA 1,200.")];
  from = asked.length;
  const sheetTurn = await call("POST", "/ai/turn", { messages: [{ role: "user", content: "EMPTYQA eta koto?" }], attachmentIds: [sheet.body?.[0]?.id] });
  const sheetTold = everything(asked[from]);
  check(
    "the Google Sheet's one tab: FILE ATTACHED, the empty tabs named, worked as a file",
    sheetTurn.status === 200 && sheetTold.includes("FILE ATTACHED: EMPTYQA Expenses — Jan\\nThe rest of the file is empty: Feb, Notes —") && sheetTold.includes("WORKING FROM A FILE") && !sheetTold.includes("WORKING FROM A SHEET'S TABS"),
    String(sheetTurn.status),
  );

  /* ------------------------------------------------------------------ */
  console.log("\nC. The page");
  const oldFile = path.join(scratch, OLD);
  const wideFile = path.join(scratch, WIDE);
  fs.writeFileSync(oldFile, OLD_BYTES);
  fs.writeFileSync(wideFile, WIDE_BYTES);

  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const openAs = async (user, width = 1440) => {
    const context = await browser.createBrowserContext();
    await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
    const page = await context.newPage();
    await page.setViewport({ width, height: 1000 });
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
  /** The paperclip: the file picked, and the endpoint's answer. */
  const attachOn = async (page, file) => {
    const input = await page.$('input[type="file"]');
    if (!input) throw new Error(`The paperclip's file input is not on the page, at ${page.url()}: ${(await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, " | ")}`);
    const answered = page.waitForResponse((r) => r.url().endsWith("/ai/attachments") && r.request().method() === "POST", { timeout: 60000 }).catch(() => null);
    await input.uploadFile(file);
    return (await answered)?.json().catch(() => null) ?? null;
  };
  /** The cards whose heading starts so, and the line right under each. */
  const cardsOn = (page, prefix) =>
    page.evaluate(
      (prefix) =>
        [...document.querySelectorAll("div.rounded-xl")]
          .filter((card) => card.querySelector("p.truncate")?.title.startsWith(prefix))
          .map((card) => ({
            title: card.querySelector("p.truncate").title,
            label: card.querySelector("p.truncate").textContent,
            text: card.innerText.replace(/\s+/g, " "),
            imports: [...card.querySelectorAll("button")].filter((b) => b.textContent.includes("Send to Import")).length,
            under: card.nextElementSibling?.tagName === "P" ? card.nextElementSibling.textContent : null,
          })),
      prefix,
    );
  const chipOf = (page) => page.evaluate(() => document.querySelector("form .truncate")?.textContent ?? "");

  const page = await openAs(admin);
  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await attachOn(page, oldFile);
  await page.waitForFunction(() => document.body.innerText.includes("Sheet2, Sheet3: empty"), { timeout: 30000 }).catch(() => undefined);
  let cards = await cardsOn(page, OLD);
  const shown = await text(page);
  await shot(page, "empty-old");
  check(
    "the paperclip: one card, headed by the file and its sheet, the empty sheets in one line under it",
    cards.length === 1 && cards[0].label === `${OLD} — Sheet1` && cards[0].title === `${OLD} — Sheet1` && cards[0].under === "Sheet2, Sheet3: empty",
    JSON.stringify(cards.map((c) => [c.label, c.under])),
  );
  check(
    "…its rows, columns and total, its Send to Import; no line of sheets above it",
    /2 rows · 3 columns/.test(cards[0]?.text ?? "") && (cards[0]?.text ?? "").includes("5140.00") && cards[0]?.imports === 1 && !shown.includes("each read and counted on its own") && !(cards[0]?.text ?? "").includes("Sheet2"),
    (cards[0]?.text ?? "").slice(0, 140),
  );
  check("the message box names the file and its sheet", (await chipOf(page)) === `${OLD} — Sheet1`, await chipOf(page));

  script = [{ ...plain("EMPTYQA 5,140 taka, two payments."), importPlan: PLAN }];
  const answered = page.waitForResponse((r) => r.url().endsWith("/ai/turn") && r.request().method() === "POST", { timeout: 60000 });
  await paste(page, "EMPTYQA ei file ta boi te tulo");
  await page.keyboard.press("Enter");
  await answered;
  await page.waitForFunction(() => document.body.innerText.includes("EMPTYQA two payments from Sheet1."), { timeout: 30000 }).catch(() => undefined);
  cards = await cardsOn(page, OLD);
  await shot(page, "empty-old-plan");
  check(
    "the plan on the card, as for one file: its note and the account it goes into",
    (cards[0]?.text ?? "").includes("EMPTYQA two payments from Sheet1.") && (cards[0]?.text ?? "").includes("Into EMPTYQA Cash, filed as EMPTYQA Courier") && cards[0]?.under === "Sheet2, Sheet3: empty",
    (cards[0]?.text ?? "").slice(0, 220),
  );

  const reopenPage = await openAs(admin);
  await reopenPage.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await reopenPage.evaluate(() => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim().startsWith("EMPTYQA ei file ta boi te tulo"))?.click());
  await reopenPage.waitForFunction(() => document.body.innerText.includes("Sheet2, Sheet3: empty"), { timeout: 30000 }).catch(() => undefined);
  const again = await cardsOn(reopenPage, OLD);
  check(
    "reopened from History: the one card and its line of empty sheets",
    again.length === 1 && again[0].label === `${OLD} — Sheet1` && again[0].under === "Sheet2, Sheet3: empty",
    JSON.stringify(again.map((c) => [c.label, c.under])),
  );

  const phone = await openAs(admin, 390);
  await phone.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  // A name of an ordinary length fits whole. A longer one is cut with an
  // ellipsis, as any file's card always was, its whole name on hover.
  await attachOn(phone, oldFile);
  await phone.waitForFunction(() => document.body.innerText.includes("Sheet2, Sheet3: empty"), { timeout: 30000 }).catch(() => undefined);
  const heading = await phone.evaluate((prefix) => {
    const p = [...document.querySelectorAll("div.rounded-xl p.truncate")].find((el) => el.title.startsWith(prefix));
    return p ? { label: p.textContent, cut: p.scrollWidth > p.clientWidth } : null;
  }, OLD);
  check("at 390px the card's heading, the file and its sheet, fits whole", heading?.label === `${OLD} — Sheet1` && heading.cut === false, JSON.stringify(heading));

  await attachOn(phone, wideFile);
  await phone.waitForFunction(() => document.body.innerText.includes("E24: empty"), { timeout: 30000 }).catch(() => undefined);
  const fit = await phone.evaluate((prefix) => {
    const scroller = [...document.querySelectorAll("div")].find((div) => getComputedStyle(div).overflowY === "auto" && div.scrollHeight > div.clientHeight);
    const card = [...document.querySelectorAll("div.rounded-xl")].find((c) => c.querySelector("p.truncate")?.title.startsWith(prefix));
    const line = card?.nextElementSibling;
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      inner: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
      card: card ? Math.round(card.getBoundingClientRect().right) : null,
      line: line ? Math.round(line.getBoundingClientRect().right) : null,
      lines: line ? Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight)) : 0,
      label: card?.querySelector("p.truncate")?.textContent,
      cards: document.querySelectorAll("div.rounded-xl p.truncate").length,
      width: window.innerWidth,
    };
  }, WIDE);
  await shot(phone, "empty-wide-390");
  check(
    "at 390px, 24 empty sheets: the card and the line fit, the line wraps, nothing scrolls sideways",
    fit.cards === 1 && fit.label === `${WIDE} — Data (hidden)` && fit.card !== null && fit.card <= fit.width && fit.line !== null && fit.line <= fit.width && fit.lines > 1 && fit.page <= 0 && fit.inner <= 0,
    JSON.stringify(fit),
  );
  check("no page error", [page, reopenPage, phone].every((p) => p.errors.length === 0), [...page.errors, ...reopenPage.errors, ...phone.errors].slice(0, 2).join(" | "));
} catch (error) {
  results.push(false);
  console.log(`  FAIL  the run stopped: ${error?.stack ?? error}`);
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
  fs.rmSync(scratch, { recursive: true, force: true });
  const [left] = await q(
    `select (select count(*) from ai_attachments where filename like 'EMPTYQA%')::int as attachments,
            (select count(*) from ai_chats where title like 'EMPTYQA%')::int as chats,
            (select count(*) from import_batches where filename like 'EMPTYQA%')::int as batches,
            (select anthropic_api_key is not distinct from $1 and google_service_account is not distinct from $2 from app_settings where id = 1) as keys_back`,
    [before.anthropic_api_key, before.google_service_account],
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
