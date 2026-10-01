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
 *
 * The invention cases run RUNS times each (six: "two of six" is how the bar
 * was first failed); the rest LIGHT times (two).
 *
 *     node .assistantbar.mjs                    every model the stored keys reach
 *     node .assistantbar.mjs gemini-2.5-pro     one model
 *     RUNS=3 LIGHT=1 node .assistantbar.mjs     a cheaper pass
 *
 * Needs `npm run dev` (api :4001) and a key in the LOCAL Settings: the Google
 * Cloud key under Connections for anything through Google, an Anthropic key
 * for Claude that way. It asks the real model, so it costs real money — a few
 * dollars for a full run on one model.
 *
 * Touches app_settings' ai_provider / ai_model, and puts them back. Deletes
 * the chats and attachments it made. The whole transcript goes to
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
  made.attachments.add(json.id);
  return { status: 200, attachment: json };
}

/** A conversation, sent the way the screen sends it. */
async function talk(lines, attachmentId) {
  const messages = [];
  let reply = null;
  let chatId;
  for (const line of lines) {
    messages.push({ role: "user", content: line });
    const res = await call("POST", "/ai/turn", {
      messages,
      ...(reply?.target ? { target: reply.target } : {}),
      ...(reply?.draft ? { draft: reply.draft } : {}),
      ...(chatId ? { chatId } : {}),
      ...(attachmentId ? { attachmentId } : {}),
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
];

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
        if (!o.pass) console.log(`          run ${i + 1}: ${o.error ? `error: ${o.error}` : o.note}${o.said ? `\n            said: ${o.said.slice(0, 300)}` : ""}`);
      });
    }
    summary.push({ model, reached, lines });
  }
} finally {
  await db.query(`update app_settings set ai_provider = $1, ai_model = $2 where id = 1`, [before.ai_provider, before.ai_model]);
  for (const id of made.chats) await call("DELETE", `/ai/chats/${id}`);
  for (const id of made.attachments) await call("DELETE", `/ai/attachments/${id}`);
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
