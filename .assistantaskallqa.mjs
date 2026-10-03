/**
 * Every field asked at once — docs/briefs/2026-10-04-assistant-asks-everything-and-b3.md,
 * piece 1 (4 Oct 2026).
 *
 * The owner had the Assistant buy a Claude plan; the plan was saved and its
 * row on AI tools and subscriptions read "N/A" for Invoice, Reference, Login
 * accounts, User name and User department. Nobody had asked. This measures
 * what the app now does, with a stand-in for the model:
 *
 *   A. the API: a plan's draft lists the five, by the page's headings, once
 *      Save has what it needs; what Save still needs comes first; a choice
 *      between two people is asked on its own; "skip" leaves one empty and
 *      it is not asked again, and "skip" as the whole answer leaves them all;
 *      an invoice attached is read for its number, which goes in invoiceNo,
 *      and asked for when it cannot be read; a payment asks Invoice and
 *      Reference, a new person Team's four columns;
 *   B. Confirm through the API: the people found on Team are on the plan;
 *   C. the page: the list in the chat, the card showing every field empty
 *      and Confirm held until each is answered or left empty, the invoice
 *      attached in the chat, Confirm, and the plan's row with no N/A in
 *      those five columns; a second plan with Reference skipped in the
 *      chat, and its row with N/A there alone; Leave empty on the card;
 *      390px.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantaskallqa.mjs                (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantaskallqa.mjs  also saves screenshots
 *
 * Starts its own API on :4018 pointed at the stand-in, so the dev API on
 * :4001 is left alone. Puts a made-up Anthropic key in the local
 * app_settings while it runs and puts back what was there. Everything it
 * makes is named ASKALLQA and deleted afterwards — plans, their payments and
 * invoices, two people, its chats — and it prints what is left (nothing).
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

const WEB = "http://localhost:3000";
const DEV_API = "http://localhost:4001";
const PORT = 4018;
const API = `http://localhost:${PORT}/api`;
const STUB_PORT = 4598;
const SHOTS = process.env.SHOT_DIR || null;
/** The list's last line (worth-asking.ts). */
const SKIP_LINE = "Say skip for any you want left empty.";
const READY = "Draft ready — check every line, then press Confirm and save. Nothing is recorded yet.";

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

const [admin] = await q(`select id, role, full_name, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`);
if (!admin) throw new Error("The local books need an active super_admin.");
const token = jwt.sign({ sub: admin.id, role: admin.role, tv: admin.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const call = async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const upload = async (p, name, bytes, type) => {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  const res = await fetch(`${API}${p}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web" }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const accounts = await q(
  `select a.id, a.name, a.currency,
          (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null and t.deleted_at is null), 0))::numeric as balance
     from accounts a left join transactions t on t.account_id = a.id
    where a.is_active and a.deleted_at is null group by a.id order by a.name`,
);
const CARD = accounts.filter((a) => a.currency !== "USD").sort((a, b) => Number(b.balance) - Number(a.balance))[0];
if (!CARD || Number(CARD.balance) < 10000) throw new Error("The local books need a taka account holding 10,000.");

/** A 1×1 PNG, and a one-line PDF: what the files module will take as a picture and a PDF. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "askallqa-"));
const PNG_FILE = path.join(tmp, "askallqa-invoice.png");
fs.writeFileSync(PNG_FILE, PNG);

/* ------------------------------------------------------------------------ */
/*  A stand-in for the model: it says what it is told to                     */
/* ------------------------------------------------------------------------ */

let answer = null;
let paper = { isInvoice: true, number: "INV-ASK-7", seller: "Anthropic", total: "10.00", currency: "USD", date: today };
const asked = [];
const stub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const request = JSON.parse(raw || "{}");
    asked.push(request);
    if (request.stream) {
      // The invoice is read through a stream, as a statement is.
      res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_askallqa" });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send("message_start", { type: "message_start", message: { id: "msg_askallqa_doc", type: "message", role: "assistant", model: "claude-opus-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
      send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_doc", name: "invoice_fields", input: {} } });
      send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(paper) } });
      send("content_block_stop", { type: "content_block_stop", index: 0 });
      send("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } });
      send("message_stop", { type: "message_stop" });
      res.end();
      return;
    }
    const input = answer ?? { draft: {}, missingFields: [], summary: "(the harness gave no answer)" };
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_askallqa" });
    res.end(
      JSON.stringify({
        id: "msg_askallqa",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "tool_use", id: `toolu_${asked.length}`, name: "answer", input }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
});
await new Promise((resolve) => stub.listen(STUB_PORT, "127.0.0.1", resolve));

const made = { chats: new Set() };
async function turn(text, says, more = {}) {
  answer = says;
  const messages = more.messages ?? [{ role: "user", content: text }];
  const res = await call("POST", "/ai/turn", { messages, ...more, messages });
  if (res.body?.chatId) made.chats.add(res.body.chatId);
  if (res.status !== 200) console.log(`  (the turn "${text.slice(0, 40)}" answered ${res.status}: ${JSON.stringify(res.body)})`);
  return res;
}
/** The system prompt the stand-in was last sent, both halves. */
const lastSystem = () => (asked.filter((r) => !r.stream).at(-1)?.system ?? []).map((block) => block.text).join("\n");
const labels = (reply) => (reply?.open ?? []).map((field) => field.label);

/** A plan with everything Save needs. */
const plan = (tool, more = {}) => ({
  area: "subscriptions",
  target: "subscription",
  draft: { toolName: tool, planName: "Max", category: "ai_tool", costUsd: "10.00", usdRate: "122.00", startDate: today, accountName: CARD.name, ...more },
  missingFields: [],
  nextQuestion: `${tool} Max, $10 — card theke.`,
});
const FIVE = ["Login accounts", "User Name", "User Department", "Invoice", "Reference"];

/* ------------------------------------------------------------------------ */

const seal = (plaintext) => {
  const source = env.SECRET_ENCRYPTION_KEY?.trim() || env.JWT_REFRESH_SECRET?.trim();
  const key = createHash("sha256").update(source, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
};
const [before] = await q(`select ai_provider, ai_model, ai_data_access, anthropic_api_key, anthropic_key_set_at, anthropic_key_set_by from app_settings where id = 1`);

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

/** Everything this run makes, taken out again — the invoices through the API, so their bytes go too. */
async function sweep() {
  const files = await q(`select f.id from files f join subscriptions s on s.id = f.subscription_id where s.tool_name like 'ASKALLQA%'`);
  for (const file of files) await call("DELETE", `/files/${file.id}`).catch(() => undefined);
  await db.query(`delete from transactions where subscription_id in (select id from subscriptions where tool_name like 'ASKALLQA%')`);
  await db.query(`delete from subscriptions where tool_name like 'ASKALLQA%'`);
  await db.query(`delete from transactions where description like 'ASKALLQA%'`);
  await db.query(`delete from team_members where full_name like 'ASKALLQA%'`);
  await db.query(`delete from ai_corrections where said like '%ASKALLQA%' or corrected like '%ASKALLQA%' or drafted like '%ASKALLQA%'`);
}

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
            anthropic_api_key = $1, anthropic_key_set_at = now(), anthropic_key_set_by = $2 where id = 1`,
    [seal("sk-ant-askallqa-0000000000000000000000"), admin.id],
  );
  const person = async (fullName) => (await call("POST", "/team-members", { fullName, joinedOn: "2026-01-01" })).body;
  const TANIA = await person("ASKALLQA Tania Rahman");
  const TANIA_A = await person("ASKALLQA Tania Akter");
  if (!TANIA?.id || !TANIA_A?.id) throw new Error(`Could not add the two people: ${JSON.stringify(TANIA)}`);

  /* ------------------------------------------------------------------ */
  console.log("\nA. The API: every field at once");
  const first = await turn("ASKALLQA Claude Max kinlam", plan("ASKALLQA Claude"));
  check("a plan with all Save needs is not ready: Save needs nothing more", first.body?.missingFields?.length === 0, JSON.stringify(first.body?.missingFields));
  check("it lists the owner's five, by the page's headings", JSON.stringify(labels(first.body)) === JSON.stringify(FIVE), JSON.stringify(labels(first.body)));
  check("none of the five is held as one Save needs", (first.body?.open ?? []).every((field) => field.required === false));
  const list = first.body?.nextQuestion ?? "";
  check(
    "the reply is the model's sentence and the list under it, a line each, ending on how to answer",
    list.startsWith("ASKALLQA Claude Max, $10 — card theke.\n") && FIVE.every((label) => list.includes(`• ${label} — `)) && list.endsWith(SKIP_LINE),
    list.replace(/\n/g, " | "),
  );
  check("and no ready line while they are open", first.body?.summary === null, String(first.body?.summary));
  check("the model was told which fields are worth asking", lastSystem().includes("WORTH ASKING") && lastSystem().includes('subscription: loginEmail ("Login accounts")') && lastSystem().includes("userNames"));

  const short = await turn("ASKALLQA Notion kinlam", { area: "subscriptions", target: "subscription", draft: { toolName: "ASKALLQA Notion" }, missingFields: [] });
  const shortList = short.body?.nextQuestion ?? "";
  const required = (short.body?.open ?? []).filter((field) => field.required).map((field) => field.field);
  check("with Save's fields missing too: all of them, at once", ["planName", "costUsd", "startDate", "accountName", "usdRate"].every((field) => required.includes(field)), JSON.stringify(required));
  check(
    "what Save needs first, then the five",
    shortList.indexOf("• Login accounts") > shortList.indexOf("• Price in dollars") && shortList.indexOf("• Price in dollars") > -1 && shortList.startsWith("To finish this, I still need:"),
    shortList.replace(/\n/g, " | "),
  );

  const choice = await turn("ASKALLQA Claude Max, user ASKALLQA Tania", plan("ASKALLQA Claude", { userNames: "ASKALLQA Tania" }));
  check(
    "two people of one name: asked which, on its own, with no list",
    choice.body?.nextQuestion === '"ASKALLQA Tania" could be ASKALLQA Tania Akter or ASKALLQA Tania Rahman. Which one?',
    choice.body?.nextQuestion,
  );

  const nobody = await turn("ASKALLQA Claude Max, user Zzqx Nobody", plan("ASKALLQA Claude", { userNames: "Zzqx Nobody" }));
  const users = (nobody.body?.open ?? []).find((field) => field.field === "userNames");
  check("a name nobody on Team has: asked again in the list, still not one Save needs", users?.required === false && /nobody on Team called "Zzqx Nobody"/.test(users?.ask ?? "") && nobody.body?.missingFields?.length === 0, JSON.stringify(users));

  const answered = { loginEmail: "ops@askallqa.test", userNames: "ASKALLQA Tania Rahman", boughtFor: "Engineering", reference: "CARD-ASK-1" };
  const skipOne = await turn("login ops@askallqa.test, Tania Rahman, Engineering, reference skip", { ...plan("ASKALLQA Claude", { ...answered, reference: undefined }), skipped: ["reference"] });
  check(
    "skip on one: it is marked, and only the invoice is still asked",
    JSON.stringify((skipOne.body?.open ?? []).map((f) => [f.field, Boolean(f.skipped)])) === JSON.stringify([["invoice", false], ["reference", true]]) && (skipOne.body?.nextQuestion ?? "").includes("• Invoice — ") && !(skipOne.body?.nextQuestion ?? "").includes("• Reference"),
    JSON.stringify(skipOne.body?.open),
  );
  check("the person said is the one on Team", skipOne.body?.draft?.userNames === "ASKALLQA Tania Rahman", skipOne.body?.draft?.userNames);

  const carried = await turn("invoice nai", plan("ASKALLQA Claude", { ...answered, reference: undefined }), { skipped: ["reference", "invoice"] });
  check("both left empty, carried from the turns before: ready, the two marked so", carried.body?.summary === READY && carried.body?.nextQuestion === null && JSON.stringify(carried.body?.open?.map((f) => [f.field, f.skipped])) === JSON.stringify([["invoice", true], ["reference", true]]), carried.body?.summary ?? carried.body?.nextQuestion);
  check("not asked again", !(carried.body?.nextQuestion ?? "").includes("Reference") && (carried.body?.open ?? []).every((f) => f.skipped));
  check("the model is told what was left empty", lastSystem().includes("Left empty on purpose: reference, invoice."));

  const skipAll = await turn("skip", plan("ASKALLQA Claude"), {
    messages: [
      { role: "user", content: "ASKALLQA Claude Max kinlam" },
      { role: "assistant", content: list },
      { role: "user", content: "skip" },
    ],
  });
  check('"skip" as the whole answer to the list leaves all five empty', (skipAll.body?.open ?? []).length === 5 && skipAll.body.open.every((f) => f.skipped) && skipAll.body?.summary?.endsWith(READY), JSON.stringify(skipAll.body?.open?.map((f) => f.field)));
  const notAList = await turn("nai", plan("ASKALLQA Claude"), {
    messages: [
      { role: "user", content: "ASKALLQA Claude kinlam" },
      { role: "assistant", content: "Is this a renewal, or a new plan?" },
      { role: "user", content: "nai" },
    ],
  });
  check('"nai" to a question that was not the list skips nothing', (notAList.body?.open ?? []).every((f) => !f.skipped), JSON.stringify(notAList.body?.open?.map((f) => [f.field, f.skipped])));

  console.log("\n   the invoice");
  const read = await upload("/ai/attachments/invoice", "askallqa-invoice.png", PNG, "image/png");
  const invoice = read.body?.[0];
  check("a picture is read as the invoice: its number, seller and total", read.status === 200 && invoice?.kind === "invoice" && invoice?.invoice?.number === "INV-ASK-7" && invoice?.invoice?.total === "10.00", `${read.status} ${JSON.stringify(invoice)}`);
  check("the model was handed the picture as a picture", asked.at(-1)?.stream === true && asked.at(-1)?.messages?.[0]?.content?.[0]?.type === "image" && asked.at(-1)?.messages?.[0]?.content?.[0]?.source?.media_type === "image/png");
  const withPaper = await turn("ASKALLQA Claude Max, invoice attached", plan("ASKALLQA Claude", answered), { attachmentIds: [invoice?.id] });
  check("its number goes in invoiceNo, read off it, not asked", withPaper.body?.draft?.invoiceNo === "INV-ASK-7" && !(withPaper.body?.open ?? []).some((f) => f.field === "invoice" || f.field === "invoiceNo"), JSON.stringify(withPaper.body?.open));
  check("nothing left: ready", withPaper.body?.summary === READY && (withPaper.body?.open ?? []).length === 0, withPaper.body?.summary ?? withPaper.body?.nextQuestion);
  check("the model was told it is the plan's invoice", lastSystem().includes("INVOICE ATTACHED: askallqa-invoice.png") && lastSystem().includes("THE PLAN'S INVOICE") && lastSystem().includes("Number: INV-ASK-7"));
  check("an invoice is never a plan for Import", withPaper.body?.importPlan === null || withPaper.body?.importPlan === undefined);

  paper = { isInvoice: true };
  const unread = await upload("/ai/attachments/invoice", "askallqa-blurred.pdf", PDF, "application/pdf");
  const blurred = unread.body?.[0];
  check("a PDF whose number cannot be read is kept, with no number", unread.status === 200 && blurred?.kind === "invoice" && blurred?.invoice?.number === null, `${unread.status} ${JSON.stringify(blurred)}`);
  check("and handed to the model as a PDF", asked.at(-1)?.messages?.[0]?.content?.[0]?.type === "document");
  const noNumber = await turn("ASKALLQA Claude Max, invoice attached", plan("ASKALLQA Claude", answered), { attachmentIds: [blurred?.id] });
  const askedNo = (noNumber.body?.open ?? []).find((f) => f.field === "invoiceNo");
  check("then its number is asked, in the list", askedNo?.label === "Invoice no." && /could not be read/.test(askedNo?.ask ?? "") && (noNumber.body?.nextQuestion ?? "").includes("• Invoice no. — "), JSON.stringify(noNumber.body?.open));
  paper = { isInvoice: true, number: "INV-ASK-7", seller: "Anthropic", total: "10.00", currency: "USD", date: today };

  const notPaper = await upload("/ai/attachments/invoice", "askallqa.csv", Buffer.from("a,b\n1,2\n"), "text/csv");
  check("a spreadsheet is not an invoice: refused before any model is asked", notPaper.status === 400 && /PDF or a picture/.test(notPaper.body?.message ?? ""), `${notPaper.status} ${notPaper.body?.message}`);
  const toImport = await call("POST", `/ai/attachments/${invoice?.id}/to-import`, {});
  check("an invoice cannot be staged for Import", toImport.status === 400 && /invoice cannot be staged/.test(toImport.body?.message ?? ""), `${toImport.status} ${toImport.body?.message}`);

  console.log("\n   the other forms");
  const pay = await turn("ASKALLQA courier 500 dilam", {
    area: "expenses",
    target: "transaction_out",
    draft: { amount: "500", accountName: CARD.name, categoryName: (await q(`select c.name from categories c join categories p on p.id = c.parent_id where c.is_active and c.deleted_at is null and c.kind <> 'in' and c.name !~* 'ai\\s*tool|subscription|software|hosting|server|domain' and p.name !~* 'ai\\s*tool|subscription|software|hosting|server|domain' and not exists (select 1 from categories o where o.id <> c.id and lower(o.name) = lower(c.name)) order by c.name limit 1`))[0]?.name, usdRate: "122", txnDate: today, description: "ASKALLQA courier" },
    missingFields: [],
  });
  check("a payment asks the ledger's Invoice and Reference", JSON.stringify(labels(pay.body)) === JSON.stringify(["Invoice", "Reference"]) && pay.body?.missingFields?.length === 0, JSON.stringify(labels(pay.body)));
  const someone = await turn("ASKALLQA new person", { area: "team", target: "team_member", draft: { fullName: "ASKALLQA Someone New", joinedOn: today }, missingFields: [] });
  check("a new person asks the four columns Team shows", JSON.stringify(labels(someone.body)) === JSON.stringify(["Employee ID", "Designation", "Employment type", "Department"]), JSON.stringify(labels(someone.body)));

  /* ------------------------------------------------------------------ */
  console.log("\nB. Confirm through the API");
  const toSave = await turn("ASKALLQA API Claude Max", plan("ASKALLQA API Claude", { ...answered, invoiceNo: "INV-API-1" }), { skipped: ["invoice"] });
  const saved = await call("POST", "/ai/confirm", { chatId: toSave.body?.chatId, draft: Object.fromEntries(Object.entries(toSave.body?.draft ?? {}).map(([k, v]) => [k, String(v)])) });
  check("saved", saved.status === 200 && saved.body?.target === "subscription", `${saved.status} ${JSON.stringify(saved.body?.message ?? saved.body?.said)}`);
  const [row] = await q(`select login_email, bought_for, reference, invoice_no from subscriptions where id = $1`, [saved.body?.id ?? "00000000-0000-0000-0000-000000000000"]);
  check("the plan holds what was answered", row?.login_email === "ops@askallqa.test" && row?.bought_for === "Engineering" && row?.reference === "CARD-ASK-1" && row?.invoice_no === "INV-API-1", JSON.stringify(row));
  const seats = await q(`select team_member_id from subscription_users where subscription_id = $1`, [saved.body?.id ?? "00000000-0000-0000-0000-000000000000"]);
  check("and the person found on Team is on it", seats.length === 1 && seats[0].team_member_id === TANIA.id, JSON.stringify(seats));

  /* ------------------------------------------------------------------ */
  console.log("\nC. The page");
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", (intercepted) => {
    const url = intercepted.url();
    const base = [`${WEB}/api/`, `${DEV_API}/api/`].find((prefix) => url.startsWith(prefix));
    if (base) intercepted.continue({ url: url.replace(base, `${API}/`) });
    else intercepted.continue();
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
  const say = async (text, says) => {
    answer = says;
    const answeredTurn = page.waitForResponse((response) => response.url().endsWith("/ai/turn") && response.request().method() === "POST", { timeout: 60000 });
    await page.type('textarea[placeholder^="Type it"]', text);
    await page.keyboard.press("Enter");
    const res = await answeredTurn;
    const body = await res.json().catch(() => null);
    if (body?.chatId) made.chats.add(body.chatId);
    await page.waitForFunction(() => !document.body.innerText.includes("Thinking…"), { timeout: 60000 });
    await settle();
    return { body, request: JSON.parse(res.request().postData() ?? "{}") };
  };
  const transcript = () => page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  const confirmButton = () =>
    page.evaluate(() => {
      const found = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Confirm and save");
      return found ? { disabled: found.disabled } : null;
    });
  /** The card's boxes: label → value, and the empty ones by field. */
  const card = () =>
    page.evaluate(() => {
      const form = [...document.querySelectorAll("form")].find((f) => f.innerText.includes("Confirm and save"));
      if (!form) return null;
      const boxes = [...form.querySelectorAll("label")].map((label) => ({
        label: label.querySelector("span")?.textContent.replace("*", "").trim(),
        value: label.querySelector("input,textarea")?.value ?? null,
        name: label.querySelector("input,textarea")?.getAttribute("name") ?? null,
      }));
      const head = form.closest("div.\\@container")?.querySelector("p")?.textContent ?? "";
      const invoice = form.querySelector('[data-open-field="invoice"]')?.innerText ?? null;
      return { boxes, head, invoice };
    });
  const pressText = (wanted, within = "form") =>
    page.evaluate(
      (text, scope) => {
        const root = scope === "form" ? [...document.querySelectorAll("form")].find((f) => f.innerText.includes("Confirm and save")) : document;
        const found = [...(root ?? document).querySelectorAll("button")].find((b) => b.textContent.trim() === text);
        found?.click();
        return Boolean(found);
      },
      wanted,
      within,
    );
  const typeInto = async (name, text) => {
    await page.click(`form input[name="${name}"]`, { clickCount: 3 });
    await page.type(`form input[name="${name}"]`, text);
  };
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await say("ASKALLQA page Claude Max kinlam", plan("ASKALLQA page Claude"));
  let text = await transcript();
  check("the chat shows the list, the five by the page's headings", FIVE.every((label) => text.includes(`• ${label} — `)) && text.includes(SKIP_LINE), text.slice(-600).replace(/\n/g, " | "));
  let shown = await card();
  const emptyBoxes = shown?.boxes.filter((box) => box.value === "").map((box) => box.label);
  check("the card shows the whole form: Login accounts, User Name, User Department and Reference empty", ["Login accounts", "User Name", "User Department", "Reference"].every((label) => emptyBoxes?.includes(label)), JSON.stringify(emptyBoxes));
  check("and the invoice's line, to attach it", /Attach the invoice/.test(shown?.invoice ?? ""), shown?.invoice);
  check("Confirm and save waits until each is answered or left empty", (await confirmButton())?.disabled === true && shown?.head === `Still to answer: ${FIVE.join(", ")}`, `${JSON.stringify(await confirmButton())} ${shown?.head}`);
  await shot("askall-list");

  // The invoice, attached in the chat with the paperclip while the plan is the draft.
  const composerInput = await page.$('input[type="file"]:not([aria-label="Attach the invoice"])');
  const readIt = page.waitForResponse((response) => response.url().endsWith("/ai/attachments/invoice"), { timeout: 60000 });
  await composerInput.uploadFile(PNG_FILE);
  await readIt;
  await page.waitForFunction(() => /Invoice · No\. INV-ASK-7/.test(document.body.innerText), { timeout: 30000 });
  await settle();
  shown = await card();
  check("attached in the chat: its card says what was read off it", /Invoice · No\. INV-ASK-7 · Anthropic/.test(await transcript()));
  check("the card's invoice line holds the file, and the number read off it is in its box", /askallqa-invoice\.png/.test(shown?.invoice ?? "") && shown?.boxes.some((box) => box.name === "invoiceNo" && box.value === "INV-ASK-7"), JSON.stringify({ invoice: shown?.invoice, boxes: shown?.boxes.filter((b) => b.name === "invoiceNo") }));

  const answerTurn = await say(
    "login ops@askallqa.test, user ASKALLQA Tania Rahman, department Engineering, reference CARD-ASK-1",
    plan("ASKALLQA page Claude", answered),
  );
  check("the answer goes with the invoice's reading", (answerTurn.request.attachmentIds ?? []).length === 1);
  shown = await card();
  const value = (name) => shown?.boxes.find((box) => box.name === name)?.value;
  check(
    "the card now holds every answer, the invoice's number among them",
    value("loginEmail") === "ops@askallqa.test" && value("userNames") === "ASKALLQA Tania Rahman" && value("boughtFor") === "Engineering" && value("reference") === "CARD-ASK-1" && value("invoiceNo") === "INV-ASK-7",
    JSON.stringify(shown?.boxes),
  );
  check("and Confirm and save can be pressed", (await confirmButton())?.disabled === false && shown?.head === "Check every line, then confirm.", `${JSON.stringify(await confirmButton())} ${shown?.head}`);
  await shot("askall-answered");

  const confirmed = page.waitForResponse((response) => response.url().endsWith("/ai/confirm"), { timeout: 60000 });
  const uploaded = page.waitForResponse((response) => /\/files\/subscription\/[0-9a-f-]+$/.test(response.url()) && response.request().method() === "POST", { timeout: 60000 });
  await pressText("Confirm and save");
  await confirmed;
  const upload1 = await uploaded;
  await page.waitForFunction(() => /The invoice is attached to it\./.test(document.body.innerText) || document.querySelector('[role="alert"]'), { timeout: 60000 });
  await settle();
  text = await transcript();
  check("saved, and the invoice uploaded to the plan", upload1.status() === 201 && /Saved — a new plan under AI tools and subscriptions: ASKALLQA page Claude, Max, \$10\.00, its first payment TXN-[\w-]+\. It shows under AI tools and subscriptions\. The invoice is attached to it\./.test(text), `${upload1.status()} ${(text.match(/Saved — [^\n]*/) ?? [""])[0]}`);
  const [pagePlan] = await q(`select id, login_email, bought_for, reference, invoice_no from subscriptions where tool_name = 'ASKALLQA page Claude'`);
  const papers = await q(`select kind::text, original_name from files where subscription_id = $1 and deleted_at is null`, [pagePlan?.id ?? "00000000-0000-0000-0000-000000000000"]);
  check("the books: the answers on the plan, the invoice its file", pagePlan?.invoice_no === "INV-ASK-7" && papers.length === 1 && papers[0].kind === "invoice" && papers[0].original_name === "askallqa-invoice.png", JSON.stringify({ pagePlan, papers }));

  /** The plan's row on AI tools and subscriptions, heading → what the cell says. */
  const rowOf = async (tool) => {
    await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
    await page.type('input[placeholder="Tool, plan, team, login…"]', tool);
    // Read in the same breath as it is found: the search settles a moment
    // after typing, and the table is drawn again when it does.
    const found = await page.waitForFunction(
      (name) => {
        // textContent: the headings are drawn in capitals, which innerText repeats.
        const heads = [...document.querySelectorAll("thead th")].map((th) => th.textContent.trim());
        const tr = [...document.querySelectorAll("tbody tr")].find((one) => one.innerText.includes(name));
        if (!tr) return null;
        const cells = [...tr.querySelectorAll("td")].map((td) => td.innerText.trim());
        return Object.fromEntries(heads.map((head, i) => [head, cells[i]]));
      },
      { timeout: 30000, polling: 250 },
      tool,
    );
    return found.jsonValue();
  };
  const claudeRow = await rowOf("ASKALLQA page Claude");
  await shot("askall-row");
  check(
    "the plan's row: no N/A in the five columns",
    FIVE.every((head) => claudeRow[head] && claudeRow[head] !== "N/A") && claudeRow["Login accounts"] === "ops@askallqa.test" && claudeRow["User Name"] === "ASKALLQA Tania Rahman" && claudeRow["User Department"] === "Engineering" && claudeRow.Reference === "CARD-ASK-1" && claudeRow.Invoice === "View",
    JSON.stringify(Object.fromEntries(FIVE.map((head) => [head, claudeRow[head]]))),
  );

  // A second plan, Reference left empty in the chat.
  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "New chat")?.click());
  await settle();
  await say("ASKALLQA page Zoom Pro kinlam", plan("ASKALLQA page Zoom"));
  const zoomInput = await page.$('input[type="file"]:not([aria-label="Attach the invoice"])');
  const readZoom = page.waitForResponse((response) => response.url().endsWith("/ai/attachments/invoice"), { timeout: 60000 });
  await zoomInput.uploadFile(PNG_FILE);
  await readZoom;
  await settle();
  const skipTurn = await say("login ops@askallqa.test, ASKALLQA Tania Rahman, Engineering, reference skip", { ...plan("ASKALLQA page Zoom", { ...answered, reference: undefined }), skipped: ["reference"] });
  shown = await card();
  check(
    "Reference left empty in the chat: marked so on the card, and Confirm can be pressed",
    (skipTurn.body?.open ?? []).some((f) => f.field === "reference" && f.skipped) && (await confirmButton())?.disabled === false && (await page.evaluate(() => [...document.querySelectorAll("form button")].some((b) => b.textContent.trim() === "Left empty" && b.getAttribute("aria-pressed") === "true"))),
    JSON.stringify(skipTurn.body?.open),
  );
  const confirmedZoom = page.waitForResponse((response) => response.url().endsWith("/ai/confirm"), { timeout: 60000 });
  await pressText("Confirm and save");
  await confirmedZoom;
  await page.waitForFunction(() => /The invoice is attached to it\./.test(document.body.innerText) || document.querySelector('[role="alert"]'), { timeout: 60000 });
  const zoomRow = await rowOf("ASKALLQA page Zoom");
  check(
    "its row: N/A under Reference alone",
    zoomRow.Reference === "N/A" && FIVE.filter((head) => head !== "Reference").every((head) => zoomRow[head] && zoomRow[head] !== "N/A"),
    JSON.stringify(Object.fromEntries(FIVE.map((head) => [head, zoomRow[head]]))),
  );

  // Leave empty on the card, on a payment.
  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "New chat")?.click());
  await settle();
  await say("ASKALLQA page courier 500", { area: "expenses", target: "transaction_out", draft: pay.body?.draft ?? {}, missingFields: [] });
  check("a payment's card holds Confirm until Invoice and Reference are answered or left empty", (await confirmButton())?.disabled === true && (await card())?.head === "Still to answer: Invoice, Reference", (await card())?.head);
  await typeInto("invoiceNo", "BILL-77");
  check("a box typed into on the card offers no Leave empty", (await page.$$('[data-open-field="invoiceNo"] button')).length === 0);
  await page.click('[data-open-field="reference"] button');
  await settle();
  check("one typed on the card, the other left empty there: Confirm can be pressed", (await confirmButton())?.disabled === false, JSON.stringify(await confirmButton()));
  await shot("askall-card-skip");
  const nextTurn = await say("ar kichu na", { area: "expenses", target: "transaction_out", draft: pay.body.draft, missingFields: [] });
  check("Leave empty on the card goes with the next message, and is not asked again", (nextTurn.request.skipped ?? []).includes("reference") && (nextTurn.body?.open ?? []).some((f) => f.field === "reference" && f.skipped), JSON.stringify(nextTurn.request.skipped));

  await page.setViewport({ width: 390, height: 844 });
  await settle();
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot("askall-390");
  check("390px: the card does not scroll the page sideways", sideways <= 0, String(sideways));
  check("no page error", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser?.close().catch(() => undefined);
  await db.query(`delete from ai_chats where id = any ($1::uuid[])`, [[...made.chats]]);
  await db.query(`delete from ai_chats where title like 'ASKALLQA%' and created_at > now() - interval '30 minutes'`);
  await db.query(`delete from ai_attachments where filename like 'askallqa%' and created_at > now() - interval '30 minutes'`);
  await sweep().catch((error) => console.log(`  (could not sweep: ${error.message})`));
  await db.query(
    `update app_settings set ai_provider = $1, ai_model = $2, ai_data_access = $3, anthropic_api_key = $4, anthropic_key_set_at = $5, anthropic_key_set_by = $6 where id = 1`,
    [before.ai_provider, before.ai_model, before.ai_data_access, before.anthropic_api_key, before.anthropic_key_set_at, before.anthropic_key_set_by],
  );
  const stopped = new Promise((resolve) => api.once("exit", resolve));
  api.kill();
  await stopped;
  stub.close();
  const [left] = await q(
    `select (select count(*) from subscriptions where tool_name like 'ASKALLQA%')::int as plans,
            (select count(*) from team_members where full_name like 'ASKALLQA%')::int as people,
            (select count(*) from transactions where description like 'ASKALLQA%')::int as entries,
            (select count(*) from ai_chats where title like 'ASKALLQA%')::int as chats`,
  );
  console.log(`\n  left behind: ${JSON.stringify(left)}`);
  await db.end();
  fs.rmSync(tmp, { recursive: true, force: true });
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exitCode = passed === results.length ? 0 : 1;
}
