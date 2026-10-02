/**
 * The Assistant's drafts, checked in code — whichever model answers.
 * docs/briefs/2026-10-02-assistant-complete-drafts.md
 *
 * No model is asked here. A stand-in for Anthropic's API answers each turn
 * with a reply written below — the one Gemini gave the owner on the live site
 * among them — and what is measured is what THIS APP makes of it:
 *
 *   A. the owner's draft (money out, no category, "record korechi"): not
 *      ready, the category asked for, the false sentence never shown;
 *   B. a transfer between two of our accounts: ready, the line under it from
 *      the code, saved through the Money Transfer endpoint as a linked pair;
 *   C. a name that fits several accounts, or none: asked about with the real
 *      ones listed; and Save refuses the same rather than picking one;
 *   D. the model's own question kept when it has one — unless it says the
 *      thing is done; a "recorded" with no draft at all replaced;
 *   E. what the model is told: the transfer target, its fields, our accounts;
 *   F. the page: the card that cannot be saved offers no Save, and the one
 *      that can saves a transfer.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantdraftqa.mjs                 (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantdraftqa.mjs  also saves screenshots
 *
 * Starts its own API on :4011 pointed at the stand-in, so the dev API on
 * :4001 is left alone. Puts a made-up Anthropic key in the local app_settings
 * while it runs (so the page reads "switched on") and puts back what was
 * there. Deletes the chats and the transfers it made.
 */
import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const DEV_API = "http://localhost:4001";
const PORT = 4011;
const API = `http://localhost:${PORT}/api`;
const STUB_PORT = 4599;
const SHOTS = process.env.SHOT_DIR || null;
/** AI_DRAFT_READY_LINE, in packages/shared/src/ai.ts. */
const READY = "Draft ready — check every line, then press Save. Nothing is recorded yet.";

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

const [user] = await q(`select id, role, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`);
const token = jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const call = async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------------ */
/*  The books this runs against                                              */
/* ------------------------------------------------------------------------ */

const accounts = await q(
  `select a.id, a.name, a.currency,
          (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null and t.deleted_at is null), 0))::numeric as balance
     from accounts a left join transactions t on t.account_id = a.id
    where a.is_active and a.deleted_at is null group by a.id order by a.name`,
);
// The richest taka account pays; any other taka account receives.
const taka = accounts.filter((a) => a.currency !== "USD").sort((a, b) => Number(b.balance) - Number(a.balance));
const FROM = taka[0];
const TO = taka[1];
if (!FROM || !TO || Number(FROM.balance) < 100) throw new Error("The local books need two taka accounts, one of them holding 100 taka.");
// A money-out sub-category that is a plain expense. Not one the map gives to
// AI tools and subscriptions (#136): a payment filed under "AI tools" is now
// refused as a plain payment, which is .assistantmapqa.mjs's to measure.
const [CATEGORY] = await q(
  `select c.name from categories c join categories p on p.id = c.parent_id
    where c.is_active and c.deleted_at is null and c.kind <> 'in'
      and c.name !~* 'ai ?tool|subscription|software|hosting|server|domain'
      and p.name !~* 'ai ?tool|subscription|software|hosting|server|domain'
    order by c.name limit 1`,
);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
// A piece of a name that more than one account carries, and one none does.
const shared = (() => {
  for (const a of accounts) {
    for (let i = 0; i + 2 <= a.name.length; i += 1) {
      const piece = a.name.slice(i, i + 2).toLowerCase();
      if (!/^[a-z]{2}$/.test(piece)) continue;
      const fits = accounts.filter((b) => b.name.toLowerCase().includes(piece));
      if (fits.length > 1 && !accounts.some((b) => b.name.toLowerCase() === piece)) return { piece, fits };
    }
  }
  return null;
})();

/* ------------------------------------------------------------------------ */
/*  A stand-in for the model: it says what it is told to                     */
/* ------------------------------------------------------------------------ */

// Held, not queued: a request the client sends twice gets the same answer.
let answer = null;
const asked = [];
const stub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    asked.push(JSON.parse(raw || "{}"));
    const input = answer ?? { draft: {}, missingFields: [], summary: "(the harness gave no answer)" };
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_draftqa" });
    res.end(
      JSON.stringify({
        id: "msg_draftqa",
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

/** One turn: the model "says" `says`, the app replies. */
const made = { chats: new Set(), transfers: [] };
async function turn(text, says, carried = {}) {
  answer = says;
  const res = await call("POST", "/ai/turn", { messages: [{ role: "user", content: text }], ...carried });
  if (res.body?.chatId) made.chats.add(res.body.chatId);
  // A turn that did not answer fails every check that reads it; say why once.
  if (res.status !== 200) console.log(`  (the turn "${text.slice(0, 40)}" answered ${res.status}: ${JSON.stringify(res.body)})`);
  return res;
}
const shown = (reply) => reply?.nextQuestion ?? reply?.clarification ?? reply?.summary ?? "";
const CLAIM = /korechi|recorded|saved|done|hoye geche/i;

/* ------------------------------------------------------------------------ */

/** secret-box's seal, byte for byte: v1.<iv>.<tag>.<ciphertext>, base64url. */
const seal = (plaintext) => {
  const source = env.SECRET_ENCRYPTION_KEY?.trim() || env.JWT_REFRESH_SECRET?.trim();
  const key = createHash("sha256").update(source, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
};
const [before] = await q(`select ai_provider, ai_model, ai_data_access, anthropic_api_key, anthropic_key_set_at, anthropic_key_set_by from app_settings where id = 1`);

// An API left on the port by a run that was cut short would answer for this one.
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

let browser;
try {
  for (let i = 0; i < 90; i += 1) {
    const up = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
    if (up) break;
    if (api.exitCode !== null || i === 89) throw new Error(`The API did not start on :${PORT}.\n${apiLog.slice(-2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await q(
    `update app_settings set ai_provider = 'anthropic', ai_model = 'claude-opus-5', ai_data_access = 'full',
            anthropic_api_key = $1, anthropic_key_set_at = now(), anthropic_key_set_by = $2 where id = 1`,
    [seal("sk-ant-draftqa-0000000000000000000000"), user.id],
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA. The draft the owner was shown");
  const owner = await turn(`1 lakh taka transfer koro ${FROM.name} theke Md. Nizam Uddin accounts a`, {
    target: "transaction_out",
    draft: { amount: 100000, accountName: FROM.name, counterparty: "Md. Nizam Uddin", usdRate: 121.5, txnDate: today, description: "Transfer to Md. Nizam Uddin" },
    missingFields: [],
    summary: "1 lakh taka transfer record korechi.",
  });
  check("the turn answers", owner.status === 200, String(owner.status));
  check("it is not ready: the category is missing, by the code's finding", JSON.stringify(owner.body?.missingFields) === '["categoryName"]', JSON.stringify(owner.body?.missingFields));
  check("the reply is a question about the category", owner.body?.nextQuestion === "Which category is this under?", shown(owner.body));
  check("the model's \"record korechi\" is not shown anywhere", !CLAIM.test(JSON.stringify([owner.body?.summary, owner.body?.nextQuestion, owner.body?.clarification])), JSON.stringify(owner.body?.summary));
  check("the figures are text, as the card holds them", owner.body?.draft?.amount === "100000" && owner.body?.draft?.usdRate === "121.5", JSON.stringify(owner.body?.draft));
  const [storedChat] = await q(`select messages, reply from ai_chats where id = $1`, [owner.body?.chatId]);
  check("the saved conversation carries the question, not the claim", storedChat?.messages?.at(-1)?.content === "Which category is this under?" && !CLAIM.test(JSON.stringify(storedChat)), JSON.stringify(storedChat?.messages?.at(-1)));

  const fixed = await turn("office er", {
    target: "transaction_out",
    draft: { amount: "100000", accountName: FROM.name, usdRate: "121.5", txnDate: today, description: "Transfer to Md. Nizam Uddin", categoryName: `${CATEGORY.name}  —  money out` },
    missingFields: [],
    nextQuestion: "Save kore dibo?",
    summary: "Shob thik ache, save korechi.",
  });
  check("with a category the books have, it is ready", fixed.body?.missingFields?.length === 0, JSON.stringify(fixed.body?.missingFields));
  check("the line under a ready draft is the code's own", fixed.body?.summary === READY && fixed.body?.nextQuestion === null, shown(fixed.body));
  check("the category reads as the books spell it, without the prompt's dash", fixed.body?.draft?.categoryName === CATEGORY.name, String(fixed.body?.draft?.categoryName));

  /* ------------------------------------------------------------------ */
  console.log("\nB. A transfer between our own accounts");
  const transfer = await turn(`100 taka transfer koro ${FROM.name} theke ${TO.name} e, rate 121.5`, {
    target: "transfer",
    draft: {
      amount: 100,
      fromAccountName: FROM.name.toLowerCase(),
      toAccountName: `${TO.name}  —  bank`,
      usdRate: 121.5,
      txnDate: today,
      counterparty: TO.name,
      categoryName: CATEGORY.name,
    },
    missingFields: [],
    summary: "Transfer record korechi.",
  });
  check("a transfer is a kind of record the app takes", transfer.status === 200 && transfer.body?.target === "transfer", `${transfer.status} ${transfer.body?.target}`);
  check("it is ready", transfer.body?.missingFields?.length === 0, JSON.stringify(transfer.body?.missingFields));
  check("the line under it is the code's, not \"record korechi\"", transfer.body?.summary === READY, shown(transfer.body));
  check("both accounts read as the books spell them", transfer.body?.draft?.fromAccountName === FROM.name && transfer.body?.draft?.toAccountName === TO.name, JSON.stringify(transfer.body?.draft));
  check("no category and no counterparty on it", !("categoryName" in (transfer.body?.draft ?? {})) && !("counterparty" in (transfer.body?.draft ?? {})), Object.keys(transfer.body?.draft ?? {}).join(", "));
  check("the description is the two accounts", transfer.body?.draft?.description === `Transfer from ${FROM.name} to ${TO.name}`, String(transfer.body?.draft?.description));

  // Saved the way the page saves it: names to ids, then the form's endpoint.
  const resolved = await call("POST", "/ai/resolve", { draft: transfer.body?.draft });
  const saved = await call("POST", "/transactions/transfer", resolved.body);
  if (saved.body?.id) made.transfers.push(saved.body.id);
  check("Save goes through the Money Transfer endpoint", saved.status === 201, `${saved.status} ${JSON.stringify(saved.body?.fieldErrors ?? saved.body?.message ?? "")}`);
  const pair = saved.body?.id
    ? await q(
        `select t.direction, a.name, t.amount::text, t.usd_rate::text, t.category_id from transactions t join accounts a on a.id = t.account_id
          where t.transfer_group_id = (select transfer_group_id from transactions where id = $1) order by t.direction desc`,
        [saved.body.id],
      )
    : [];
  check(
    "the books hold the pair: out of one, into the other, no category",
    pair.length === 2 && pair[0].direction === "out" && pair[0].name === FROM.name && pair[1].direction === "in" && pair[1].name === TO.name && pair.every((r) => r.amount === "100.00" && Number(r.usd_rate) === 121.5 && r.category_id === null),
    JSON.stringify(pair),
  );

  const noRate = await turn(`50 taka ${FROM.name} theke ${TO.name} e pathao`, {
    target: "transfer",
    draft: { amount: "50", fromAccountName: FROM.name, toAccountName: TO.name, txnDate: today },
    missingFields: [],
  });
  check("a transfer with no rate is not ready: the form requires one", JSON.stringify(noRate.body?.missingFields) === '["usdRate"]', JSON.stringify(noRate.body?.missingFields));
  check("and the question says why it is asked", /USD rate/.test(noRate.body?.nextQuestion ?? "") && /Every entry/.test(noRate.body?.nextQuestion ?? ""), shown(noRate.body));

  const sameSide = await turn("same account", {
    target: "transfer",
    draft: { amount: "50", fromAccountName: FROM.name, toAccountName: FROM.name, txnDate: today, usdRate: "121.5" },
    missingFields: [],
  });
  check("the same account on both sides is asked about", sameSide.body?.missingFields?.[0] === "toAccountName" && /^Both sides are/.test(sameSide.body?.nextQuestion ?? ""), shown(sameSide.body));

  /* ------------------------------------------------------------------ */
  console.log("\nC. A name is looked up, not taken on trust");
  const payment = { amount: "500", usdRate: "121.5", txnDate: today, description: "Courier", categoryName: CATEGORY.name };
  if (shared) {
    const several = await turn("courier 500", { target: "transaction_out", draft: { ...payment, accountName: shared.piece }, missingFields: [] });
    check(
      `"${shared.piece}" fits ${shared.fits.length} accounts: none is picked`,
      several.body?.missingFields?.[0] === "accountName" && !("accountName" in (several.body?.draft ?? {})),
      JSON.stringify(several.body?.draft),
    );
    check("the question lists the real ones", shared.fits.every((a) => (several.body?.nextQuestion ?? "").includes(a.name)), shown(several.body));
    const refused = await call("POST", "/ai/resolve", { draft: { ...payment, accountName: shared.piece } });
    check("Save refuses the same name rather than taking the first", refused.status === 400 && shared.fits.every((a) => refused.body?.message?.includes(a.name)), `${refused.status} ${refused.body?.message}`);
  } else {
    console.log("  (no two local accounts share a piece of a name; skipped)");
  }
  const nobody = await turn("courier 500", { target: "transaction_out", draft: { ...payment, accountName: "Zylofone Bank" }, missingFields: [] });
  check("an account that does not exist is asked about", nobody.body?.missingFields?.[0] === "accountName" && /There is no account called "Zylofone Bank"/.test(nobody.body?.nextQuestion ?? ""), shown(nobody.body));
  check("with the accounts there are", accounts.length > 12 || accounts.every((a) => (nobody.body?.nextQuestion ?? "").includes(a.name)), shown(nobody.body));
  const noSuch = await call("POST", "/ai/resolve", { draft: { ...payment, accountName: "Zylofone Bank" } });
  check("Save says there is no such account, in words", noSuch.status === 400 && /There is no account called "Zylofone Bank"/.test(noSuch.body?.message ?? ""), `${noSuch.status} ${noSuch.body?.message}`);
  const noCategory = await turn("drone rental", { target: "transaction_out", draft: { ...payment, accountName: FROM.name, categoryName: "Zylofone rental" }, missingFields: [] });
  check("a category that does not exist is asked about, not saved", noCategory.body?.missingFields?.[0] === "categoryName" && /There is no money-out category called "Zylofone rental"/.test(noCategory.body?.nextQuestion ?? ""), shown(noCategory.body));
  const [moneyIn] = await q(`select name from categories c where is_active and deleted_at is null and parent_id is not null and kind = 'in' and not exists (select 1 from categories o where o.id <> c.id and lower(o.name) = lower(c.name)) order by name limit 1`);
  if (moneyIn) {
    const wrongWay = await turn("courier 500", { target: "transaction_out", draft: { ...payment, accountName: FROM.name, categoryName: moneyIn.name }, missingFields: [] });
    check(`a money-in category ("${moneyIn.name}") on money going out is asked about: the ledger would refuse it`, wrongWay.body?.missingFields?.[0] === "categoryName" && /There is no money-out category called/.test(wrongWay.body?.nextQuestion ?? ""), shown(wrongWay.body));
  } else {
    console.log("  (no money-in-only category locally; skipped)");
  }
  const dollars = await turn("courier", { target: "transaction_out", draft: { ...payment, accountName: FROM.name, amount: "$100" }, missingFields: [] });
  check("\"$100\" is not read as a hundred taka: the amount is asked for", dollars.body?.missingFields?.[0] === "amount" && !("amount" in (dollars.body?.draft ?? {})), `${JSON.stringify(dollars.body?.missingFields)} ${shown(dollars.body)}`);
  const badKey = await turn("courier 500", { target: "transaction_out", draft: { ...payment, accountName: FROM.name, vendorName: "Sundarban", currencyCode: "BDT" }, missingFields: [] });
  check("a field the endpoint does not know never reaches the card", badKey.body?.missingFields?.length === 0 && !("vendorName" in badKey.body.draft) && !("currencyCode" in badKey.body.draft), Object.keys(badKey.body?.draft ?? {}).join(", "));
  const badRate = await turn("courier 500", { target: "transaction_out", draft: { ...payment, accountName: FROM.name, usdRate: "121,5" }, missingFields: [] });
  check("a value the schema refuses is asked for again", badRate.body?.missingFields?.[0] === "usdRate" && /"121,5" cannot be saved/.test(badRate.body?.nextQuestion ?? ""), shown(badRate.body));

  /* ------------------------------------------------------------------ */
  console.log("\nD. Whose sentence is shown");
  const ownQuestion = `${FROM.name} theke ${TO.name} e 50 taka — aajker USD rate koto?`;
  const asks = await turn("50 taka pathao", {
    target: "transfer",
    draft: { amount: "50", fromAccountName: FROM.name, toAccountName: TO.name, txnDate: today },
    missingFields: ["usdRate"],
    nextQuestion: ownQuestion,
  });
  check("the model's own question is kept, in the person's own words", asks.body?.nextQuestion === ownQuestion, shown(asks.body));
  const lies = await turn("50 taka pathao", {
    target: "transfer",
    draft: { amount: "50", fromAccountName: FROM.name, toAccountName: TO.name, txnDate: today },
    missingFields: ["usdRate"],
    nextQuestion: "Transfer record korechi. Aajker rate koto?",
  });
  check("unless it says the thing is done: then the code asks", !CLAIM.test(lies.body?.nextQuestion ?? "") && /USD rate/.test(lies.body?.nextQuestion ?? ""), shown(lies.body));
  const noDraft = await turn("transfer ta koro", { draft: {}, missingFields: [], summary: "Thik ache, transfer record korechi." });
  check("\"record korechi\" with no draft at all is replaced", /^Nothing has been recorded/.test(noDraft.body?.summary ?? ""), shown(noDraft.body));
  const midDraft = await turn("hoyeche?", { draft: {}, missingFields: [], summary: "Transfer ta record hoye geche." }, { target: "transfer", draft: { amount: "50", fromAccountName: FROM.name } });
  check("\"record hoye geche\" with a draft on the table is replaced too", /^Nothing has been recorded/.test(midDraft.body?.summary ?? ""), shown(midDraft.body));
  const aside = await turn("50 taka pathao, r balance koto?", {
    target: "transfer",
    draft: { amount: "50", fromAccountName: FROM.name, toAccountName: TO.name, txnDate: today },
    missingFields: [],
    summary: `${FROM.name} te ekhon taka ache.`,
  });
  check("an answer given along the way is kept, ahead of the code's question", aside.body?.nextQuestion === `${FROM.name} te ekhon taka ache. What was the USD rate that day? Every entry that moves money carries one.`, shown(aside.body));
  const table = await turn("ei duita vendor add koro", {
    draft: {},
    missingFields: [],
    batch: { target: "vendor", rows: [{ name: "QA Draft One" }, { name: "QA Draft Two" }], note: "I have saved these 2 vendors." },
    summary: "2 rows were already recorded in the books, so I left them out.",
  });
  check("beside a table: a report of what is already recorded is left alone", table.body?.summary === "2 rows were already recorded in the books, so I left them out." && table.body?.batch?.rows?.length === 2, shown(table.body));
  check("and a note that says the rows are saved is taken off", table.body?.batch?.note === null, JSON.stringify(table.body?.batch?.note));
  const trueAnswer = `August e 3 ta transfer record kora hoyeche. ${FROM.name} te ekhon taka ache.`;
  const answered = await turn("august e koyta transfer?", { draft: {}, missingFields: [], summary: trueAnswer });
  check("an answer about the books is shown as it was given", answered.body?.summary === trueAnswer, shown(answered.body));

  /* ------------------------------------------------------------------ */
  console.log("\nE. What the model is told");
  const request = asked.at(-1);
  const system = (request?.system ?? []).map((block) => block.text).join("\n");
  const answerTool = request?.tools?.find((tool) => tool.name === "answer");
  check("transfer is a target it may choose", answerTool?.input_schema?.properties?.target?.enum?.includes("transfer"), JSON.stringify(answerTool?.input_schema?.properties?.target?.enum));
  check("it is told when a transfer applies", /Money moved between two of OUR OWN accounts\s+-> transfer/.test(system) && /it has no category and no counterparty/.test(system));
  check("the transfer's fields come from the form's schema", /\ntransfer\n(?:.*\n)*?\s+fromAccountName\s+REQUIRED/.test(system) && /toAccountName\s+REQUIRED/.test(system));
  check("the category is REQUIRED on a payment, as the schema has it", /categoryName\s+REQUIRED/.test(system));
  check("our accounts are listed, each on its line", accounts.every((a) => new RegExp(`\\n${a.name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}  —  `).test(system)));
  check("it is told never to say it is recorded", /never say, in any language, that something is recorded/.test(system));
  check("and to answer the way they wrote", /Bangla in Latin letters/.test(system) && /Name the ones it could be/.test(system));

  /* ------------------------------------------------------------------ */
  console.log("\nF. The page");
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The browser's own calls go to the API this harness started; the page
  // cannot tell. It asks for /api on the web's own port, or the API's when
  // NEXT_PUBLIC_API_URL names it. (Next's server still asks :4001 whether the
  // assistant is on.)
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    const base = [`${WEB}/api/`, `${DEV_API}/api/`].find((prefix) => url.startsWith(prefix));
    if (base) request.continue({ url: url.replace(base, `${API}/`) });
    else request.continue();
  });
  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  const say = async (text, says) => {
    answer = says;
    const answered = page.waitForResponse((response) => response.url().endsWith("/ai/turn") && response.request().method() === "POST", { timeout: 60000 });
    await page.type('textarea[placeholder^="Type it"]', text);
    await page.keyboard.press("Enter");
    await answered;
    await page.waitForFunction(() => !document.body.innerText.includes("Thinking…"), { timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
  };
  const card = () =>
    page.evaluate(() => {
      const heading = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "The draft");
      const box = heading?.closest("div.rounded-xl");
      const save = [...(box?.querySelectorAll("button") ?? [])].find((b) => /Save it/.test(b.textContent));
      return box
        ? {
            head: heading.parentElement.innerText,
            labels: [...box.querySelectorAll("label")].map((l) => l.innerText.trim()),
            values: Object.fromEntries([...box.querySelectorAll("input, textarea")].map((i) => [i.name, i.value])),
            saveDisabled: save ? save.disabled : null,
          }
        : null;
    });
  const transcript = () => page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

  await say(`1 lakh taka transfer koro ${FROM.name} theke Md. Nizam Uddin accounts a`, {
    target: "transaction_out",
    draft: { amount: 100000, accountName: FROM.name, counterparty: "Md. Nizam Uddin", usdRate: 121.5, txnDate: today, description: "Transfer to Md. Nizam Uddin" },
    missingFields: [],
    summary: "1 lakh taka transfer record korechi.",
  });
  let text = await transcript();
  let drawn = await card();
  await shot("draft-not-ready");
  check("the owner's draft: the page asks for the category", text.includes("Which category is this under?"), text.slice(-300).replace(/\n/g, " | "));
  check("\"record korechi\" is nowhere on the page", !/record korechi/i.test(text));
  check("the card says what is still needed, in the form's word", /Still needed: Category/.test(drawn?.head ?? ""), drawn?.head);
  check("and offers no Save", drawn?.saveDisabled === true, String(drawn?.saveDisabled));

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await say(`100 taka transfer koro ${FROM.name} theke ${TO.name} e, rate 121.5`, {
    target: "transfer",
    draft: { amount: "100", fromAccountName: FROM.name, toAccountName: TO.name, usdRate: "121.5", txnDate: today },
    missingFields: [],
    summary: "Transfer record korechi.",
  });
  text = await transcript();
  drawn = await card();
  await shot("transfer-ready");
  check("the transfer: the line under the draft is the code's", text.includes(READY) && !/record korechi/i.test(text), text.slice(-300).replace(/\n/g, " | "));
  check("the card is the transfer form's: From, To, USD rate", ["From", "To", "USD rate", "Amount"].every((l) => drawn?.labels.includes(l)), JSON.stringify(drawn?.labels));
  check("with the two accounts in it", drawn?.values.fromAccountName === FROM.name && drawn?.values.toAccountName === TO.name, JSON.stringify(drawn?.values));
  check("and Save is offered", drawn?.saveDisabled === false, String(drawn?.saveDisabled));

  const transfersBefore = (await q(`select count(*)::int as n from transactions where transfer_group_id is not null`))[0].n;
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Save it/.test(b.textContent))?.click());
  await page.waitForFunction(() => /Saved — /.test(document.body.innerText) || document.querySelector('[role="alert"]'), { timeout: 60000 });
  text = await transcript();
  await shot("transfer-saved");
  const savedLine = text.match(/Saved — [^\n]*/)?.[0] ?? "";
  check("pressing Save records it, and the page says so with its number", /Saved — money moved between our own accounts, TXN-/.test(savedLine), savedLine || text.slice(-300).replace(/\n/g, " | "));
  const madeOnPage = await q(`select id, direction from transactions where transfer_group_id is not null and created_at > now() - interval '2 minutes' and description = $1 and amount = 100 order by created_at desc limit 4`, [`Transfer from ${FROM.name} to ${TO.name}`]);
  made.transfers.push(...madeOnPage.map((r) => r.id));
  const transfersAfter = (await q(`select count(*)::int as n from transactions where transfer_group_id is not null`))[0].n;
  check("exactly one more pair is in the books", transfersAfter - transfersBefore === 2, `${transfersBefore} -> ${transfersAfter}`);
  check("no page error", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser?.close().catch(() => undefined);
  for (const id of made.chats) await call("DELETE", `/ai/chats/${id}`).catch(() => undefined);
  await db.query(`delete from ai_chats where user_id = $1 and created_at > now() - interval '15 minutes' and title like any ($2)`, [user.id, ["1 lakh taka transfer koro%", "100 taka transfer koro%"]]);
  if (made.transfers.length) {
    await db.query(
      `delete from transactions where transfer_group_id in (select transfer_group_id from transactions where id = any ($1::uuid[]))`,
      [made.transfers],
    );
  }
  await db.query(
    `update app_settings set ai_provider = $1, ai_model = $2, ai_data_access = $3, anthropic_api_key = $4, anthropic_key_set_at = $5, anthropic_key_set_by = $6 where id = 1`,
    [before.ai_provider, before.ai_model, before.ai_data_access, before.anthropic_api_key, before.anthropic_key_set_at, before.anthropic_key_set_by],
  );
  const stopped = new Promise((resolve) => api.once("exit", resolve));
  api.kill();
  await stopped;
  stub.close();
  await db.end();
}

const failed = results.filter((pass) => !pass).length;
// What the API itself said, when something failed: a 500 explains itself there.
if (failed) {
  const said = apiLog
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""))
    .filter((line) => /ERROR|WARN|Error|error/.test(line));
  console.log(`\n--- the API's log, its last lines ---\n${said.slice(-12).join("\n")}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
