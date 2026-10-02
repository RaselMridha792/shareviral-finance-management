/**
 * "Added by the assistant" on everything Confirm and save puts in the books —
 * docs/briefs/2026-10-02-assistant-powerful.md, piece A4b (3 Oct 2026).
 *
 * Before A4b only a plain payment said so. A transfer, a plan's payment and a
 * challan's payment saved through Confirm said "Entered by hand" or "From a
 * tax payment", like the forms', and a batch the Assistant entered could not
 * be found by its origin. Measured here:
 *
 *   A. through Confirm, every kind that writes a ledger row — a payment with a
 *      bank charge, money in, a transfer with a charge (both halves), a plan's
 *      renewal, a new plan's first payment, a challan, a table row: every row
 *      "ai_intake", the charges with their entries, the challan still linked;
 *   B. the same kinds through their own forms, on the same API right after:
 *      "manual", and the challan's "tax_payment" — the origin is the
 *      Assistant's alone;
 *   C. the API's own filter: origin "ai_intake" lists exactly the rows saved
 *      through Confirm, of every kind, and the totals answer to it;
 *   D. the prompt names the button as it is now: Confirm and save;
 *   E. the page: All transactions, Origin "Added by the assistant", shows
 *      exactly those rows; "Entered by hand" shows the forms'; Clear puts it
 *      back; the row at 1280px and 1490px, and 390px.
 *
 *     npm run build --workspace @finance/api     (this runs the BUILT api)
 *     node .assistantoriginqa.mjs                (needs the web on :3000)
 *     SHOT_DIR=<dir> node .assistantoriginqa.mjs   also saves screenshots
 *
 * Starts its own API on :4017 pointed at a stand-in for the model, so the dev
 * API on :4001 is left alone. Puts a made-up Anthropic key in the local
 * app_settings while it runs and puts back what was there. Everything it
 * saves is named ORIGINQA and deleted afterwards, and it prints what is left
 * (nothing). The audit rows of what it saved stay, as they would for anybody.
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
const PORT = 4017;
const API = `http://localhost:${PORT}/api`;
const STUB_PORT = 4597;
const SHOTS = process.env.SHOT_DIR || null;
const TAG = "ORIGINQA";

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

const results = [];
const check = (name, pass, detail) => {
  results.push(Boolean(pass));
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------------ */
/*  The books this runs against                                              */
/* ------------------------------------------------------------------------ */

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const accounts = await q(
  `select a.id, a.name, a.currency,
          (a.opening_balance + coalesce(sum(t.signed_amount) filter (where t.voided_at is null and t.deleted_at is null), 0))::numeric as balance
     from accounts a left join transactions t on t.account_id = a.id
    where a.is_active and a.deleted_at is null group by a.id order by a.name`,
);
const taka = accounts.filter((a) => a.currency !== "USD").sort((a, b) => Number(b.balance) - Number(a.balance));
const CARD = taka[0];
const OTHER = taka[1];
if (!CARD || !OTHER || Number(CARD.balance) < 30000) throw new Error("The local books need two taka accounts, one of them holding 30,000.");
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
if (!PLAIN || !INCOME) throw new Error("The local books need a plain money-out sub-category and a money-in one.");

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
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_originqa" });
    res.end(
      JSON.stringify({
        id: "msg_originqa",
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
async function turn(text, says) {
  answer = says;
  const res = await call("POST", "/ai/turn", { messages: [{ role: "user", content: text }] });
  if (res.body?.chatId) made.chats.add(res.body.chatId);
  if (res.status !== 200) console.log(`  (the turn "${text.slice(0, 40)}" answered ${res.status}: ${JSON.stringify(res.body)})`);
  return res;
}
/** Drafted, then confirmed as drafted. */
async function confirmed(text, says) {
  const drafted = await turn(text, says);
  const saved = await call("POST", "/ai/confirm", { chatId: drafted.body?.chatId, draft: drafted.body?.draft });
  if (saved.status !== 200) console.log(`  (confirming "${text.slice(0, 40)}" answered ${saved.status}: ${saved.body?.message})`);
  return saved;
}
/** A record's row, its charge, and a transfer's other half. */
const rowsOf = (id) =>
  q(
    `select id, ref_no, direction, created_via, charge_for_id, transfer_group_id, description
       from transactions
      where id = $1
         or charge_for_id = $1
         or (transfer_group_id is not null and transfer_group_id = (select transfer_group_id from transactions where id = $1))
      order by created_at, ref_no`,
    [id ?? "00000000-0000-4000-8000-000000000000"],
  );
const origins = (rows) => rows.map((r) => r.created_via).join(",");

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

/** Everything this run saves, taken out again. Charges first: they point at their entries. */
async function sweep() {
  await db.query(`delete from tds_deposits where challan_number like '${TAG}%'`);
  const ours = `select id from transactions
                 where description like '%${TAG}%'
                    or subscription_id in (select id from subscriptions where tool_name like '${TAG}%')`;
  await db.query(`delete from transactions where charge_for_id in (${ours})`);
  await db.query(`delete from transactions where transfer_group_id in (select transfer_group_id from transactions where description like '%${TAG}%' and transfer_group_id is not null)`);
  await db.query(`delete from transactions where id in (${ours})`);
  await db.query(`delete from subscriptions where tool_name like '${TAG}%'`);
  await db.query(`delete from ai_corrections where said like '%${TAG}%' or corrected like '%${TAG}%' or drafted like '%${TAG}%'`);
}

/** A plan on file, as the map harness plants one: no payment yet this month. */
const plantPlan = async (tool) =>
  (
    await q(
      `insert into subscriptions (tool_name, plan_name, category, status, cost_usd, cost_bdt, usd_rate, billing_cycle, start_date, next_renewal_on, payment_method, account_id, created_by, updated_by)
       values ($1, 'Pro', 'ai_tool', 'active', 10, 1225, 122.5, 'monthly', $2, $2, 'card', $3, $4, $4) returning id`,
      [tool, today, CARD.id, admin.id],
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
            anthropic_api_key = $1, anthropic_key_set_at = now(), anthropic_key_set_by = $2 where id = 1`,
    [seal("sk-ant-originqa-0000000000000000000000"), admin.id],
  );
  const RENEWED = await plantPlan(`${TAG} Renewed`);
  const RENEWED_BY_HAND = await plantPlan(`${TAG} Renewed by hand`);

  /* ------------------------------------------------------------------ */
  console.log("\nA. Through Confirm and save: every row the Assistant writes");
  const viaChat = [];

  const pay = await confirmed(`${TAG} courier 640 dilam`, {
    area: "expenses",
    target: "transaction_out",
    draft: { amount: "640", chargeAmount: "15", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: `${TAG} courier` },
    missingFields: [],
  });
  const payRows = await rowsOf(pay.body?.id);
  viaChat.push(...payRows);
  check(
    "a payment and its bank charge: both added by the assistant",
    pay.status === 200 && payRows.length === 2 && payRows.some((r) => r.charge_for_id === pay.body.id) && origins(payRows) === "ai_intake,ai_intake",
    `${pay.status} ${payRows.map((r) => `${r.ref_no} ${r.created_via}${r.charge_for_id ? " (charge)" : ""}`).join(", ") || pay.body?.message}`,
  );

  const income = await confirmed(`${TAG} income`, {
    area: "transactions",
    target: "transaction_in",
    draft: { amount: "5000", accountName: CARD.name, categoryName: INCOME.name, usdRate: "122.5", txnDate: today, description: `${TAG} income` },
    missingFields: [],
  });
  const incomeRows = await rowsOf(income.body?.id);
  viaChat.push(...incomeRows);
  check("money in", income.status === 200 && origins(incomeRows) === "ai_intake", `${income.status} ${origins(incomeRows) || income.body?.message}`);

  const transfer = await confirmed(`${TAG} transfer`, {
    area: "transfers",
    target: "transfer",
    draft: { amount: "300", chargeAmount: "10", fromAccountName: CARD.name, toAccountName: OTHER.name, usdRate: "122.5", txnDate: today, description: `${TAG} transfer` },
    missingFields: [],
  });
  const transferRows = await rowsOf(transfer.body?.id);
  viaChat.push(...transferRows);
  check(
    "a transfer: both halves and its charge, added by the assistant (was: entered by hand)",
    transfer.status === 200 && transferRows.length === 3 && transferRows.filter((r) => r.transfer_group_id).length === 2 && transferRows.filter((r) => r.charge_for_id).length === 1 && origins(transferRows) === "ai_intake,ai_intake,ai_intake",
    `${transfer.status} ${transferRows.map((r) => `${r.direction} ${r.created_via}${r.charge_for_id ? " (charge)" : ""}`).join(", ") || transfer.body?.message}`,
  );

  const renewal = await confirmed(`${TAG} Renewed renew korlam`, {
    area: "subscriptions",
    target: "subscription_payment",
    draft: { subscriptionName: `${TAG} Renewed`, txnDate: today, usdRate: "122.5" },
    missingFields: [],
  });
  const renewalRows = await q(`select id, ref_no, created_via, subscription_id from transactions where subscription_id = $1`, [RENEWED]);
  viaChat.push(...renewalRows);
  check(
    "a plan's renewal: added by the assistant (was: entered by hand)",
    renewal.status === 200 && renewalRows.length === 1 && renewalRows[0].id === renewal.body?.id && origins(renewalRows) === "ai_intake",
    `${renewal.status} ${origins(renewalRows) || renewal.body?.message}`,
  );

  const plan = await confirmed(`${TAG} New notun plan`, {
    area: "subscriptions",
    target: "subscription",
    draft: { toolName: `${TAG} New`, planName: "Pro", category: "ai_tool", costUsd: "20", usdRate: "122.5", billingCycle: "monthly", startDate: today, accountName: CARD.name },
    missingFields: [],
  });
  const [newPlan] = await q(`select id from subscriptions where tool_name = $1`, [`${TAG} New`]);
  const firstPayment = newPlan ? await q(`select id, ref_no, created_via from transactions where subscription_id = $1`, [newPlan.id]) : [];
  viaChat.push(...firstPayment);
  check(
    "a new plan's first payment: added by the assistant (was: entered by hand)",
    plan.status === 200 && firstPayment.length === 1 && firstPayment[0].ref_no === plan.body?.refNo && origins(firstPayment) === "ai_intake",
    `${plan.status} ${origins(firstPayment) || plan.body?.message}`,
  );

  const challan = await confirmed(`${TAG} challan`, {
    area: "tds",
    target: "tds_deposit",
    draft: { challanNumber: `${TAG}-42`, challanDate: today, depositDate: today, amount: "500", periodYear: today.slice(0, 4), periodMonth: String(Number(today.slice(5, 7))), accountName: CARD.name, usdRate: "122.5" },
    missingFields: [],
  });
  const [deposit] = await q(`select id, transaction_id from tds_deposits where challan_number = $1`, [`${TAG}-42`]);
  const challanRows = deposit?.transaction_id ? await rowsOf(deposit.transaction_id) : [];
  viaChat.push(...challanRows);
  check(
    "a challan's payment: added by the assistant (was: from a tax payment), and the challan still links to it",
    challan.status === 200 && challanRows.length === 1 && challanRows[0].ref_no === challan.body?.refNo && origins(challanRows) === "ai_intake",
    `${challan.status} ${origins(challanRows) || challan.body?.message}`,
  );

  const table = await turn(`${TAG} ei duita bill`, {
    area: "expenses",
    draft: {},
    missingFields: [],
    batch: {
      target: "transaction_out",
      rows: [
        { amount: "111", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: `${TAG} row one` },
        { amount: "222", accountName: CARD.name, categoryName: PLAIN.name, usdRate: "122.5", txnDate: today, description: `${TAG} row two` },
      ],
      note: "2 bills",
    },
  });
  const rowSaved = await call("POST", "/ai/confirm", { chatId: table.body?.chatId, row: 0 });
  const tableRows = await rowsOf(rowSaved.body?.id);
  viaChat.push(...tableRows);
  check("a table's row, confirmed by its number", rowSaved.status === 200 && origins(tableRows) === "ai_intake", `${rowSaved.status} ${origins(tableRows) || rowSaved.body?.message}`);
  check(
    "every ledger row Confirm wrote this run says so: 10 rows, none otherwise",
    viaChat.length === 10 && viaChat.every((r) => r.created_via === "ai_intake"),
    `${viaChat.length} rows: ${origins(viaChat)}`,
  );

  /* ------------------------------------------------------------------ */
  console.log("\nB. The same kinds through their own forms: not the Assistant's");
  const byHand = [];
  const typed = await call("POST", "/transactions", { direction: "out", amount: "45", chargeAmount: "5", accountId: CARD.id, categoryId: PLAIN.id, usdRate: "122.5", txnDate: today, description: `${TAG} typed into the form` });
  const typedRows = await rowsOf(typed.body?.id);
  byHand.push(...typedRows);
  check("a payment and its charge, typed: entered by hand", typed.status === 201 && origins(typedRows) === "manual,manual", `${typed.status} ${origins(typedRows) || JSON.stringify(typed.body)}`);

  const moved = await call("POST", "/transactions/transfer", { fromAccountId: CARD.id, toAccountId: OTHER.id, amount: "30", chargeAmount: "2", usdRate: "122.5", txnDate: today, description: `${TAG} transfer by hand` });
  const movedRows = await rowsOf(moved.body?.id);
  byHand.push(...movedRows);
  check("a transfer on the Money Transfer form: both halves and the charge entered by hand", moved.status === 201 && origins(movedRows) === "manual,manual,manual", `${moved.status} ${origins(movedRows) || JSON.stringify(moved.body)}`);

  const renewedByHand = await call("POST", `/subscriptions/${RENEWED_BY_HAND}/pay`, { txnDate: today, advanceRenewal: false });
  const renewedRows = await q(`select id, ref_no, created_via from transactions where subscription_id = $1`, [RENEWED_BY_HAND]);
  byHand.push(...renewedRows);
  check("a renewal on the Renew drawer: entered by hand", renewedByHand.status === 201 && origins(renewedRows) === "manual", `${renewedByHand.status} ${origins(renewedRows) || JSON.stringify(renewedByHand.body)}`);

  const challanByHand = await call("POST", "/tds/deposits", { challanNumber: `${TAG}-43`, challanDate: today, depositDate: today, amount: "400", periodYear: Number(today.slice(0, 4)), periodMonth: Number(today.slice(5, 7)), accountId: CARD.id, usdRate: "122.5" });
  const [depositByHand] = await q(`select transaction_id from tds_deposits where challan_number = $1`, [`${TAG}-43`]);
  const challanHandRows = depositByHand?.transaction_id ? await rowsOf(depositByHand.transaction_id) : [];
  check("a challan on the TDS screen: still from a tax payment", challanByHand.status === 201 && origins(challanHandRows) === "tax_payment", `${challanByHand.status} ${origins(challanHandRows) || JSON.stringify(challanByHand.body)}`);

  /* ------------------------------------------------------------------ */
  console.log('\nC. The origin filter: "ai_intake" is exactly what Confirm saved');
  const listed = async (origin) => {
    const res = await call("GET", `/transactions?createdVia=${origin}&q=${TAG}&pageSize=100`);
    return { status: res.status, ids: (res.body?.items ?? []).map((r) => r.id).sort(), total: res.body?.total };
  };
  const ours = viaChat.map((r) => r.id).sort();
  const viaFilter = await listed("ai_intake");
  check(
    "GET /transactions?createdVia=ai_intake lists those 10, every kind, and nothing typed",
    viaFilter.status === 200 && viaFilter.ids.join() === ours.join(),
    `${viaFilter.status} listed ${viaFilter.ids.length}, saved through Confirm ${ours.length}`,
  );
  const handFilter = await listed("manual");
  check("and createdVia=manual lists the 6 typed into the forms, none of the Assistant's", handFilter.status === 200 && handFilter.ids.join() === byHand.map((r) => r.id).sort().join(), `${handFilter.status} listed ${handFilter.ids.length}`);
  const totals = await call("GET", `/transactions/summary?createdVia=ai_intake&q=${TAG}`);
  const [sums] = await q(
    `select coalesce(sum(amount) filter (where direction = 'in'), 0)::numeric(14,2)::text as "in",
            coalesce(sum(amount) filter (where direction = 'out'), 0)::numeric(14,2)::text as "out"
       from transactions where id = any ($1::uuid[])`,
    [ours],
  );
  check(
    "the totals answer to the filter too",
    totals.status === 200 && totals.body?.entries === 10 && Number(totals.body?.moneyIn) === Number(sums.in) && Number(totals.body?.moneyOut) === Number(sums.out),
    `${totals.status} ${JSON.stringify(totals.body)} against in ${sums.in}, out ${sums.out}`,
  );

  /* ------------------------------------------------------------------ */
  console.log("\nD. The prompt names the button as it is");
  const system = JSON.stringify(asked.at(-1)?.system ?? "");
  check("it says **Confirm and save** on the draft card", system.includes("**Confirm and save** on the draft card"), system.match(/the only ones that exist:[^.]*/)?.[0]?.slice(0, 160));
  check("and no longer **Save**", !system.includes("**Save** on the draft card"));

  /* ------------------------------------------------------------------ */
  console.log("\nE. The page: All transactions, by origin");
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
  const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  /**
   * The page's own list request once it settles, what it was answered, and
   * how many rows it drew. The table has no description column (#99), so a
   * row is known by the answer the page drew it from, and the count holds the
   * two together.
   */
  const listedOnPage = async (act) => {
    const answered = page.waitForResponse((response) => /\/transactions\?/.test(response.url()) && !response.url().includes("/summary") && response.request().method() === "GET", { timeout: 60000 });
    await act();
    const res = await answered;
    const body = await res.json().catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const drawn = await page.$$eval("main tbody tr", (trs) => trs.filter((tr) => tr.innerText.trim()).length);
    const items = body?.items ?? [];
    return { url: res.url(), ids: items.map((r) => r.id).sort(), descriptions: items.map((r) => r.description), drawn };
  };

  await page.goto(`${WEB}/transactions`, { waitUntil: "networkidle0", timeout: 120000 });
  const origin = await page.$eval('select[aria-label="Origin"]', (s) => ({ value: s.value, options: [...s.options].map((o) => o.textContent) })).catch(() => null);
  check(
    "an Origin filter, every origin by its own name, Any origin until chosen",
    origin?.value === "" && origin?.options.join("|") === "Any origin|Entered by hand|Imported from Excel|Added by the assistant|From a payroll run|From a tax payment|System",
    JSON.stringify(origin),
  );

  const label = await page.$$eval("label", (ls) => ls.find((l) => l.textContent.trim() === "Search the transactions")?.htmlFor);
  const searched = await listedOnPage(() => page.type(`#${label}`, TAG));
  check("searching the run's own entries: all 17 of them", searched.ids.length === 17, `${searched.ids.length} listed`);

  const byAssistant = await listedOnPage(() => page.select('select[aria-label="Origin"]', "ai_intake"));
  await shot("origin-assistant");
  check("Origin, Added by the assistant: the page asks for it", /[?&]createdVia=ai_intake(&|$)/.test(byAssistant.url), byAssistant.url.replace(/^.*\?/, "?"));
  check("and lists exactly the 10 saved through Confirm, of every kind", byAssistant.ids.join() === ours.join(), `${byAssistant.ids.length} listed`);
  check("the table draws 10 rows", byAssistant.drawn === 10, String(byAssistant.drawn));
  check(
    "among them both halves of the transfer, the renewal, the new plan's payment, the challan's payment and both charges",
    byAssistant.descriptions.filter((d) => d === `${TAG} transfer`).length === 2 &&
      [`${TAG} Renewed subscription`, `${TAG} New — `, `challan ${TAG}-42`, `Bank charge — ${TAG} courier`, `Bank charge — ${TAG} transfer`].every((needle) => byAssistant.descriptions.some((d) => d.includes(needle))),
    byAssistant.descriptions.join(" || ").slice(0, 600),
  );
  check("and nothing typed into a form", !byAssistant.descriptions.some((d) => /by hand|typed into the form|challan ORIGINQA-43/.test(d)));

  const byHandOnPage = await listedOnPage(() => page.select('select[aria-label="Origin"]', "manual"));
  check("Entered by hand: the 6 typed into the forms, none of the Assistant's", byHandOnPage.ids.join() === byHand.map((r) => r.id).sort().join() && byHandOnPage.drawn === 6, `${byHandOnPage.ids.length} listed, ${byHandOnPage.drawn} drawn`);

  const clearLabel = await page.$$eval("button", (bs) => bs.map((b) => b.textContent.trim()).find((t) => /^Clear \d+$/.test(t)));
  check("the filters count as two set", clearLabel === "Clear 2", clearLabel);
  const cleared = await listedOnPage(() => page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Clear \d+$/.test(b.textContent.trim()))?.click()));
  const after = await page.$eval('select[aria-label="Origin"]', (s) => s.value);
  check("Clear puts Origin back to Any origin and asks for every origin", after === "" && !/createdVia=/.test(cleared.url), `${after} ${cleared.url.replace(/^.*\?/, "?")}`);

  // The row's own budget (transactions-screen.tsx): one line from 1490px.
  const lines = async (width) => {
    await page.setViewport({ width, height: 900 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    return page.evaluate(() => {
      const select = document.querySelector('select[aria-label="Origin"]');
      const bar = select?.parentElement;
      const tops = new Set([...(bar?.children ?? [])].map((el) => Math.round(el.getBoundingClientRect().top)));
      return { lines: tops.size, width: Math.round(select?.getBoundingClientRect().width ?? 0), sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
  };
  const at1280 = await lines(1280);
  await shot("origin-1280");
  check("1280px: Origin on a second line of its own, nothing sideways (the owner's choice)", at1280.lines === 2 && at1280.sideways <= 0, JSON.stringify(at1280));
  const at1490 = await lines(1490);
  check("1490px: the whole row on one line", at1490.lines === 1 && at1490.sideways <= 0, JSON.stringify(at1490));
  const at390 = await lines(390);
  await shot("origin-390");
  check("390px: the page does not scroll sideways", at390.sideways <= 0, JSON.stringify(at390));
  check("no page error", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser?.close().catch(() => undefined);
  await db.query(`delete from ai_chats where id = any ($1::uuid[])`, [[...made.chats]]);
  await db.query(`delete from ai_chats where title like '${TAG}%' and created_at > now() - interval '30 minutes'`);
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
    `select (select count(*) from transactions where description like '%${TAG}%')::int as entries,
            (select count(*) from subscriptions where tool_name like '${TAG}%')::int as plans,
            (select count(*) from tds_deposits where challan_number like '${TAG}%')::int as challans,
            (select count(*) from ai_chats where title like '${TAG}%')::int as chats,
            (select count(*) from ai_corrections where said like '%${TAG}%')::int as lessons`,
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
