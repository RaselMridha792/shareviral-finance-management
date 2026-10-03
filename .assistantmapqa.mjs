/**
 * The Assistant knows the app: the map, routing before drafting, a plan and
 * its renewal, the owner's instructions, and the wider look-ups.
 * docs/briefs/2026-10-02-assistant-powerful.md, piece A2.
 *
 * No model is asked here. A stand-in for Anthropic's API answers each round
 * with what the script below tells it to — the answer the owner was given on
 * the live site among them — and what is measured is what THIS APP makes of
 * it:
 *
 *   A. the owner's case: "buy an AI subscription" answered as a plain payment
 *      is sent back to the model once, then refused, with the way to the
 *      screen; a plain payment is left alone; a salary is pointed to Payroll;
 *      a role that could not save a record is not offered one;
 *   B. a new plan: ready when the Add subscription form would take it;
 *   C. a renewal: filled from the plan, its rate asked every time;
 *   D. what the model is told: the map, the plans on file, the owner's
 *      instructions, the two new kinds of record;
 *   E. the look-ups, each run through the real loop and gated on the role;
 *   F. the instructions: read and saved by the Super Admin alone, audited,
 *      limited, and in the prompt from the next turn;
 *   G. the page: the refusal with its link; a plan saved from its card and
 *      shown on AI tools and subscriptions, with its first payment in the
 *      ledger; a renewal saved against its plan; the instructions box.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantmapqa.mjs                   (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantmapqa.mjs    also saves screenshots
 *
 * Starts its own API on :4012 pointed at the stand-in, so the dev API on
 * :4001 is left alone. Puts a made-up Anthropic key in the local app_settings
 * while it runs and puts back what was there, the instructions included.
 * Everything it makes is named MAPQA and deleted afterwards: plans and their
 * payments, an invoice, a bank advice, a budget and its spends, a pay change,
 * its chats. The audit rows of its own changes stay, as they would for
 * anybody.
 */
import { spawn } from "node:child_process";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const DEV_API = "http://localhost:4001";
const PORT = 4012;
const API = `http://localhost:${PORT}/api`;
const STUB_PORT = 4598;
const SHOTS = process.env.SHOT_DIR || null;
/** AI_DRAFT_READY_LINE, in packages/shared/src/ai.ts. */
const READY = "Draft ready — check every line, then press Confirm and save. Nothing is recorded yet.";
/** The subscriptions part's own sentence, in subscriptions/app-map.ts. */
const BELONGS =
  "A subscription is recorded as a plan under AI tools and subscriptions, not as a plain payment. Is this a new plan, or the renewal of one already on file?";

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
const hr = await person("hr");
const cfo = await person("cfo");
if (!admin || !hr || !cfo) throw new Error("The local books need an active super_admin, an hr and a cfo user.");
const tokenFor = (user) => jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const token = tokenFor(admin);
const callAs = (bearer) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const call = callAs(token);
const callHr = callAs(tokenFor(hr));
const callCfo = callAs(tokenFor(cfo));

const results = [];
// A wait left pending when the browser closes must not end the run before
// the settings it changed are put back (it did, twice, 3 Oct 2026).
process.on("unhandledRejection", (error) => console.log(`  (a wait gave up: ${error?.message ?? error})`));
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------------ */
/*  The books this runs against                                              */
/* ------------------------------------------------------------------------ */

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const monthStart = `${today.slice(0, 7)}-01`;
const accounts = await q(
  `select a.id, a.name, a.currency,
          (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null), 0))::numeric as balance
     from accounts a left join transactions t on t.account_id = a.id
    where a.is_active and a.deleted_at is null group by a.id order by a.name`,
);
// The richest taka account pays for the plans.
const CARD = accounts.filter((a) => a.currency !== "USD").sort((a, b) => Number(b.balance) - Number(a.balance))[0];
if (!CARD || Number(CARD.balance) < 20000) throw new Error("The local books need a taka account holding 20,000.");
// A money-out sub-category no part of the map claims.
const [PLAIN] = await q(
  `select c.name from categories c join categories p on p.id = c.parent_id
    where c.is_active and c.deleted_at is null and c.kind <> 'in'
      and c.name !~* 'ai\\s*tool|subscription|software|hosting|server|domain'
      and p.name !~* 'ai\\s*tool|subscription|software|hosting|server|domain'
      and not exists (select 1 from categories o where o.id <> c.id and lower(o.name) = lower(c.name))
    order by c.name limit 1`,
);
// What a plan's payment is filed under here: the endpoint's own answer.
const [TOOLING] = await q(`select id, name from categories where deleted_at is null and kind = 'out' and slug = 'ai-tools' limit 1`);
const [member] = await q(`select id, full_name from team_members where deleted_at is null order by created_at limit 1`);
if (!PLAIN || !TOOLING) throw new Error("The local books need a plain money-out sub-category and the ai-tools one.");

/* ------------------------------------------------------------------------ */
/*  A stand-in for the model: it says what it is told to, round by round     */
/* ------------------------------------------------------------------------ */

// Each request takes the next line of the script; the last one is held, so a
// request sent twice, or a model that will not change its answer, gets the
// same thing again.
let script = [];
const asked = [];
const stub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    asked.push(JSON.parse(raw || "{}"));
    const line = (script.length > 1 ? script.shift() : script[0]) ?? { draft: {}, missingFields: [], summary: "(the harness gave no answer)" };
    const use = line.tool ? { name: line.tool, input: line.input ?? {} } : { name: "answer", input: line };
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_mapqa" });
    res.end(
      JSON.stringify({
        id: "msg_mapqa",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "tool_use", id: `toolu_${asked.length}`, ...use }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
});
await new Promise((resolve) => stub.listen(STUB_PORT, "127.0.0.1", resolve));

const made = { chats: new Set() };
/** One turn: the model "says" each line of `says` in order, the app replies. */
async function turn(text, says, { as = call, carried = {} } = {}) {
  script = Array.isArray(says) ? [...says] : [says];
  const from = asked.length;
  const res = await as("POST", "/ai/turn", { messages: [{ role: "user", content: text }], ...carried });
  if (res.body?.chatId) made.chats.add(res.body.chatId);
  if (res.status !== 200) console.log(`  (the turn "${text.slice(0, 40)}" answered ${res.status}: ${JSON.stringify(res.body)})`);
  return { ...res, requests: asked.slice(from) };
}
const shown = (reply) => reply?.nextQuestion ?? reply?.clarification ?? reply?.summary ?? "";
/** What the app sent back to the model after a round: its tool results. */
const toldBack = (request) =>
  (request?.messages ?? [])
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((block) => block.type === "tool_result");
const systemOf = (request) => (request?.system ?? []).map((block) => block.text).join("\n");

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
const [before] = await q(
  `select ai_provider, ai_model, ai_data_access, anthropic_api_key, anthropic_key_set_at, anthropic_key_set_by,
          ai_instructions, ai_instructions_set_at, ai_instructions_set_by from app_settings where id = 1`,
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

/** Everything this run puts in the books, taken out again at the end. */
async function sweep() {
  await db.query(`delete from transactions where subscription_id in (select id from subscriptions where tool_name like 'MAPQA %')`);
  await db.query(`delete from subscriptions where tool_name like 'MAPQA %'`);
  await db.query(`delete from invoices where invoice_number like 'MAPQA-%'`);
  await db.query(`delete from bank_advices where title like 'MAPQA %'`);
  await db.query(`delete from hr_budget_spends where purpose like 'MAPQA %'`);
  await db.query(`delete from hr_budget_periods where category_name like 'MAPQA %'`);
  await db.query(`delete from compensation_requests where change_reason like 'MAPQA %'`);
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
    [seal("sk-ant-mapqa-00000000000000000000000"), admin.id],
  );

  // Three plans on file, put there directly: no first payment, so a renewal
  // this month is this run's own to make.
  const plan = async (tool, name, costUsd) =>
    (
      await q(
        `insert into subscriptions (tool_name, plan_name, category, status, cost_usd, cost_bdt, usd_rate, billing_cycle, start_date, next_renewal_on, payment_method, account_id, bought_for, created_by, updated_by)
         values ($1, $2, 'ai_tool', 'active', $3, $3::numeric * 122.5, 122.5, 'monthly', $4, $4, 'card', $5, 'MAPQA team', $6, $6) returning id`,
        [tool, name, costUsd, monthStart, CARD.id, admin.id],
      )
    )[0].id;
  const CLAUDE = await plan("MAPQA Claude", "Max", "100");
  await plan("MAPQA Chat", "Plus", "20");
  await plan("MAPQA Chat", "Team", "60");

  /* ------------------------------------------------------------------ */
  console.log("\nA. Where it belongs, decided against the map");
  const asPayment = {
    area: "transactions",
    target: "transaction_out",
    draft: { amount: "2450", accountName: CARD.name, categoryName: TOOLING.name, usdRate: "122.5", txnDate: today, description: "Cursor Pro" },
    missingFields: [],
  };
  const owner = await turn("ekta ai subscription kinlam aaj, Cursor Pro, 20 dollar", asPayment);
  check("the turn answers", owner.status === 200, String(owner.status));
  check("a subscription drafted as a plain payment is not offered: no draft, no target", owner.body?.target === null && Object.keys(owner.body?.draft ?? { x: 1 }).length === 0, `${owner.body?.target} ${JSON.stringify(owner.body?.draft)}`);
  check("the person is told where it belongs, and asked which it is", owner.body?.nextQuestion === BELONGS, shown(owner.body));
  check("the reply names the part and the way to its screen", owner.body?.area === "subscriptions" && owner.body?.screen?.href === "/subscriptions" && owner.body?.screen?.name === "AI tools and subscriptions", JSON.stringify([owner.body?.area, owner.body?.screen]));
  check("the model was asked twice: its answer went back to it once", owner.requests.length === 2, String(owner.requests.length));
  const sentBack = toldBack(owner.requests[1]).at(-1);
  check("it was told why, and what to draft instead", sentBack?.is_error === true && /Refused by the app/.test(sentBack?.content ?? "") && /\[subscriptions\]/.test(sentBack?.content ?? "") && /subscription or subscription_payment/.test(sentBack?.content ?? ""), String(sentBack?.content).slice(0, 160));
  const [ownerChat] = await q(`select messages, reply from ai_chats where id = $1`, [owner.body?.chatId]);
  check("the saved conversation carries the question, and no payment draft", ownerChat?.messages?.at(-1)?.content === BELONGS && ownerChat?.reply?.target === null, JSON.stringify(ownerChat?.reply?.target));

  const asPlan = {
    area: "subscriptions",
    target: "subscription",
    draft: { toolName: "MAPQA Cursor", planName: "Pro", category: "AI Tool", costUsd: "$20", usdRate: 122.5, startDate: today, accountName: CARD.name, status: "canceled", users: "everybody" },
    missingFields: [],
    summary: "Plan ta add korechi.",
  };
  const corrected = await turn("ekta ai subscription kinlam aaj, Cursor Pro, 20 dollar", [asPayment, asPlan]);
  check("sent back once, the model drafts a plan — and that is what is offered", corrected.body?.target === "subscription" && corrected.body?.area === "subscriptions" && corrected.requests.length === 2, `${corrected.body?.target} in ${corrected.requests.length} rounds`);
  check("the plan is ready, under the code's own line", corrected.body?.missingFields?.length === 0 && corrected.body?.summary === READY, shown(corrected.body));

  const byWords = await turn("ai subscription kinlam aaj 20 dollar", {
    area: "transactions",
    target: "transaction_out",
    draft: { amount: "2450", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: "Monthly payment" },
    missingFields: [],
  });
  check(`refused by what was typed, though the category chosen was "${PLAIN.name}"`, byWords.body?.target === null && byWords.body?.nextQuestion === BELONGS, shown(byWords.body));

  const plain = await turn(`aaj courier bill 500 taka dilam ${CARD.name} theke, rate 122.5`, {
    area: "expenses",
    target: "transaction_out",
    draft: { amount: "500", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: "Courier bill" },
    missingFields: [],
  });
  check("a plain payment is left alone: one round, ready, and under the part the model named", plain.body?.target === "transaction_out" && plain.body?.summary === READY && plain.requests.length === 1 && plain.body?.area === "expenses" && plain.body?.screen === null, `${plain.body?.target} / ${shown(plain.body)} / ${plain.requests.length} / ${plain.body?.area}`);

  const asVendor = await turn("openai ke add koro", { area: "vendors", target: "vendor", draft: { name: "OpenAI", type: "ai_tool" }, missingFields: [] });
  check("a tool drafted as a vendor is refused the same way", asVendor.body?.target === null && asVendor.body?.nextQuestion === BELONGS, shown(asVendor.body));

  const salary = await turn("september er salary dilam 5 lakh", {
    area: "payroll",
    target: "transaction_out",
    draft: { amount: "500000", accountName: CARD.name, usdRate: "122.5", txnDate: today, description: "September salary" },
    missingFields: [],
  });
  check("a salary drafted as a payment is refused, in Payroll's own sentence", salary.body?.target === null && /^I cannot record a salary payment/.test(salary.body?.summary ?? "") && salary.body?.nextQuestion === null, shown(salary.body));
  check("with the way to Payroll", salary.body?.area === "payroll" && salary.body?.screen?.href === "/payroll", JSON.stringify(salary.body?.screen));

  const pointed = await turn("salary sheet finalise koro", { area: "payroll", draft: {}, missingFields: [], summary: "Ami salary sheet finalise korte pari na. Payroll e giye oi masher sheet e Finalise chapun." });
  check("an answer that only points keeps its own words, and gets the link", /^Ami salary sheet finalise korte pari na/.test(pointed.body?.summary ?? "") && pointed.body?.screen?.href === "/payroll" && pointed.requests.length === 1, `${shown(pointed.body)} ${JSON.stringify(pointed.body?.screen)}`);

  const noArea = await turn("kemon acho", { draft: {}, missingFields: [], summary: "Bhalo. Ki record korbo?" });
  check("an answer with no part named carries no link", noArea.body?.screen === null && noArea.body?.area === null, JSON.stringify([noArea.body?.area, noArea.body?.screen]));

  // HR held `ai.use` until B1 (3 Oct 2026), and was the role the gates inside
  // a turn were measured on: a draft the role cannot save, the look-ups it may
  // not run. The Super Admin and the CFO are the only roles left, and both
  // save and read everything, so no real role reaches those gates now;
  // routing.spec.ts keeps the role gate as unit tests.
  const asHr = await turn("aaj courier bill 500 taka dilam", { area: "transactions", target: "transaction_out", draft: { amount: "500", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: "Courier bill" }, missingFields: [] }, { as: callHr });
  check("HR is refused the Assistant (403), and nothing reaches the model", asHr.status === 403 && asHr.requests.length === 0, `${asHr.status} ${asHr.requests.length}`);

  const named = await turn(`MAPQA Claude er bill dilam 500 taka ${CARD.name} theke, rate 122.5`, {
    area: "expenses",
    target: "transaction_out",
    draft: { amount: "500", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: "MAPQA Claude bill" },
    missingFields: [],
  });
  check("a plain payment that names a plan on file is offered, with the plan pointed out", named.body?.target === "transaction_out" && named.body?.summary === `MAPQA Claude is on file under AI tools and subscriptions. If this is its payment, say so and I will draft the renewal instead of a plain payment. ${READY}`, shown(named.body));

  const notOne = await turn("na, eta subscription na, newspaper er bill", { area: "expenses", target: "transaction_out", draft: { amount: "500", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: "Newspaper bill" }, missingFields: [] }, { carried: { target: "transaction_out", draft: { amount: "500" } } });
  check("\"eta subscription na\", said of a draft on the table, does not take the draft away", notOne.body?.target === "transaction_out" && notOne.body?.summary === READY && notOne.requests.length === 1, `${notOne.body?.target} ${shown(notOne.body)}`);

  const twice = await turn("claude", asPayment, { carried: {} });
  const secondTime = await call("POST", "/ai/turn", { messages: [{ role: "user", content: "ai subscription" }, { role: "assistant", content: BELONGS }, { role: "user", content: "claude er" }] });
  if (secondTime.body?.chatId) made.chats.add(secondTime.body.chatId);
  check("asked the same again, it says plainly what it can do and the way round it", twice.body?.nextQuestion === BELONGS && /^I can record a subscription only as a plan/.test(secondTime.body?.summary ?? "") && /ordinary form/.test(secondTime.body?.summary ?? ""), shown(secondTime.body));

  const table = await turn("MAPQA Claude r MAPQA Chat Plus duitai renew korlam", { area: "subscriptions", draft: {}, missingFields: [], batch: { target: "subscription_payment", rows: [{ subscriptionName: "MAPQA Claude", txnDate: today }, { subscriptionName: "MAPQA Chat › Plus", txnDate: today }], note: "2 renewals" } });
  check("renewals are never offered as a table: they are drafted one at a time", table.body?.batch === null && table.body?.target === null && /one at a time/.test(shown(table.body)) && table.requests.length === 2, `${shown(table.body)} / ${table.requests.length}`);

  const file = await turn("ei file ta import koro", { area: "data", draft: {}, missingFields: [], importPlan: { accountName: CARD.name, categoryName: TOOLING.name, columnMap: { Date: "txnDate", Amount: "amount", Details: "description" }, usdRate: "122.5", note: "12 rows" } });
  check("a file to be filed under the tooling heading is not staged as plain payments", file.body?.importPlan === null && /Import takes plain entries only/.test(shown(file.body)), shown(file.body));

  /* ------------------------------------------------------------------ */
  console.log("\nB. A new plan, as the Add subscription form takes it");
  const drafted = corrected.body?.draft ?? {};
  check("the figures are text, the dollar sign off, the category as the form stores it", drafted.costUsd === "20" && drafted.usdRate === "122.5" && drafted.category === "ai_tool", JSON.stringify(drafted));
  check("the account reads as the books spell it", drafted.accountName === CARD.name, String(drafted.accountName));
  check("the status and the seats are not the model's to set", !("status" in drafted) && !("users" in drafted), Object.keys(drafted).join(", "));
  check("\"Plan ta add korechi\" is not shown", !/korechi/i.test(JSON.stringify([corrected.body?.summary, corrected.body?.nextQuestion])), shown(corrected.body));

  const noCard = await turn("cursor pro kinlam 20 dollar", { area: "subscriptions", target: "subscription", draft: { toolName: "MAPQA Cursor", planName: "Pro", category: "ai_tool", costUsd: "20", usdRate: "122.5", startDate: today }, missingFields: [] });
  check("with no account it is not ready: the price comes out of one when it is saved", JSON.stringify(noCard.body?.missingFields) === '["accountName"]' && /The price comes out of it when the plan is saved/.test(noCard.body?.nextQuestion ?? ""), shown(noCard.body));

  const noRate = await turn("cursor pro kinlam 20 dollar", { area: "subscriptions", target: "subscription", draft: { toolName: "MAPQA Cursor", planName: "Pro", category: "ai_tool", costUsd: "20", startDate: today, accountName: CARD.name }, missingFields: [] });
  check("with no rate it is not ready", JSON.stringify(noRate.body?.missingFields) === '["usdRate"]', JSON.stringify(noRate.body?.missingFields));

  const onFile = await turn("MAPQA Claude kinlam aaj", { area: "subscriptions", target: "subscription", draft: { toolName: "MAPQA Claude", category: "ai_tool", costUsd: "100", usdRate: "122.5", startDate: today, accountName: CARD.name }, missingFields: [] });
  check("a tool already on file is asked about: a renewal, or a new plan?", onFile.body?.missingFields?.[0] === "planName" && onFile.body?.nextQuestion === "MAPQA Claude is on file already: MAPQA Claude › Max. Is this a renewal, or a new plan? If it is new, which plan is it?", shown(onFile.body));

  const twin = await turn("MAPQA Claude Max kinlam aaj", { area: "subscriptions", target: "subscription", draft: { toolName: "MAPQA Claude", planName: "Max", category: "ai_tool", costUsd: "100", usdRate: "122.5", startDate: today, accountName: CARD.name }, missingFields: [] });
  check("the same plan again is offered, with what is on file said beside it", twin.body?.missingFields?.length === 0 && twin.body?.summary === `MAPQA Claude is already on file. If this is its renewal, say so and I will draft that instead of a second plan. ${READY}`, shown(twin.body));

  /* ------------------------------------------------------------------ */
  console.log("\nC. A renewal, as the Renew drawer takes it");
  const renew = await turn("mapqa claude renew korlam aaj", { area: "subscriptions", target: "subscription_payment", draft: { subscriptionName: "mapqa claude", txnDate: today, categoryName: TOOLING.name, advanceRenewal: false }, missingFields: [] });
  check("a renewal is a kind of record the app takes", renew.status === 200 && renew.body?.target === "subscription_payment", `${renew.status} ${renew.body?.target}`);
  check("the plan's own price and card are on the draft, to be checked", renew.body?.draft?.usdAmount === "100.00" && renew.body?.draft?.accountName === CARD.name && renew.body?.draft?.subscriptionName === "MAPQA Claude", JSON.stringify(renew.body?.draft));
  check("the rate is asked for, with the plan's own offered and not taken", JSON.stringify(renew.body?.missingFields) === '["usdRate"]' && renew.body?.nextQuestion === "What rate was this renewal charged at? The plan's own is 122.5." && !("usdRate" in (renew.body?.draft ?? {})), shown(renew.body));
  check("a category and the renewal switch are not the model's to set", !("categoryName" in renew.body.draft) && !("advanceRenewal" in renew.body.draft), Object.keys(renew.body?.draft ?? {}).join(", "));

  const renewReady = await turn("121.75", { area: "subscriptions", target: "subscription_payment", draft: { subscriptionName: "MAPQA Claude", txnDate: today, usdRate: 121.75 }, missingFields: [] }, { carried: { target: "subscription_payment", draft: renew.body?.draft } });
  check("with the rate it is ready", renewReady.body?.missingFields?.length === 0 && renewReady.body?.summary === READY && renewReady.body?.draft?.usdRate === "121.75", shown(renewReady.body));
  const shownBack = systemOf(renewReady.requests[0]).split("Already understood:")[1] ?? "";
  check("the plan's own price and card are not shown back to the model as things it was told", /MAPQA Claude/.test(shownBack) && !/usdAmount|Master card/.test(shownBack.replace(/Keep these[\s\S]*/, "")), shownBack.slice(0, 200).replace(/\n/g, " "));
  const switched = await turn("na, MAPQA Chat › Team er", { area: "subscriptions", target: "subscription_payment", draft: { subscriptionName: "MAPQA Chat › Team", txnDate: today, usdRate: "122" }, missingFields: [] }, { carried: { target: "subscription_payment", draft: renewReady.body?.draft } });
  check("switched to another plan, the draft carries that plan's price, not the first one's", switched.body?.draft?.usdAmount === "60.00" && switched.body?.draft?.subscriptionName === "MAPQA Chat › Team", JSON.stringify(switched.body?.draft));

  const near = await turn("mapqa claude code renew", { area: "subscriptions", target: "subscription_payment", draft: { subscriptionName: "MAPQA Claude Code", txnDate: today, usdRate: "122" }, missingFields: [] });
  check("a name that only resembles a plan is asked about, never taken", near.body?.missingFields?.[0] === "subscriptionName" && near.body?.nextQuestion === 'There is no plan called "MAPQA Claude Code" under AI tools and subscriptions. Did you mean MAPQA Claude? If it is a new plan, say so.' && !("usdAmount" in near.body.draft), shown(near.body));
  // That Confirm and save posts it against the plan itself and its card, by
  // id, is measured on the page below (G): its ledger row is read back.

  const whichOne = await turn("mapqa chat renew", { area: "subscriptions", target: "subscription_payment", draft: { subscriptionName: "MAPQA Chat", txnDate: today, usdRate: "122" }, missingFields: [] });
  check("a tool with two plans is asked about, with both named", whichOne.body?.missingFields?.[0] === "subscriptionName" && whichOne.body?.nextQuestion === '"MAPQA Chat" could be MAPQA Chat › Plus or MAPQA Chat › Team. Which one?', shown(whichOne.body));
  const refusedSave = await call("POST", "/ai/confirm", { chatId: whichOne.body?.chatId, draft: { subscriptionName: "MAPQA Chat", txnDate: today, usdRate: "122" } });
  check("and Confirm and save refuses the same name rather than taking the first", refusedSave.status === 400 && /MAPQA Chat › Plus/.test(refusedSave.body?.message ?? "") && /MAPQA Chat › Team/.test(refusedSave.body?.message ?? ""), `${refusedSave.status} ${refusedSave.body?.message}`);

  const noPlan = await turn("Record this month's payment for the Zylofone Pro subscription - the usual amount, from the usual account.", { area: "subscriptions", target: "subscription_payment", draft: { subscriptionName: "Zylofone Pro", txnDate: today }, missingFields: [] });
  check("a plan that is not on file gets no amount and no account: it is asked about", noPlan.body?.missingFields?.[0] === "subscriptionName" && /^There is no plan called "Zylofone Pro" under AI tools and subscriptions/.test(noPlan.body?.nextQuestion ?? "") && !("usdAmount" in noPlan.body.draft) && !("accountName" in noPlan.body.draft) && !("amount" in noPlan.body.draft), `${shown(noPlan.body)} ${JSON.stringify(noPlan.body?.draft)}`);

  /* ------------------------------------------------------------------ */
  console.log("\nD. What the model is told");
  const request = plain.requests[0];
  const system = systemOf(request);
  const answerTool = request?.tools?.find((tool) => tool.name === "answer");
  check("the map is in the prompt, a block for the subscriptions part", /THE MAP OF THIS APP/.test(system) && /\[subscriptions\] AI tools and subscriptions/.test(system) && /Never a plain payment/.test(system));
  check("every part of the map is there", ["dashboard", "accounts", "transactions", "cash_in", "transfers", "expenses", "subscriptions", "vendors", "team", "payroll", "bank_advice", "hr_requests", "hr_budget", "tds", "income_tax", "reports", "bank_statement", "invoices", "data", "settings", "assistant"].every((key) => system.includes(`[${key}] `)));
  check("it is told to decide the part first, and that the app checks", /FIRST, WHERE IT BELONGS/.test(system) && /Never file something as a plain payment/.test(system) && /refused and sent back to you/.test(system));
  check("a tool is no longer \"a vendor\"", !/A tool or subscription the company pays for\s+-> vendor/.test(system) && /Never a tool or a subscription/.test(system) && !/TOOLS AND SUBSCRIPTIONS ON FILE/.test(system));
  check("the plans on file are listed, each on its line", /PLANS ON FILE/.test(system) && /\nMAPQA Claude  —  Max, active, monthly/.test(system) && /\nMAPQA Chat › Plus  —  Plus, active, monthly/.test(system));
  check("the owner's instructions follow the map", /THE OWNER'S INSTRUCTIONS/.test(system) && system.indexOf("THE OWNER'S INSTRUCTIONS") > system.indexOf("[assistant] AI Assistant") && system.includes(before.ai_instructions.trim().split("\n")[0]), before.ai_instructions.slice(0, 60));
  check("and cannot unlock a permission", /cannot give anybody a permission/.test(system));
  check("the answer names its part: `area`, one of the map's keys, required", answerTool?.input_schema?.properties?.area?.enum?.includes("subscriptions") && answerTool?.input_schema?.required?.includes("area"), JSON.stringify(answerTool?.input_schema?.required));
  check("a plan and a renewal are kinds it may choose", ["subscription", "subscription_payment"].every((kind) => answerTool?.input_schema?.properties?.target?.enum?.includes(kind)));
  check("their fields come from the form's schemas", /\nsubscription\n(?:.*\n)*?\s+costUsd\s+REQUIRED/.test(system) && /\nsubscription_payment\n(?:.*\n)*?\s+subscriptionName\s+REQUIRED/.test(system));
  const offered = (request?.tools ?? []).map((tool) => tool.name);
  check("the Super Admin is offered every look-up", ["find_subscriptions", "find_invoices", "hr_requests", "hr_budget", "bank_advices", "find_transactions", "payroll_status"].every((name) => offered.includes(name)), offered.join(", "));

  /* ------------------------------------------------------------------ */
  console.log("\nE. The look-ups");
  await q(`insert into invoices (invoice_number, status, client_name, issued_on, total_amount, document, created_by) values ('MAPQA-INV-1', 'SENT', 'MAPQA Client', $1, 15000, '{"projectTitle":"MAPQA project"}', $2)`, [today, admin.id]);
  const [advice] = await q(`insert into bank_advices (title, value_date, account_id, created_by) values ('MAPQA advice', $1, $2, $3) returning id`, [today, CARD.id, admin.id]);
  await q(`insert into bank_advice_lines (bank_advice_id, beneficiary_name, amount, position) values ($1, 'MAPQA One', 1000, 1), ($1, 'MAPQA Two', 2500, 2)`, [advice.id]);
  const budget = randomUUID();
  await q(`insert into hr_budget_periods (external_id, category_name, starts_on, ends_on, amount, recorded_by_name, status, decided_by, decided_at) values ($1, 'MAPQA Snacks', $2, $3, 50000, 'MAPQA HR', 'approved', $4, now())`, [budget, monthStart, today, admin.id]);
  await q(
    `insert into hr_budget_spends (external_id, budget_external_id, spent_on, amount, purpose, hr_status, recorded_by_name, status)
     values ($1, $3, $4, 1200, 'MAPQA tea', 'proposed', 'MAPQA HR', 'approved'), ($2, $3, $4, 800, 'MAPQA cups', 'proposed', 'MAPQA HR', 'received')`,
    [randomUUID(), randomUUID(), budget, today],
  );
  if (member) await q(`insert into compensation_requests (external_id, team_member_id, gross_amount, effective_from, change_reason, status) values ($3, $1, 98765, $2, 'MAPQA raise', 'received')`, [member.id, today, randomUUID()]);

  /** One look-up through the real loop: the tool is called, then answered. */
  const lookUp = async (tool, input = {}, as = call) => {
    const run = await turn(`look up ${tool}`, [{ tool, input }, { area: "assistant", draft: {}, missingFields: [], summary: "ok" }], { as });
    return toldBack(run.requests.at(-1)).at(-1) ?? {};
  };

  const plans = await lookUp("find_subscriptions", { search: "MAPQA" });
  check("find_subscriptions: the plan, its price, its rate and its card", plans.is_error === false && /MAPQA Claude — Max \(ai tool, active\)/.test(plans.content) && /\$100\.00, monthly, at a rate of 122\.5/.test(plans.content) && plans.content.includes(`paid from ${CARD.name}`), String(plans.content).slice(0, 300));
  check("and that nothing has been paid against it yet", /paid: nothing recorded against this plan/.test(plans.content ?? ""));

  const invoices = await lookUp("find_invoices", { search: "MAPQA" });
  check("find_invoices: the number, the status, the client and the total", /MAPQA-INV-1 · SENT · MAPQA Client · MAPQA project · ৳15,000\.00/.test(invoices.content ?? ""), String(invoices.content).slice(0, 300));

  const budgets = await lookUp("hr_budget", { search: "MAPQA" });
  check("hr_budget: the budget, what was approved against it and what still waits", /MAPQA Snacks, .* asked ৳50,000\.00 \(approved\); 2 spends against it — approved ৳1,200\.00, of which paid ৳0\.00; still waiting ৳800\.00/.test(budgets.content ?? ""), String(budgets.content).slice(0, 300));
  check("and its latest spends", /MAPQA tea · approved/.test(budgets.content ?? "") && /MAPQA cups · pending/.test(budgets.content ?? ""), String(budgets.content).slice(-200));

  const requests = await lookUp("hr_requests", {});
  check("hr_requests: what is waiting, the spend with its amount", /Spend · MAPQA cups · ৳800\.00/.test(requests.content ?? "") && !/MAPQA tea/.test(requests.content ?? ""), String(requests.content).slice(0, 400));
  if (member) {
    // Nor HR's own words about it, which can carry the figure.
    check("a pay change is listed with who, and never how much, nor HR's reason", new RegExp(`Pay change · ${member.full_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · for `).test(requests.content ?? "") && !/98[,.]?765|MAPQA raise/.test(requests.content ?? ""), String(requests.content).slice(0, 400));
  } else {
    console.log("  (nobody on the local team; the pay-change check is skipped)");
  }

  const advices = await lookUp("bank_advices");
  check("bank_advices: the file, its payments and its total — nobody's own amount", /MAPQA advice: value date \d{4}-\d{2}-\d{2}, 2 payments totalling ৳3,500\.00/.test(advices.content ?? "") && !/MAPQA One|2,500\.00|1,000\.00/.test(advices.content ?? ""), String(advices.content).slice(0, 300));

  // Counting, which the owner found missing on the live site: "amader total
  // team member kotojon?" The figures are the books' own, read here.
  const [team] = await q(
    `select count(*)::int as everyone,
            count(*) filter (where status in ('active', 'on_leave'))::int as current,
            count(*) filter (where status in ('active', 'on_leave') and engagement_type = 'contractor')::int as contractors
       from team_members where deleted_at is null`,
  );
  const counted = await lookUp("team_members");
  check("team_members: the Team screen's own total, current and past, as the books have them", (counted.content ?? "").startsWith(`The Team screen lists ${team.everyone} people in all: ${team.current} current`) && (counted.content ?? "").includes(`and ${team.everyone - team.current} past`), String(counted.content).slice(0, 240));
  check("and never a figure of anybody's pay", !/৳|salary|gross/i.test(counted.content ?? ""));
  const contractors = await lookUp("team_members", { status: "current", engagement: "contractor" }, callCfo);
  check("the CFO may count the team too, filtered",contractors.is_error === false && (contractors.content ?? "").includes(`${team.contractors} match what was asked.`), String(contractors.content).slice(0, 240));
  const [{ vendors: vendorCount }] = await q(`select count(*)::int as vendors from vendors where deleted_at is null`);
  const vendorList = await lookUp("list_vendors");
  check("list_vendors: how many vendors are on file", vendorCount ? (vendorList.content ?? "").startsWith(`${vendorCount} vendor${vendorCount === 1 ? "" : "s"} on file`) : /No vendor on file/.test(vendorList.content ?? ""), String(vendorList.content).slice(0, 160));
  const [{ plans: planCount }] = await q(`select count(*)::int as plans from subscriptions where deleted_at is null`);
  const allPlans = await lookUp("find_subscriptions");
  check("find_subscriptions counts every plan, not only the sixty listed", (allPlans.content ?? "").startsWith(`${planCount} plan${planCount === 1 ? "" : "s"}: `), String(allPlans.content).slice(0, 160));

  /* ------------------------------------------------------------------ */
  console.log("\nF. The owner's instructions");
  const read = await call("GET", "/ai/instructions");
  check("the Super Admin reads them", read.status === 200 && read.body?.instructions === before.ai_instructions, `${read.status} ${String(read.body?.instructions).slice(0, 60)}`);
  const readHr = await callHr("GET", "/ai/instructions");
  const readCfo = await callCfo("GET", "/ai/instructions");
  // B2's permission change (3 Oct 2026): the CFO reads them and saves none.
  check("the CFO reads them too", readCfo.status === 200 && readCfo.body?.instructions === before.ai_instructions, `${readCfo.status}`);
  check("HR does not", readHr.status === 403, `${readHr.status}`);
  const settings = await callCfo("GET", "/settings");
  check("and GET /settings carries none of it", settings.status === 200 && !Object.keys(settings.body ?? {}).some((key) => /instruction/i.test(key)), Object.keys(settings.body ?? {}).filter((key) => /instruction/i.test(key)).join(", "));

  const RULE = "MAPQA rule: Namecheap domain = Ai Tools and Subscriptions.";
  const written = await call("PUT", "/ai/instructions", { instructions: `  ${RULE}\r\nMAPQA rule two.  ` });
  check("the Super Admin saves them, tidied", written.status === 200 && written.body?.instructions === `${RULE}\nMAPQA rule two.` && written.body?.setBy === admin.full_name && Boolean(written.body?.setAt), `${written.status} ${JSON.stringify(written.body)}`);
  const writtenCfo = await callCfo("PUT", "/ai/instructions", { instructions: "CFO's rule" });
  check("the CFO cannot", writtenCfo.status === 403, String(writtenCfo.status));
  const tooLong = await call("PUT", "/ai/instructions", { instructions: "a".repeat(4001) });
  check("over 4,000 characters is refused, and says the limit", tooLong.status === 400 && /4,000 characters/.test(JSON.stringify(tooLong.body)), `${tooLong.status} ${JSON.stringify(tooLong.body).slice(0, 160)}`);
  const [audited] = await q(`select summary, before, after from audit_logs where entity_table = 'app_settings' and summary = 'Changed the instructions for the Assistant' order by occurred_at desc limit 1`);
  check("the change is in the audit log, with the text before and after", audited?.after?.instructions === `${RULE}\nMAPQA rule two.` && audited?.before?.instructions === before.ai_instructions, JSON.stringify(audited?.after));
  const after = await turn("kemon acho", { area: "assistant", draft: {}, missingFields: [], summary: "Bhalo." });
  check("the next turn's prompt carries the new rule", systemOf(after.requests[0]).includes(RULE) && !systemOf(after.requests[0]).includes(before.ai_instructions.trim().split("\n")[0]));
  const cleared = await call("PUT", "/ai/instructions", { instructions: "" });
  const empty = await turn("kemon acho", { area: "assistant", draft: {}, missingFields: [], summary: "Bhalo." });
  check("with none saved, the prompt has no such section", cleared.status === 200 && cleared.body?.instructions === "" && !/THE OWNER'S INSTRUCTIONS/.test(systemOf(empty.requests[0])), String(cleared.status));
  await call("PUT", "/ai/instructions", { instructions: `${RULE}\nMAPQA rule two.` });

  /* ------------------------------------------------------------------ */
  console.log("\nG. The page");
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The browser's own calls go to the API this harness started; the page
  // cannot tell. (Next's server still asks :4001, which reads the same books.)
  await page.setRequestInterception(true);
  page.on("request", (intercepted) => {
    const url = intercepted.url();
    const base = [`${WEB}/api/`, `${DEV_API}/api/`].find((prefix) => url.startsWith(prefix));
    if (base) intercepted.continue({ url: url.replace(base, `${API}/`) });
    else intercepted.continue();
  });
  const say = async (text, says) => {
    script = Array.isArray(says) ? [...says] : [says];
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
      const save = [...(box?.querySelectorAll("button") ?? [])].find((b) => /Confirm and save/.test(b.textContent));
      return box
        ? {
            head: heading.parentElement.innerText,
            text: box.innerText,
            labels: [...box.querySelectorAll("label")].map((l) => l.innerText.trim()),
            values: Object.fromEntries([...box.querySelectorAll("input, textarea")].map((i) => [i.name, i.value])),
            saveDisabled: save ? save.disabled : null,
          }
        : null;
    });
  const transcript = () => page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  const links = () => page.evaluate(() => [...document.querySelectorAll("main a")].map((a) => ({ text: a.innerText.trim(), href: a.getAttribute("href") })));
  const pressSave = async () => {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Confirm and save/.test(b.textContent))?.click());
    await page.waitForFunction(() => /Saved — /.test(document.body.innerText) || document.querySelector('[role="alert"]'), { timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
  };
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await say("ekta ai subscription kinlam aaj, Cursor Pro, 20 dollar", asPayment);
  let text = await transcript();
  await shot("subscription-refused");
  check("the owner's request: the page says where it belongs, and asks", text.includes(BELONGS), text.slice(-300).replace(/\n/g, " | "));
  check("no draft card is drawn for the plain payment", (await card()) === null);
  check("and the way to the screen is beside the answer", (await links()).some((a) => a.text === "Open AI tools and subscriptions" && a.href === "/subscriptions"), JSON.stringify(await links()));

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await say("ekta ai subscription kinlam aaj, MAPQA Cursor Pro, 20 dollar, rate 122.5", [asPayment, asPlan]);
  text = await transcript();
  let drawn = await card();
  await shot("plan-ready");
  check("a new plan: the card is the form's — Tool, Plan, Price, Paid from", ["Tool", "Plan", "Category", "Price (USD)", "USD rate", "Start date", "Paid from"].every((l) => drawn?.labels.includes(l)), JSON.stringify(drawn?.labels));
  check("with what was said in it", drawn?.values.toolName === "MAPQA Cursor" && drawn?.values.costUsd === "20" && drawn?.values.accountName === CARD.name, JSON.stringify(drawn?.values));
  check("the price is read back in dollars", /Read the price back before saving: \$20\.00/.test(drawn?.text ?? ""), (drawn?.text ?? "").slice(-200).replace(/\n/g, " | "));
  check("the line under it is the code's, and Confirm and save is offered", text.includes(READY) && drawn?.saveDisabled === false && !/korechi/i.test(text), String(drawn?.saveDisabled));

  const balanceBefore = Number((await q(`select (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null), 0))::text as b from accounts a left join transactions t on t.account_id = a.id where a.id = $1 group by a.id`, [CARD.id]))[0].b);
  await pressSave();
  text = await transcript();
  await shot("plan-saved");
  const planLine = text.match(/Saved — [^\n]*/)?.[0] ?? "";
  check("pressing Confirm and save records it, and the page says what and where", /^Saved — a new plan under AI tools and subscriptions: MAPQA Cursor, Pro, \$20\.00, its first payment TXN-[\w-]+\. It shows under AI tools and subscriptions\.$/.test(planLine), planLine || text.slice(-300).replace(/\n/g, " | "));
  check("with the way to that page", (await links()).some((a) => a.text === "Open AI tools and subscriptions" && a.href === "/subscriptions"), JSON.stringify(await links()));
  const [savedPlan] = await q(`select id, plan_name, category, status, cost_usd::text, cost_bdt::text, usd_rate::text, account_id, next_renewal_on::text from subscriptions where tool_name = 'MAPQA Cursor' and deleted_at is null`);
  check("the plan is in the register, as the form would have written it", savedPlan?.plan_name === "Pro" && savedPlan?.category === "ai_tool" && savedPlan?.status === "active" && savedPlan?.cost_usd === "20.00" && savedPlan?.cost_bdt === "2450.00" && Number(savedPlan?.usd_rate) === 122.5 && savedPlan?.account_id === CARD.id, JSON.stringify(savedPlan));
  const firstPayments = savedPlan ? await q(`select direction, amount::text, original_amount::text, usd_rate::text, category_id, account_id, description, txn_date::text from transactions where subscription_id = $1 and voided_at is null`, [savedPlan.id]) : [];
  check("its first payment is in the ledger, against the plan, under the tooling heading", firstPayments.length === 1 && firstPayments[0].direction === "out" && firstPayments[0].amount === "2450.00" && firstPayments[0].original_amount === "20.00" && firstPayments[0].category_id === TOOLING.id && firstPayments[0].account_id === CARD.id && firstPayments[0].txn_date === today && /^MAPQA Cursor — First payment, recorded when the plan was added$/.test(firstPayments[0].description), JSON.stringify(firstPayments));
  const balanceAfter = Number((await q(`select (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null), 0))::text as b from accounts a left join transactions t on t.account_id = a.id where a.id = $1 group by a.id`, [CARD.id]))[0].b);
  check("and the account is 2,450 lighter", Math.round((balanceBefore - balanceAfter) * 100) === 245000, `${balanceBefore} -> ${balanceAfter}`);

  await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes("MAPQA"), { timeout: 60000 }).catch(() => undefined);
  const register = await page.evaluate(() => [...document.querySelectorAll("tbody tr")].map((row) => row.innerText.replace(/\s+/g, " ")).filter((row) => row.includes("MAPQA Cursor")));
  await shot("plan-on-the-page");
  check("the AI tools and subscriptions page shows the plan — where the owner looked for it", register.length === 1 && /Pro/.test(register[0]) && /20\.00/.test(register[0]), register.join(" || ").slice(0, 300));

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await say("mapqa claude renew korlam aaj, rate 121.75", { area: "subscriptions", target: "subscription_payment", draft: { subscriptionName: "MAPQA Claude", txnDate: today, usdRate: "121.75" }, missingFields: [], summary: "Renewal record korechi." });
  text = await transcript();
  drawn = await card();
  await shot("renewal-ready");
  check("a renewal: the card is the drawer's — Plan, date, dollars, rate, Paid from", ["Plan", "Date it was charged", "Amount (USD)", "USD rate", "Paid from"].every((l) => drawn?.labels.includes(l)), JSON.stringify(drawn?.labels));
  check("filled from the plan: its price and its card", drawn?.values.subscriptionName === "MAPQA Claude" && drawn?.values.usdAmount === "100.00" && drawn?.values.accountName === CARD.name && drawn?.values.usdRate === "121.75", JSON.stringify(drawn?.values));
  check("ready, and \"record korechi\" nowhere", text.includes(READY) && drawn?.saveDisabled === false && !/korechi/i.test(text));
  await pressSave();
  text = await transcript();
  await shot("renewal-saved");
  const renewalLine = text.match(/Saved — [^\n]*/)?.[0] ?? "";
  check("Confirm and save records the renewal, and says where it shows", /^Saved — a plan's renewal, under AI tools and subscriptions, TXN-[\w-]+: MAPQA Claude, \$100\.00\. It shows under AI tools and subscriptions\.$/.test(renewalLine), renewalLine || text.slice(-300).replace(/\n/g, " | "));
  const renewals = await q(`select direction, amount::text, original_amount::text, usd_rate::text, category_id, account_id, description from transactions where subscription_id = $1 and voided_at is null`, [CLAUDE]);
  check("the ledger holds it against the plan: 100 dollars at 121.75", renewals.length === 1 && renewals[0].direction === "out" && renewals[0].amount === "12175.00" && renewals[0].original_amount === "100.00" && Number(renewals[0].usd_rate) === 121.75 && renewals[0].category_id === TOOLING.id && renewals[0].account_id === CARD.id, JSON.stringify(renewals));
  const [moved] = await q(`select next_renewal_on::text from subscriptions where id = $1`, [CLAUDE]);
  check("and the plan's next renewal has moved on a month", moved?.next_renewal_on > today && moved.next_renewal_on.slice(8) === "01", String(moved?.next_renewal_on));

  const paidNow = await lookUp("find_subscriptions", { search: "MAPQA Claude" });
  check("the look-up now counts the payment against the plan", /paid: ৳12,175\.00 in 1 payment, the last on \d{4}-\d{2}-\d{2}/.test(paidNow.content ?? ""), String(paidNow.content).slice(0, 400));

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await say("mapqa claude abar renew korlam aaj, rate 121.75", { area: "subscriptions", target: "subscription_payment", draft: { subscriptionName: "MAPQA Claude", txnDate: today, usdRate: "121.75" }, missingFields: [] });
  text = await transcript();
  drawn = await card();
  await shot("renewal-twice");
  check("a second renewal in the month is not offered: the app's own rule is asked about first", /This plan was already renewed that month: TXN-[\w-]+/.test(text) && /A plan renews once a month/.test(text) && drawn?.saveDisabled === true, `${String(drawn?.saveDisabled)} ${text.slice(-300).replace(/\n/g, " | ")}`);
  check("and nothing more is in the ledger for it", (await q(`select count(*)::int as n from transactions where subscription_id = $1`, [CLAUDE]))[0].n === 1);

  await page.goto(`${WEB}/settings?tab=assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForSelector('textarea[name="instructions"]', { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('textarea[name="instructions"]')?.value.length > 0, { timeout: 60000 });
  const box = () =>
    page.evaluate(() => {
      const area = document.querySelector('textarea[name="instructions"]');
      const form = area.closest("form");
      const save = [...form.querySelectorAll("button")].find((b) => /Save the instructions/.test(b.textContent));
      return { value: area.value, text: form.innerText, saveDisabled: save.disabled, title: form.closest("section, div.rounded-2xl, div")?.parentElement?.innerText.slice(0, 80) };
    });
  let instructions = await box();
  await shot("instructions");
  check("Settings → Assistant shows the instructions as they are stored", instructions.value === `${RULE}\nMAPQA rule two.` && /Instructions for the Assistant/.test(await page.evaluate(() => document.body.innerText)), instructions.value.slice(0, 80));
  check("with the count, who saved them, and Save waiting for a change", new RegExp(`${instructions.value.length} of 4,000 characters`).test(instructions.text) && instructions.text.includes(`Last saved by ${admin.full_name}`) && instructions.saveDisabled === true, instructions.text.slice(-200).replace(/\n/g, " | "));
  await page.click('textarea[name="instructions"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("End");
  await page.keyboard.up("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.type("MAPQA rule three, typed on the page.");
  instructions = await box();
  check("typing a rule lets it be saved", instructions.saveDisabled === false, String(instructions.saveDisabled));
  const savedRule = page.waitForResponse((response) => response.url().endsWith("/ai/instructions") && response.request().method() === "PUT", { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Save the instructions/.test(b.textContent))?.click());
  await savedRule;
  await page.waitForFunction(() => /Saved\. The Assistant follows these from its next message\./.test(document.body.innerText), { timeout: 60000 }).catch(() => undefined);
  const [storedNow] = await q(`select ai_instructions, ai_instructions_set_by from app_settings where id = 1`);
  await shot("instructions-saved");
  check("Save stores it, and the page says so", storedNow?.ai_instructions === `${RULE}\nMAPQA rule two.\nMAPQA rule three, typed on the page.` && storedNow?.ai_instructions_set_by === admin.id && /Saved\. The Assistant follows these/.test(await page.evaluate(() => document.body.innerText)), String(storedNow?.ai_instructions).slice(-60));
  await page.evaluate(() => {
    const area = document.querySelector('textarea[name="instructions"]');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    set.call(area, "a".repeat(4001));
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  instructions = await box();
  check("a text over the limit says so and cannot be saved", /4,001 of 4,000 characters — too long to save/.test(instructions.text) && instructions.saveDisabled === true, instructions.text.slice(-160).replace(/\n/g, " | "));
  check("no page error", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser?.close().catch(() => undefined);
  // By id, in the books themselves: a conversation belongs to whoever had
  // it, and the API will not let the Super Admin delete HR's.
  await db.query(`delete from ai_chats where id = any ($1::uuid[])`, [[...made.chats]]);
  // And the ones the page started, which this run never saw the ids of.
  await db.query(`delete from ai_chats where user_id = $1 and created_at > now() - interval '20 minutes' and (title ilike '%mapqa%' or title ilike '%subscription kinlam%')`, [admin.id]);
  await sweep().catch((error) => console.log(`  (could not sweep: ${error.message})`));
  await db.query(
    `update app_settings set ai_provider = $1, ai_model = $2, ai_data_access = $3, anthropic_api_key = $4, anthropic_key_set_at = $5, anthropic_key_set_by = $6,
            ai_instructions = $7, ai_instructions_set_at = $8, ai_instructions_set_by = $9 where id = 1`,
    [before.ai_provider, before.ai_model, before.ai_data_access, before.anthropic_api_key, before.anthropic_key_set_at, before.anthropic_key_set_by, before.ai_instructions, before.ai_instructions_set_at, before.ai_instructions_set_by],
  );
  const stopped = new Promise((resolve) => api.once("exit", resolve));
  api.kill();
  await stopped;
  stub.close();
  const [left] = await q(
    `select (select count(*) from subscriptions where tool_name like 'MAPQA %')::int as plans,
            (select count(*) from transactions where description like 'MAPQA %')::int as payments,
            (select count(*) from invoices where invoice_number like 'MAPQA-%')::int as invoices,
            (select count(*) from bank_advices where title like 'MAPQA %')::int as advices,
            (select count(*) from hr_budget_periods where category_name like 'MAPQA %')::int as budgets,
            (select ai_instructions = $1 from app_settings where id = 1) as instructions_back`,
    [before.ai_instructions],
  );
  console.log(`\n  left behind: ${JSON.stringify(left)}`);
  await db.end();
}

const failed = results.filter((pass) => !pass).length;
// What the API itself said, when something failed: a 500 explains itself there.
if (failed) {
  const said = apiLog
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, ""))
    .filter((line) => /ERROR|WARN|Error|error/.test(line));
  console.log(`\n--- the API's log, its last lines ---\n${said.slice(-14).join("\n")}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
