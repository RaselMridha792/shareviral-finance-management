/**
 * Confirm in chat, then it saves — docs/briefs/2026-10-02-assistant-powerful.md,
 * piece A4 (3 Oct 2026).
 *
 * No model is asked here. A stand-in for Anthropic's API answers each turn
 * with a reply written below, and what is measured is what THIS APP does when
 * somebody presses Confirm and save:
 *
 *   A. a draft card, edited and confirmed: saved as the form saves it, as
 *      the person; its audit row says it came through the Assistant; the chat
 *      says what was saved and where; the lesson is kept; never twice;
 *   B. what the server will not take: two presses at once, the kind of
 *      record chosen by the caller, ids or a direction slipped in, a value
 *      the record refuses, a payment edited into a subscription, somebody
 *      else's conversation, HR, a conversation with nothing to save;
 *   C. a table of drafts: a row at a time, by its number, never twice, a
 *      refused row saying why;
 *   D. every other kind of record, each saved as its own form saves it,
 *      each audit row marked: money in, a transfer, a vendor, a person, a
 *      TDS challan, a new plan with its first payment;
 *   E. the page: Confirm and save, the sentence and its link, the card not
 *      offered again on a conversation reopened; a table's count and total,
 *      a row confirmed alone, the rest all together; 390px.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantconfirmqa.mjs               (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantconfirmqa.mjs  also saves screenshots
 *
 * Starts its own API on :4016 pointed at the stand-in, so the dev API on
 * :4001 is left alone. Puts a made-up Anthropic key in the local
 * app_settings while it runs and puts back what was there. Everything it
 * saves is named CONFIRMQA and deleted afterwards — entries, transfers, a
 * vendor, a person, a challan, a plan and their payments, its chats and its
 * lessons — and it prints what is left (nothing). The audit rows of what it
 * saved stay, as they would for anybody.
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
const PORT = 4016;
const API = `http://localhost:${PORT}/api`;
const STUB_PORT = 4596;
const SHOTS = process.env.SHOT_DIR || null;
const MARK = " — through the Assistant";
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
const cfo = await person("cfo");
const hr = await person("hr");
if (!admin || !cfo || !hr) throw new Error("The local books need an active super_admin, a cfo and an hr user.");
const tokenFor = (user) => jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const callAs = (bearer) => async (method, p, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const token = tokenFor(admin);
const call = callAs(token);
const callCfo = callAs(tokenFor(cfo));
const callHr = callAs(tokenFor(hr));

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------------ */
/*  The books this runs against                                              */
/* ------------------------------------------------------------------------ */

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
/** This run's own audit rows are the ones written after this. */
const [{ started }] = await q(`select now() as started`);
const accounts = await q(
  `select a.id, a.name, a.currency,
          (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null and t.deleted_at is null), 0))::numeric as balance
     from accounts a left join transactions t on t.account_id = a.id
    where a.is_active and a.deleted_at is null group by a.id order by a.name`,
);
const taka = accounts.filter((a) => a.currency !== "USD").sort((a, b) => Number(b.balance) - Number(a.balance));
const CARD = taka[0];
const OTHER = taka[1];
if (!CARD || !OTHER || Number(CARD.balance) < 20000) throw new Error("The local books need two taka accounts, one of them holding 20,000.");
// A money-out sub-category no part of the map claims, and a money-in one.
const [PLAIN] = await q(
  `select c.id, c.name from categories c join categories p on p.id = c.parent_id
    where c.is_active and c.deleted_at is null and c.kind <> 'in'
      and c.name !~* 'ai\\s*tool|subscription|software|hosting|server|domain'
      and p.name !~* 'ai\\s*tool|subscription|software|hosting|server|domain'
      and not exists (select 1 from categories o where o.id <> c.id and lower(o.name) = lower(c.name))
    order by c.name limit 1`,
);
const [INCOME] = await q(
  `select c.id, c.name from categories c
    where c.is_active and c.deleted_at is null and c.parent_id is not null and c.kind in ('in', 'both')
      and not exists (select 1 from categories o where o.id <> c.id and lower(o.name) = lower(c.name))
    order by c.name limit 1`,
);
// The heading a plan's payment is filed under: the subscriptions part claims it.
const [TOOLING] = await q(`select id, name from categories where deleted_at is null and kind = 'out' and slug = 'ai-tools' limit 1`);
if (!PLAIN || !INCOME || !TOOLING) throw new Error("The local books need a plain money-out sub-category, a money-in one and the ai-tools one.");

/* ------------------------------------------------------------------------ */
/*  A stand-in for the model: it says what it is told to                     */
/* ------------------------------------------------------------------------ */

let answer = null;
const asked = [];
const stub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    asked.push(JSON.parse(raw || "{}"));
    const input = answer ?? { draft: {}, missingFields: [], summary: "(the harness gave no answer)" };
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_confirmqa" });
    res.end(
      JSON.stringify({
        id: "msg_confirmqa",
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
async function turn(text, says, as = call) {
  answer = says;
  const res = await as("POST", "/ai/turn", { messages: [{ role: "user", content: text }] });
  if (res.body?.chatId) made.chats.add(res.body.chatId);
  if (res.status !== 200) console.log(`  (the turn "${text.slice(0, 40)}" answered ${res.status}: ${JSON.stringify(res.body)})`);
  return res;
}
const confirm = (chatId, draft, as = call) => as("POST", "/ai/confirm", { chatId, draft });
const confirmRow = (chatId, row, as = call) => as("POST", "/ai/confirm", { chatId, row });
/** The audit rows written for one record, newest first. */
const auditOf = (entityId) =>
  q(`select action, entity_table, summary, actor_user_id, actor_role from audit_logs where entity_id = $1 order by occurred_at desc`, [String(entityId)]);
const chatOf = async (id) => (await q(`select messages, reply from ai_chats where id = $1`, [id]))[0];
const esc = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const payment = (more = {}) => ({
  area: "expenses",
  target: "transaction_out",
  draft: { amount: "1234.50", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: "CONFIRMQA courier", ...more },
  missingFields: [],
});

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

/** Everything this run saves, taken out again. */
async function sweep() {
  await db.query(`delete from tds_deposits where challan_number like 'CONFIRMQA%'`);
  await db.query(`delete from transactions where transfer_group_id in (select transfer_group_id from transactions where description like 'CONFIRMQA%' and transfer_group_id is not null)`);
  await db.query(`delete from transactions where subscription_id in (select id from subscriptions where tool_name like 'CONFIRMQA%')`);
  await db.query(`delete from transactions where description like 'CONFIRMQA%' or description like '%challan CONFIRMQA%'`);
  await db.query(`delete from subscriptions where tool_name like 'CONFIRMQA%'`);
  await db.query(`delete from vendors where name like 'CONFIRMQA%'`);
  await db.query(`delete from team_members where full_name like 'CONFIRMQA%'`);
  await db.query(`delete from ai_corrections where said like '%CONFIRMQA%' or corrected like '%CONFIRMQA%' or drafted like '%CONFIRMQA%'`);
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
    [seal("sk-ant-confirmqa-000000000000000000000"), admin.id],
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA. A draft card, edited and confirmed");
  const first = await turn("CONFIRMQA courier bill 1234.50 dilam", payment());
  check("the draft is ready", first.body?.target === "transaction_out" && first.body?.missingFields?.length === 0, JSON.stringify(first.body?.missingFields));
  // The person changes the amount and the wording on the card before confirming.
  const edited = { ...first.body.draft, amount: "1250", description: "CONFIRMQA courier bill" };
  const saved = await confirm(first.body.chatId, edited);
  check("Confirm and save answers 200 with the record's number", saved.status === 200 && /^TXN-\d{4}-\d+$/.test(saved.body?.refNo ?? ""), `${saved.status} ${JSON.stringify(saved.body?.message ?? saved.body?.refNo)}`);
  check(
    "it says what was saved, from where, and where it shows",
    saved.body?.said === `Saved — money going out, ${saved.body?.refNo}: ৳1,250.00 from ${CARD.name}, under ${PLAIN.name}. It shows under All transactions.`,
    saved.body?.said,
  );
  check("with the screen for the link", saved.body?.showsOn?.href === "/transactions" && saved.body?.showsOn?.name === "All transactions" && saved.body?.warning === null, JSON.stringify(saved.body?.showsOn));
  const [row] = await q(
    `select id, direction, amount::text, account_id, category_id, created_via, created_by, description from transactions where ref_no = $1`,
    [saved.body?.refNo ?? "none"],
  );
  check(
    "the books hold what was on the card when it was confirmed, not what was drafted",
    row?.amount === "1250.00" && row?.description === "CONFIRMQA courier bill" && row?.direction === "out" && row?.account_id === CARD.id && row?.category_id === PLAIN.id,
    JSON.stringify(row),
  );
  check("saved as the person who pressed it, marked as come through the Assistant", row?.created_by === admin.id && row?.created_via === "ai_intake", `${row?.created_by} ${row?.created_via}`);
  const [audit] = row ? await auditOf(row.id) : [];
  check(
    "its audit row says who saved it, and that it came through the Assistant",
    audit?.action === "create" && audit?.entity_table === "transactions" && audit?.actor_user_id === admin.id && audit?.actor_role === "super_admin" && audit?.summary.endsWith(MARK),
    JSON.stringify(audit),
  );
  const firstChat = await chatOf(first.body.chatId);
  check("the conversation keeps it as saved, with its number", firstChat?.reply?.saved?.refNo === saved.body?.refNo && firstChat?.reply?.saved?.id === row?.id, JSON.stringify(firstChat?.reply?.saved));
  check("and the sentence is the conversation's last line", firstChat?.messages?.at(-1)?.role === "assistant" && firstChat?.messages?.at(-1)?.content === saved.body?.said, JSON.stringify(firstChat?.messages?.at(-1)));
  const lesson = await q(`select field, drafted, corrected from ai_corrections where kind = 'field' and said like 'CONFIRMQA courier bill%'`);
  check("what was changed on the card is kept as a lesson — the wording, never the amount", lesson.some((l) => l.field === "description" && l.corrected === "CONFIRMQA courier bill") && !lesson.some((l) => l.field === "amount"), JSON.stringify(lesson));
  const again = await confirm(first.body.chatId, edited);
  check("confirmed again: refused, saved already, with its number (409)", again.status === 409 && again.body?.message?.includes(saved.body?.refNo), `${again.status} ${again.body?.message}`);
  check("and still one record", (await q(`select count(*)::int as n from transactions where description = 'CONFIRMQA courier bill'`))[0].n === 1);

  /* ------------------------------------------------------------------ */
  console.log("\nB. What the server will not take");
  const twice = await turn("CONFIRMQA two presses", payment({ amount: "75", description: "CONFIRMQA two presses" }));
  const both = await Promise.all([confirm(twice.body.chatId, twice.body.draft), confirm(twice.body.chatId, twice.body.draft)]);
  check("two presses at once: one is saved, the other refused (409)", both.map((r) => r.status).sort().join(",") === "200,409", both.map((r) => `${r.status} ${r.body?.message ?? r.body?.refNo}`).join(" | "));
  check("and there is one record, not two", (await q(`select count(*)::int as n from transactions where description = 'CONFIRMQA two presses'`))[0].n === 1);

  const kind = await turn("CONFIRMQA kind", payment({ amount: "60", description: "CONFIRMQA kind" }));
  const asVendor = await call("POST", "/ai/confirm", { chatId: kind.body.chatId, draft: { name: "CONFIRMQA Vendor by the back door" }, target: "vendor" });
  check("the kind of record cannot be chosen by the caller (400)", asVendor.status === 400, `${asVendor.status} ${JSON.stringify(asVendor.body)}`);
  const neither = await call("POST", "/ai/confirm", { chatId: kind.body.chatId });
  check("nor a request with neither a card nor a row (400)", neither.status === 400, String(neither.status));

  const slipped = await turn("CONFIRMQA slipped", payment({ amount: "55", description: "CONFIRMQA slipped" }));
  const sneaky = await confirm(slipped.body.chatId, {
    ...slipped.body.draft,
    accountId: OTHER.id,
    direction: "in",
    createdVia: "excel_import",
    categoryId: randomUUID(),
  });
  const [sneakyRow] = await q(`select direction, account_id, category_id, created_via from transactions where description = 'CONFIRMQA slipped'`);
  check(
    "an account id, a direction and an origin slipped onto the card are ignored: the named account, money out, through the Assistant",
    sneaky.status === 200 && sneakyRow?.direction === "out" && sneakyRow?.account_id === CARD.id && sneakyRow?.category_id === PLAIN.id && sneakyRow?.created_via === "ai_intake",
    `${sneaky.status} ${JSON.stringify(sneakyRow)} ${sneaky.body?.message ?? ""}`,
  );

  const badAmount = await turn("CONFIRMQA bad amount", payment({ amount: "80", description: "CONFIRMQA bad amount" }));
  const refusedAmount = await confirm(badAmount.body.chatId, { ...badAmount.body.draft, amount: "eighty" });
  check("a value the record refuses is said in words, and nothing is saved (400)", refusedAmount.status === 400 && /^Not saved\. Amount "eighty" cannot be saved/.test(refusedAmount.body?.message ?? ""), `${refusedAmount.status} ${refusedAmount.body?.message}`);
  check("the conversation is not marked saved", !(await chatOf(badAmount.body.chatId))?.reply?.saved && (await q(`select count(*)::int as n from transactions where description = 'CONFIRMQA bad amount'`))[0].n === 0);
  const fixed = await confirm(badAmount.body.chatId, { ...badAmount.body.draft, amount: "80" });
  check("put right, the same card is saved", fixed.status === 200, `${fixed.status} ${fixed.body?.message ?? ""}`);

  const tooling = await turn("CONFIRMQA tooling", payment({ amount: "90", description: "CONFIRMQA tooling" }));
  const asTooling = await confirm(tooling.body.chatId, { ...tooling.body.draft, categoryName: TOOLING.name });
  check(
    "a payment edited onto the subscriptions heading is refused with the map's own sentence (400)",
    asTooling.status === 400 && asTooling.body?.message === BELONGS && (await q(`select count(*)::int as n from transactions where description = 'CONFIRMQA tooling'`))[0].n === 0,
    `${asTooling.status} ${asTooling.body?.message}`,
  );

  const notHers = await confirm(first.body.chatId, edited, callCfo);
  check("somebody else's conversation is not there (404)", notHers.status === 404, String(notHers.status));
  const asHr = await confirm(kind.body.chatId, kind.body.draft, callHr);
  check("HR cannot confirm at all (403)", asHr.status === 403, String(asHr.status));
  const talk = await turn("CONFIRMQA just talking", { draft: {}, missingFields: [], summary: "CONFIRMQA hello." });
  const nothing = await confirm(talk.body.chatId, { amount: "10" });
  check("a conversation with nothing waiting to be saved says so (400)", nothing.status === 400 && /Nothing on this conversation is waiting to be saved/.test(nothing.body?.message ?? ""), `${nothing.status} ${nothing.body?.message}`);

  const cfoDraft = await turn("CONFIRMQA cfo payment", payment({ amount: "65", description: "CONFIRMQA cfo payment" }), callCfo);
  const cfoSaved = await confirm(cfoDraft.body.chatId, cfoDraft.body.draft, callCfo);
  const [cfoRow] = await q(`select id, created_by from transactions where description = 'CONFIRMQA cfo payment'`);
  const [cfoAudit] = cfoRow ? await auditOf(cfoRow.id) : [];
  check("the CFO confirms their own: saved as the CFO, the audit row theirs and marked", cfoSaved.status === 200 && cfoRow?.created_by === cfo.id && cfoAudit?.actor_user_id === cfo.id && cfoAudit?.actor_role === "cfo" && cfoAudit?.summary.endsWith(MARK), `${cfoSaved.status} ${JSON.stringify(cfoAudit)}`);

  /* ------------------------------------------------------------------ */
  console.log("\nC. A table of drafts, a row at a time");
  const rowOf = (amount, description, account = CARD.name) => ({ amount, accountName: account, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description });
  const table = await turn("CONFIRMQA ei tinta bill add koro", {
    area: "expenses",
    draft: {},
    missingFields: [],
    batch: { target: "transaction_out", rows: [rowOf("100", "CONFIRMQA row one"), rowOf("200.50", "CONFIRMQA row two"), rowOf("300", "CONFIRMQA row three", "Zylofone Bank")], note: "3 bills" },
  });
  check("three rows are offered as a table", table.body?.batch?.rows?.length === 3, JSON.stringify(table.body?.batch?.rows?.length));
  const rowZero = await confirmRow(table.body.chatId, 0);
  check("row 1 is confirmed by its number and saved", rowZero.status === 200 && /^TXN-/.test(rowZero.body?.refNo ?? ""), `${rowZero.status} ${rowZero.body?.message ?? rowZero.body?.refNo}`);
  const rowZeroAgain = await confirmRow(table.body.chatId, 0);
  check("and never twice (409)", rowZeroAgain.status === 409 && /Row 1 is saved already/.test(rowZeroAgain.body?.message ?? ""), `${rowZeroAgain.status} ${rowZeroAgain.body?.message}`);
  const rowThree = await confirmRow(table.body.chatId, 2);
  check("a row naming an account nobody has is refused, saying why (400)", rowThree.status === 400 && /There is no account called "Zylofone Bank"/.test(rowThree.body?.message ?? ""), `${rowThree.status} ${rowThree.body?.message}`);
  const rowTwo = await confirmRow(table.body.chatId, 1);
  const rowMissing = await confirmRow(table.body.chatId, 7);
  check("a row that is not on the table is refused (400)", rowMissing.status === 400, String(rowMissing.status));
  const tableChat = await chatOf(table.body.chatId);
  check(
    "the conversation keeps which rows are saved, and only those",
    tableChat?.reply?.batch?.saved?.["0"]?.refNo === rowZero.body?.refNo && tableChat?.reply?.batch?.saved?.["1"]?.refNo === rowTwo.body?.refNo && !("2" in (tableChat?.reply?.batch?.saved ?? {})),
    JSON.stringify(tableChat?.reply?.batch?.saved),
  );
  check("a row's sentence is not added to the conversation one by one", !tableChat?.messages?.some((m) => /^Saved — /.test(m.content)), JSON.stringify(tableChat?.messages?.at(-1)));
  const rowsSaved = await q(`select id, amount::text from transactions where description in ('CONFIRMQA row one', 'CONFIRMQA row two', 'CONFIRMQA row three') order by amount::numeric`);
  const rowAudits = await Promise.all(rowsSaved.map((r) => auditOf(r.id)));
  check("two rows are in the books, each with its own marked audit row", rowsSaved.map((r) => r.amount).join(",") === "100.00,200.50" && rowAudits.every((rows) => rows[0]?.summary.endsWith(MARK)), JSON.stringify(rowsSaved));

  /* ------------------------------------------------------------------ */
  console.log("\nD. Every other kind, saved as its own form saves it");
  const moneyIn = await turn("CONFIRMQA income", { area: "transactions", target: "transaction_in", draft: { amount: "5000", accountName: CARD.name, categoryName: INCOME.name, usdRate: "122.5", txnDate: today, description: "CONFIRMQA income" }, missingFields: [] });
  const moneyInSaved = await confirm(moneyIn.body.chatId, moneyIn.body.draft);
  const [inRow] = await q(`select id, direction from transactions where description = 'CONFIRMQA income'`);
  check("money coming in", moneyInSaved.status === 200 && inRow?.direction === "in" && moneyInSaved.body?.said === `Saved — money coming in, ${moneyInSaved.body?.refNo}: ৳5,000.00 into ${CARD.name}. It shows under All transactions.`, `${moneyInSaved.status} ${moneyInSaved.body?.said ?? moneyInSaved.body?.message}`);

  const transfer = await turn("CONFIRMQA transfer", { area: "transfers", target: "transfer", draft: { amount: "100", fromAccountName: CARD.name, toAccountName: OTHER.name, usdRate: "122.5", txnDate: today, description: "CONFIRMQA transfer" }, missingFields: [] });
  const transferSaved = await confirm(transfer.body.chatId, transfer.body.draft);
  const pair = await q(`select id, direction, account_id from transactions where transfer_group_id = (select transfer_group_id from transactions where id = $1) order by direction desc`, [transferSaved.body?.id ?? randomUUID()]);
  const [transferAudit] = transferSaved.body?.id ? await auditOf(transferSaved.body.id) : [];
  check(
    "a transfer: the pair, out of one and into the other, its audit row marked",
    transferSaved.status === 200 && pair.length === 2 && pair[0].account_id === CARD.id && pair[1].account_id === OTHER.id && transferAudit?.summary.endsWith(MARK),
    `${transferSaved.status} ${JSON.stringify(pair)} ${transferAudit?.summary ?? transferSaved.body?.message}`,
  );
  check("and the sentence names Money Transfer", transferSaved.body?.said === `Saved — money moved between our own accounts, ${transferSaved.body?.refNo}: ৳100.00 from ${CARD.name} to ${OTHER.name}. It shows under Money Transfer.`, transferSaved.body?.said);

  const vendor = await turn("CONFIRMQA vendor", { area: "vendors", target: "vendor", draft: { name: "CONFIRMQA Sundarban Courier", type: "supplier" }, missingFields: [] });
  const vendorSaved = await confirm(vendor.body.chatId, vendor.body.draft);
  const [vendorAudit] = vendorSaved.body?.id ? await auditOf(vendorSaved.body.id) : [];
  check("a vendor, its audit row marked, said to be on no screen", vendorSaved.status === 200 && vendorSaved.body?.refNo === null && vendorAudit?.entity_table === "vendors" && vendorAudit?.summary.endsWith(MARK) && vendorSaved.body?.said === "Saved — a vendor: CONFIRMQA Sundarban Courier. No screen lists vendors today.", `${vendorSaved.status} ${vendorSaved.body?.said ?? vendorSaved.body?.message}`);

  const member = await turn("CONFIRMQA notun lok", { area: "team", target: "team_member", draft: { fullName: "CONFIRMQA Rahim Uddin", joinedOn: today, engagementType: "employee", designation: "Courier" }, missingFields: [] });
  const memberSaved = await confirm(member.body.chatId, member.body.draft);
  const [memberAudit] = memberSaved.body?.id ? await auditOf(memberSaved.body.id) : [];
  check("someone on the team, their audit row marked, shown under Team", memberSaved.status === 200 && memberAudit?.summary.endsWith(MARK) && memberSaved.body?.said === "Saved — someone on the team: CONFIRMQA Rahim Uddin. It shows under Team." && memberSaved.body?.showsOn?.href === "/team", `${memberSaved.status} ${memberSaved.body?.said ?? memberSaved.body?.message}`);

  const challan = await turn("CONFIRMQA challan", { area: "tds", target: "tds_deposit", draft: { challanNumber: "CONFIRMQA-42", challanDate: today, depositDate: today, amount: "500", periodYear: today.slice(0, 4), periodMonth: String(Number(today.slice(5, 7))), accountName: CARD.name, usdRate: "122.5" }, missingFields: [] });
  const challanSaved = await confirm(challan.body.chatId, challan.body.draft);
  const [deposit] = await q(`select id, transaction_id from tds_deposits where challan_number = 'CONFIRMQA-42'`);
  const [depositAudit] = deposit ? await auditOf(deposit.id) : [];
  check(
    "a TDS challan: its payment's number, where it really shows, its audit row marked",
    challanSaved.status === 200 && deposit?.transaction_id && /^TXN-/.test(challanSaved.body?.refNo ?? "") && depositAudit?.summary.endsWith(MARK) && /Its payment shows under All transactions; the TDS screen lists no challans\.$/.test(challanSaved.body?.said ?? ""),
    `${challanSaved.status} ${challanSaved.body?.said ?? challanSaved.body?.message}`,
  );

  const plan = await turn("CONFIRMQA plan", { area: "subscriptions", target: "subscription", draft: { toolName: "CONFIRMQA Tool", planName: "Pro", category: "ai_tool", costUsd: "20", usdRate: "122.5", billingCycle: "monthly", startDate: today, accountName: CARD.name }, missingFields: [] });
  const planSaved = await confirm(plan.body.chatId, plan.body.draft);
  const [planRow] = await q(`select id from subscriptions where tool_name = 'CONFIRMQA Tool'`);
  const firstPayment = planRow ? await q(`select id, amount::text from transactions where subscription_id = $1`, [planRow.id]) : [];
  const planAudit = planRow ? await auditOf(planRow.id) : [];
  const paymentAudit = firstPayment[0] ? await auditOf(firstPayment[0].id) : [];
  check(
    "a new plan and its first payment, both audit rows marked",
    planSaved.status === 200 && firstPayment.length === 1 && firstPayment[0].amount === "2450.00" && planAudit.some((a) => a.action === "create" && a.summary.endsWith(MARK)) && paymentAudit[0]?.summary.endsWith(MARK),
    `${planSaved.status} ${JSON.stringify(firstPayment)} ${planAudit.map((a) => a.summary).join(" | ")}`,
  );
  check("said with its first payment's number", planSaved.body?.said === `Saved — a new plan under AI tools and subscriptions: CONFIRMQA Tool, Pro, $20.00, its first payment ${planSaved.body?.refNo}. It shows under AI tools and subscriptions.`, planSaved.body?.said);
  const [unmarked] = await q(
    `select count(*)::int as n from audit_logs where occurred_at >= $3 and summary like '%CONFIRMQA%' and summary not like $1 and actor_user_id = any ($2::uuid[]) and action = 'create'`,
    [`%${MARK}`, [admin.id, cfo.id], started],
  );
  check("no create this run made through the chat went unmarked", unmarked.n === 0, String(unmarked.n));
  // The mark is the Assistant's alone: the same entry typed into the form,
  // right after a confirm on the same API, says nothing of the Assistant.
  const typed = await call("POST", "/transactions", { direction: "out", amount: "45", accountId: CARD.id, categoryId: PLAIN.id, usdRate: "122.5", txnDate: today, description: "CONFIRMQA typed into the form" });
  const [typedAudit] = typed.body?.id ? await auditOf(typed.body.id) : [];
  check("an entry typed into the form is not marked", typed.status === 201 && typedAudit?.summary === "Paid ৳45.00 — CONFIRMQA typed into the form", `${typed.status} ${typedAudit?.summary ?? JSON.stringify(typed.body)}`);

  /* ------------------------------------------------------------------ */
  console.log("\nE. The page");
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
  const say = async (text, says) => {
    answer = says;
    const answered = page.waitForResponse((response) => response.url().endsWith("/ai/turn") && response.request().method() === "POST", { timeout: 60000 });
    await page.type('textarea[placeholder^="Type it"]', text);
    await page.keyboard.press("Enter");
    const res = await answered;
    const body = await res.json().catch(() => null);
    if (body?.chatId) made.chats.add(body.chatId);
    await page.waitForFunction(() => !document.body.innerText.includes("Thinking…"), { timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
  };
  const transcript = () => page.evaluate(() => document.querySelector("main")?.innerText ?? document.body.innerText);
  const links = () => page.evaluate(() => [...document.querySelectorAll("main a")].map((a) => ({ text: a.innerText.trim(), href: a.getAttribute("href") })));
  const button = (label) =>
    page.evaluate((wanted) => {
      const found = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === wanted || b.getAttribute("aria-label") === wanted);
      return found ? { disabled: found.disabled } : null;
    }, label);
  const press = (label) =>
    page.evaluate((wanted) => {
      const found = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === wanted || b.getAttribute("aria-label") === wanted);
      found?.click();
      return Boolean(found);
    }, label);
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await say("CONFIRMQA page courier 640 taka", payment({ amount: "640", description: "CONFIRMQA page courier" }));
  check("the draft card offers Confirm and save", (await button("Confirm and save"))?.disabled === false, JSON.stringify(await button("Confirm and save")));
  await shot("card-ready");
  const confirmed = page.waitForResponse((response) => response.url().endsWith("/ai/confirm"), { timeout: 60000 });
  await press("Confirm and save");
  await confirmed;
  await page.waitForFunction(() => /Saved — /.test(document.body.innerText) || document.querySelector('[role="alert"]'), { timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  let text = await transcript();
  await shot("card-saved");
  const pageLine = text.match(/Saved — [^\n]*/)?.[0] ?? "";
  check("pressing it: the sentence says what was saved and where", new RegExp(`^Saved — money going out, TXN-[\\w-]+: ৳640\\.00 from ${esc(CARD.name)}, under ${esc(PLAIN.name)}\\. It shows under All transactions\\.$`).test(pageLine), pageLine || text.slice(-300).replace(/\n/g, " | "));
  check("with the link to that screen", (await links()).some((a) => a.text === "Open All transactions" && a.href === "/transactions"), JSON.stringify(await links()));
  check("and the card is gone: nothing left to press twice", (await button("Confirm and save")) === null);
  check("one record in the books", (await q(`select count(*)::int as n from transactions where description = 'CONFIRMQA page courier'`))[0].n === 1);

  // Reopened from the history: the sentence is there, the card is not.
  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForFunction(() => [...document.querySelectorAll("aside button")].some((b) => b.textContent.startsWith("CONFIRMQA page courier")), { timeout: 60000 });
  await page.evaluate(() => [...document.querySelectorAll("aside button")].find((b) => b.textContent.startsWith("CONFIRMQA page courier"))?.click());
  await page.waitForFunction(() => /Saved — /.test(document.body.innerText), { timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  text = await transcript();
  await shot("card-reopened");
  check("reopened later: the sentence is in the conversation", /Saved — money going out, TXN-/.test(text), text.slice(-300).replace(/\n/g, " | "));
  check("the card is not offered again", (await button("Confirm and save")) === null && !text.includes("The draft"));
  check("and the link is there", (await links()).some((a) => a.text === "Open All transactions"), JSON.stringify(await links()));

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await say("CONFIRMQA page table", {
    area: "expenses",
    draft: {},
    missingFields: [],
    batch: {
      target: "transaction_out",
      rows: [
        rowOf("1,000", "CONFIRMQA page row one"),
        rowOf("250.50", "CONFIRMQA page row two"),
        rowOf("99", "CONFIRMQA page row three", "Zylofone Bank"),
        rowOf("$40", "CONFIRMQA page row four"),
      ],
      note: "4 bills",
    },
  });
  text = await transcript();
  await shot("table-ready");
  check("the table's summary: how many, and what they come to", /4 to save · total ৳1,349\.50/.test(text), (text.match(/\d+ to save[^\n]*/) ?? [""])[0]);
  check("a row whose amount cannot be read is counted apart, not added in", /1 with no amount that can be read, left out of the total/.test(text), (text.match(/\d+ to save[^\n]*/) ?? [""])[0]);
  check("with Confirm and save all, and a Confirm on every row", (await button("Confirm and save all 4"))?.disabled === false && (await page.$$eval("tbody button", (b) => b.filter((x) => x.textContent.trim() === "Confirm").length)) === 4);

  const oneRow = page.waitForResponse((response) => response.url().endsWith("/ai/confirm"), { timeout: 60000 });
  await press("Confirm and save row 1");
  await oneRow;
  await page.waitForFunction(() => [...document.querySelectorAll("tbody tr")][0]?.innerText.includes("TXN-"), { timeout: 60000 });
  text = await transcript();
  check("row 1 confirmed alone: its number on the row, the rest still to save", /3 to save · total ৳349\.50/.test(text), (text.match(/\d+ to save[^\n]*/) ?? [""])[0]);
  await press("Confirm and save all 3");
  await page.waitForFunction(() => /Saved \d+ of \d+/.test(document.body.innerText), { timeout: 60000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  text = await transcript();
  await shot("table-saved");
  // Each row with the line under it, when it has one: why it was refused.
  const rowsOnPage = await page.$$eval("tbody tr.row-finance", (trs) =>
    trs.map((tr) => {
      const next = tr.nextElementSibling;
      const reason = next && !next.classList.contains("row-finance") ? ` ${next.innerText}` : "";
      return `${tr.innerText}${reason}`.replace(/\s+/g, " ");
    }),
  );
  check("all together: the good one saved, the two refused say why on their rows", /Saved 1 of 3 — the rest say why on their rows\./.test(text) && /TXN-/.test(rowsOnPage[1]) && /There is no account called "Zylofone Bank"/.test(rowsOnPage[2]) && /cannot be saved/.test(rowsOnPage[3]), rowsOnPage.join(" || ").slice(0, 500));
  check("each refused row keeps its Confirm, to try again", (await page.$$eval("tbody button", (b) => b.filter((x) => x.textContent.trim() === "Confirm").length)) === 2);
  const pageRows = await q(`select amount::text from transactions where description like 'CONFIRMQA page row%' order by amount::numeric`);
  check("the books hold the two saved rows, and nothing for the refused", pageRows.map((r) => r.amount).join(",") === "250.50,1000.00", JSON.stringify(pageRows));

  await page.setViewport({ width: 390, height: 844 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot("table-390");
  check("390px: the page does not scroll sideways; the table scrolls in its own box", sideways <= 0, String(sideways));
  check("no page error", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser?.close().catch(() => undefined);
  await db.query(`delete from ai_chats where id = any ($1::uuid[])`, [[...made.chats]]);
  await db.query(`delete from ai_chats where title like 'CONFIRMQA%' and created_at > now() - interval '30 minutes'`);
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
    `select (select count(*) from transactions where description like 'CONFIRMQA%' or description like '%challan CONFIRMQA%')::int as entries,
            (select count(*) from subscriptions where tool_name like 'CONFIRMQA%')::int as plans,
            (select count(*) from vendors where name like 'CONFIRMQA%')::int as vendors,
            (select count(*) from team_members where full_name like 'CONFIRMQA%')::int as people,
            (select count(*) from tds_deposits where challan_number like 'CONFIRMQA%')::int as challans,
            (select count(*) from ai_chats where title like 'CONFIRMQA%')::int as chats,
            (select count(*) from ai_corrections where said like '%CONFIRMQA%')::int as lessons`,
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
