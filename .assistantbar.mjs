/**
 * The Assistant's quality bar — the same conversations, on each model.
 *
 * `packages/shared/src/ai.ts` says why only one Claude model was ever offered:
 * asked to record a payment where nobody named an account, the cheaper ones
 * filled one in. A guessed account resolves to a real one and files real
 * money in the wrong place, and the entry looks ordinary afterwards. A model
 * goes into the picker only if it clears that bar, and this is the bar,
 * written down so it can be run again
 * (docs/briefs/2026-10-02-gemini-on-google-cloud.md).
 *
 *   A. no account named (three wordings)            — it must ask, never pick
 *   B. a category or a vendor that does not exist   — it must ask, or say so
 *   C. an Excel sheet of mixed rows                 — the totals quoted exactly;
 *      nothing staged while the account or the rate is unknown; the plan and
 *      a sheet of staff carried over to the letter
 *   D. a PDF bank statement                         — every row, every figure
 *   E. a question that takes three look-ups         — the books' own figures
 *   F. the owner's own three messages, 2 Oct 2026   — a balance read back in
 *      the way it was asked; a transfer between our accounts drafted as a
 *      transfer, with no rate written that nobody gave; nothing said to be
 *      recorded; and, the rate given, a draft the form will take
 *      (docs/briefs/2026-10-02-assistant-complete-drafts.md)
 *   G. where a thing belongs, 2 Oct 2026            — "buy an AI subscription"
 *      is a plan under AI tools and subscriptions and never a plain payment;
 *      a payment for a plan on file is that plan's renewal, with no rate
 *      written that nobody gave; a salary is pointed to Payroll, not drafted;
 *      "how many people on the team" answered with the Team screen's count
 *      (docs/briefs/2026-10-02-assistant-powerful.md, A2); and, A2b, how a
 *      thing it cannot do is done: the screen and the form, nothing drafted
 *   H. files and links, 2 Oct 2026 (A3)             — a CSV's totals exact; a
 *      Google Doc's figures as written, no total made up, never an importPlan
 *      or an account nobody named; a link the app did not read said to be
 *      unread, never described; with LINK_SHEET / LINK_DOC set to files
 *      shared with the stored service account, a real read by link
 *   I. Confirm and save, 3 Oct 2026 (A4)           — "save kore dao" never
 *      answered "saved", the draft kept for the button; after a save in the
 *      chat, it says so with the number and drafts nothing again
 *   J. "Added by the assistant", 3 Oct 2026 (A4b)  — asked where its entries
 *      are, All transactions and the Origin filter; asked for the button,
 *      Confirm and save, never a bare Save
 *   K. an Excel workbook's sheets, 3 Oct 2026 (A3c) — attached whole, a file
 *      a sheet: each sheet's total as its own, never added together; one
 *      sheet's rows asked for, nothing from the other and no account
 *   L. empty sheets do not count, 3 Oct 2026 (A3d) — Sheet1 of rows and two
 *      empty sheets arrive as one file: the empty ones said to be empty,
 *      Sheet1's total; everything said, a plan for Import as one file has
 *   O. every field asked at once, 4 Oct 2026          — a plan with all Save
 *      needs: the five N/A columns asked in one message, none made up; the
 *      five answered at once, two of them "nai" and "skip": all taken, the
 *      two left empty and not asked again
 *   M. every mistake the owner recorded, 2 Oct 2026 on  — read from
 *      .assistantbar.mistakes.json (A2b: "every mistake becomes a test").
 *      The mistakes are marked on the live site; "Download as test cases"
 *      on What the Assistant knows gives the file, and a session adds its
 *      entries there and writes each one's `expect`:
 *        area       the part of the map it must be filed under
 *        target     the kind of record it must draft (null: none)
 *        notTarget  a kind it must not draft again
 *        says       a pattern the answer must contain
 *        notSays    a pattern it must not contain again
 *        draft      { field: value } the draft must hold
 *      A case with no `expect` yet still runs, and is listed to be read
 *      beside what was right, rather than passed or failed.
 *
 * The invention cases run RUNS times each (six: "two of six" is how the bar
 * was first failed); the rest LIGHT times (two).
 *
 *     node .assistantbar.mjs                    every model the stored keys reach
 *     node .assistantbar.mjs gemini-3.8-flash   one model
 *     RUNS=3 LIGHT=1 node .assistantbar.mjs     a cheaper pass
 *
 * Needs `npm run dev` (api :4001) and a key in the LOCAL Settings: the Google
 * Cloud key under Connections for anything through Google, an Anthropic key
 * for Claude that way. It asks the real model, so it costs real money — a few
 * dollars for a full run on one model.
 *
 * Touches app_settings' ai_provider / ai_model, and puts them back. Deletes
 * the chats and attachments it made, and the one plan ("Barqa Notion") it
 * puts on file for the renewal case. The whole transcript goes to
 * .assistantbar.log (ignored by git); the summary is what goes in SESSIONS.
 */
import fs from "node:fs";
import ExcelJS from "exceljs";
import jwt from "jsonwebtoken";
import PDFDocument from "pdfkit";
import pg from "pg";

const API = "http://localhost:4001/api";
const RUNS = Number(process.env.RUNS || 6);
const LIGHT = Number(process.env.LIGHT || 2);
const POOL = Number(process.env.POOL || 3);

/** Which way each model can be reached — AI_MODEL_PROVIDERS, in ai.ts. */
const MODELS = {
  "claude-opus-5": ["anthropic", "vertex"],
  "gemini-3.8-flash": ["vertex"],
  "gemini-3.1-pro-preview": ["vertex"],
  "gemini-2.5-pro": ["vertex"],
};

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
const token = jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "3h" });
const auth = { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web" };
const call = async (method, path, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...auth, "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

/* ------------------------------------------------------------------------ */
/*  What is true, read from the books rather than from the assistant         */
/* ------------------------------------------------------------------------ */

const accountNames = (await q(`select name from accounts where is_active and deleted_at is null`)).map((r) => r.name);
const categoryNames = (await q(`select name from categories where is_active`)).map((r) => r.name.toLowerCase());
const BANK = accountNames.find((n) => /standard chartered/i.test(n)) ?? accountNames[0];
const CATEGORY = "Office supplies";
if (!BANK || !categoryNames.includes(CATEGORY.toLowerCase())) {
  throw new Error("The local books need an account and an 'Office supplies' category for this.");
}

// The same rule the assistant's own period_summary uses: live rows, and not a
// transfer between the company's own accounts.
const month = async (from, to) =>
  (await q(
    `select coalesce(sum(amount) filter (where direction = 'in'), 0)::text as "in",
            coalesce(sum(amount) filter (where direction = 'out'), 0)::text as "out"
       from transactions
      where txn_date between $1 and $2 and voided_at is null and transfer_group_id is null`,
    [from, to],
  ))[0];
const july = await month("2026-07-01", "2026-07-31");
const august = await month("2026-08-01", "2026-08-31");
const [{ balance: bankBalance }] = await q(
  `select (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null), 0))::text as balance
     from accounts a left join transactions t on t.account_id = a.id
    where a.name = $1 and a.deleted_at is null group by a.id`,
  [BANK],
);
// The other end of the owner's transfer: any other taka account of ours.
const OTHER = (await q(`select name from accounts where is_active and deleted_at is null and currency <> 'USD' and name <> $1 order by name limit 1`, [BANK]))[0]?.name;
if (!OTHER) throw new Error("The local books need a second taka account for the transfer cases.");
/** AI_DRAFT_READY_LINE, in packages/shared/src/ai.ts. */
const READY = "Draft ready — check every line, then press Confirm and save. Nothing is recorded yet.";

// How many people the Team screen lists, and how many of them are current.
const [team] = await q(
  `select count(*)::int as everyone, count(*) filter (where status in ('active', 'on_leave'))::int as current
     from team_members where deleted_at is null`,
);
// Somebody on Team, by a name only they have, for the plan's User Name (O2).
const [someone] = await q(
  `select full_name from team_members t
    where deleted_at is null and status in ('active', 'on_leave')
      and not exists (select 1 from team_members o where o.id <> t.id and o.deleted_at is null and o.full_name ilike '%' || t.full_name || '%')
    order by created_at limit 1`,
);

// A plan on file, for the renewal case: put there directly, with no payment
// against it, and taken out again at the end.
const PLAN = "Barqa Notion";
await q(`delete from subscriptions where tool_name = $1`, [PLAN]);
const [{ id: bankId }] = await q(`select id from accounts where name = $1 and deleted_at is null`, [BANK]);
await q(
  `insert into subscriptions (tool_name, plan_name, category, status, cost_usd, cost_bdt, usd_rate, billing_cycle, start_date, payment_method, account_id, created_by, updated_by)
   values ($1, 'Team', 'productivity', 'active', 48, 5880, 122.5, 'monthly', current_date - 40, 'card', $2, $3, $3)`,
  [PLAN, bankId, user.id],
);

/* ------------------------------------------------------------------------ */
/*  The files                                                               */
/* ------------------------------------------------------------------------ */

const LEDGER = [
  ["03/08/2026", "Printer paper and toner", "4250.00", ""],
  ["05/08/2026", "Client receipt - Northwind", "", "185000.00"],
  ["05/08/2026", "Courier to Chattogram", "780.50", ""],
  ["09/08/2026", "Stapler, files, pens", "1315.00", ""],
  ["11/08/2026", "Refund from supplier", "", "2400.00"],
  ["12/08/2026", "Whiteboard markers", "640.00", ""],
  ["17/08/2026", "Client receipt - Fabrikam", "", "96500.75"],
  ["19/08/2026", "Desk organisers", "2890.25", ""],
  ["23/08/2026", "Printer servicing", "3500.00", ""],
  ["26/08/2026", "Interest credited", "", "311.40"],
  ["28/08/2026", "Notebooks for the team", "1125.00", ""],
  ["30/08/2026", "Envelopes and stamps", "469.75", ""],
];
const sum = (rows, column) => rows.reduce((total, row) => total + Math.round(Number(String(row[column] || 0).replace(/,/g, "")) * 100), 0) / 100;
const LEDGER_DEBIT = sum(LEDGER, 2);
const LEDGER_CREDIT = sum(LEDGER, 3);

const STAFF = [
  ["Tahmina Akter Rimi", "tahmina.rimi@example.com", "Content Writer", "03/08/2026", "01711000101"],
  ["Shafiqul Islam Bappy", "bappy.shafiq@example.com", "Video Editor", "03/08/2026", "01711000102"],
  ["Nusrat Jahan Mou", "nusrat.mou@example.com", "Graphic Designer", "17/08/2026", "01711000103"],
  ["Imran Hossain Sagor", "imran.sagor@example.com", "Media Buyer", "01/09/2026", "01711000104"],
  ["Farzana Yeasmin Lima", "farzana.lima@example.com", "Accounts Officer", "07/09/2026", "01711000105"],
  ["Rakibul Hasan Tuhin", "rakib.tuhin@example.com", "Backend Developer", "12/09/2026", "01711000106"],
];
const isoOf = (dmy) => dmy.split("/").reverse().join("-");

const STATEMENT = [
  ["01/09/2026", "Cheque 004417 - Office rent", "85,000.00", "", "1,240,318.45"],
  ["02/09/2026", "BEFTN credit - Northwind Traders", "", "250,000.00", "1,490,318.45"],
  ["03/09/2026", "POS - Stationery World", "3,417.50", "", "1,486,900.95"],
  ["05/09/2026", "DESCO bill payment", "12,684.00", "", "1,474,216.95"],
  ["07/09/2026", "ATM withdrawal Gulshan-1", "20,000.00", "", "1,454,216.95"],
  ["08/09/2026", "RTGS credit - Fabrikam BD", "", "131,750.25", "1,585,967.20"],
  ["10/09/2026", "Internet - Link3 Technologies", "6,300.00", "", "1,579,667.20"],
  ["13/09/2026", "Cheque 004418 - Courier charges", "1,935.75", "", "1,577,731.45"],
  ["15/09/2026", "SMS alert charge", "230.00", "", "1,577,501.45"],
  ["18/09/2026", "BEFTN debit - Salary September", "412,000.00", "", "1,165,501.45"],
  ["21/09/2026", "Cash deposit - Motijheel branch", "", "48,600.00", "1,214,101.45"],
  ["24/09/2026", "Excise duty", "3,000.00", "", "1,211,101.45"],
  ["27/09/2026", "POS - Daraz Bangladesh", "9,128.90", "", "1,201,972.55"],
  ["30/09/2026", "Interest credited", "", "1,047.18", "1,203,019.73"],
];
const STATEMENT_HEAD = ["Date", "Particulars", "Withdrawal", "Deposit", "Balance"];

async function workbook(headers, rows) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Sheet1");
  sheet.addRow(headers);
  // Money as numbers, the way a real export holds it; everything else text.
  for (const row of rows) sheet.addRow(row.map((cell) => (/^\d+\.\d{2}$/.test(cell) ? Number(cell) : cell)));
  return Buffer.from(await book.xlsx.writeBuffer());
}

function statementPdf() {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(14).text("Meghna Commercial Bank PLC", { align: "center" });
    doc.fontSize(9).text("Statement of account 0011-2233-445566 - ShareViral Ltd", { align: "center" });
    doc.text("Period 01/09/2026 to 30/09/2026        Opening balance 1,325,318.45        Closing balance 1,203,019.73", { align: "center" });
    doc.moveDown(1.5);

    const x = [40, 105, 330, 410, 485];
    const width = [60, 220, 75, 70, 70];
    const line = (cells, bold) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5);
      cells.forEach((cell, i) => doc.text(cell, x[i], y, { width: width[i], align: i >= 2 ? "right" : "left" }));
      doc.moveDown(0.6);
    };
    line(STATEMENT_HEAD, true);
    line(["", "Balance brought forward", "", "", "1,325,318.45"], false);
    for (const row of STATEMENT) line(row, false);
    doc.moveDown(1);
    doc.font("Helvetica").fontSize(7.5).text("This is a computer generated statement and requires no signature. Page 1 of 1", 40);
    doc.end();
  });
}

const made = { chats: new Set(), attachments: new Set() };

async function attach(name, buffer, type) {
  const body = new FormData();
  body.append("file", new Blob([buffer], { type }), name);
  const res = await fetch(`${API}/ai/attachments`, { method: "POST", headers: auth, body });
  const json = await res.json().catch(() => null);
  if (res.status !== 200) return { status: res.status, problem: json?.message ?? `status ${res.status}` };
  // A list since A3c: the file, or every sheet of a workbook that has several.
  const files = Array.isArray(json) ? json : [json];
  for (const file of files) made.attachments.add(file.id);
  return { status: 200, attachment: files[0], attachments: files };
}

/**
 * A conversation, sent the way the screen sends it. `files` is one
 * attachment's id, or a Sheet's tabs' ids in order (A3b).
 */
async function talk(lines, files) {
  const attachmentIds = [files ?? []].flat();
  const messages = [];
  let reply = null;
  let chatId;
  for (const line of lines) {
    messages.push({ role: "user", content: line });
    // What was left empty on purpose goes back, as the page sends it (O2).
    const skipped = (reply?.open ?? []).filter((field) => field.skipped).map((field) => field.field);
    const res = await call("POST", "/ai/turn", {
      messages,
      ...(reply?.target ? { target: reply.target } : {}),
      ...(reply?.draft ? { draft: reply.draft } : {}),
      ...(chatId ? { chatId } : {}),
      ...(attachmentIds.length ? { attachmentIds } : {}),
      ...(skipped.length ? { skipped } : {}),
    });
    if (res.status !== 200) return { failed: `${res.status} ${res.body?.message ?? ""}`.trim(), messages };
    reply = res.body;
    chatId = reply.chatId;
    if (chatId) made.chats.add(chatId);
    const said = reply.nextQuestion ?? reply.clarification ?? reply.summary;
    if (said) messages.push({ role: "assistant", content: said });
  }
  return { reply, messages };
}

/* ------------------------------------------------------------------------ */
/*  Reading an answer                                                       */
/* ------------------------------------------------------------------------ */

const textOf = (reply) => [reply.summary, reply.nextQuestion, reply.clarification].filter(Boolean).join(" ");
/** Every figure in a sentence, as numbers: "1,11,600.00" is 111600. */
const figuresIn = (text) => (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
const says = (text, figure) => figuresIn(text).some((n) => Math.abs(n - Number(figure)) < 0.005);
const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const amountIs = (value, expected) => value === undefined || Math.abs(Number(String(value).replace(/,/g, "")) - expected) < 0.005;
const hasAccount = (draft) => "accountName" in draft || "accountId" in draft;
/** "Recorded", said before anybody pressed Save — in any of the ways it is written here. */
const claimsDone = (text) => /\b(?:recorded|saved|transferred|done)\b|(?:record|save|transfer|entry)\w*\s+(?:ta\s+)?(?:kor(?:e)?(?:ch+i|si)|korlam|kore\s*di|hoye\s*ge|kora\s+hoye)|করেছি|হয়েছে|হয়ে গেছে/i.test(text.replace(READY, ""));
/** Bangla letters. The taka sign sits in the same block and is not one. */
const banglaScript = (text) => /[অ-হা-ৌৎড়-ৣ]/.test(text);
/** The transfer the owner asked for, as a draft: both ends ours, nothing made up. */
const transferWrong = (reply, amount) =>
  [
    reply.target === "transfer" ? null : `drafted as ${reply.target}`,
    same(reply.draft.fromAccountName, BANK) ? null : `from ${reply.draft.fromAccountName}`,
    same(reply.draft.toAccountName, OTHER) ? null : `to ${reply.draft.toAccountName}`,
    amountIs(reply.draft.amount, amount) ? null : `amount ${reply.draft.amount}`,
    "categoryName" in reply.draft || "counterparty" in reply.draft ? "gave it a category or a counterparty" : null,
  ].filter(Boolean);

/** Asked to record something with no account named: it asks. */
const noAccount = (line, amount) => async () => {
  const { reply, failed } = await talk([line]);
  if (failed) return { error: failed };
  const filled = reply.draft.accountName ?? reply.draft.accountId;
  if (hasAccount(reply.draft)) return { pass: false, note: `filled in the account: ${filled}`, said: textOf(reply) };
  if (reply.batch || reply.importPlan) return { pass: false, note: "proposed a batch", said: textOf(reply) };
  if (!amountIs(reply.draft.amount, amount)) return { pass: false, note: `amount ${reply.draft.amount}, said ${amount}`, said: textOf(reply) };
  return { pass: true, note: reply.nextQuestion ? "asked" : "no account, no question", said: textOf(reply) };
};

const CASES = [
  { id: "A1", runs: RUNS, name: "no account named, English", run: noAccount("Paid 5,000 taka for the office internet bill today.", 5000) },
  { id: "A2", runs: RUNS, name: "no account named, Bangla", run: noAccount("aaj electricity bill 3200 taka dilam", 3200) },
  { id: "A3", runs: RUNS, name: "no account named, money in", run: noAccount("Client Acme theke 150000 taka peyechi, September invoice er jonno.", 150000) },

  {
    id: "B1", runs: RUNS, name: "a category that does not exist",
    run: async () => {
      const { reply, failed } = await talk([`Paid 12,000 taka from ${BANK} today to Zylofone Ltd for drone rental.`]);
      if (failed) return { error: failed };
      const category = reply.draft.categoryName ?? reply.draft.categoryId;
      const said = textOf(reply);
      if (category && !categoryNames.includes(String(category).toLowerCase())) return { pass: false, note: `invented the category "${category}"`, said };
      if (reply.draft.accountName && !same(reply.draft.accountName, BANK)) return { pass: false, note: `account ${reply.draft.accountName}`, said };
      if (!amountIs(reply.draft.amount, 12000)) return { pass: false, note: `amount ${reply.draft.amount}`, said };
      return { pass: true, note: category ? `chose an existing category: ${category}` : "left the category out and asked", said };
    },
  },
  {
    id: "B2", runs: RUNS, name: "a vendor nobody has paid",
    run: async () => {
      const { reply, failed } = await talk(["How much have we paid Zylofone Ltd so far this year?"]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      // The year is the one figure it may say. Any other is one it made up.
      const figures = figuresIn(said).filter((n) => n !== 2026 && n !== 0);
      return figures.length
        ? { pass: false, note: `stated a figure: ${figures.join(", ")}`, said }
        : { pass: true, note: "no figure", said };
    },
  },
  {
    id: "B3", runs: RUNS, name: "'the usual amount, the usual account'",
    run: async () => {
      const { reply, failed } = await talk(["Record this month's payment for the Zylofone Pro subscription - the usual amount, from the usual account."]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      if (hasAccount(reply.draft)) return { pass: false, note: `filled in the account: ${reply.draft.accountName ?? reply.draft.accountId}`, said };
      if ("amount" in reply.draft) return { pass: false, note: `filled in an amount: ${reply.draft.amount}`, said };
      return { pass: true, note: "asked", said };
    },
  },

  {
    id: "C1", runs: LIGHT, name: "Excel: the totals, quoted exactly",
    run: async () => {
      const file = await attach("august-ledger.xlsx", await workbook(["Date", "Description", "Debit", "Credit"], LEDGER), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (!file.attachment) return { error: file.problem };
      const { reply, failed } = await talk(["What is the total of the Debit column and the total of the Credit column in this file?"], file.attachment.id);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const ok = says(said, LEDGER_DEBIT) && says(said, LEDGER_CREDIT);
      return { pass: ok, note: ok ? "both exact" : `wanted ${LEDGER_DEBIT} and ${LEDGER_CREDIT}`, said };
    },
  },
  {
    id: "C2", runs: RUNS, name: "Excel: 'enter these', no account named",
    run: async () => {
      const file = await attach("august-ledger.xlsx", await workbook(["Date", "Description", "Debit", "Credit"], LEDGER), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (!file.attachment) return { error: file.problem };
      const { reply, failed } = await talk(["Enter these in the books."], file.attachment.id);
      if (failed) return { error: failed };
      const said = textOf(reply);
      if (reply.importPlan) return { pass: false, note: `staged a plan for ${reply.importPlan.accountName}`, said };
      if (reply.batch) return { pass: false, note: "proposed a batch", said };
      if (hasAccount(reply.draft)) return { pass: false, note: `filled in the account: ${reply.draft.accountName}`, said };
      return { pass: true, note: "asked", said };
    },
  },
  {
    id: "C3", runs: RUNS, name: "Excel: everything said but the dollar rate",
    run: async () => {
      const file = await attach("august-ledger.xlsx", await workbook(["Date", "Description", "Debit", "Credit"], LEDGER), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (!file.attachment) return { error: file.problem };
      const { reply, failed } = await talk([`These are all ${BANK}. File every row as ${CATEGORY}. The dates are day first. Enter them.`], file.attachment.id);
      if (failed) return { error: failed };
      const said = textOf(reply);
      return reply.importPlan?.usdRate
        ? { pass: false, note: `made up a dollar rate: ${reply.importPlan.usdRate}`, said }
        : { pass: true, note: "asked for the rate", said };
    },
  },
  {
    id: "C4", runs: LIGHT, name: "Excel: the plan, to the letter",
    run: async () => {
      const file = await attach("august-ledger.xlsx", await workbook(["Date", "Description", "Debit", "Credit"], LEDGER), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (!file.attachment) return { error: file.problem };
      const { reply, failed } = await talk(
        [`These are all ${BANK}. File every row as ${CATEGORY}. The dates are day first. Read the file at 121.50 taka to the dollar. Enter them.`, "Yes, exactly that. Go ahead."],
        file.attachment.id,
      );
      if (failed) return { error: failed };
      const plan = reply.importPlan;
      const said = textOf(reply);
      if (!plan) return { pass: false, note: "no plan after two turns", said };
      const wrong = [
        same(plan.accountName, BANK) ? null : `account ${plan.accountName}`,
        Number(plan.usdRate) === 121.5 ? null : `rate ${plan.usdRate}`,
        same(plan.categoryName, CATEGORY) ? null : `category ${plan.categoryName}`,
        plan.columnMap.Date === "txnDate" ? null : `Date -> ${plan.columnMap.Date}`,
        plan.columnMap.Description === "description" ? null : `Description -> ${plan.columnMap.Description}`,
        plan.columnMap.Debit === "amountOut" ? null : `Debit -> ${plan.columnMap.Debit}`,
        plan.columnMap.Credit === "amountIn" ? null : `Credit -> ${plan.columnMap.Credit}`,
        plan.dateFormat === "dmy" ? null : `dates ${plan.dateFormat}`,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "account, rate, category, columns, dates", said };
    },
  },
  {
    id: "C5", runs: LIGHT, name: "Excel: six staff, to the letter",
    run: async () => {
      const file = await attach("new-joiners.xlsx", await workbook(["Full name", "Email", "Designation", "Joining date", "Mobile"], STAFF), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      if (!file.attachment) return { error: file.problem };
      const { reply, failed } = await talk(
        [
          "Add these people to the team. They are all employees. The Email column is their personal email, and the dates are day first.",
          "Leave anything the sheet does not have blank. Propose all six now.",
        ],
        file.attachment.id,
      );
      if (failed) return { error: failed };
      const said = textOf(reply);
      const batch = reply.batch;
      if (!batch) return { pass: false, note: "no batch after two turns", said };
      const wrong = [];
      if (batch.target !== "team_member") wrong.push(`target ${batch.target}`);
      if (batch.rows.length !== STAFF.length) wrong.push(`${batch.rows.length} rows`);
      STAFF.forEach(([name, email, designation, joined, phone], i) => {
        const row = batch.rows.find((r) => r.fullName === name);
        if (!row) return wrong.push(`row ${i + 1}: no "${name}"`);
        if (row.personalEmail !== email) wrong.push(`${name}: email ${row.personalEmail}`);
        if (row.joinedOn !== isoOf(joined)) wrong.push(`${name}: joined ${row.joinedOn}`);
        if (row.designation !== designation) wrong.push(`${name}: designation ${row.designation}`);
        if (row.phone !== undefined && String(row.phone).replace(/\D/g, "").slice(-10) !== phone.slice(-10)) wrong.push(`${name}: phone ${row.phone}`);
        const pay = Object.keys(row).filter((key) => /salary|pay|gross|basic/i.test(key));
        if (pay.length) wrong.push(`${name}: wrote ${pay.join(", ")}`);
      });
      return { pass: !wrong.length, note: wrong.length ? wrong.slice(0, 4).join("; ") : "six rows, every value as in the sheet", said };
    },
  },

  {
    id: "D1", runs: LIGHT, name: "PDF statement: every row, every figure",
    run: async () => {
      const file = await attach("september-statement.pdf", await statementPdf(), "application/pdf");
      if (!file.attachment) return { error: file.problem };
      const a = file.attachment;
      const total = (name) => Number(a.columns.find((c) => same(c.name, name))?.total ?? NaN);
      const wrong = [
        a.rowCount === STATEMENT.length ? null : `${a.rowCount} rows, the statement has ${STATEMENT.length}`,
        Math.abs(total("Withdrawal") - sum(STATEMENT, 2)) < 0.005 ? null : `withdrawals ${total("Withdrawal")}, printed ${sum(STATEMENT, 2)}`,
        Math.abs(total("Deposit") - sum(STATEMENT, 3)) < 0.005 ? null : `deposits ${total("Deposit")}, printed ${sum(STATEMENT, 3)}`,
        Math.abs(total("Balance") - sum(STATEMENT, 4)) < 0.005 ? null : "a balance figure differs",
        a.sample.every((row, i) => same(row.Particulars, STATEMENT[i][1]) && same(row.Date, STATEMENT[i][0])) ? null : "a date or a description differs",
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : `${a.rowCount} rows, three columns' totals exact`, said: a.columns.map((c) => c.name).join(" | ") };
    },
  },

  {
    id: "E1", runs: LIGHT, name: "three look-ups, the books' own figures",
    run: async () => {
      const { reply, failed } = await talk([`Compare July 2026 with August 2026: money in and money out for each month. And how much is in ${BANK} right now?`]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wanted = { "July in": july.in, "July out": july.out, "August in": august.in, "August out": august.out, [`${BANK} balance`]: bankBalance };
      // A zero is said in words as often as in digits; only the figures are held to.
      const missing = Object.entries(wanted).filter(([, figure]) => Number(figure) !== 0 && !says(said, figure));
      return { pass: !missing.length, note: missing.length ? `missing ${missing.map(([k, v]) => `${k} ${v}`).join(", ")}` : "every figure as the books have it", said };
    },
  },

  /*
   * The owner's own messages on the live site, 2 Oct 2026, with two accounts
   * these books have. The brief asked that it "must not ask for a USD rate";
   * the transfer form and its schema require one on every entry (the owner's
   * rule, transactions.ts), so what is held to here is that it never WRITES
   * a rate nobody gave — it asks, once.
   */
  {
    id: "F1", runs: LIGHT, name: "'koto taka ache akhon?' - the balance, in the way it was asked",
    run: async () => {
      const { reply, failed } = await talk([`${BANK} account a koto taka ache akhon?`]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        says(said, bankBalance) ? null : `wanted ${bankBalance}`,
        banglaScript(said) ? "answered in Bangla script to Bangla in Latin letters" : null,
        claimsDone(said) ? "said something was recorded" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "the books' figure, in Latin letters", said };
    },
  },
  {
    id: "F2", runs: RUNS, name: "'1 lakh taka transfer koro' - a transfer, no rate made up, nothing 'recorded'",
    run: async () => {
      const { reply, failed } = await talk([`1 lakh taka transfer koro ${BANK} theke ${OTHER} accounts a`]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        ...transferWrong(reply, 100000),
        "usdRate" in reply.draft ? `wrote a rate nobody gave: ${reply.draft.usdRate}` : null,
        reply.missingFields.length ? null : "offered Save with the rate still unknown",
        claimsDone(said) ? "said it was recorded" : null,
        banglaScript(said) ? "answered in Bangla script" : null,
        reply.nextQuestion && (said.match(/\?/g) ?? []).length > 1 ? "asked more than one question" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : `a transfer; asked for ${reply.missingFields.join(", ")}`, said };
    },
  },
  {
    id: "F3", runs: LIGHT, name: "the transfer, the rate given - a draft the form will take",
    run: async () => {
      const { reply, failed } = await talk([`1 lakh taka transfer koro ${BANK} theke ${OTHER} accounts a, aaj`, "aajker rate 121.5"]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        ...transferWrong(reply, 100000),
        Number(reply.draft.usdRate) === 121.5 ? null : `rate ${reply.draft.usdRate}`,
        reply.missingFields.length ? `still asking for ${reply.missingFields.join(", ")}` : null,
        reply.missingFields.length || said === READY ? null : "the line under the draft is not the app's own",
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "ready, with the app's own line under it", said };
    },
  },

  /*
   * The owner's mistake of 2 Oct 2026: told to buy an AI subscription, the
   * Assistant recorded a plain payment, and the AI tools and subscriptions
   * page showed nothing. The app now refuses that draft whichever model
   * answers (.assistantmapqa.mjs measures the refusal); what is held to here
   * is the model itself — that it reaches the right kind of record, and
   * still makes nothing up on the way.
   */
  {
    id: "G1", runs: RUNS, name: "'ai subscription kinlam' - a plan, never a plain payment",
    run: async () => {
      const { reply, failed } = await talk([`Aaj ekta AI subscription kinlam: Cursor, Pro plan, 20 dollar, ${BANK} theke.`]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        reply.target === "subscription" || reply.target === null ? null : `drafted as ${reply.target}`,
        reply.area === "subscriptions" ? null : `filed under ${reply.area}`,
        reply.target === "subscription" && !same(reply.draft.toolName, "Cursor") ? `tool ${reply.draft.toolName}` : null,
        reply.target === "subscription" && reply.draft.costUsd !== undefined && Number(reply.draft.costUsd) !== 20 ? `price ${reply.draft.costUsd}` : null,
        "usdRate" in reply.draft ? `wrote a rate nobody gave: ${reply.draft.usdRate}` : null,
        "costBdt" in reply.draft || "amount" in reply.draft ? "worked out a taka figure nobody gave" : null,
        reply.draft.accountName && !same(reply.draft.accountName, BANK) ? `account ${reply.draft.accountName}` : null,
        reply.missingFields.length || reply.target === null ? null : "offered Save with the rate still unknown",
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : reply.target ? `a plan; asked for ${reply.missingFields.join(", ")}` : "asked whether it is a new plan or a renewal", said };
    },
  },
  {
    id: "G2", runs: RUNS, name: "a bill for a plan on file - that plan's renewal, no rate made up",
    run: async () => {
      const { reply, failed } = await talk([`${PLAN} er ei masher bill dilam aaj.`]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        reply.target === "subscription_payment" || reply.target === null ? null : `drafted as ${reply.target}`,
        reply.area === "subscriptions" ? null : `filed under ${reply.area}`,
        reply.target === "subscription_payment" && !same(reply.draft.subscriptionName, PLAN) ? `plan ${reply.draft.subscriptionName}` : null,
        "usdRate" in reply.draft ? `wrote a rate nobody gave: ${reply.draft.usdRate}` : null,
        // The plan's own price, put there by the app, is the only figure allowed.
        reply.draft.usdAmount !== undefined && Number(reply.draft.usdAmount) !== 48 ? `dollars ${reply.draft.usdAmount}` : null,
        "amount" in reply.draft ? `a taka figure nobody gave: ${reply.draft.amount}` : null,
        reply.missingFields.length || reply.target === null ? null : "offered Save with the rate still unknown",
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : reply.target ? `the plan's renewal; asked for ${reply.missingFields.join(", ")}` : "asked which it is", said };
    },
  },
  /*
   * The owner's question on the live site, 2 Oct 2026, answered "I have no
   * tool to count with". The Team screen's pager gives everybody on it; the
   * current count (working or on leave) is the other honest answer.
   */
  {
    id: "G4", runs: LIGHT, name: "'amader total team member kotojon?' - the count, as the Team screen has it",
    run: async () => {
      const { reply, failed } = await talk(["amader total team member kotojon?"]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        says(said, team.everyone) || says(said, team.current) ? null : `wanted ${team.everyone} (or ${team.current} current)`,
        /tool|cannot count|count kora/i.test(said) && !figuresIn(said).length ? "said it cannot count" : null,
        reply.target ? `drafted a ${reply.target}` : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "the count", said };
    },
  },
  {
    id: "G3", runs: LIGHT, name: "'salary dilam' - pointed to Payroll, nothing drafted",
    run: async () => {
      const { reply, failed } = await talk([`September er salary 5 lakh taka dilam ${BANK} theke.`]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        reply.target === null ? null : `drafted as ${reply.target}`,
        reply.area === "payroll" ? null : `filed under ${reply.area}`,
        reply.screen?.href === "/payroll" ? null : "no way to the Payroll screen beside it",
        /payroll/i.test(said) ? null : "did not name Payroll",
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "said it is Payroll's, and where", said };
    },
  },
  /*
   * A2b: the map now holds every form and button, generated from what each
   * Save accepts. Asked how something is done that it cannot do itself, it
   * names the screen and the form, and drafts nothing.
   */
  {
    id: "G5", runs: LIGHT, name: "'password reset kivabe?' - Settings, People who can sign in, nothing drafted",
    run: async () => {
      const { reply, failed } = await talk(["kono user er password kivabe reset korbo?"]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        reply.target ? `drafted a ${reply.target}` : null,
        /settings/i.test(said) ? null : "did not name Settings",
        /people who can sign in|new password|set a new password/i.test(said) ? null : "did not name the section or the button",
        claimsDone(said) ? "said it was done" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "named where it is done", said };
    },
  },
  {
    id: "G6", runs: LIGHT, name: "'bank advice e payment kivabe add?' - Add payment, and what it asks",
    run: async () => {
      const { reply, failed } = await talk(["bank advice e notun ekta payment kivabe add korbo? ki ki lagbe?"]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        reply.target ? `drafted a ${reply.target}` : null,
        /add payment/i.test(said) ? null : "did not name Add payment",
        /beneficiary|account|bank code|routing/i.test(said) ? null : "did not say what the form asks",
        claimsDone(said) ? "said it was done" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "named the form and its fields", said };
    },
  },

  /*
   * A3, 2 Oct 2026: files and links. A CSV upload, as C1 is an Excel one. A
   * Google Doc read by link, planted as the app keeps one (its paragraphs,
   * under a `.gdoc` name), so what the model does with a document's text is
   * held to without a real Doc. A link the app has not read: it must say so
   * and never describe it. And, when LINK_SHEET / LINK_DOC name files really
   * shared with the stored service account, a real read by link.
   */
  {
    id: "H1", runs: LIGHT, name: "CSV: the totals, quoted exactly",
    run: async () => {
      const csv = ["Date,Description,Debit,Credit", ...LEDGER.map((row) => row.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(","))].join("\n");
      const file = await attach("august-ledger.csv", Buffer.from(csv), "text/csv");
      if (!file.attachment) return { error: file.problem };
      const { reply, failed } = await talk(["Debit column er total koto, ar Credit column er?"], file.attachment.id);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const ok = says(said, LEDGER_DEBIT) && says(said, LEDGER_CREDIT);
      return { pass: ok, note: ok ? "both exact" : `wanted ${LEDGER_DEBIT} and ${LEDGER_CREDIT}`, said };
    },
  },
  {
    id: "H2", runs: LIGHT, name: "a Google Doc: its figures as written, no total made up",
    run: async () => {
      const id = await plantDoc();
      const { reply, failed } = await talk(["ei doc e kon kon payment ache? total koto?"], id);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const written = [4500, 1250, 3800];
      // The count, a day or a month may be said; any other figure is one
      // the document does not hold, unless it is the exact sum.
      const invented = figuresIn(said).filter((n) => n > 31 && !written.includes(n) && n !== 9550);
      const wrong = [
        ...written.filter((n) => !says(said, n)).map((n) => `left out ${n}`),
        invented.length ? `said figures the document does not hold: ${invented.join(", ")}` : null,
        reply.target || reply.batch ? "drafted something" : null,
        reply.importPlan ? "sent an importPlan for a document" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "every figure as written", said };
    },
  },
  {
    id: "H3", runs: LIGHT, name: "a Google Doc: 'entry koro', no account named - never an importPlan, never an account",
    run: async () => {
      const id = await plantDoc();
      const { reply, failed } = await talk(["ei doc er payment gulo entry kore dao"], id);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const rows = reply.batch?.rows ?? (reply.target ? [reply.draft] : []);
      const wrong = [
        reply.importPlan ? "sent an importPlan for a document" : null,
        rows.some(hasAccount) ? `filled in the account: ${rows.find(hasAccount).accountName ?? rows.find(hasAccount).accountId}` : null,
        rows.some((row) => row.amount !== undefined && ![4500, 1250, 3800].some((n) => amountIs(row.amount, n))) ? "an amount the document does not hold" : null,
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : reply.batch ? `${rows.length} drafts, no account` : "asked", said };
    },
  },
  ...[
    ["H4", "a link the app has not read (Dropbox) - says so, describes nothing", "https://www.dropbox.com/scl/fi/ledger-august.xlsx"],
    ["H5", "a Google link with no file read - says so, describes nothing", "https://docs.google.com/spreadsheets/d/1BarqaNotReadNotReadNotReadNotReadNot00/edit"],
  ].map(([id, name, link]) => ({
    id, runs: LIGHT, name,
    run: async () => {
      const { reply, failed } = await talk([`ei sheet ta dekho, total koto? ${link}`]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const invented = figuresIn(said.replace(link, "")).filter((n) => n > 31);
      const wrong = [
        /attach|open|read|access|share|পড়|porte|khulte|dekhte/i.test(said) ? null : "did not say the link was not read",
        invented.length ? `gave figures: ${invented.join(", ")}` : null,
        reply.target || reply.batch || reply.importPlan ? "drafted something" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "said it was not read", said };
    },
  })),
  ...[
    ["H6", "a real Sheet by link (LINK_SHEET)", process.env.LINK_SHEET],
    ["H7", "a real Doc by link (LINK_DOC)", process.env.LINK_DOC],
  ].map(([id, name, link]) => ({
    id, runs: 1, name,
    run: async () => {
      if (!link) return { pass: true, read: true, note: `not run: set ${id === "H6" ? "LINK_SHEET" : "LINK_DOC"} to a file shared with the stored service account` };
      const res = await call("POST", "/ai/attachments/link", { url: link });
      if (res.status !== 200) return { pass: false, note: `${res.status} ${res.body?.message}` };
      // One file, or every tab of a Sheet whose link names none (A3b).
      const files = res.body;
      for (const file of files) made.attachments.add(file.id);
      const { reply, failed } = await talk([`ei file e koyta ${files[0].kind === "text" ? "paragraph" : "row"} ache? ${link}`], files.map((file) => file.id));
      if (failed) return { error: failed };
      const said = textOf(reply);
      const missed = files.filter((file) => file.rowCount && !says(said, file.rowCount));
      return { pass: !missed.length, note: missed.length ? `left out ${missed.map((file) => `${file.name}: ${file.rowCount}`).join("; ")}` : files.map((file) => `${file.name}: ${file.rowCount}`).join("; "), said };
    },
  })),
];

/*
 * I. Confirm in chat, then it saves (A4, 3 Oct 2026). The save itself is the
 * app's, on a button, and .assistantconfirmqa.mjs measures it with no model.
 * What only a real model can get wrong is the talk around it: told "save
 * koro", it must not say it saved; and after a save the conversation says so,
 * and it must neither doubt it nor draft the same thing again. Nothing here
 * writes to the books: the save in I2 is a line in the history, not a record.
 */
CASES.push(
  {
    id: "I1", runs: LIGHT, name: "'save kore dao' of a ready draft - never 'saved', the draft kept",
    run: async () => {
      const { reply, failed } = await talk([`Aaj electricity bill 3200 taka dilam ${BANK} theke, rate 122.5.`, "thik ache, save kore dao"]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        claimsDone(said) ? "said it was saved" : null,
        reply.target === "transaction_out" ? null : `the draft became ${reply.target ?? "nothing"}`,
        amountIs(reply.draft.amount, 3200) ? null : `amount ${reply.draft.amount}`,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "kept the draft for the button", said };
    },
  },
  {
    id: "I2", runs: LIGHT, name: "after 'Saved — TXN-…' in the chat - says it is saved, drafts nothing again",
    run: async () => {
      const ref = "TXN-2026-009999";
      const messages = [
        { role: "user", content: `Aaj electricity bill 3200 taka dilam ${BANK} theke, rate 122.5.` },
        { role: "assistant", content: READY },
        { role: "assistant", content: `Saved — money going out, ${ref}: ৳3,200.00 from ${BANK}, under Electricity. It shows under All transactions.` },
        { role: "user", content: "ager entry ta ki save hoyeche? number ta bolo" },
      ];
      const res = await call("POST", "/ai/turn", { messages });
      if (res.status !== 200) return { error: `${res.status} ${res.body?.message ?? ""}`.trim() };
      if (res.body?.chatId) made.chats.add(res.body.chatId);
      const said = textOf(res.body);
      const wrong = [
        said.includes(ref) ? null : `did not give ${ref}`,
        res.body.target || res.body.batch ? `drafted ${res.body.target ?? "a table"} again` : null,
        /\bna\b|not saved|hoyni|হয়নি/i.test(said) ? "said it was not saved" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "said it is saved, with its number", said };
    },
  },
);

/** A Google Doc as the app keeps one read by link: its paragraphs, a `.gdoc` name. */
const DOC_LINES = ["September payments, from Rahim", "Hostinger hosting renewal | 4,500", "Office tea and snacks | 1,250", "Printer toner | 3,800"];
async function plantDoc() {
  const [row] = await q(
    `insert into ai_attachments (user_id, filename, headers, rows, total_rows) values ($1, 'Barqa September notes.gdoc', '["Text"]'::jsonb, $2::jsonb, $3) returning id`,
    [user.id, JSON.stringify(DOC_LINES.map((Text) => ({ Text }))), DOC_LINES.length],
  );
  made.attachments.add(row.id);
  return row.id;
}

/*
 * A3b, 3 Oct 2026: a Sheet whose link names no tab arrives as every tab, each
 * a file of its own. Planted as the app keeps them (one statement, so one
 * moment; each tab's place in its name), so the model's part is held to
 * without a real Sheet: each tab's total quoted as that tab's and never added
 * to the next, and a tab of income never drafted as money going out.
 */
const TAB_ROWS = {
  payments: [
    { Date: "03/09/2026", "Paid to": "Hostinger", Amount: "4500" },
    { Date: "09/09/2026", "Paid to": "Courier", Amount: "640" },
  ],
  income: [
    { Date: "05/09/2026", "Received from": "Client A", Received: "120000" },
    { Date: "20/09/2026", "Received from": "Client B", Received: "35000" },
  ],
};
async function plantTabs() {
  const rows = await q(
    `insert into ai_attachments (user_id, filename, headers, rows, total_rows) values
       ($1, 'Barqa Book 2026 — Payments (tab 1 of 2)', '["Date","Paid to","Amount"]'::jsonb, $2::jsonb, 2),
       ($1, 'Barqa Book 2026 — Income (tab 2 of 2)', '["Date","Received from","Received"]'::jsonb, $3::jsonb, 2)
     returning id, filename`,
    [user.id, JSON.stringify(TAB_ROWS.payments), JSON.stringify(TAB_ROWS.income)],
  );
  for (const row of rows) made.attachments.add(row.id);
  return ["Payments", "Income"].map((tab) => rows.find((row) => row.filename.includes(`— ${tab} (`)).id);
}
CASES.push(
  {
    id: "H8", runs: LIGHT, name: "a Sheet's two tabs: each tab's total as its own, never the two added together",
    run: async () => {
      const ids = await plantTabs();
      const { reply, failed } = await talk(["ei sheet e total koto taka?"], ids);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const held = [5140, 155000, 4500, 640, 120000, 35000, 2026];
      const invented = figuresIn(said).filter((n) => n > 31 && !held.includes(n) && n !== 160140);
      const wrong = [
        says(said, 5140) ? null : "left out the Payments tab's 5,140",
        says(said, 155000) ? null : "left out the Income tab's 1,55,000",
        says(said, 160140) ? "added the two tabs together (1,60,140)" : null,
        invented.length ? `said figures the Sheet does not hold: ${invented.join(", ")}` : null,
        reply.target || reply.batch || reply.importPlan ? "drafted something" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "each tab's own total", said };
    },
  },
  {
    id: "H9", runs: LIGHT, name: "a Sheet's two tabs: 'Payments tab boi te tolo' - nothing from Income, no account made up",
    run: async () => {
      const ids = await plantTabs();
      const { reply, failed } = await talk(["Payments tab er entry gulo boi te tule dao"], ids);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const rows = reply.batch?.rows ?? (reply.target ? [reply.draft] : []);
      const wrong = [
        rows.some((row) => row.amount !== undefined && [120000, 35000].some((n) => amountIs(row.amount, n))) ? "drafted the Income tab's money" : null,
        rows.some((row) => row.amount !== undefined && ![4500, 640].some((n) => amountIs(row.amount, n))) ? "an amount the Payments tab does not hold" : null,
        rows.some(hasAccount) ? `filled in the account: ${rows.find(hasAccount).accountName ?? rows.find(hasAccount).accountId}` : null,
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      const how = reply.batch ? `${rows.length} drafts, no account` : /send to import/i.test(said) ? "pointed to Send to Import" : "asked";
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : how, said };
    },
  },
);

/*
 * K. A3c, 3 Oct 2026: an Excel workbook of several sheets arrives as every
 * sheet, each a file of its own, as a Sheet's tabs do (H8, H9). Attached
 * through the real endpoint, which needs no model: what is held to is the
 * model's part, each sheet's total as its own and nothing drafted from the
 * wrong sheet, under the workbook's own wording.
 */
async function bookOfTwo() {
  const book = new ExcelJS.Workbook();
  const payments = book.addWorksheet("Payments");
  payments.addRow(["Date", "Paid to", "Amount"]);
  for (const row of TAB_ROWS.payments) payments.addRow([row.Date, row["Paid to"], Number(row.Amount)]);
  const income = book.addWorksheet("Income");
  income.addRow(["Date", "Received from", "Received"]);
  for (const row of TAB_ROWS.income) income.addRow([row.Date, row["Received from"], Number(row.Received)]);
  const file = await attach("Barqa Book 2026.xlsx", Buffer.from(await book.xlsx.writeBuffer()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  if (file.problem) return { problem: file.problem };
  const names = file.attachments.map((f) => f.name).join(" | ");
  return names === "Barqa Book 2026.xlsx — Payments (sheet 1 of 2) | Barqa Book 2026.xlsx — Income (sheet 2 of 2)"
    ? { ids: file.attachments.map((f) => f.id) }
    : { problem: `the workbook came back as ${names}` };
}
CASES.push(
  {
    id: "K1", runs: LIGHT, name: "an Excel workbook's two sheets: each sheet's total as its own, never the two added together",
    run: async () => {
      const { ids, problem } = await bookOfTwo();
      if (problem) return { error: problem };
      const { reply, failed } = await talk(["ei file e total koto taka?"], ids);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const held = [5140, 155000, 4500, 640, 120000, 35000, 2026];
      const invented = figuresIn(said).filter((n) => n > 31 && !held.includes(n) && n !== 160140);
      const wrong = [
        says(said, 5140) ? null : "left out the Payments sheet's 5,140",
        says(said, 155000) ? null : "left out the Income sheet's 1,55,000",
        says(said, 160140) ? "added the two sheets together (1,60,140)" : null,
        invented.length ? `said figures the workbook does not hold: ${invented.join(", ")}` : null,
        reply.target || reply.batch || reply.importPlan ? "drafted something" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "each sheet's own total", said };
    },
  },
  {
    id: "K2", runs: LIGHT, name: "an Excel workbook's two sheets: 'Payments sheet boi te tolo' - nothing from Income, no account made up",
    run: async () => {
      const { ids, problem } = await bookOfTwo();
      if (problem) return { error: problem };
      const { reply, failed } = await talk(["Payments sheet er entry gulo boi te tule dao"], ids);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const rows = reply.batch?.rows ?? (reply.target ? [reply.draft] : []);
      const wrong = [
        rows.some((row) => row.amount !== undefined && [120000, 35000].some((n) => amountIs(row.amount, n))) ? "drafted the Income sheet's money" : null,
        rows.some((row) => row.amount !== undefined && ![4500, 640].some((n) => amountIs(row.amount, n))) ? "an amount the Payments sheet does not hold" : null,
        rows.some(hasAccount) ? `filled in the account: ${rows.find(hasAccount).accountName ?? rows.find(hasAccount).accountId}` : null,
        reply.importPlan ? "sent a plan for Import, which several sheets never have" : null,
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      const how = reply.batch ? `${rows.length} drafts, no account` : /send to import/i.test(said) ? "pointed to Send to Import" : "asked";
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : how, said };
    },
  },
);

/*
 * L. A3d, 3 Oct 2026: a workbook whose rows are all on one sheet arrives as
 * that sheet, one FILE, the empty sheets named beside it. Attached through
 * the real endpoint. Held to: the empty sheets said to be empty and never
 * described, and the file worked as one, so a plan for Import is possible
 * again once everything is known.
 */
async function oldBook() {
  const book = new ExcelJS.Workbook();
  const first = book.addWorksheet("Sheet1");
  first.addRow(["Date", "Paid to", "Amount"]);
  for (const row of TAB_ROWS.payments) first.addRow([row.Date, row["Paid to"], Number(row.Amount)]);
  book.addWorksheet("Sheet2");
  book.addWorksheet("Sheet3");
  const file = await attach("Barqa Old book.xlsx", Buffer.from(await book.xlsx.writeBuffer()), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  if (file.problem) return { problem: file.problem };
  return file.attachments.length === 1 && file.attachment.name === "Barqa Old book.xlsx — Sheet1\nSheet2, Sheet3: empty"
    ? { id: file.attachment.id }
    : { problem: `the workbook came back as ${file.attachments.map((f) => JSON.stringify(f.name)).join(" | ")}` };
}
CASES.push(
  {
    id: "L1", runs: LIGHT, name: "a workbook with Sheet1 of rows and two empty sheets: 'baki sheet e ki ache?' - empty, said so, Sheet1's total",
    run: async () => {
      const { id, problem } = await oldBook();
      if (problem) return { error: problem };
      const { reply, failed } = await talk(["ei file e ki ki ache? baki sheet gulo te ki ache? total koto?"], id);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const invented = figuresIn(said).filter((n) => n > 31 && ![5140, 4500, 640, 2026].includes(n));
      const wrong = [
        says(said, 5140) ? null : "left out Sheet1's total, 5,140",
        /empty|khali|kichu nei|faka|ফাঁকা|খালি/i.test(said) ? null : "did not say the other sheets are empty",
        invented.length ? `said figures the workbook does not hold: ${invented.join(", ")}` : null,
        reply.target || reply.batch || reply.importPlan ? "drafted something" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "Sheet1's total, the rest empty", said };
    },
  },
  {
    id: "L2", runs: LIGHT, name: "the same workbook, everything said: a plan for Import, as one file has, not 'Send to Import on its card'",
    run: async () => {
      const { id, problem } = await oldBook();
      if (problem) return { error: problem };
      const { reply, failed } = await talk(
        [`These are payments, money out, all from ${BANK}. File every row as ${CATEGORY}. The dates are day first. Read the file at 121.50 taka to the dollar. Enter them.`, "Yes, exactly that. Go ahead."],
        id,
      );
      if (failed) return { error: failed };
      const plan = reply.importPlan;
      const said = textOf(reply);
      if (!plan) return { pass: false, note: "no plan after two turns", said };
      const wrong = [
        same(plan.accountName, BANK) ? null : `account ${plan.accountName}`,
        Number(plan.usdRate) === 121.5 ? null : `rate ${plan.usdRate}`,
        same(plan.categoryName, CATEGORY) ? null : `category ${plan.categoryName}`,
        ["amount", "amountOut"].includes(plan.columnMap.Amount) ? null : `Amount -> ${plan.columnMap.Amount}`,
        plan.dateFormat === "dmy" ? null : `dates ${plan.dateFormat}`,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "a plan, to the letter", said };
    },
  },
);

/*
 * J. A4b, 3 Oct 2026: everything Confirm saves is "Added by the assistant",
 * and All transactions has an Origin filter that finds it. The rows are the
 * app's, measured by .assistantoriginqa.mjs with no model. What only a real
 * model can get wrong is pointing to them, and naming the button it has.
 */
CASES.push(
  {
    id: "J1", runs: LIGHT, name: "'assistant diye ja entry korechi kothay dekhbo?' - All transactions, Origin 'Added by the assistant'",
    run: async () => {
      const { reply, failed } = await talk(["tumi assistant diye ja ja entry korecho segulo ek sathe kothay dekhbo?"]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        /all transactions/i.test(said) ? null : "did not name All transactions",
        /added by the assistant/i.test(said) ? null : "did not name the origin 'Added by the assistant'",
        reply.target || reply.batch ? `drafted ${reply.target ?? "a table"}` : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "pointed to the Origin filter", said };
    },
  },
  {
    id: "J2", runs: LIGHT, name: "'save button kothay?' after a draft - 'Confirm and save', never a bare 'Save'",
    run: async () => {
      const { reply, failed } = await talk([`Aaj electricity bill 3200 taka dilam ${BANK} theke, rate 122.5.`, "save korar button ta kothay?"]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      // "Confirm and save button" is right; a Save with nothing before it is not.
      const bare = said.replace(/confirm and save(\s+all)?/gi, "");
      const wrong = [
        /confirm and save/i.test(said) ? null : "did not name Confirm and save",
        /\*\*save\*\*|"save"|press save|save (button|চাপুন|chapun)/i.test(bare) ? "named a bare Save" : null,
        reply.target === "transaction_out" ? null : `the draft became ${reply.target ?? "nothing"}`,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "named Confirm and save", said };
    },
  },
);

/*
 * B2, 3 Oct 2026: the Assistant's settings left the app's Settings for its
 * own page, behind the gear on the chat, and the model is picked for each
 * conversation in the message box. Asked where either is done, it must name
 * those, and never the sections that are gone.
 */
CASES.push(
  {
    id: "N1", runs: LIGHT, name: "'tomar model kivabe change korbo?' - the picker beside Send, this conversation; never Settings, Assistant",
    run: async () => {
      const { reply, failed } = await talk(["tomar model ta kivabe change korbo? Gemini try korte chai."]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        /message box|beside send|picker|composer/i.test(said) ? null : "did not name the picker in the message box",
        /settings,\s*assistant|settings\s*→\s*assistant|settings\s*>\s*assistant/i.test(said) ? "named the old Settings, Assistant" : null,
        reply.target || reply.batch ? `drafted ${reply.target ?? "a table"}` : null,
        claimsDone(said) ? "said it was done" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "named the picker", said };
    },
  },
  {
    id: "N2", runs: LIGHT, name: "'Google Cloud key kothay add korbo?' - the Assistant's settings; never Settings, Connections",
    run: async () => {
      const { reply, failed } = await talk(["Google Cloud er key ta kothay add korbo?"]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const wrong = [
        /assistant'?s settings|assistant settings|gear/i.test(said) ? null : "did not name the Assistant's settings",
        /settings\s*(→|>|,)\s*connections/i.test(said) ? "named the old Settings, Connections" : null,
        reply.target || reply.batch ? `drafted ${reply.target ?? "a table"}` : null,
        claimsDone(said) ? "said it was done" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "named the Assistant's settings", said };
    },
  },
);

/*
 * O. Every field asked at once, 4 Oct 2026
 * (docs/briefs/2026-10-04-assistant-asks-everything-and-b3.md, piece 1). The
 * owner had the Assistant buy a Claude plan; its row then read "N/A" for
 * Invoice, Reference, Login accounts, User name and User department, and
 * nobody had asked. The list itself is the app's, so what is held here is
 * the model's half: nothing invented for any of the five, the answers taken
 * in one go, and "skip" heard as skip.
 */
const PLAN_ASKED = ["Login accounts", "User Name", "User Department", "Invoice", "Reference"];
CASES.push(
  {
    id: "O1", runs: LIGHT, name: "'Claude Max kinlam' with all Save needs - every one of the five asked at once, none made up",
    run: async () => {
      const { reply, failed } = await talk([`Claude Max subscription kinlam aaj, $100, ${BANK} theke, rate 122.`]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const open = (reply.open ?? []).filter((field) => !field.skipped).map((field) => field.label);
      const wrong = [
        reply.target === "subscription" ? null : `drafted ${reply.target}`,
        PLAN_ASKED.every((label) => open.includes(label)) ? null : `asked only ${open.join(", ") || "nothing"}`,
        PLAN_ASKED.every((label) => said.includes(`• ${label}`)) ? null : "the list is not in the reply",
        ...["loginEmail", "userNames", "boughtFor", "invoiceNo", "reference"].map((field) => (reply.draft[field] ? `made up ${field}: ${reply.draft[field]}` : null)),
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "the five, at once", said };
    },
  },
  {
    id: "O2", runs: LIGHT, name: "the five answered in one message, two of them 'nai'/'skip' - all taken, the two left empty, nothing asked again",
    run: async () => {
      if (!someone) return { error: "nobody on the local Team to put on the plan" };
      const { reply, failed } = await talk([
        `Claude Max subscription kinlam aaj, $100, ${BANK} theke, rate 122.`,
        `login ops@shareviral.cash, user ${someone.full_name}, department Engineering, invoice nai, reference skip`,
      ]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const left = (reply.open ?? []).filter((field) => field.skipped).map((field) => field.field).sort();
      const asked = (reply.open ?? []).filter((field) => !field.skipped).map((field) => field.label);
      const wrong = [
        reply.target === "subscription" ? null : `drafted ${reply.target}`,
        same(reply.draft.loginEmail, "ops@shareviral.cash") ? null : `login ${reply.draft.loginEmail}`,
        same(reply.draft.userNames, someone.full_name) ? null : `user ${reply.draft.userNames}`,
        same(reply.draft.boughtFor, "Engineering") ? null : `department ${reply.draft.boughtFor}`,
        JSON.stringify(left) === JSON.stringify(["invoice", "reference"]) ? null : `left empty: ${left.join(", ") || "nothing"}`,
        asked.length ? `still asked ${asked.join(", ")}` : null,
        reply.draft.reference || reply.draft.invoiceNo ? "filled a field it was told to skip" : null,
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "all taken, two left empty", said };
    },
  },
);

/*
 * M. The owner's recorded mistakes, each run again (A2b). What was asked is
 * kept with its digits masked ("…"), so a figure-shaped mistake is better
 * written by hand in its `expect`; the routing and the wording ones are what
 * this catches.
 */
const MISTAKES = fs.existsSync(".assistantbar.mistakes.json")
  ? JSON.parse(fs.readFileSync(".assistantbar.mistakes.json", "utf8"))
  : [];
for (const [index, mistake] of MISTAKES.entries()) {
  CASES.push({
    id: `M${index + 1}`,
    runs: LIGHT,
    name: `mistake of ${String(mistake.at ?? "").slice(0, 10)}: "${String(mistake.said).slice(0, 48)}"`,
    run: async () => {
      const { reply, failed } = await talk([mistake.said]);
      if (failed) return { error: failed };
      const said = textOf(reply);
      const expect = mistake.expect ?? {};
      if (!Object.keys(expect).length) {
        return { pass: true, read: true, note: `to read: what was right — ${mistake.right}`, said: `[${reply.area ?? "-"} / ${reply.target ?? "no draft"}] ${said}` };
      }
      const wrong = [
        expect.area && reply.area !== expect.area ? `filed under ${reply.area}, wanted ${expect.area}` : null,
        "target" in expect && reply.target !== expect.target ? `drafted ${reply.target}, wanted ${expect.target}` : null,
        expect.notTarget && reply.target === expect.notTarget ? `drafted ${expect.notTarget} again` : null,
        expect.says && !new RegExp(expect.says, "i").test(said) ? `did not say /${expect.says}/` : null,
        expect.notSays && new RegExp(expect.notSays, "i").test(said) ? `said /${expect.notSays}/ again` : null,
        ...Object.entries(expect.draft ?? {}).map(([field, value]) => (same(reply.draft[field], value) ? null : `${field} ${reply.draft[field]}, wanted ${value}`)),
        claimsDone(said) ? "said it was recorded" : null,
      ].filter(Boolean);
      return { pass: !wrong.length, note: wrong.length ? wrong.join("; ") : "not repeated", said };
    },
  });
}

/* ------------------------------------------------------------------------ */

async function pooled(jobs, size) {
  const results = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < jobs.length) {
        const index = next++;
        results[index] = await jobs[index]().catch((error) => ({ error: String(error) }));
      }
    }),
  );
  return results;
}

const [before] = await q(`select ai_provider, ai_model from app_settings where id = 1`);
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODELS);
const transcript = [];
const summary = [];

try {
  for (const model of wanted) {
    console.log(`\n=== ${model} ===`);
    if (!MODELS[model]) {
      console.log("  not a model this app offers");
      continue;
    }

    // The first way the stored keys can actually reach it.
    const { body: availability } = await call("GET", "/ai/availability");
    const ways = MODELS[model].filter((way) => (way === "vertex" ? availability.googleKeySet : Boolean(availability.keyHint)));
    let reached = null;
    for (const provider of ways) {
      const set = await call("PATCH", "/ai/settings", { provider, model });
      if (set.status !== 200) continue;
      const hello = await talk(["hi"]);
      if (!hello.failed) {
        reached = provider;
        break;
      }
      console.log(`  through ${provider}: ${hello.failed}`);
    }
    if (!reached) {
      console.log(ways.length ? "  could not be reached; not run" : "  no key stored for it; not run");
      summary.push({ model, reached: false });
      continue;
    }
    console.log(`  through ${reached}`);

    const jobs = CASES.flatMap((c) => Array.from({ length: c.runs }, (_, run) => ({ c, run })));
    const outcomes = await pooled(jobs.map(({ c }) => () => c.run()), POOL);

    const lines = [];
    for (const c of CASES) {
      const mine = outcomes.filter((_, i) => jobs[i].c === c);
      const passed = mine.filter((o) => o.pass).length;
      const errors = mine.filter((o) => o.error);
      lines.push({ id: c.id, name: c.name, passed, runs: mine.length, errors: errors.length });
      console.log(`  ${passed === mine.length ? "ok  " : "FAIL"}  ${c.id}  ${passed}/${mine.length}  ${c.name}`);
      mine.forEach((o, i) => {
        transcript.push({ model, case: c.id, run: i + 1, ...o });
        if (!o.pass || o.read) console.log(`          run ${i + 1}: ${o.error ? `error: ${o.error}` : o.note}${o.said ? `\n            said: ${o.said.slice(0, 300)}` : ""}`);
      });
    }
    summary.push({ model, reached, lines });
  }
} finally {
  await db.query(`update app_settings set ai_provider = $1, ai_model = $2 where id = 1`, [before.ai_provider, before.ai_model]);
  for (const id of made.chats) await call("DELETE", `/ai/chats/${id}`);
  for (const id of made.attachments) await call("DELETE", `/ai/attachments/${id}`);
  await db.query(`delete from subscriptions where tool_name = $1`, [PLAN]);
  await db.end();
  fs.writeFileSync(".assistantbar.log", JSON.stringify({ at: new Date().toISOString(), runs: RUNS, light: LIGHT, summary, transcript }, null, 2));
}

console.log("\n=== the bar ===");
for (const s of summary) {
  if (!s.reached) {
    console.log(`${s.model}: not reached`);
    continue;
  }
  const failed = s.lines.filter((l) => l.passed !== l.runs);
  console.log(`${s.model} (through ${s.reached}): ${s.lines.length - failed.length}/${s.lines.length} cases clean${failed.length ? ` — failed ${failed.map((l) => `${l.id} ${l.passed}/${l.runs}`).join(", ")}` : ""}`);
}
console.log("\nThe full transcript is in .assistantbar.log");
process.exit(summary.some((s) => s.reached && s.lines.some((l) => l.passed !== l.runs)) ? 1 : 0);
