/**
 * An Excel workbook read whole, in the Assistant: every sheet, each on its own.
 * docs/briefs/2026-10-02-assistant-powerful.md, piece A3c.
 *
 * Neither Google nor a model is asked here. Two stand-ins answer instead, as
 * in .assistantlinkqa.mjs: a local server for *.googleapis.com (the API this
 * script starts is preloaded to send Google's requests there), and a stand-in
 * for Anthropic's API.
 *
 * What is measured:
 *   A. the endpoint: a workbook attached with the paperclip's endpoint comes
 *      back as every sheet, in its order, each counted on its own, an empty
 *      hidden one kept and said to be so, in one statement; one sheet and a
 *      CSV as before; too many sheets, no rows, too many rows refused in words
 *      with nothing kept; an .xlsx in Drive, and one opened in Sheets with a
 *      tab's link, read the same way; Send to Import on a sheet stages that
 *      sheet alone; a role without the Assistant refused;
 *   B. what the model is told: each sheet as FILE 1, FILE 2, FILE 3 with its
 *      own totals, worked as a workbook's sheets (never added together), the
 *      empty one empty, the tools asking which file, no plan for Import, the
 *      sheets back in order when the conversation is reopened; one sheet
 *      worked as a file, as before;
 *   C. the page: the paperclip, a card a sheet under a line naming the
 *      workbook, each headed by its sheet; the empty one said to be so; the
 *      message carried every sheet; one removed alone; reopened from History;
 *      one sheet's card as before; a phone's width.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantexcelqa.mjs                 (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantexcelqa.mjs  also saves screenshots
 *
 * Starts its own API on :4018, so the dev API on :4001 is left alone. Puts a
 * made-up Anthropic key and a made-up Google key in the local app_settings
 * while it runs and puts back what was there. Everything it makes carries
 * XLSQA and is deleted at the end.
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
const PORT = 4018;
const API = `http://localhost:${PORT}/api`;
const MODEL_PORT = 4594;
const GOOGLE_PORT = 4595;
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
/** The paperclip's endpoint, multipart, as the page sends it. */
const uploadAs = (bearer) => async (name, buffer, type = XLSX_TYPE) => {
  const body = new FormData();
  body.append("file", new Blob([buffer], { type }), name);
  const res = await fetch(`${API}/ai/attachments`, { method: "POST", headers: { Authorization: `Bearer ${bearer}`, "X-Requested-With": "finance-web" }, body });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const upload = uploadAs(tokenFor(admin));

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
// A mixed book, as the owner's boss keeps them: money on one sheet, people
// on the next, and an empty sheet somebody hid.
const MIXED = [
  { name: "Payments", rows: [["Date", "Paid to", "Amount"], ["03/09/2026", "XLSQA Hostinger", 4500], [], ["19/09/2026", "XLSQA Courier", 640]] },
  { name: "People", rows: [["Name", "Joined", "Salary"], ["XLSQA Rahim", "01/06/2026", 45000]] },
  { name: "Notes", rows: [], state: "hidden" },
];
const MIXED_BYTES = await workbook(MIXED);
const ONE_BYTES = await workbook([MIXED[0]]);

/* ------------------------------------------------------------------------ */
/*  A stand-in for Google                                                    */
/* ------------------------------------------------------------------------ */

const DRIVE_ID = "1XlsqaDriveXlsqaDriveXlsqaDrive0001";
const OPENED_ID = "1XlsqaOpenedXlsqaOpenedXlsqaOpenedXlsqa000002";
const DRIVE_URL = `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`;
const OPENED_TAB_URL = `https://docs.google.com/spreadsheets/d/${OPENED_ID}/edit#gid=1234567`;

const googleAsked = [];
const google = http.createServer((req, res) => {
  const url = new URL(req.url, "http://stand-in");
  googleAsked.push(`${url.pathname}${url.search}`);
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const p = decodeURIComponent(url.pathname);
  // An .xlsx opened in Sheets without being converted: the Sheets API will
  // not read it, and says so in these words.
  if (p.startsWith(`/sheets.googleapis.com/v4/spreadsheets/${OPENED_ID}`)) {
    return send(400, { error: { code: 400, message: "This operation is not supported for this document", status: "FAILED_PRECONDITION" } });
  }
  const drive = /^\/www.googleapis.com\/drive\/v3\/files\/([^/]+)$/.exec(p);
  if (drive && [DRIVE_ID, OPENED_ID].includes(drive[1])) {
    if (url.searchParams.get("alt") === "media") {
      res.writeHead(200, { "content-type": XLSX_TYPE });
      return res.end(MIXED_BYTES);
    }
    const name = drive[1] === DRIVE_ID ? "XLSQA Drive book.xlsx" : "XLSQA Opened in Sheets.xlsx";
    return send(200, { id: drive[1], name, mimeType: XLSX_TYPE, size: String(MIXED_BYTES.length) });
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
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_xlsqa" });
    res.end(JSON.stringify({ id: "msg_xlsqa", type: "message", role: "assistant", model: "claude-opus-5", content: [use], stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((resolve) => model.listen(MODEL_PORT, "127.0.0.1", resolve));
const plain = (summary) => ({ target: null, draft: {}, missingFields: [], summary });
const toolsOf = (request) => (request?.tools ?? []).map((tool) => tool.name);
const everything = (request) => JSON.stringify(request ?? {});

/* ------------------------------------------------------------------------ */
/*  The API, preloaded to ask the stand-in Google                            */
/* ------------------------------------------------------------------------ */

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "xlsqa-"));
const preload = path.join(scratch, "preload.cjs");
fs.writeFileSync(
  preload,
  `// Written by .assistantexcelqa.mjs for one run, and deleted after it.
const { GoogleAuth } = require(require.resolve("google-auth-library", { paths: [${JSON.stringify(path.resolve("apps/api"))}] }));
GoogleAuth.prototype.getAccessToken = async function () { return "ya29.xlsqa"; };
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
  project_id: "sfm-xlsqa",
  private_key_id: "0000000000000000000000000000000000000000",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  client_email: "sfm-xlsqa@sfm-xlsqa.iam.gserviceaccount.com",
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
  await db.query(`delete from ai_chats where title like 'XLSQA%'`);
  await db.query(`delete from ai_attachments where filename like 'XLSQA%'`);
  await db.query(`delete from import_batches where filename like 'XLSQA%'`);
};
const keptCount = async () => (await q(`select count(*)::int as n from ai_attachments where filename like 'XLSQA%'`))[0].n;
const total = (file, column) => file?.columns?.find((c) => c.name === column)?.total;
const BOOK = "XLSQA Book 2026.xlsx";
const NAMES = [`${BOOK} — Payments (sheet 1 of 3)`, `${BOOK} — People (sheet 2 of 3)`, `${BOOK} — Notes (sheet 3 of 3, hidden)`];

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
    [seal("sk-ant-xlsqa-0000000000000000000000"), admin.id, seal(JSON.stringify(KEY))],
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA. The endpoint");
  const book = await upload(BOOK, MIXED_BYTES);
  check(
    "a workbook of three sheets: every sheet, a file each, in the workbook's order, each named with its place",
    book.status === 200 && Array.isArray(book.body) && book.body.map((f) => f.name).join(" | ") === NAMES.join(" | "),
    `${book.status} ${Array.isArray(book.body) ? book.body.map((f) => f.name).join(" | ") : book.body?.message}`,
  );
  check(
    "…each counted on its own: Payments 2 rows ৳5,140 (the blank row skipped); People 1 row, ৳45,000",
    book.body?.[0]?.rowCount === 2 && total(book.body?.[0], "Amount") === "5140.00" && book.body?.[1]?.rowCount === 1 && total(book.body?.[1], "Salary") === "45000.00" && !book.body?.[0]?.columns?.some((c) => c.name === "Salary"),
    JSON.stringify(book.body?.map?.((f) => [f.rowCount, f.columns.map((c) => c.name).join("/")])),
  );
  check(
    "…the empty sheet, hidden, kept with no rows and no columns",
    book.body?.[2]?.rowCount === 0 && book.body?.[2]?.columns?.length === 0 && book.body?.[2]?.kind === "table",
    JSON.stringify(book.body?.[2] && { rows: book.body[2].rowCount, columns: book.body[2].columns.length }),
  );
  check("…the dates read day-first, as the column shows", book.body?.[0]?.columns?.find((c) => c.name === "Date")?.dateOrder === "dmy");
  const keptBook = await q(`select user_id, filename, total_rows, created_at, chat_id from ai_attachments where id = any($1::uuid[])`, [book.body?.map?.((f) => f.id) ?? []]);
  check(
    "…kept as the asker's own, in one statement (one moment, which is how a reopened chat knows them for one workbook)",
    keptBook.length === 3 && keptBook.every((row) => row.user_id === admin.id) && new Set(keptBook.map((row) => row.created_at.toISOString())).size === 1,
    JSON.stringify(keptBook.map((row) => [row.filename.slice(BOOK.length + 3), row.total_rows])),
  );

  const one = await upload("XLSQA Bank July.xlsx", ONE_BYTES);
  check(
    "a workbook of one sheet: one file, named by the file alone, as before",
    one.status === 200 && Array.isArray(one.body) && one.body.length === 1 && one.body[0].name === "XLSQA Bank July.xlsx" && one.body[0].rowCount === 2 && total(one.body[0], "Amount") === "5140.00",
    `${one.status} ${JSON.stringify(one.body?.map?.((f) => [f.name, f.rowCount]) ?? one.body?.message)}`,
  );
  const csv = await upload("XLSQA bank.csv", Buffer.from("Date,Narration,Debit\n01/07/2026,XLSQA rent,25000\n02/07/2026,XLSQA tea,350\n"), "text/csv");
  check(
    "a CSV: one file, as before",
    csv.status === 200 && csv.body?.length === 1 && csv.body[0].name === "XLSQA bank.csv" && total(csv.body[0], "Debit") === "25350.00",
    `${csv.status} ${JSON.stringify(csv.body?.map?.((f) => [f.name, f.rowCount]) ?? csv.body?.message)}`,
  );

  const keptBefore = await keptCount();
  const many = await upload("XLSQA Many.xlsx", await workbook(Array.from({ length: 21 }, (_, at) => ({ name: `S${at + 1}`, rows: [["Amount"], [1]] }))));
  check(
    "21 sheets: refused, saying how many it reads and what to do",
    many.status === 400 && (many.body?.message ?? "").startsWith('"XLSQA Many.xlsx" has 21 sheets. The Assistant reads up to 20 at once: copy the sheets you mean into a workbook of their own'),
    `${many.status} ${many.body?.message}`,
  );
  const blank = await upload("XLSQA Blank.xlsx", await workbook([{ name: "A", rows: [["Amount"]] }, { name: "B", rows: [] }]));
  check(
    "no rows under a heading on any sheet: refused",
    blank.status === 400 && blank.body?.message === '"XLSQA Blank.xlsx" has no rows under a heading row on any of its 2 sheets.',
    `${blank.status} ${blank.body?.message}`,
  );
  const rows = Array.from({ length: 6000 }, (_, at) => [at + 1]);
  const big = await upload("XLSQA Big.xlsx", await workbook([{ name: "A", rows: [["Amount"], ...rows] }, { name: "B", rows: [["Amount"], ...rows] }]));
  check(
    "12,000 rows across two sheets: refused, not cut short",
    big.status === 400 && (big.body?.message ?? "").startsWith('"XLSQA Big.xlsx" has 12,000 rows across its 2 sheets. The Assistant reads up to 10,000 at once'),
    `${big.status} ${big.body?.message}`,
  );
  check("…and nothing of the three refused was kept", (await keptCount()) === keptBefore, `${keptBefore} → ${await keptCount()}`);

  const drive = await call("POST", "/ai/attachments/link", { url: DRIVE_URL });
  check(
    "an .xlsx kept in Drive, by its link: every sheet, as the upload reads it",
    drive.status === 200 &&
      drive.body?.map?.((f) => `${f.name}:${f.rowCount}`).join(" | ") ===
        "XLSQA Drive book.xlsx — Payments (sheet 1 of 3):2 | XLSQA Drive book.xlsx — People (sheet 2 of 3):1 | XLSQA Drive book.xlsx — Notes (sheet 3 of 3, hidden):0",
    `${drive.status} ${Array.isArray(drive.body) ? drive.body.map((f) => `${f.name}:${f.rowCount}`).join(" | ") : drive.body?.message}`,
  );
  const opened = await call("POST", "/ai/attachments/link", { url: OPENED_TAB_URL });
  check(
    "an .xlsx opened in Sheets, by a tab's link: every sheet, named by the file (the tab cannot be matched), no '(first sheet)'",
    opened.status === 200 &&
      opened.body?.map?.((f) => f.name).join(" | ") === "XLSQA Opened in Sheets.xlsx — Payments (sheet 1 of 3) | XLSQA Opened in Sheets.xlsx — People (sheet 2 of 3) | XLSQA Opened in Sheets.xlsx — Notes (sheet 3 of 3, hidden)",
    `${opened.status} ${Array.isArray(opened.body) ? opened.body.map((f) => f.name).join(" | ") : opened.body?.message}`,
  );

  const staged = await call("POST", `/ai/attachments/${book.body?.[1]?.id}/to-import`, { plan: null });
  const [batch] = await q(`select filename, total_rows from import_batches where id = $1`, [staged.body?.batchId ?? "00000000-0000-4000-8000-000000000000"]);
  const [stagedRow] = await q(`select raw from import_rows where batch_id = $1`, [staged.body?.batchId ?? "00000000-0000-4000-8000-000000000000"]);
  check(
    "Send to Import on the People sheet stages that sheet's one row alone, nothing from Payments",
    staged.status === 200 && batch?.filename === NAMES[1] && batch?.total_rows === 1 && stagedRow?.raw?.Name === "XLSQA Rahim",
    `${staged.status} ${JSON.stringify(batch)} ${JSON.stringify(stagedRow?.raw)}`,
  );
  if (finance) {
    const barred = await uploadAs(tokenFor(finance))("XLSQA Barred.xlsx", MIXED_BYTES);
    check("a role without the Assistant is refused", barred.status === 403, String(barred.status));
  }

  /* ------------------------------------------------------------------ */
  console.log("\nB. What the model is told");
  const ids = book.body?.map?.((f) => f.id) ?? [];
  script = [
    { tool: "read_attachment", input: { file: 2, offset: 0, limit: 5 } },
    { tool: "group_attachment", input: { file: 1, by: "Paid to", sum: "Amount" } },
    { tool: "read_attachment", input: { offset: 0 } },
    { ...plain("XLSQA Payments 5,140; People 45,000."), importPlan: { accountName: "XLSQA", columnMap: { Amount: "amount" }, dateFormat: "dmy" } },
  ];
  let from = asked.length;
  const turn = await call("POST", "/ai/turn", { messages: [{ role: "user", content: "XLSQA ei file e koto?" }], attachmentIds: ids });
  const request = asked[from];
  const told = everything(request);
  check(
    "each sheet described on its own, FILE 1 to FILE 3, each with its own total",
    turn.status === 200 && NAMES.every((name, at) => told.includes(`FILE ${at + 1} ATTACHED: ${name}`)) && told.includes("total 5140.00") && told.includes("total 45000.00"),
    `${turn.status} ${turn.body?.message ?? ""}`,
  );
  check(
    "…worked as a workbook's sheets: never added together, never assumed alike, counted sheet by sheet",
    told.includes("WORKING FROM A WORKBOOK'S SHEETS") &&
      told.includes("every one was read: 3 sheets") &&
      told.includes("Never add one sheet's figures to another's") &&
      told.includes("never assume a sheet is like the one before it") &&
      told.includes("the workbook was counted sheet by sheet") &&
      !told.includes("WORKING FROM A SHEET'S TABS") &&
      !told.includes("WORKING FROM A FILE"),
  );
  check("…the empty sheet told as empty, in the word for it", told.includes(`FILE 3 ATTACHED: ${NAMES[2]}\\nThis sheet is empty`));
  check(
    "…and told, once, that a workbook of several sheets arrives a FILE a sheet",
    told.includes("An Excel workbook of several\\n  sheets, attached or kept in Drive, arrives the same way, a FILE a sheet."),
  );
  const fileTools = (request?.tools ?? []).filter((tool) => ["read_attachment", "group_attachment"].includes(tool.name));
  check(
    "each file tool asks which file, by its number",
    fileTools.length === 2 && fileTools.every((tool) => tool.input_schema?.properties?.file?.type === "number" && tool.input_schema?.required?.[0] === "file"),
    JSON.stringify(fileTools.map((tool) => [tool.name, tool.input_schema?.required])),
  );
  const lastResult = (sent) =>
    (sent?.messages?.at(-1)?.content ?? [])
      .filter?.((part) => part.type === "tool_result")
      ?.map((part) => (typeof part.content === "string" ? part.content : JSON.stringify(part.content)))
      .join("\n") ?? "";
  const toolResults = [1, 2, 3].map((n) => lastResult(asked[from + n]));
  check("read_attachment on FILE 2 reads People alone, and says which file", toolResults[0].includes("FILE 2: Rows 1–1 of 1") && toolResults[0].includes("XLSQA Rahim") && !toolResults[0].includes("Hostinger"), toolResults[0].match(/FILE 2[^"]{0,60}/)?.[0]);
  check("group_attachment on FILE 1 totals Payments alone", toolResults[1].includes("FILE 1: Grouped by Paid to, totalling Amount") && toolResults[1].includes("XLSQA Hostinger: 1 row, 4500.00") && !toolResults[1].includes("Rahim"), toolResults[1].match(/FILE 1[^"]{0,90}/)?.[0]);
  check("…with no file named, it is asked to say which", toolResults[2].includes("Say which file, by its number: 1 to 3."), toolResults[2].match(/Say which[^"]{0,40}/)?.[0]);
  check("a plan for Import made of several sheets is dropped", turn.body?.importPlan === null || turn.body?.importPlan === undefined, JSON.stringify(turn.body?.importPlan));
  const reopened = await call("GET", `/ai/chats/${turn.body?.chatId}`);
  check(
    "the conversation reopened: the three sheets, in the workbook's order",
    reopened.status === 200 && reopened.body?.attachments?.map((f) => f.id).join(",") === ids.join(","),
    JSON.stringify(reopened.body?.attachments?.map((f) => f.name)),
  );

  script = [plain("XLSQA July 5,140.")];
  from = asked.length;
  const oneTurn = await call("POST", "/ai/turn", { messages: [{ role: "user", content: "XLSQA eta koto?" }], attachmentIds: [one.body?.[0]?.id] });
  const oneTold = everything(asked[from]);
  check(
    "a workbook of one sheet: FILE ATTACHED, worked as a file, as before",
    oneTurn.status === 200 && oneTold.includes("FILE ATTACHED: XLSQA Bank July.xlsx") && oneTold.includes("WORKING FROM A FILE") && !oneTold.includes("WORKING FROM A WORKBOOK'S SHEETS"),
    String(oneTurn.status),
  );

  /* ------------------------------------------------------------------ */
  console.log("\nC. The page");
  const bookFile = path.join(scratch, BOOK);
  const oneFile = path.join(scratch, "XLSQA Bank July.xlsx");
  fs.writeFileSync(bookFile, MIXED_BYTES);
  fs.writeFileSync(oneFile, ONE_BYTES);

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
  /** The paperclip: the file picked, and the endpoint's answer. */
  const attachOn = async (page, file) => {
    const input = await page.$('input[type="file"]');
    if (!input) throw new Error(`The paperclip's file input is not on the page, at ${page.url()}: ${(await page.evaluate(() => document.body.innerText)).slice(0, 300).replace(/\n/g, " | ")}`);
    // Never left pending unhandled: a page closed mid-wait must not end the
    // run before its settings are put back.
    const answered = page.waitForResponse((r) => r.url().endsWith("/ai/attachments") && r.request().method() === "POST", { timeout: 60000 }).catch(() => null);
    await input.uploadFile(file);
    return (await answered)?.json().catch(() => null) ?? null;
  };
  const cardsOn = (page, prefix) =>
    page.evaluate(
      (prefix) =>
        [...document.querySelectorAll("div.rounded-xl")]
          .filter((card) => card.querySelector("p.truncate")?.title.startsWith(prefix))
          .map((card) => ({ name: card.querySelector("p.truncate").title, label: card.querySelector("p.truncate").textContent, text: card.innerText.replace(/\s+/g, " "), imports: [...card.querySelectorAll("button")].filter((b) => b.textContent.includes("Send to Import")).length })),
      prefix,
    );
  const chipOf = (page) => page.evaluate(() => document.querySelector("form .truncate")?.textContent ?? "");

  const page = await openAs(admin);
  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  const attached = await attachOn(page, bookFile);
  await page.waitForFunction(() => document.body.innerText.includes("each read and counted on its own"), { timeout: 30000 }).catch(() => undefined);
  let cards = await cardsOn(page, BOOK);
  let shown = await text(page);
  await shot(page, "excel-book");
  check(
    "the paperclip: a card a sheet, in the workbook's order, under one line naming the workbook; each card headed by its sheet alone",
    cards.map((c) => c.name).join(" | ") === NAMES.join(" | ") &&
      cards.map((c) => c.label).join(" | ") === "Payments (sheet 1 of 3) | People (sheet 2 of 3) | Notes (sheet 3 of 3, hidden)" &&
      shown.includes(`${BOOK} · 3 sheets, each read and counted on its own`),
    `${cards.map((c) => c.label).join(" | ")} · ${shown.slice(0, 160).replace(/\n/g, " | ")}`,
  );
  check(
    "…each with its own rows, columns and totals: Payments 2 rows ৳5,140; People 1 row, its salary",
    /2 rows · 3 columns/.test(cards[0]?.text ?? "") && (cards[0]?.text ?? "").includes("5140.00") && /1 rows · 3 columns/.test(cards[1]?.text ?? "") && (cards[1]?.text ?? "").includes("45000.00") && !(cards[0]?.text ?? "").includes("45000.00"),
    cards.slice(0, 2).map((c) => c.text.slice(0, 120)).join(" || "),
  );
  check(
    "…the empty sheet said to be empty, with no Send to Import; the others have their own",
    (cards[2]?.text ?? "").includes("Empty: no rows under a heading row, so nothing was read") && cards[2]?.imports === 0 && cards[0]?.imports === 1 && cards[1]?.imports === 1,
    JSON.stringify(cards.map((c) => c.imports)),
  );
  check("the message box names the workbook and its sheets", (await chipOf(page)) === `${BOOK} · 3 sheets`, await chipOf(page));

  script = [plain("XLSQA tin ta sheet.")];
  const pageAnswered = page.waitForResponse((r) => r.url().endsWith("/ai/turn") && r.request().method() === "POST", { timeout: 60000 });
  await paste(page, "XLSQA ei workbook ta dekho");
  await page.keyboard.press("Enter");
  await pageAnswered;
  await page.waitForFunction(() => document.body.innerText.includes("XLSQA tin ta sheet."), { timeout: 30000 }).catch(() => undefined);
  const turnBody = JSON.parse(page.sent.find((s) => s.path === "/ai/turn")?.body || "{}");
  check(
    "the message carried every sheet, in order",
    Array.isArray(attached) && turnBody.attachmentIds?.length === 3 && turnBody.attachmentIds.join(",") === attached.map((f) => f.id).join(","),
    JSON.stringify(turnBody.attachmentIds),
  );

  const removed = page.waitForResponse((r) => r.url().includes("/ai/attachments/") && r.request().method() === "DELETE", { timeout: 30000 });
  await page.evaluate((name) => {
    const card = [...document.querySelectorAll("div.rounded-xl")].find((c) => c.querySelector("p.truncate")?.title === name);
    card?.querySelector('button[aria-label="Remove this file"]')?.click();
  }, NAMES[1]);
  await removed;
  await page.waitForFunction(() => !document.body.innerText.includes("People (sheet 2 of 3)"), { timeout: 10000 }).catch(() => undefined);
  cards = await cardsOn(page, BOOK);
  const [{ left: peopleLeft }] = await q(`select count(*)::int as left from ai_attachments where id = $1`, [attached?.[1]?.id]);
  check(
    "one sheet's cross removes that sheet alone, its rows too; the box says one sheet fewer",
    cards.map((c) => c.name).join(" | ") === `${NAMES[0]} | ${NAMES[2]}` && peopleLeft === 0 && (await chipOf(page)) === `${BOOK} · 2 sheets`,
    `${cards.map((c) => c.label).join(" | ")} · left ${peopleLeft} · ${await chipOf(page)}`,
  );

  const reopenPage = await openAs(admin);
  await reopenPage.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await reopenPage.evaluate(() => [...document.querySelectorAll("button, a")].find((b) => b.textContent.trim().startsWith("XLSQA ei workbook ta dekho"))?.click());
  await reopenPage.waitForFunction(() => document.body.innerText.includes("Notes (sheet 3 of 3, hidden)"), { timeout: 30000 }).catch(() => undefined);
  const reopenShown = await text(reopenPage);
  check(
    "reopened from History: the sheets that are left, as cards, in order",
    reopenShown.includes(`${BOOK} · 2 sheets, each read and counted on its own`) &&
      reopenShown.indexOf("Payments (sheet 1 of 3)") > -1 &&
      reopenShown.indexOf("Payments (sheet 1 of 3)") < reopenShown.indexOf("Notes (sheet 3 of 3, hidden)") &&
      !reopenShown.includes("People (sheet 2 of 3)"),
    reopenShown.slice(0, 200).replace(/\n/g, " | "),
  );

  const onePage = await openAs(admin);
  await onePage.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await attachOn(onePage, oneFile);
  await onePage.waitForFunction(() => document.body.innerText.includes("XLSQA Bank July.xlsx"), { timeout: 30000 }).catch(() => undefined);
  const oneCards = await cardsOn(onePage, "XLSQA Bank July");
  const oneShown = await text(onePage);
  await shot(onePage, "excel-one");
  check(
    "a workbook of one sheet: one card, named by the file, no line of sheets, as before",
    oneCards.length === 1 && oneCards[0].label === "XLSQA Bank July.xlsx" && oneCards[0].imports === 1 && !oneShown.includes("each read and counted on its own") && (await chipOf(onePage)) === "XLSQA Bank July.xlsx",
    `${oneCards.map((c) => c.label).join(" | ")} · ${await chipOf(onePage)}`,
  );
  check("no page error", [page, reopenPage, onePage].every((p) => p.errors.length === 0), [...page.errors, ...reopenPage.errors, ...onePage.errors].slice(0, 2).join(" | "));

  const phone = await openAs(admin, 390);
  await phone.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await attachOn(phone, bookFile);
  await phone.waitForFunction(() => document.body.innerText.includes("each read and counted on its own"), { timeout: 30000 }).catch(() => undefined);
  const fit = await phone.evaluate((prefix) => {
    const scroller = [...document.querySelectorAll("div")].find((div) => getComputedStyle(div).overflowY === "auto" && div.scrollHeight > div.clientHeight);
    const cards = [...document.querySelectorAll("div.rounded-xl")].filter((card) => card.querySelector("p.truncate")?.title.startsWith(prefix));
    // A heading too long for its card is cut with an ellipsis: the sheet's
    // own name and place must fit whole at a phone's width.
    const cut = cards.map((card) => card.querySelector("p.truncate")).filter((p) => p.scrollWidth > p.clientWidth).map((p) => p.textContent);
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, inner: scroller ? scroller.scrollWidth - scroller.clientWidth : 0, cards: cards.length, over: cards.filter((card) => card.getBoundingClientRect().right > window.innerWidth).length, cut };
  }, BOOK);
  await shot(phone, "excel-book-390");
  check("at 390px the three sheet cards fit, each sheet's name whole, and nothing scrolls sideways", fit.cards === 3 && fit.over === 0 && fit.cut.length === 0 && fit.page <= 0 && fit.inner <= 0 && phone.errors.length === 0, JSON.stringify(fit));
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
    `select (select count(*) from ai_attachments where filename like 'XLSQA%')::int as attachments,
            (select count(*) from ai_chats where title like 'XLSQA%')::int as chats,
            (select count(*) from import_batches where filename like 'XLSQA%')::int as batches,
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
