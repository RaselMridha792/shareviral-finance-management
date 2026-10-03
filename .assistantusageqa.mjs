/**
 * What the Assistant spends — docs/briefs/2026-10-04-assistant-asks-everything-and-b3.md,
 * piece 2 (B3, 4 Oct 2026).
 *
 * A stand-in for Anthropic's API answers every call with token counts this
 * script chose, and what is measured is what the app keeps and says:
 *
 *   A. a row of ai_usage for each kind of call: both rounds of a turn with a
 *      look-up, a PDF statement read, an invoice read, the Anthropic key's
 *      Test — who, which chat, which model, the counts as the stand-in gave
 *      them;
 *   B. the report checked against the rows, in SQL: the month's totals, by
 *      model, by person, by day; the estimate worked out here from the
 *      providers' prices and compared to the cent's ten-thousandth, Gemini
 *      rows included (put in directly: no Google stand-in exists); who may
 *      read it and who may set the limit;
 *   C. the limit: a warning at 80%, carried on the turn's answer; at 100%
 *      the turn and a PDF refused with the sentence, nothing asked, nothing
 *      kept; taken off, it answers again; every change audited;
 *   D. the page: the panel beside the chat at 1440px, folded and kept
 *      folded, the warning above the message box, the panel behind its
 *      button at 390px; the breakdown on the Assistant's settings, the
 *      limit's box for the Super Admin and none for the CFO.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantusageqa.mjs                 (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantusageqa.mjs   also saves screenshots
 *
 * Starts its own API on :4019 pointed at the stand-in, so the dev API on
 * :4001 is left alone. Puts a made-up Anthropic key and its own limit in the
 * local app_settings while it runs and puts back what was there. Its rows of
 * ai_usage, its chats and attachments are deleted afterwards; the audit rows
 * of its limit changes stay, as they would for anybody.
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
const PORT = 4019;
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

/* ------------------------------------------------------------------------ */
/*  The prices, written out again here: the report is held to them          */
/* ------------------------------------------------------------------------ */

/** US dollars per million tokens, as the providers' pages had them, 4 Oct 2026. */
const PRICES = {
  "anthropic|claude-opus-5": { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  "vertex|claude-opus-5": { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  "vertex|gemini-3.8-flash": { input: 0.75, cacheRead: 0.075, cacheWrite: 0, output: 3.75 },
  "vertex|gemini-3.1-pro-preview": { input: 2, cacheRead: 0.2, cacheWrite: 0, output: 12 },
  "vertex|gemini-3.1-pro-preview|long": { input: 4, cacheRead: 0.4, cacheWrite: 0, output: 18 },
  "vertex|gemini-2.5-pro": { input: 1.25, cacheRead: 0.125, cacheWrite: 0, output: 10 },
  "vertex|gemini-2.5-pro|long": { input: 2.5, cacheRead: 0.25, cacheWrite: 0, output: 15 },
};
const micro = (usd) => BigInt(Math.round(usd * 1e6));
/** 10^-12 dollars as "0.0000", rounded half up. */
const dollars = (pico) => {
  const t = (pico * 10000n + 500000000000n) / 1000000000000n;
  return `${t / 10000n}.${(t % 10000n).toString().padStart(4, "0")}`;
};
/** The estimate of rows summed in SQL by model, way and prompt length. */
const estimate = (groups) => {
  let pico = 0n;
  let unpriced = 0;
  for (const g of groups) {
    const rate = PRICES[`${g.provider}|${g.model}${g.long ? "|long" : ""}`] ?? PRICES[`${g.provider}|${g.model}`];
    if (!rate || g.day > "2026-12-31") {
      unpriced += Number(g.calls);
      continue;
    }
    pico +=
      BigInt(g.input) * micro(rate.input) +
      BigInt(g.cache_read) * micro(rate.cacheRead) +
      BigInt(g.cache_write) * micro(rate.cacheWrite) +
      BigInt(Number(g.output) + Number(g.thinking)) * micro(rate.output);
  }
  return { usd: dollars(pico), pico, unpriced };
};
const MONTH_ROWS = `created_at >= date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka'`;
const groupsBy = (extra = "") =>
  q(`select model, provider, to_char(created_at at time zone 'Asia/Dhaka', 'YYYY-MM-DD') as day,
            (input_tokens + cache_read_tokens + cache_write_tokens) > 200000 as long ${extra ? `, ${extra}` : ""},
            count(*)::int as calls, sum(input_tokens)::bigint as input, sum(cache_read_tokens)::bigint as cache_read,
            sum(cache_write_tokens)::bigint as cache_write, sum(output_tokens)::bigint as output,
            coalesce(sum(thinking_tokens), 0)::bigint as thinking
       from ai_usage where ${MONTH_ROWS} group by 1, 2, 3, 4 ${extra ? ", 5" : ""}`);

/* ------------------------------------------------------------------------ */
/*  A stand-in for the model: it answers with the counts it is told         */
/* ------------------------------------------------------------------------ */

/** What the next turn's rounds answer, in order, and what each counts. */
let script = [];
const TURN_USAGE = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 };
const DOC_USAGE = { input_tokens: 2000, output_tokens: 150 };
const asked = [];
const stub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const request = JSON.parse(raw || "{}");
    asked.push(request);
    if (request.stream) {
      const tool = request.tool_choice?.name;
      const input =
        tool === "statement_rows"
          ? { headers: ["Date", "Description", "Debit"], rows: [["01/10/2026", "USAGEQA row", "100"]] }
          : { isInvoice: true, number: "INV-USAGE-1" };
      res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_usageqa" });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send("message_start", { type: "message_start", message: { id: "msg_usageqa_doc", type: "message", role: "assistant", model: "claude-opus-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: DOC_USAGE.input_tokens, output_tokens: 1 } } });
      send("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_doc", name: tool, input: {} } });
      send("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } });
      send("content_block_stop", { type: "content_block_stop", index: 0 });
      send("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: DOC_USAGE.output_tokens } });
      send("message_stop", { type: "message_stop" });
      res.end();
      return;
    }
    const line = script.shift() ?? { draft: {}, missingFields: [], summary: "USAGEQA an answer." };
    const use = line.tool ? { name: line.tool, input: line.input ?? {} } : { name: "answer", input: line };
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_usageqa" });
    res.end(
      JSON.stringify({
        id: `msg_usageqa_${asked.length}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "tool_use", id: `toolu_${asked.length}`, ...use }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: line.usage ?? TURN_USAGE,
      }),
    );
  });
});
await new Promise((resolve) => stub.listen(STUB_PORT, "127.0.0.1", resolve));

const made = { chats: new Set(), attachments: new Set() };
async function turn(text, lines, as = call) {
  script = Array.isArray(lines) ? [...lines] : [lines];
  const res = await as("POST", "/ai/turn", { messages: [{ role: "user", content: `USAGEQA ${text}` }] });
  if (res.body?.chatId) made.chats.add(res.body.chatId);
  return res;
}

/* ------------------------------------------------------------------------ */

const seal = (plaintext) => {
  const source = env.SECRET_ENCRYPTION_KEY?.trim() || env.JWT_REFRESH_SECRET?.trim();
  const key = createHash("sha256").update(source, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
};
const [before] = await q(`select ai_provider, ai_model, ai_data_access, anthropic_api_key, anthropic_key_set_at, anthropic_key_set_by, ai_monthly_limit_usd from app_settings where id = 1`);
const [{ started }] = await q(`select now() as started`);

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

/** The rows this run wrote: everything since it started, by its own people. */
const mine = () => q(`select * from ai_usage where created_at >= $1 and user_id = any ($2::uuid[]) order by created_at, id`, [started, [admin.id, cfo.id]]);

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
            anthropic_api_key = $1, anthropic_key_set_at = now(), anthropic_key_set_by = $2, ai_monthly_limit_usd = null where id = 1`,
    [seal("sk-ant-usageqa-00000000000000000000000"), admin.id],
  );

  /* ------------------------------------------------------------------ */
  console.log("\nA. A row for every call");
  const looked = await turn("koto jon team e?", [{ tool: "team_members", input: {} }, { area: "team", draft: {}, missingFields: [], summary: "USAGEQA the count." }]);
  let rows = await mine();
  check("a turn with a look-up: two rounds, two rows", looked.status === 200 && rows.length === 2 && rows.every((r) => r.kind === "turn"), `${looked.status} ${rows.length}`);
  check(
    "on the conversation, as the person asking, by model and way",
    rows.every((r) => r.chat_id === looked.body?.chatId && r.user_id === admin.id && r.provider === "anthropic" && r.model === "claude-opus-5"),
    JSON.stringify(rows.map((r) => [r.chat_id === looked.body?.chatId, r.provider, r.model])),
  );
  check(
    "with the counts the model gave: input apart from the cache, Claude's thinking left null",
    rows.every((r) => r.input_tokens === 1200 && r.cache_read_tokens === 6000 && r.cache_write_tokens === 0 && r.output_tokens === 300 && r.thinking_tokens === null),
    JSON.stringify(rows.map((r) => [r.input_tokens, r.cache_read_tokens, r.cache_write_tokens, r.output_tokens, r.thinking_tokens])),
  );
  check("the answer carries the month so far", looked.body?.usage?.state === "ok" && looked.body?.usage?.totals?.calls >= 2, JSON.stringify(looked.body?.usage?.totals));

  const pdf = await upload("/ai/attachments", "usageqa.pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), "application/pdf");
  for (const one of pdf.body ?? []) made.attachments.add(one.id);
  const invoice = await upload("/ai/attachments/invoice", "usageqa-invoice.pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), "application/pdf");
  for (const one of invoice.body ?? []) made.attachments.add(one.id);
  rows = (await mine()).filter((r) => r.kind === "document");
  check("a PDF statement read, and an invoice read: a document row each, on no conversation yet", pdf.status === 200 && invoice.status === 200 && rows.length === 2 && rows.every((r) => r.chat_id === null && r.input_tokens === 2000 && r.output_tokens === 150), `${pdf.status} ${invoice.status} ${JSON.stringify(rows.map((r) => [r.input_tokens, r.output_tokens]))}`);

  const tested = await call("POST", "/ai/key", { apiKey: "sk-ant-usageqa-test-000000000000000000" });
  rows = (await mine()).filter((r) => r.kind === "test");
  check("the Anthropic key's Test: a test row, on no conversation", tested.body?.saved === true && rows.length === 1 && rows[0].chat_id === null && rows[0].provider === "anthropic", `${JSON.stringify(tested.body)} ${rows.length}`);

  // Gemini, put in as the adapter writes it (gemini.spec.ts holds the
  // adapter to it): no stand-in for Google exists.
  await q(
    `insert into ai_usage (user_id, chat_id, provider, model, kind, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, thinking_tokens)
     values ($1, null, 'vertex', 'gemini-3.8-flash', 'turn', 3000, 4000, 0, 500, 2500),
            ($1, null, 'vertex', 'gemini-3.1-pro-preview', 'turn', 150000, 60000, 0, 1000, 4000),
            ($2, null, 'vertex', 'gemini-3.1-pro-preview', 'turn', 20000, 0, 0, 800, 1200),
            ($2, null, 'vertex', 'gemini-0-retired', 'turn', 100, 0, 0, 10, 0)`,
    [admin.id, cfo.id],
  );

  /* ------------------------------------------------------------------ */
  console.log("\nB. The report, against the rows");
  const report = await call("GET", "/ai/usage/report");
  const [sums] = await q(
    `select count(*)::int as calls, sum(input_tokens)::bigint as input, sum(cache_read_tokens)::bigint as cache_read, sum(cache_write_tokens)::bigint as cache_write,
            sum(output_tokens)::bigint as output, coalesce(sum(thinking_tokens), 0)::bigint as thinking
       from ai_usage where ${MONTH_ROWS}`,
  );
  const t = report.body?.totals ?? {};
  check(
    "the month's counts are SQL's sums of the rows",
    report.status === 200 && t.calls === sums.calls && t.inputTokens === Number(sums.input) && t.cacheReadTokens === Number(sums.cache_read) && t.cacheWriteTokens === Number(sums.cache_write) && t.outputTokens === Number(sums.output) && t.thinkingTokens === Number(sums.thinking),
    `${JSON.stringify(t)} vs ${JSON.stringify(sums)}`,
  );
  const groups = await groupsBy();
  const expected = estimate(groups);
  check("the estimate is the providers' prices on those sums, to the ten-thousandth", t.costUsd === expected.usd, `${t.costUsd} vs ${expected.usd}`);
  check("a model with no price is counted, and left out of the dollars, never $0", t.unpricedCalls === expected.unpriced && expected.unpriced >= 1, `${t.unpricedCalls} vs ${expected.unpriced}`);

  const longPro = groups.filter((g) => g.model === "gemini-3.1-pro-preview");
  check("a 3.1 Pro prompt over 200,000 tokens is priced at the long rate", longPro.some((g) => g.long) && longPro.some((g) => !g.long));

  const byModelSql = await q(
    `select provider, model, count(*)::int as calls, sum(output_tokens)::bigint as output from ai_usage where ${MONTH_ROWS} group by 1, 2`,
  );
  const byModel = report.body?.byModel ?? [];
  check(
    "by model: each model's calls and output, as SQL counts them, and its own estimate",
    byModelSql.length === byModel.length &&
      byModelSql.every((s) => {
        const row = byModel.find((m) => m.model === s.model && m.provider === s.provider);
        const own = estimate(groups.filter((g) => g.model === s.model && g.provider === s.provider));
        return row && row.calls === s.calls && row.outputTokens === Number(s.output) && (row.costUsd ?? null) === (own.pico > 0n || own.unpriced === 0 ? own.usd : null);
      }),
    JSON.stringify(byModel.map((m) => [m.model, m.calls, m.costUsd])),
  );
  const byPersonSql = await q(`select user_id, count(*)::int as calls from ai_usage where ${MONTH_ROWS} group by 1`);
  const byPerson = report.body?.byPerson ?? [];
  check(
    "by person: each person's calls, with their name",
    byPersonSql.length === byPerson.length && byPersonSql.every((s) => byPerson.find((p) => p.userId === s.user_id)?.calls === s.calls) && byPerson.find((p) => p.userId === admin.id)?.name === admin.full_name,
    JSON.stringify(byPerson.map((p) => [p.name, p.calls])),
  );
  const byDaySql = await q(`select to_char(created_at at time zone 'Asia/Dhaka', 'YYYY-MM-DD') as day, count(*)::int as calls from ai_usage where ${MONTH_ROWS} group by 1`);
  const byDay = report.body?.byDay ?? [];
  check("by day (Dhaka's): each day's calls", byDaySql.length === byDay.length && byDaySql.every((s) => byDay.find((d) => d.day === s.day)?.calls === s.calls), JSON.stringify(byDay.map((d) => [d.day, d.calls])));
  check("the last twelve months, this one among them with the same totals", report.body?.months?.[0]?.month === report.body?.month && report.body?.months?.[0]?.calls === t.calls, JSON.stringify(report.body?.months?.slice(0, 2)));
  check("the prices the estimate used are in the report", (report.body?.prices ?? []).some((p) => p.model === "gemini-3.8-flash" && p.from === "2027-01-01" && p.input === 1.5));

  const summary = await call("GET", "/ai/usage");
  check("the panel's summary: the same month, the same estimate, no limit", summary.body?.totals?.costUsd === t.costUsd && summary.body?.limitUsd === null && summary.body?.state === "ok", JSON.stringify(summary.body));
  const cfoRead = await callCfo("GET", "/ai/usage/report");
  const hrRead = await callHr("GET", "/ai/usage");
  const cfoSet = await callCfo("PUT", "/ai/usage/limit", { limitUsd: "1.00" });
  check("the CFO reads the report and the summary", cfoRead.status === 200 && (await callCfo("GET", "/ai/usage")).status === 200, String(cfoRead.status));
  check("the CFO cannot set the limit; HR reads nothing", cfoSet.status === 403 && hrRead.status === 403, `${cfoSet.status} ${hrRead.status}`);
  const zero = await call("PUT", "/ai/usage/limit", { limitUsd: "0" });
  check("a limit of nothing is refused in words", zero.status === 400, `${zero.status} ${JSON.stringify(zero.body?.message)}`);

  /* ------------------------------------------------------------------ */
  console.log("\nC. The limit");
  // 85% of what is spent so far: the warning.
  const spentPico = expected.pico;
  const warnAt = (Number(spentPico / 10000000000n) / 100 / 0.85).toFixed(2);
  const setWarn = await call("PUT", "/ai/usage/limit", { limitUsd: warnAt });
  check("the Super Admin sets it", setWarn.status === 200 && setWarn.body?.limitUsd === warnAt, `${setWarn.status} ${JSON.stringify(setWarn.body)}`);
  check(
    "at 85% it warns, in words that name who can raise it",
    setWarn.body?.state === "warning" && setWarn.body?.usedShare >= 0.8 && setWarn.body?.usedShare < 1 && /Super Admin can raise it in the Assistant's settings/.test(setWarn.body?.message ?? ""),
    `${setWarn.body?.usedShare} ${setWarn.body?.message}`,
  );
  const warned = await turn("aro ekta", { area: "team", draft: {}, missingFields: [], summary: "USAGEQA still answering.", usage: { input_tokens: 1, output_tokens: 1 } });
  check("a turn still answers, and carries the warning", warned.status === 200 && warned.body?.usage?.state === "warning", `${warned.status} ${warned.body?.usage?.state}`);

  const stopAt = "0.01";
  const setStop = await call("PUT", "/ai/usage/limit", { limitUsd: stopAt });
  check("at 100% it has stopped", setStop.body?.state === "stopped" && /It is off until the 1st, unless a Super Admin raises the limit in the Assistant's settings/.test(setStop.body?.message ?? ""), setStop.body?.message);
  const askedBefore = asked.length;
  const [{ n: chatsBefore }] = await q(`select count(*)::int as n from ai_chats where user_id = $1`, [cfo.id]);
  const rowsBefore = (await mine()).length;
  const refused = await turn("ar ekta", { area: "team", draft: {}, missingFields: [], summary: "USAGEQA must not be asked." }, callCfo);
  check("a turn at the limit is refused with the sentence, for the CFO as for anybody", refused.status === 402 && /reached this month's limit of \$0\.01/.test(refused.body?.message ?? ""), `${refused.status} ${refused.body?.message}`);
  const pdfRefused = await upload("/ai/attachments", "usageqa2.pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), "application/pdf");
  check("a PDF at the limit is refused too", pdfRefused.status === 402, String(pdfRefused.status));
  const [{ n: chatsAfter }] = await q(`select count(*)::int as n from ai_chats where user_id = $1`, [cfo.id]);
  check("nothing was asked of the model, and nothing kept", asked.length === askedBefore && chatsAfter === chatsBefore && (await mine()).length === rowsBefore, `${asked.length - askedBefore} asked, ${chatsAfter - chatsBefore} chats, ${(await mine()).length - rowsBefore} rows`);

  const off = await call("PUT", "/ai/usage/limit", { limitUsd: null });
  const again = await turn("ekhon?", { area: "team", draft: {}, missingFields: [], summary: "USAGEQA answering again.", usage: { input_tokens: 1, output_tokens: 1 } });
  check("taken off: no limit, and it answers again", off.body?.limitUsd === null && off.body?.state === "ok" && again.status === 200, `${off.status} ${again.status}`);
  const audits = await q(`select summary from audit_logs where occurred_at >= $1 and summary like '%Assistant''s monthly limit%' order by occurred_at`, [started]);
  check(
    "every change to it is in the audit log",
    audits.length === 3 && audits[0].summary === `Set the Assistant's monthly limit to $${warnAt} of estimated cost` && audits[2].summary === "Took off the Assistant's monthly limit",
    audits.map((a) => a.summary).join(" | "),
  );

  /* ------------------------------------------------------------------ */
  console.log("\nD. The page");
  await call("PUT", "/ai/usage/limit", { limitUsd: warnAt });
  const panelUsage = (await call("GET", "/ai/usage")).body;
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
  const settle = () => new Promise((resolve) => setTimeout(resolve, 600));
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  /** "$0.1234" as the panel writes it: four places under a dollar. */
  const shown = (text) => (Number(text) >= 1 ? `$${Number(text).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${Number(text).toFixed(4)}`);

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("sfm.assistant.usage.folded");
    } catch {}
  });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector('aside[aria-label="Usage this month"] [data-usage-state]', { timeout: 30000 });
  await settle();
  const aside = await page.evaluate(() => {
    const el = document.querySelector('aside[aria-label="Usage this month"]');
    const box = el?.getBoundingClientRect();
    return { text: el?.innerText ?? "", width: box?.width, right: box?.right, meter: el?.querySelector('[role="meter"]')?.getAttribute("aria-valuenow"), state: el?.querySelector("[data-usage-state]")?.getAttribute("data-usage-state") };
  });
  check("1440px: the panel on the right of the chat, 288px wide", aside.width === 288 && aside.right === 1440, JSON.stringify({ width: aside.width, right: aside.right }));
  check("it shows the month's estimate, said to be one, and the limit with how much is used", aside.text.includes(shown(panelUsage.totals.costUsd)) && /invoice is the real figure/.test(aside.text) && aside.text.includes(`$${warnAt}`) && aside.state === "warning" && Number(aside.meter) >= 80, aside.text.replace(/\n/g, " | ").slice(0, 300));
  check("with the tokens by kind", /Input/.test(aside.text) && /Read from the cache/.test(aside.text) && /Output/.test(aside.text) && /Thinking \(Gemini\)/.test(aside.text));
  const notice = await page.evaluate(() => document.querySelector('[data-usage-notice]')?.getAttribute("data-usage-notice"));
  check("the warning above the message box", notice === "warning", String(notice));
  await shot("usage-1440");

  await page.click('button[aria-label="Hide usage"]');
  await settle();
  const folded = await page.evaluate(() => ({ panel: Boolean(document.querySelector('aside[aria-label="Usage this month"]')), button: Boolean(document.querySelector('button[aria-label="Show usage"]')) }));
  await page.reload({ waitUntil: "networkidle0" });
  await settle();
  const stillFolded = await page.evaluate(() => Boolean(document.querySelector('button[aria-label="Show usage"]')));
  check("folded away to a button, and kept folded when the page is opened again", !folded.panel && folded.button && stillFolded, JSON.stringify({ ...folded, stillFolded }));
  await page.click('button[aria-label="Show usage"]');
  await settle();

  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle();
  const phone = await page.evaluate(() => {
    const el = document.querySelector('aside[aria-label="Usage this month"]');
    return { asideShown: el ? getComputedStyle(el).display !== "none" : false, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  await page.click('button[aria-label="Usage"]');
  await page.waitForSelector('[role="dialog"][aria-label="Usage this month"] [data-usage-state]', { timeout: 30000 });
  await settle();
  const drawer = await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"][aria-label="Usage this month"]');
    return { text: el?.innerText ?? "", sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  await shot("usage-390");
  check("390px: no panel beside the chat, nothing sideways", !phone.asideShown && phone.sideways <= 0 && drawer.sideways <= 0, JSON.stringify(phone));
  check("the Usage button opens it over the chat", drawer.text.includes(shown(panelUsage.totals.costUsd)) && drawer.text.includes(`$${warnAt}`), drawer.text.replace(/\n/g, " | ").slice(0, 200));

  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${WEB}/assistant/settings`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForSelector("#usage [data-usage-totals]", { timeout: 30000 });
  await settle();
  const card = await page.evaluate(() => {
    const el = document.querySelector("#usage");
    return {
      text: el?.innerText ?? "",
      input: Boolean(el?.querySelector("[data-usage-limit] input")),
      tables: [...(el?.querySelectorAll("[data-usage-table]") ?? [])].map((s) => s.getAttribute("data-usage-table")),
      models: el?.querySelectorAll('[data-usage-table="By model"] tbody tr').length,
    };
  });
  await shot("usage-settings");
  const reportNow = (await call("GET", "/ai/usage/report")).body;
  check("the settings: What it spends, its estimate the report's", card.text.includes("What it spends") && card.text.includes(shown(reportNow.totals.costUsd)) && /invoices from Anthropic and Google are the real figures/.test(card.text), card.text.slice(0, 200).replace(/\n/g, " | "));
  check("by model, person, day and month, a row for each model", JSON.stringify(card.tables) === JSON.stringify(["By model", "By person", "By day", "By month"]) && card.models === reportNow.byModel.length, JSON.stringify(card));
  check("the Super Admin has the limit's box", card.input);

  const cfoContext = await browser.createBrowserContext();
  await cfoContext.setCookie({ name: "sfm_access", value: tokenFor(cfo), domain: "localhost", path: "/" });
  const cfoPage = await cfoContext.newPage();
  await cfoPage.setViewport({ width: 1440, height: 1000 });
  await cfoPage.setRequestInterception(true);
  cfoPage.on("request", (intercepted) => {
    const url = intercepted.url();
    const base = [`${WEB}/api/`, `${DEV_API}/api/`].find((prefix) => url.startsWith(prefix));
    if (base) intercepted.continue({ url: url.replace(base, `${API}/`) });
    else intercepted.continue();
  });
  await cfoPage.goto(`${WEB}/assistant/settings`, { waitUntil: "networkidle0", timeout: 120000 });
  await cfoPage.waitForSelector("#usage [data-usage-totals]", { timeout: 30000 });
  const cfoCard = await cfoPage.evaluate(() => ({
    input: Boolean(document.querySelector("#usage [data-usage-limit] input")),
    line: document.querySelector("#usage [data-usage-limit]")?.textContent ?? "",
  }));
  check("the CFO reads it, the limit as a line, with no box to change it", !cfoCard.input && /Monthly limit: \$.*set by a Super Admin/.test(cfoCard.line), cfoCard.line);
  check("no page error", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser?.close().catch(() => undefined);
  await db.query(`delete from ai_usage where created_at >= $1 and user_id = any ($2::uuid[])`, [started, [admin.id, cfo.id]]);
  await db.query(`delete from ai_chats where id = any ($1::uuid[])`, [[...made.chats]]);
  await db.query(`delete from ai_attachments where id = any ($1::uuid[])`, [[...made.attachments]]);
  await db.query(`delete from ai_attachments where filename like 'usageqa%' and created_at >= $1`, [started]);
  await db.query(
    `update app_settings set ai_provider = $1, ai_model = $2, ai_data_access = $3, anthropic_api_key = $4, anthropic_key_set_at = $5, anthropic_key_set_by = $6, ai_monthly_limit_usd = $7 where id = 1`,
    [before.ai_provider, before.ai_model, before.ai_data_access, before.anthropic_api_key, before.anthropic_key_set_at, before.anthropic_key_set_by, before.ai_monthly_limit_usd],
  );
  const stopped = new Promise((resolve) => api.once("exit", resolve));
  api.kill();
  await stopped;
  stub.close();
  const [left] = await q(
    `select (select count(*) from ai_usage where created_at >= $1 and user_id = any ($2::uuid[]))::int as rows,
            (select count(*) from ai_chats where title like 'USAGEQA%' and created_at >= $1)::int as chats,
            (select ai_monthly_limit_usd is not distinct from $3 from app_settings where id = 1) as limit_back`,
    [started, [admin.id, cfo.id], before.ai_monthly_limit_usd],
  );
  console.log(`\n  left behind: ${JSON.stringify(left)}`);
  await db.end();
  const passed = results.filter(Boolean).length;
  if (passed !== results.length) {
    const said = apiLog.split(/\r?\n/).map((line) => line.replace(/\u001b\[[0-9;]*m/g, "")).filter((line) => /ERROR|Error/.test(line));
    console.log(`\n--- the API's log, its errors ---\n${said.slice(-12).join("\n")}`);
  }
  console.log(`\n${passed}/${results.length} passed`);
  process.exitCode = passed === results.length ? 0 : 1;
}
