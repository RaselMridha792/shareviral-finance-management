/**
 * The Assistant gets better with use: its mistakes kept, told back to it,
 * made rules, and the map of the app it is given, as a page.
 * docs/briefs/2026-10-02-assistant-powerful.md, piece A2b.
 *
 * No model is asked here. A stand-in for Anthropic's API answers each round
 * with what the script below tells it to, and what is measured is what THIS
 * APP makes of it:
 *
 *   A. which model answered goes on the answer and on the conversation;
 *   B. "This was wrong": kept from the conversation itself, digits masked,
 *      refused for somebody else's conversation and for no reason;
 *   C. a field changed on a draft before Save: a plan's name now too, with
 *      the model and the part, a description's figures masked;
 *   D. what the model is told on the next turn: the answers marked wrong,
 *      each only to a role that may read that part;
 *   E. the owner's list, with the rule each offers: the CFO reads it too
 *      (each only about a part they read), HR does not; and the rest behind
 *      the settings (B2's permission change, 3 Oct 2026): the CFO reads
 *      the instructions and the model, changes nothing, and is never sent
 *      the key's hint;
 *   F. "Make this a rule": one line added to the instructions, audited,
 *      never twice, within 4,000 characters; the mistake then leaves the
 *      prompt and its rule is in it;
 *   G. "Remove": off the list and out of the prompt, audited;
 *   H. the map as a page's data: every part, every form, the fields their
 *      Save checks;
 *   I. the page: This was wrong under an answer; What the Assistant knows,
 *      with the rules, the mistakes and Make this a rule for the Super Admin
 *      and the rules and mistakes to read for the CFO (B2); the Assistant's
 *      settings; a phone's width.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantlearnqa.mjs                 (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantlearnqa.mjs  also saves screenshots
 *
 * Starts its own API on :4014 pointed at the stand-in, so the dev API on
 * :4001 is left alone. Puts a made-up Anthropic key in the local
 * app_settings while it runs and puts back what was there, the instructions
 * included. Every mistake it makes carries LEARNQA and is deleted at the
 * end, with its chats. The audit rows of its own changes stay, as they
 * would for anybody.
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
const PORT = 4014;
const API = `http://localhost:${PORT}/api`;
const STUB_PORT = 4599;
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
const hr = await person("hr");
const cfo = await person("cfo");
if (!admin || !hr || !cfo) throw new Error("The local books need an active super_admin, an hr and a cfo user.");
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
const callHr = callAs(tokenFor(hr));
const callCfo = callAs(tokenFor(cfo));

// What a lesson is kept from since A4 (3 Oct 2026): a draft confirmed and
// saved. The richest taka account pays for the plan and the renewal below.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const CARD = (
  await q(
    `select a.id, a.name, (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null and t.deleted_at is null), 0))::numeric as balance
       from accounts a left join transactions t on t.account_id = a.id
      where a.is_active and a.deleted_at is null and a.currency <> 'USD' group by a.id order by balance desc limit 1`,
  )
)[0];
if (!CARD || Number(CARD.balance) < 20000) throw new Error("The local books need a taka account holding 20,000.");

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------------ */
/*  A stand-in for the model: it says what it is told to, round by round     */
/* ------------------------------------------------------------------------ */

let script = [];
const asked = [];
const stub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    asked.push(JSON.parse(raw || "{}"));
    const line = (script.length > 1 ? script.shift() : script[0]) ?? { draft: {}, missingFields: [], summary: "(the harness gave no answer)" };
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_learnqa" });
    res.end(
      JSON.stringify({
        id: "msg_learnqa",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "tool_use", id: `toolu_${asked.length}`, name: "answer", input: line }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
});
await new Promise((resolve) => stub.listen(STUB_PORT, "127.0.0.1", resolve));

const made = { chats: new Set() };
async function turn(text, says, { as = call } = {}) {
  script = Array.isArray(says) ? [...says] : [says];
  const from = asked.length;
  const res = await as("POST", "/ai/turn", { messages: [{ role: "user", content: text }] });
  if (res.body?.chatId) made.chats.add(res.body.chatId);
  if (res.status !== 200) console.log(`  (the turn "${text.slice(0, 40)}" answered ${res.status}: ${JSON.stringify(res.body)})`);
  return { ...res, requests: asked.slice(from) };
}
const systemOf = (request) => (request?.system ?? []).map((block) => block.text).join("\n");
const plain = (summary) => ({ target: null, draft: {}, missingFields: [], summary });

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

const sweep = async () => {
  await db.query(`delete from ai_corrections where said like '%LEARNQA%' or corrected like '%LEARNQA%' or drafted like '%LEARNQA%'`);
  // The plans section C confirms and saves, and their payments.
  await db.query(`delete from transactions where subscription_id in (select id from subscriptions where tool_name like 'LEARNQA %')`);
  await db.query(`delete from subscriptions where tool_name like 'LEARNQA %'`);
};
/** A mistake, straight into the table: the kinds only another role makes. */
const plant = async (row) =>
  (
    await q(
      `insert into ai_corrections (kind, target, area, said, field, drafted, corrected, model, user_id)
       values ($1, $2, $3, $4, $5, $6, $7, 'claude-opus-5', $8) returning id`,
      [row.kind ?? "reply", row.target ?? null, row.area ?? null, row.said, row.field ?? null, row.drafted ?? null, row.corrected, admin.id],
    )
  )[0].id;

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
            ai_instructions = 'LEARNQA rule one.' where id = 1`,
    [seal("sk-ant-learnqa-0000000000000000000000"), admin.id],
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA. Which model answered");
  const counted = await turn("LEARNQA amader total team member kotojon? 42 jon na?", { ...plain("LEARNQA Team member er total count dekhar kono tool amar kache nei."), area: "team" });
  check("the answer names the model that gave it", counted.body?.model === "claude-opus-5", counted.body?.model);
  const [stored] = await q(`select reply from ai_chats where id = $1`, [counted.body?.chatId]);
  check("and the conversation keeps it with the answer", stored?.reply?.model === "claude-opus-5", JSON.stringify(stored?.reply?.model));

  /* ------------------------------------------------------------------ */
  console.log("\nB. This was wrong");
  const marked = await call("POST", "/ai/feedback", { chatId: counted.body.chatId, reason: "LEARNQA count ache, Team screen e 120 jon" });
  check("an answer marked wrong is kept", marked.status === 200 && marked.body?.recorded === true, `${marked.status} ${JSON.stringify(marked.body)}`);
  const [kept] = await q(`select * from ai_corrections where corrected like 'LEARNQA count%' order by created_at desc limit 1`);
  check("as a reply, with the model, by the person who said so", kept?.kind === "reply" && kept?.model === "claude-opus-5" && kept?.user_id === admin.id && kept?.field === null, JSON.stringify({ kind: kept?.kind, model: kept?.model, field: kept?.field }));
  check("what was asked is read from the conversation, digits masked", kept?.said === "LEARNQA amader total team member kotojon? … jon na?", kept?.said);
  check("what it answered is read from the conversation too", kept?.drafted === 'said "LEARNQA Team member er total count dekhar kono tool amar kache nei."', kept?.drafted);
  check("why, in the person's words, digits masked", kept?.corrected === "LEARNQA count ache, Team screen e … jon", kept?.corrected);
  const notTheirs = await callCfo("POST", "/ai/feedback", { chatId: counted.body.chatId, reason: "LEARNQA not mine" });
  check("somebody else's conversation cannot be marked (404)", notTheirs.status === 404, String(notTheirs.status));
  const noReason = await call("POST", "/ai/feedback", { chatId: counted.body.chatId, reason: " a " });
  check("nor one without a reason (400)", noReason.status === 400, String(noReason.status));
  const noChat = await call("POST", "/ai/feedback", { chatId: randomUUID(), reason: "LEARNQA nothing" });
  check("nor a conversation that is not there (404)", noChat.status === 404, String(noChat.status));

  // A draft marked wrong: the kind of record and its fields, never an id.
  const drafted = await turn("LEARNQA Cursor er 2450 taka bill dilam", {
    area: "transactions",
    target: "transaction_out",
    draft: { amount: "2450", accountName: "LEARNQA card", categoryName: "Office supplies", txnDate: "2026-10-02", description: "LEARNQA Cursor bill" },
    missingFields: ["usdRate"],
    nextQuestion: "LEARNQA USD rate koto?",
  });
  await call("POST", "/ai/feedback", { chatId: drafted.body.chatId, reason: "LEARNQA eta subscription, AI tools e jabe" });
  const [draftMistake] = await q(`select * from ai_corrections where corrected = 'LEARNQA eta subscription, AI tools e jabe'`);
  check(
    "a draft marked wrong keeps its kind, its part and its fields, figures masked",
    draftMistake?.target === "transaction_out" && draftMistake?.area === "transactions" && /drafted money going out \(transaction_out\): amount "…"/.test(draftMistake?.drafted ?? "") && !/2450/.test(draftMistake?.drafted ?? ""),
    draftMistake?.drafted,
  );

  /* ------------------------------------------------------------------ */
  console.log("\nC. A field changed on a draft before Confirm and save");
  // A plan on file to renew, put there directly: no payment this month yet.
  await q(
    `insert into subscriptions (tool_name, plan_name, category, status, cost_usd, cost_bdt, usd_rate, billing_cycle, start_date, next_renewal_on, payment_method, account_id, created_by, updated_by)
     values ('LEARNQA Claude', 'Max', 'ai_tool', 'active', 100, 12200, 122, 'monthly', $1, $1, 'card', $2, $3, $3)`,
    [`${today.slice(0, 7)}-01`, CARD.id, admin.id],
  );
  const renewal = await turn("LEARNQA Claude Code er ei masher bill dilam", {
    area: "subscriptions",
    target: "subscription_payment",
    draft: { subscriptionName: "LEARNQA Claude Code", txnDate: today },
    missingFields: ["usdRate"],
    nextQuestion: "LEARNQA rate koto?",
  });
  // Since A4 the lesson is kept when the card is confirmed and saved, not by
  // a call of its own: the boxes as the person left them are the lesson.
  const learnt = await call("POST", "/ai/confirm", {
    chatId: renewal.body.chatId,
    draft: { subscriptionName: "LEARNQA Claude", txnDate: today, usdRate: "125", description: "LEARNQA bill 4999" },
  });
  check("the corrected renewal is confirmed and saved", learnt.status === 200 && /^TXN-/.test(learnt.body?.refNo ?? ""), `${learnt.status} ${JSON.stringify(learnt.body?.message ?? learnt.body?.refNo)}`);
  const fieldRows = await q(`select * from ai_corrections where kind = 'field' and said like 'LEARNQA Claude Code%' order by field`);
  const planRow = fieldRows.find((row) => row.field === "subscriptionName");
  // "LEARNQA Claude Code" is no plan on file, so the app took it off the
  // draft and asked: the lesson is the plan they then named.
  check("which plan a name means is kept now", planRow?.drafted === null && planRow?.corrected === "LEARNQA Claude", JSON.stringify(planRow));
  check("with the model and the part it was in", planRow?.model === "claude-opus-5" && planRow?.area === "subscriptions", `${planRow?.model} ${planRow?.area}`);
  check("never the rate", !fieldRows.some((row) => row.field === "usdRate"), fieldRows.map((row) => row.field).join(","));
  const plan = await turn("LEARNQA notun plan: Cursr Pro", {
    area: "subscriptions",
    target: "subscription",
    draft: { toolName: "LEARNQA Cursr", planName: "LEARNQA Pro", billingCycle: "monthly", category: "ai_tool", startDate: today, accountName: CARD.name },
    missingFields: ["costUsd"],
    nextQuestion: "LEARNQA dam koto?",
  });
  const planSaved = await call("POST", "/ai/confirm", {
    chatId: plan.body.chatId,
    draft: { toolName: "LEARNQA Cursor", planName: "LEARNQA Pro Team", billingCycle: "yearly", category: "ai_tool", startDate: today, accountName: CARD.name, costUsd: "20", usdRate: "122.5" },
  });
  check("the corrected plan is confirmed and saved, with its first payment", planSaved.status === 200 && /^TXN-/.test(planSaved.body?.refNo ?? ""), `${planSaved.status} ${JSON.stringify(planSaved.body?.message ?? planSaved.body?.said)}`);
  const planFields = await q(`select field, drafted, corrected from ai_corrections where kind = 'field' and said like 'LEARNQA notun plan%' order by field`);
  check(
    "a new plan's tool, plan and cycle are kept as they were corrected",
    JSON.stringify(planFields.map((row) => [row.field, row.drafted, row.corrected])) ===
      JSON.stringify([["billingCycle", "monthly", "yearly"], ["planName", "LEARNQA Pro", "LEARNQA Pro Team"], ["toolName", "LEARNQA Cursr", "LEARNQA Cursor"]]),
    JSON.stringify(planFields),
  );
  check("never its price", !planFields.some((row) => /cost|rate/i.test(row.field)), planFields.map((row) => row.field).join(","));
  const described = fieldRows.find((row) => row.field === "description");
  check("a description is kept with its figures masked", described?.corrected === "LEARNQA bill …", described?.corrected);

  /* ------------------------------------------------------------------ */
  console.log("\nD. What the model is told next");
  // Two more, of the kinds only another part makes: one with only a part.
  const teamOnly = await plant({ area: "team", said: "LEARNQA team e kara ache", drafted: 'said "LEARNQA I cannot list"', corrected: "LEARNQA team_members diye list koro" });
  const accountsOnly = await plant({ area: "accounts", said: "LEARNQA kon account e koto", drafted: 'said "LEARNQA no idea"', corrected: "LEARNQA account_balances dekho" });
  const nowhere = await plant({ said: "LEARNQA kichu ekta", drafted: 'said "LEARNQA hmm"', corrected: "LEARNQA placed nowhere" });

  const next = await turn("LEARNQA hello", plain("LEARNQA hi"));
  const told = systemOf(next.requests[0]);
  check("the answers marked wrong are told back, under their own heading", /ANSWERS SOMEBODY HERE MARKED WRONG/.test(told), told.slice(told.indexOf("ANSWERS"), told.indexOf("ANSWERS") + 80));
  check("each with what was asked, what it said and what was right", told.includes('"LEARNQA amader total team member kotojon? … jon na?" → you said "LEARNQA Team member er total count dekhar kono tool amar kache nei.". They said: LEARNQA count ache, Team screen e … jon'), "");
  check("and the field fixed before Save, as before", /"LEARNQA Claude Code er ei masher bill dilam" → subscriptionName: you left it empty, they made it "LEARNQA Claude"/.test(told), "");
  check("one placed in no part is told to nobody", !told.includes("LEARNQA placed nowhere"), "");

  // HR held `ai.use` until B1 (3 Oct 2026), and was the role these filters
  // were measured on. Only the Super Admin and the CFO use the Assistant now,
  // and both read every part, so a real role can no longer show the filter
  // holding a mistake back; routing.spec.ts keeps the role gate as unit tests.
  const hrTurn = await turn("LEARNQA hello from HR", plain("LEARNQA hi"), { as: callHr });
  check("HR is refused the Assistant (403), and nothing reaches the model", hrTurn.status === 403 && hrTurn.requests.length === 0, `${hrTurn.status} ${hrTurn.requests.length}`);
  const cfoTurn = await turn("LEARNQA hello from the CFO", plain("LEARNQA hi"), { as: callCfo });
  const toldCfo = systemOf(cfoTurn.requests[0]);
  check("the CFO is told the payment one", toldCfo.includes("LEARNQA eta subscription, AI tools e jabe"), "");
  check("and the one in Team", toldCfo.includes("LEARNQA team_members diye list koro"), "");

  /* ------------------------------------------------------------------ */
  console.log("\nE. The owner's list");
  const list = await call("GET", "/ai/mistakes");
  const listed = (list.body ?? []).filter((m) => /LEARNQA/.test(`${m.said} ${m.corrected}`));
  check("the Super Admin reads every kind, newest first", list.status === 200 && listed.length >= 6 && listed.some((m) => m.kind === "field") && listed.some((m) => m.kind === "reply"), `${list.status} ${listed.length}`);
  const countMistake = listed.find((m) => m.corrected === "LEARNQA count ache, Team screen e … jon");
  check("each names its part and model, and offers a rule", countMistake?.areaName === "Team" && countMistake?.model === "claude-opus-5" && countMistake?.rule === '"LEARNQA amader total team member kotojon? … jon na?": LEARNQA count ache, Team screen e … jon', JSON.stringify(countMistake?.rule));
  const planMistake = listed.find((m) => m.field === "subscriptionName");
  check("a field's rule reads as the field", planMistake?.areaName === "AI tools and subscriptions" && planMistake?.rule === '"LEARNQA Claude Code er ei masher bill dilam" → subscription: LEARNQA Claude', JSON.stringify(planMistake?.rule));
  check("the Super Admin's list has the one placed in no part", listed.some((m) => m.corrected === "LEARNQA placed nowhere"));
  // B2's permission change (3 Oct 2026): the CFO reads everything behind the
  // settings and changes nothing. Each mistake only about a part they read.
  const cfoList = await callCfo("GET", "/ai/mistakes");
  const cfoListed = (cfoList.body ?? []).filter((m) => /LEARNQA/.test(`${m.said} ${m.corrected}`));
  check(
    "the CFO reads the list too (200): the Team one, the plan's field, the count",
    cfoList.status === 200 &&
      cfoListed.some((m) => m.corrected === "LEARNQA team_members diye list koro") &&
      cfoListed.some((m) => m.field === "subscriptionName") &&
      cfoListed.some((m) => m.corrected === "LEARNQA count ache, Team screen e … jon"),
    `${cfoList.status} ${cfoListed.length}`,
  );
  check("but not the one placed in no part", !cfoListed.some((m) => m.corrected === "LEARNQA placed nowhere"));
  check("HR cannot read it (403)", (await callHr("GET", "/ai/mistakes")).status === 403);

  console.log("\nE2. The rest behind the settings: the CFO reads, changes nothing");
  const cfoRules = await callCfo("GET", "/ai/instructions");
  check("the CFO reads the owner's instructions (200)", cfoRules.status === 200 && cfoRules.body?.instructions === "LEARNQA rule one.", `${cfoRules.status} ${JSON.stringify(cfoRules.body?.instructions)}`);
  const cfoSave = await callCfo("PUT", "/ai/instructions", { instructions: "LEARNQA the CFO's rule" });
  const [rulesKept] = await q(`select ai_instructions from app_settings where id = 1`);
  check("and cannot save them (403), nothing written", cfoSave.status === 403 && rulesKept.ai_instructions === "LEARNQA rule one.", `${cfoSave.status} ${JSON.stringify(rulesKept.ai_instructions)}`);
  check("nor change the model (403)", (await callCfo("PATCH", "/ai/settings", { model: "claude-opus-5" })).status === 403);
  check("nor clear the key (403)", (await callCfo("DELETE", "/ai/key")).status === 403);
  check("HR reads none of it (403)", (await callHr("GET", "/ai/instructions")).status === 403);
  const adminSees = await call("GET", "/ai/availability");
  check("the Super Admin is sent the key's hint and who set it", /0000$/.test(adminSees.body?.keyHint ?? "") && adminSees.body?.setBy === admin.full_name, `${adminSees.body?.keyHint} ${adminSees.body?.setBy}`);
  const cfoSees = await callCfo("GET", "/ai/availability");
  check(
    "the CFO is sent the route and the model, and no hint, date or name",
    cfoSees.status === 200 &&
      cfoSees.body?.configured === true &&
      cfoSees.body?.model === "claude-opus-5" &&
      cfoSees.body?.provider === "anthropic" &&
      cfoSees.body?.keyHint === null &&
      cfoSees.body?.setAt === null &&
      cfoSees.body?.setBy === null &&
      !JSON.stringify(cfoSees.body).includes(admin.full_name),
    JSON.stringify(cfoSees.body),
  );

  /* ------------------------------------------------------------------ */
  console.log("\nF. Make this a rule");
  const RULE = "LEARNQA Subscription kena = AI tools and subscriptions, never a plain payment";
  const ruled = await call("POST", `/ai/mistakes/${draftMistake.id}/rule`, { rule: `  ${RULE}\n` });
  const [afterRule] = await q(`select ai_instructions, ai_instructions_set_by from app_settings where id = 1`);
  check("one line is added to the instructions", ruled.status === 200 && afterRule?.ai_instructions === `LEARNQA rule one.\n${RULE}` && ruled.body?.instructions === afterRule?.ai_instructions, JSON.stringify(afterRule?.ai_instructions));
  check("by the Super Admin", afterRule?.ai_instructions_set_by === admin.id);
  const [ruledRow] = await q(`select ruled_at from ai_corrections where id = $1`, [draftMistake.id]);
  check("and the mistake is marked a rule", ruledRow?.ruled_at !== null);
  const [audited] = await q(
    `select before, after, actor_user_id from audit_logs where entity_table = 'app_settings' and summary = 'Made a mistake of the Assistant one of its instructions' order by occurred_at desc limit 1`,
  );
  check("the change is in the audit log, before and after", audited?.before?.instructions === "LEARNQA rule one." && audited?.after?.instructions === `LEARNQA rule one.\n${RULE}` && audited?.actor_user_id === admin.id, JSON.stringify(audited?.after));
  const twice = await call("POST", `/ai/mistakes/${draftMistake.id}/rule`, { rule: RULE });
  check("a mistake already a rule is not made one twice (400)", twice.status === 400, `${twice.status} ${twice.body?.message}`);
  const sameLine = await call("POST", `/ai/mistakes/${accountsOnly}/rule`, { rule: RULE });
  const [stillOne] = await q(`select ai_instructions from app_settings where id = 1`);
  check("a line already there is not written again", sameLine.status === 200 && stillOne.ai_instructions === `LEARNQA rule one.\n${RULE}`, JSON.stringify(stillOne.ai_instructions));
  check("the CFO cannot make one (403)", (await callCfo("POST", `/ai/mistakes/${teamOnly}/rule`, { rule: "LEARNQA cfo" })).status === 403);
  await q(`update app_settings set ai_instructions = $1 where id = 1`, [`LEARNQA rule one.\n${"x".repeat(3990)}`]);
  const tooLong = await call("POST", `/ai/mistakes/${teamOnly}/rule`, { rule: "LEARNQA one more" });
  const [unruled] = await q(`select ruled_at from ai_corrections where id = $1`, [teamOnly]);
  check("over 4,000 characters is refused, and nothing is marked", tooLong.status === 400 && /4,000/.test(tooLong.body?.message ?? "") && unruled?.ruled_at === null, `${tooLong.status} ${tooLong.body?.message}`);
  await q(`update app_settings set ai_instructions = $1 where id = 1`, [`LEARNQA rule one.\n${RULE}`]);
  check("a mistake that is not there (404)", (await call("POST", `/ai/mistakes/${randomUUID()}/rule`, { rule: "LEARNQA x" })).status === 404);

  const afterRuleTurn = await turn("LEARNQA hello again", plain("LEARNQA hi"));
  const toldNow = systemOf(afterRuleTurn.requests[0]);
  check("the rule is in the prompt, under the owner's instructions", toldNow.includes(`THE OWNER'S INSTRUCTIONS`) && toldNow.includes(RULE), "");
  check("and the mistake it came from is no longer told as one", !toldNow.includes("LEARNQA eta subscription, AI tools e jabe"), "");

  /* ------------------------------------------------------------------ */
  console.log("\nG. Remove from the list");
  check("the CFO cannot remove one (403)", (await callCfo("DELETE", `/ai/mistakes/${teamOnly}`)).status === 403);
  const removed = await call("DELETE", `/ai/mistakes/${teamOnly}`);
  const [gone] = await q(`select count(*)::int as n from ai_corrections where id = $1`, [teamOnly]);
  check("the Super Admin removes one (204), and it is gone", removed.status === 204 && gone.n === 0, String(removed.status));
  const [removal] = await q(`select before from audit_logs where entity_table = 'ai_corrections' and entity_id = $1 and action = 'delete'`, [teamOnly]);
  check("with an audit row of what it said", removal?.before?.corrected === "LEARNQA team_members diye list koro", JSON.stringify(removal?.before?.corrected));
  const cfoAgain = await turn("LEARNQA the CFO once more", plain("LEARNQA hi"), { as: callCfo });
  check("and it is told to nobody any more", cfoAgain.requests.length > 0 && !systemOf(cfoAgain.requests[0]).includes("LEARNQA team_members diye list koro"), "");
  check("one that is not there (404)", (await call("DELETE", `/ai/mistakes/${randomUUID()}`)).status === 404);
  await q(`delete from ai_corrections where id = $1`, [nowhere]);

  /* ------------------------------------------------------------------ */
  console.log("\nH. The map, as the page reads it");
  const knowledge = await callCfo("GET", "/ai/knowledge");
  const parts = knowledge.body?.parts ?? [];
  const forms = parts.flatMap((part) => part.forms);
  check("the CFO reads it", knowledge.status === 200 && parts.length >= 21, `${knowledge.status} ${parts.length} parts`);
  check("HR does not: the Assistant is not HR's (403)", (await callHr("GET", "/ai/knowledge")).status === 403);
  check("every part has its forms, a hundred and more of them", forms.length >= 100, String(forms.length));
  const addPlan = parts.find((part) => part.key === "subscriptions")?.forms.find((form) => form.draft);
  check(
    "a form's fields are the ones its Save checks, the needed ones marked",
    addPlan?.fields.some((field) => field.name === "toolName" && field.required === true) && addPlan?.fields.some((field) => field.name === "chargeUsd" && field.required === false),
    JSON.stringify(addPlan?.fields.slice(0, 3)),
  );
  const markWrong = parts.find((part) => part.key === "assistant")?.forms.find((form) => form.name === "This was wrong");
  check("the Assistant's own part has This was wrong, on its screen", markWrong?.on?.href === "/assistant", JSON.stringify(markWrong?.on));
  check("and its page is on the map", parts.find((part) => part.key === "assistant")?.screens.some((screen) => screen.href === "/assistant/knowledge"));

  /* ------------------------------------------------------------------ */
  console.log("\nI. The page");
  browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const openAs = async (user, width = 1440) => {
    const context = await browser.createBrowserContext();
    await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
    const page = await context.newPage();
    await page.setViewport({ width, height: 1000 });
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(String(e)));
    // The browser's own calls go to the API this harness started. (Next's
    // server still asks :4001, which reads the same books.)
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
  const press = (page, label) =>
    page.evaluate((label) => {
      const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
      button?.click();
      return Boolean(button);
    }, label);

  const page = await openAs(admin);
  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  script = [plain("LEARNQA Team e 7 jon.")];
  const answered = page.waitForResponse((response) => response.url().endsWith("/ai/turn") && response.request().method() === "POST", { timeout: 60000 });
  await page.type('textarea[placeholder^="Type it"]', "LEARNQA team e koto jon from the page");
  await page.keyboard.press("Enter");
  await answered;
  await page.waitForFunction(() => document.body.innerText.includes("This was wrong"), { timeout: 60000 }).catch(() => undefined);
  check("This was wrong is under the answer", (await text(page)).includes("This was wrong"));
  await press(page, "This was wrong");
  await page.waitForSelector("#mark-wrong-reason", { timeout: 10000 }).catch(() => undefined);
  await page.type("#mark-wrong-reason", "LEARNQA from the page: Team screen e 120 jon");
  const sentFeedback = page.waitForResponse((response) => response.url().endsWith("/ai/feedback"), { timeout: 60000 });
  await press(page, "Send");
  await sentFeedback;
  await page.waitForFunction(() => document.body.innerText.includes("Kept as a mistake"), { timeout: 30000 }).catch(() => undefined);
  await shot(page, "marked-wrong");
  check("sending it says it is kept", (await text(page)).includes("Kept as a mistake, with why."));
  const [fromPage] = await q(`select kind, said, drafted from ai_corrections where corrected = 'LEARNQA from the page: Team screen e … jon'`);
  check("and it is in the table, read from the conversation", fromPage?.kind === "reply" && fromPage?.said === "LEARNQA team e koto jon from the page" && fromPage?.drafted === 'said "LEARNQA Team e … jon."', JSON.stringify(fromPage));
  check("the chat's history rail links to What the Assistant knows", await page.evaluate(() => [...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/assistant/knowledge")));
  // The conversation the page started, for the sweep.
  for (const row of await q(`select id from ai_chats where user_id = $1 and title like 'LEARNQA%'`, [admin.id])) made.chats.add(row.id);

  await page.goto(`${WEB}/assistant/knowledge`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes("Make this a rule"), { timeout: 30000 }).catch(() => undefined);
  let shown = await text(page);
  await shot(page, "knowledge-admin");
  check("What the Assistant knows opens, headed so", shown.includes("What the Assistant knows") && shown.includes("The map of the app"), shown.slice(0, 120).replace(/\n/g, " | "));
  check("with the owner's rules, numbered", shown.includes("Your rules") && shown.includes(RULE));
  check("and the recent mistakes, the one just marked among them", shown.includes("Its recent mistakes") && shown.includes("LEARNQA from the page: Team screen e … jon"));
  const cards = await page.evaluate(() => [...document.querySelectorAll("details summary")].filter((s) => /Forms and buttons/.test(s.textContent)).length);
  check("the map: a card for each part with its forms", cards >= 15, `${cards} parts with forms`);

  // Make the page's own mistake a rule.
  const opened = await page.evaluate(() => {
    // The innermost: the list card holds every row, and comes first.
    const row = [...document.querySelectorAll("div.rounded-xl")].filter((div) => div.innerText.includes("LEARNQA from the page") && div.querySelector("button")).pop();
    const button = [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "Make this a rule");
    button?.click();
    return Boolean(button);
  });
  await page.waitForSelector('input[id^="rule-"]', { timeout: 10000 }).catch(() => undefined);
  const offered = await page.evaluate(() => document.querySelector('input[id^="rule-"]')?.value ?? null);
  check("Make this a rule offers a line to change first", opened && offered === '"LEARNQA team e koto jon from the page": LEARNQA from the page: Team screen e … jon', offered);
  const PAGE_RULE = "LEARNQA Team er count team_members diye bolo";
  await page.evaluate(() => {
    const input = document.querySelector('input[id^="rule-"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.type('input[id^="rule-"]', PAGE_RULE);
  const ruledOnPage = page.waitForResponse((response) => /\/ai\/mistakes\/.+\/rule$/.test(response.url()), { timeout: 60000 });
  await press(page, "Add the rule");
  await ruledOnPage;
  await page.waitForFunction(() => /A rule since/.test(document.body.innerText), { timeout: 30000 }).catch(() => undefined);
  shown = await text(page);
  await shot(page, "knowledge-ruled");
  const [rulesNow] = await q(`select ai_instructions from app_settings where id = 1`);
  check("Add the rule writes it into the instructions", rulesNow.ai_instructions === `LEARNQA rule one.\n${RULE}\n${PAGE_RULE}`, JSON.stringify(rulesNow.ai_instructions.slice(-80)));
  check("and the page shows it as a rule, in Your rules too", /A rule since/.test(shown) && shown.includes(PAGE_RULE));

  await page.type('input[placeholder="Find a part or a form"]', "bank advice");
  await new Promise((resolve) => setTimeout(resolve, 400));
  const filtered = await page.evaluate(() => [...document.querySelectorAll("h2, h3")].map((h) => h.textContent.trim()));
  check("the search keeps the parts that mention it", filtered.includes("Bank Advice") && !filtered.includes("Invoice Builder"), filtered.join(", ").slice(0, 200));
  check("no page error", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));

  // The Assistant's own settings since B2 (3 Oct 2026); the old address
  // still opens them.
  await page.goto(`${WEB}/settings?tab=assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForFunction(() => document.body.innerText.includes("Its recent mistakes"), { timeout: 30000 }).catch(() => undefined);
  shown = await text(page);
  check("the Assistant's settings list the mistakes too, beside the instructions", new URL(page.url()).pathname === "/assistant/settings" && shown.indexOf("Instructions for the Assistant") > -1 && shown.indexOf("Its recent mistakes") > shown.indexOf("Instructions for the Assistant"));
  check("with the way to What the Assistant knows", await page.evaluate(() => [...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/assistant/knowledge")));

  const cfoPage = await openAs(cfo);
  await cfoPage.goto(`${WEB}/assistant/knowledge`, { waitUntil: "networkidle0", timeout: 120000 });
  await cfoPage.waitForFunction(() => document.body.innerText.includes("Its recent mistakes"), { timeout: 30000 }).catch(() => undefined);
  shown = await text(cfoPage);
  await shot(cfoPage, "knowledge-cfo");
  check("the CFO sees the map", shown.includes("The map of the app") && shown.includes("AI tools and subscriptions"));
  // B2, the owner (3 Oct 2026): the CFO reads the rules and the mistakes,
  // and changes nothing.
  const cfoButtons = await cfoPage.evaluate(() => [...document.querySelectorAll("button, a")].filter((b) => /Make this a rule|Change them|^Remove$/.test(b.textContent.trim())).length);
  check("and reads the owner's rules and the mistakes, with nothing to change them", shown.includes("The owner's rules") && shown.includes("Its recent mistakes") && !shown.includes("Your rules") && cfoButtons === 0, String(cfoButtons));
  check("no page error for the CFO", cfoPage.errors.length === 0, cfoPage.errors.slice(0, 2).join(" | "));

  const phone = await openAs(admin, 390);
  await phone.goto(`${WEB}/assistant/knowledge`, { waitUntil: "networkidle0", timeout: 120000 });
  await phone.waitForFunction(() => document.body.innerText.includes("Make this a rule") || document.body.innerText.includes("A rule since"), { timeout: 30000 }).catch(() => undefined);
  const sideways = await phone.evaluate(() => {
    const scroller = [...document.querySelectorAll("div")].find((div) => getComputedStyle(div).overflowY === "auto" && div.scrollHeight > div.clientHeight);
    return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, inner: scroller ? scroller.scrollWidth - scroller.clientWidth : 0 };
  });
  await shot(phone, "knowledge-390");
  check("at 390px nothing scrolls sideways", sideways.page <= 0 && sideways.inner <= 0, JSON.stringify(sideways));
} finally {
  await browser?.close().catch(() => undefined);
  await db.query(`delete from ai_chats where id = any ($1::uuid[])`, [[...made.chats]]);
  await db.query(`delete from ai_chats where title like 'LEARNQA%' and created_at > now() - interval '30 minutes'`);
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
    `select (select count(*) from ai_corrections where said like '%LEARNQA%' or corrected like '%LEARNQA%')::int as mistakes,
            (select count(*) from ai_chats where title like 'LEARNQA%')::int as chats,
            (select count(*) from subscriptions where tool_name like 'LEARNQA %')::int as plans,
            (select ai_instructions = $1 from app_settings where id = 1) as instructions_back`,
    [before.ai_instructions],
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
