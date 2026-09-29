/**
 * Bank Advice — the payment file for the bank, built from a salary sheet (#119).
 *
 * The owner, 29 Sep 2026: *"amake every month bank a ekta excel sheet submit
 * korte hoy jeta manually banano onek problem. tai ami cai eta payroll page
 * er arekta tab hisebe thakuk, etar alada ekta page hobe. etay sobgula excel
 * sundor vabe table a list kora thakbe edit delete update kora jabe. eta
 * mainly generate hobe payroll theke"* — with the bank's "Bank Standard
 * Format Final-R1.xlsx" and "Preparing Excel File.pdf".
 *
 * Against the running app and the local database, on four throwaway people
 * and a throwaway salary sheet for a month years ahead:
 *   A. built from payroll: SCB people get SCBLBDDXXXX, others 00 + routing,
 *      account numbers digits only, the holder's name, emails when asked,
 *      the net pay; a wallet-only person is left out and named; a person
 *      with no bank details is IN, flagged; the total is summed in SQL;
 *   B. the file is refused while anything is missing, in words; fixing the
 *      line clears it; the type rules (BT only SCB, ACH/RTGS not SCB);
 *   C. the CSV is the bank's: H row, a P row per payment, T row, 44 fields
 *      each, the right columns, DD/MM/YYYY, Excel-style amounts, CRLF, no
 *      header row, no BOM; downloading stamps it; the workbook has the
 *      bank's column names, text account numbers with their zeros, numbers;
 *   D. add, change and remove a payment; change the advice's details;
 *   E. who: HR and the CEO read, only payroll.pay builds and downloads;
 *   F. the trash takes an advice and gives it back;
 *   G. the browser: the rail (People → Payroll & Bank → Payroll / Bank
 *      Advice), the tabs, New from payroll with the left-out list, the
 *      flagged row fixed in its drawer, Download, add and remove a payment,
 *      the read-only view for HR, a row click, the bin, no sideways scroll.
 *
 *     node .bankadviceqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 *     SHOT_DIR=<dir> node .bankadviceqa.mjs   also saves screenshots
 */
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const API = "http://localhost:4001/api";
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
const who = async (role) =>
  (await q(`select id, role, token_version from users where role = $1 and status = 'active' and deleted_at is null order by created_at limit 1`, [role]))[0];
const tokenFor = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const users = { super_admin: await who("super_admin"), cfo: await who("cfo"), ceo: await who("ceo"), hr: await who("hr") };
const caller = (user) => async (method, p, body, raw = false) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${tokenFor(user)}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return res;
  return { status: res.status, body: await res.json().catch(() => null) };
};
const call = caller(users.super_admin);
const msgOf = (r) => `${r.body?.message ?? ""} ${Object.values(r.body?.errors ?? {}).flat().join(" ")}`.trim();

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const MARK = `BAQA${Date.now().toString(36).toUpperCase()}`;
const YEAR = 2031;
const MONTH = 7;
const SCB = "SCBLBDDXXXX";

async function wipe() {
  const advices = (await q(`select id from bank_advices where title like $1`, [`%${MARK}%`])).map((r) => r.id);
  if (advices.length) {
    await q(`delete from audit_logs where entity_table = 'bank_advices' and entity_id::text = any($1)`, [advices]);
    await q(`delete from bank_advices where id = any($1::uuid[])`, [advices]);
  }
  const members = (await q(`select id from team_members where full_name like $1`, [`${MARK} %`])).map((r) => r.id);
  const runs = (await q(`select id from payroll_runs where notes = $1`, [MARK])).map((r) => r.id);
  const ids = [...members, ...runs];
  if (ids.length) await q(`delete from audit_logs where entity_id::text = any($1)`, [ids]);
  if (runs.length) {
    await q(`update bank_advices set payroll_run_id = null where payroll_run_id = any($1::uuid[])`, [runs]);
    await q(`delete from payroll_lines where payroll_run_id = any($1::uuid[])`, [runs]);
    await q(`delete from payroll_runs where id = any($1::uuid[])`, [runs]);
  }
  if (members.length) {
    await q(`delete from payroll_lines where team_member_id = any($1::uuid[])`, [members]);
    await q(`delete from compensation_history where team_member_id = any($1::uuid[])`, [members]);
    await q(`delete from team_members where id = any($1::uuid[])`, [members]);
  }
}

const account = (await q(`select id, name, account_number from accounts where type = 'bank' and account_number is not null and account_number <> '' order by created_at limit 1`))[0];
const debitDigits = (account?.account_number ?? "").replace(/\D/g, "");
const expectedDebit = debitDigits.startsWith("00") ? debitDigits : `00${debitDigits}`;

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
const open = async (user, url, width = 1440) => {
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: tokenFor(user), domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width, height: 1000 });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Encountered two children/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}${url}`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(900);
  return { page, context };
};
const typeInto = async (page, selector, text) => {
  const box = await page.$(selector);
  if (!box) throw new Error(`no ${selector}`);
  await box.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  if (text) await box.type(text);
  await settle(120);
};

let adviceId = null;
try {
  await wipe();
  if (!account) throw new Error("No bank account with a number in the local database to pay from");
  const clash = await q(`select id from payroll_runs where period_year = $1 and period_month = $2 and deleted_at is null`, [YEAR, MONTH]);
  if (clash.length) throw new Error(`${YEAR}-${MONTH} already has a salary sheet — not touching it`);

  /* ------------------------------------------------------------------ */
  console.log("\nSetting up: four people and a salary sheet");
  const add = async (name, extra) => {
    const r = await call("POST", "/team-members", { fullName: `${MARK} ${name}`, joinedOn: "2031-01-01", ...extra });
    if (r.status !== 201) throw new Error(`member ${name}: ${r.status} ${msgOf(r)}`);
    return r.body.id;
  };
  const scbId = await add("Scb", { joiningSalary: "50000", bankName: "Standard Chartered Bank", bankAccountNumber: "01-7023747-01", bankAccountHolder: "SCB HOLDER NAME", workEmail: "scb.person@example.test" });
  const otherId = await add("Other", { joiningSalary: "40000", bankName: "Dutch-Bangla Bank", bankAccountNumber: "1471 5800 29011", bankRouting: "240100436", personalEmail: "other.person@example.test" });
  const nobankId = await add("Nobank", { joiningSalary: "30000" });
  const walletId = await add("Wallet", { joiningSalary: "20000", walletProvider: "bKash", walletNumber: "01711000000" });
  const run = await call("POST", "/payroll/runs", { periodYear: YEAR, periodMonth: MONTH, notes: MARK });
  if (run.status !== 201) throw new Error(`run: ${run.status} ${msgOf(run)}`);
  const RUN = run.body.id;
  const synced = await call("POST", `/payroll/runs/${RUN}/members`, { teamMemberIds: [scbId, otherId, nobankId, walletId] });
  const lines = await q(`select team_member_id::text id, coalesce(net_amount_override, net_amount)::text net from payroll_lines where payroll_run_id = $1`, [RUN]);
  const netOf = Object.fromEntries(lines.map((l) => [l.id, l.net]));
  check("a salary sheet with the four of them", synced.status === 200 && lines.length === 4, `HTTP ${synced.status}, ${lines.length} lines`);

  /* ------------------------------------------------------------------ */
  console.log("\nA. Built from payroll");
  const built = await call("POST", "/bank-advices/from-payroll", {
    payrollRunId: RUN,
    valueDate: "2031-07-31",
    paymentDetails: "Salary July 2031",
    paymentType: "PAY",
    accountId: account.id,
    includeEmails: true,
    title: `${MARK} Salary July 2031`,
  });
  const advice = built.body?.advice;
  adviceId = advice?.id;
  check("built: 201, three payments", built.status === 201 && advice?.lines?.length === 3, `HTTP ${built.status} ${msgOf(built)}`);
  const byMember = Object.fromEntries((advice?.lines ?? []).map((l) => [l.teamMemberId, l]));
  const scb = byMember[scbId];
  const other = byMember[otherId];
  const nobank = byMember[nobankId];
  check("the wallet-only person is left out, and named with why", built.body?.skipped?.length === 1 && built.body.skipped[0].name === `${MARK} Wallet` && /bKash/.test(built.body.skipped[0].reason), JSON.stringify(built.body?.skipped));
  check("SCB: SCBLBDDXXXX, digits-only account, the holder's name, work email, net pay", scb?.bankCode === SCB && scb?.accountNo === "01702374701" && scb?.beneficiaryName === "SCB HOLDER NAME" && scb?.email === "scb.person@example.test" && scb?.amount === netOf[scbId] && scb?.paymentType === "PAY" && scb?.paymentDetails === "Salary July 2031", JSON.stringify(scb));
  check("another bank: 00 + routing, digits-only account, personal email", other?.bankCode === "00240100436" && other?.accountNo === "1471580029011" && other?.email === "other.person@example.test" && other?.amount === netOf[otherId], JSON.stringify(other));
  check("no bank details: in, and flagged", nobank && nobank.bankCode === "" && nobank.accountNo === "" && nobank.problems.includes("No account number"), JSON.stringify(nobank?.problems));
  const sum = [scbId, otherId, nobankId].reduce((s, id) => s + BigInt(netOf[id].replace(".", "")), 0n);
  check("the total is the three nets, to the paisa", advice?.totalAmount === `${sum / 100n}.${String(sum % 100n).padStart(2, "0")}`, `${advice?.totalAmount}`);
  check("paid from the account, written 00 + its number; the advice itself is fine", advice?.debitAccountNo === expectedDebit && advice?.problems?.length === 0, `${advice?.debitAccountNo} vs ${expectedDebit} ${JSON.stringify(advice?.problems)}`);
  const auditBuilt = await q(`select summary, is_sensitive from audit_logs where entity_table = 'bank_advices' and entity_id = $1`, [adviceId]);
  check("an audit row, sensitive", auditBuilt.length === 1 && auditBuilt[0].is_sensitive, auditBuilt[0]?.summary);

  /* ------------------------------------------------------------------ */
  console.log("\nB. Not ready until it is");
  const refused = await call("GET", `/bank-advices/${adviceId}/csv`);
  check("the CSV is refused while a payment is missing its bank, naming who", refused.status === 400 && refused.body?.message?.includes(`${MARK} Nobank`), refused.body?.message);
  const fix = (patch) => call("PATCH", `/bank-advices/${adviceId}/lines/${nobank.id}`, { paymentType: "PAY", beneficiaryName: `${MARK} Nobank`, bankCode: "240100436", accountNo: "2001-234 5678.9", paymentDetails: "Salary July 2031", amount: netOf[nobankId], email: null, ...patch });
  const bt = await fix({ paymentType: "BT" });
  check("BT to another bank is flagged — BT is SCB to SCB", bt.body?.lines?.find((l) => l.id === nobank.id)?.problems.some((p) => /BT is SCB to SCB/.test(p)));
  const ach = await call("PATCH", `/bank-advices/${adviceId}/lines/${scb.id}`, { ...scb, paymentType: "ACH" });
  check("ACH to an SCB account is flagged", ach.body?.lines?.find((l) => l.id === scb.id)?.problems.some((p) => /ACH is for another bank/.test(p)));
  await call("PATCH", `/bank-advices/${adviceId}/lines/${scb.id}`, { ...scb, paymentType: "PAY" });
  const fixed = await fix({});
  const fixedLine = fixed.body?.lines?.find((l) => l.id === nobank.id);
  check("filling it in: the routing gets its zeros, the account its digits, no problems left", fixedLine?.bankCode === "00240100436" && fixedLine?.accountNo === "200123456789" && fixedLine?.problems.length === 0, JSON.stringify(fixedLine));

  /* ------------------------------------------------------------------ */
  console.log("\nC. The files");
  const csvRes = await call("GET", `/bank-advices/${adviceId}/csv`, undefined, true);
  const csvBuf = Buffer.from(await csvRes.arrayBuffer());
  const csv = csvBuf.toString("utf8");
  const rows = csv.split("\r\n").filter((r, i, all) => !(i === all.length - 1 && r === ""));
  const cells = rows.map((r) => r.split(","));
  check("the CSV answers 200, as a file named for the advice", csvRes.status === 200 && /attachment/.test(csvRes.headers.get("content-disposition") ?? "") && /\.csv/.test(csvRes.headers.get("content-disposition") ?? ""), csvRes.headers.get("content-disposition"));
  check("no byte-order mark, CRLF line ends", csvBuf[0] !== 0xef && csv.includes("\r\n") && !/[^\r]\n/.test(csv));
  check("H row, three P rows, T row — no column names", rows.length === 5 && rows[0].startsWith("H,P,") && rows[4].startsWith("T,") && !csv.includes("Record Type"), `${rows.length} rows`);
  check("44 fields on every row, as Excel writes the bank's sheet", cells.every((c) => c.length === 44), cells.map((c) => c.length).join(","));
  const pScb = cells.find((c) => c[10] === "SCB HOLDER NAME");
  const netWhole = (net) => (net.endsWith(".00") ? net.slice(0, -3) : net.replace(/0$/, ""));
  check(
    "a P row has the bank's columns: B type, C ON, G BD, H DHK, I debit, J DD/MM/YYYY, K name, P code, T account, U details, AL BDT, AM amount, AR email",
    pScb && pScb[0] === "P" && pScb[1] === "PAY" && pScb[2] === "ON" && pScb[6] === "BD" && pScb[7] === "DHK" && pScb[8] === expectedDebit && pScb[9] === "31/07/2031" && pScb[15] === SCB && pScb[19] === "01702374701" && pScb[20] === "Salary July 2031" && pScb[37] === "BDT" && pScb[38] === netWhole(netOf[scbId]) && pScb[43] === "scb.person@example.test",
    JSON.stringify(pScb?.filter(Boolean)),
  );
  check("every other column empty", pScb && pScb.every((v, i) => [0, 1, 2, 6, 7, 8, 9, 10, 15, 19, 20, 37, 38, 43].includes(i) || v === ""));
  const stamped = (await q(`select downloaded_at is not null as stamped, downloaded_by::text as by from bank_advices where id = $1`, [adviceId]))[0];
  check("downloading stamps it, with who", stamped?.stamped === true && stamped?.by === users.super_admin.id);

  const xlsxRes = await call("GET", `/bank-advices/${adviceId}/xlsx`, undefined, true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await xlsxRes.arrayBuffer()));
  const sheet = workbook.worksheets[0];
  const head = sheet.getRow(1).values.slice(1);
  const xScb = [...Array(sheet.rowCount).keys()].map((i) => sheet.getRow(i + 1)).find((r) => r.getCell(11).value === "SCB HOLDER NAME");
  check("the workbook: the bank's 44 column names in row 1, H in row 2, T last", xlsxRes.status === 200 && head.length === 44 && head[0] === "Record Type" && head[43] === "Beneficiary Email ID" && sheet.getRow(2).getCell(1).value === "H" && sheet.getRow(sheet.rowCount).getCell(1).value === "T", `${head.length} columns, ${sheet.rowCount} rows`);
  check("account numbers kept as text with their zeros, the amount a number", xScb?.getCell(9).value === expectedDebit && xScb?.getCell(20).value === "01702374701" && typeof xScb?.getCell(39).value === "number", JSON.stringify([xScb?.getCell(9).value, xScb?.getCell(20).value, xScb?.getCell(39).value]));

  /* ------------------------------------------------------------------ */
  console.log("\nD. Add, change, remove");
  const added = await call("POST", `/bank-advices/${adviceId}/lines`, { paymentType: "ACH", beneficiaryName: "Supplier Ltd", bankCode: "240100436", accountNo: "123456789012", paymentDetails: "Supplier Payment", amount: "1234.50", email: null });
  const supplier = added.body?.lines?.find((l) => l.beneficiaryName === "Supplier Ltd");
  check("a payment added by hand, last in order", added.status === 201 && supplier?.position === 4 && supplier?.problems.length === 0, `HTTP ${added.status} ${msgOf(added)}`);
  const csv2 = await (await call("GET", `/bank-advices/${adviceId}/csv`, undefined, true)).text();
  check("…and in the file with 1234.5, as Excel writes 1234.50", csv2.split("\r\n").some((r) => r.split(",")[10] === "Supplier Ltd" && r.split(",")[38] === "1234.5" && r.split(",")[1] === "ACH"));
  const bad = await call("POST", `/bank-advices/${adviceId}/lines`, { paymentType: "PAY", beneficiaryName: "X", bankCode: "", accountNo: "", paymentDetails: "", amount: "12.345", email: null });
  check("an amount past two decimals is refused", bad.status === 400, `HTTP ${bad.status}`);
  const removed = await call("DELETE", `/bank-advices/${adviceId}/lines/${supplier.id}`);
  check("a payment taken off", removed.status === 200 && removed.body?.lines?.length === 3);
  const details = await call("PATCH", `/bank-advices/${adviceId}`, { title: `${MARK} Salary July 2031 (fixed)`, accountId: account.id, debitCityCode: "ctg", valueDate: "2031-08-01", note: "Checked" });
  check("the advice's details change — name, city (upper-cased), date", details.status === 200 && details.body?.debitCityCode === "CTG" && details.body?.valueDate === "2031-08-01" && details.body?.title.endsWith("(fixed)"), `${details.body?.debitCityCode} ${details.body?.valueDate}`);
  const csv3 = await (await call("GET", `/bank-advices/${adviceId}/csv`, undefined, true)).text();
  check("…and the file follows: CTG, 01/08/2031", csv3.split("\r\n")[1].split(",")[7] === "CTG" && csv3.split("\r\n")[1].split(",")[9] === "01/08/2031");
  await call("PATCH", `/bank-advices/${adviceId}`, { title: `${MARK} Salary July 2031`, accountId: account.id, debitCityCode: "DHK", valueDate: "2031-07-31", note: null });

  /* ------------------------------------------------------------------ */
  console.log("\nE. Who");
  for (const [role, reads, builds] of [["cfo", true, true], ["ceo", true, false], ["hr", true, false]]) {
    if (!users[role]) continue;
    const as = caller(users[role]);
    const r = await as("GET", `/bank-advices/${adviceId}`);
    const b = await as("POST", "/bank-advices/from-payroll", {});
    const c = await as("GET", `/bank-advices/${adviceId}/csv`);
    check(
      `${role}: ${reads ? "reads" : "cannot read"}; ${builds ? "builds and downloads" : "cannot build or download (403)"}`,
      (reads ? r.status === 200 : r.status === 403) && (builds ? b.status === 400 && c.status === 200 : b.status === 403 && c.status === 403),
      `${r.status}/${b.status}/${c.status}`,
    );
  }

  /* ------------------------------------------------------------------ */
  console.log("\nF. The trash");
  const binned = await call("POST", `/trash/bank-advice/${adviceId}`, { reason: "harness" });
  const listed = await call("GET", `/bank-advices?q=${encodeURIComponent(MARK)}`);
  const summary = await call("GET", "/trash/summary");
  const kind = (Array.isArray(summary.body) ? summary.body : []).find((k) => k.kind === "bank-advice");
  check("into the trash, off the list; the trash knows the kind", (binned.status === 201 || binned.status === 200) && listed.body?.items?.length === 0 && Boolean(kind) && kind.count >= 1, JSON.stringify(kind));
  const restored = await call("POST", `/trash/bank-advice/${adviceId}/restore`);
  const back = await call("GET", `/bank-advices/${adviceId}`);
  check("and back, with its payments", (restored.status === 201 || restored.status === 200) && back.body?.lines?.length === 3, `HTTP ${restored.status}`);

  /* ------------------------------------------------------------------ */
  console.log("\nG. In the browser");
  // A fresh sheet-built advice through the drawer.
  await q(`delete from bank_advices where id = $1`, [adviceId]);
  await q(`delete from audit_logs where entity_table = 'bank_advices' and entity_id = $1`, [adviceId]);
  adviceId = null;

  const { page, context } = await open(users.super_admin, "/payroll");
  const rail = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const texts = [...aside.querySelectorAll("a, button")].map((el) => el.textContent.trim());
    return {
      parent: texts.includes("Payroll & Bank"),
      team: texts.indexOf("Team") >= 0 && texts.indexOf("Team") < texts.indexOf("Payroll & Bank"),
      kids: [...aside.querySelectorAll("a")].filter((a) => ["/payroll", "/payroll/bank-advice"].includes(a.getAttribute("href"))).map((a) => `${a.getAttribute("href")}=${a.textContent.trim()}${a.getAttribute("aria-current") ? "*" : ""}`),
    };
  });
  check("the rail: People → Team, then Payroll & Bank → Payroll (lit) / Bank Advice", rail.parent && rail.team && rail.kids.includes("/payroll=Payroll*") && rail.kids.includes("/payroll/bank-advice=Bank Advice"), JSON.stringify(rail));
  const tabs = await page.evaluate(() => [...document.querySelectorAll("[data-payroll-tabs] a")].map((a) => `${a.textContent.trim()}${a.getAttribute("aria-current") ? "*" : ""}`));
  check("Payroll carries the two tabs, Payroll lit", tabs.join("|") === "Payroll*|Bank Advice", tabs.join("|"));
  await page.evaluate(() => [...document.querySelectorAll("[data-payroll-tabs] a")].find((a) => a.textContent.includes("Bank Advice")).click());
  await page.waitForFunction(() => location.pathname === "/payroll/bank-advice", { timeout: 20000 }).catch(() => {});
  await settle(1200);
  const tabs2 = await page.evaluate(() => [...document.querySelectorAll("[data-payroll-tabs] a")].map((a) => `${a.textContent.trim()}${a.getAttribute("aria-current") ? "*" : ""}`));
  check("the Bank Advice tab opens its page, lit there", tabs2.join("|") === "Payroll|Bank Advice*", tabs2.join("|"));

  await page.click("[data-advice-build]");
  await page.waitForSelector("[data-advice-field='run']", { timeout: 10000 });
  await page.select("[data-advice-field='run']", RUN);
  await page.select("[data-advice-field='account']", account.id);
  await page.evaluate(() => {
    const el = document.querySelector("[data-advice-field='valueDate']");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "2031-07-31");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click("[data-advice-submit]");
  await page.waitForSelector("[data-advice-skipped]", { timeout: 20000 }).catch(() => {});
  const skippedText = await page.evaluate(() => document.querySelector("[data-advice-skipped]")?.textContent ?? "");
  check("New from payroll says who was left out, and why", skippedText.includes(`${MARK} Wallet`) && skippedText.includes("bKash"), skippedText.slice(0, 120));
  await page.click("[data-advice-open]");
  await page.waitForFunction(() => /\/payroll\/bank-advice\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 20000 }).catch(() => {});
  await settle(1500);
  adviceId = await page.evaluate(() => location.pathname.split("/").pop());
  // The drawer names it "Salary — July 2031"; give it the mark for cleanup.
  await q(`update bank_advices set title = $2 where id = $1`, [adviceId, `${MARK} Salary — July 2031`]);
  await page.reload({ waitUntil: "networkidle0" });
  await settle(900);
  const detail = await page.evaluate(() => ({
    rows: document.querySelectorAll("tr[data-row-id]").length,
    notReady: Boolean(document.querySelector("[data-advice-not-ready]")),
    csvDisabled: document.querySelector("[data-advice-csv]")?.disabled,
    flagged: [...document.querySelectorAll("tr[data-row-id]")].filter((tr) => !tr.hasAttribute("data-line-ok")).map((tr) => tr.children[2].textContent.trim()),
  }));
  check("the advice: three payments, not ready, CSV held back, the no-bank one flagged", detail.rows === 3 && detail.notReady && detail.csvDisabled === true && detail.flagged.length === 1 && detail.flagged[0].startsWith(`${MARK} Nobank`), JSON.stringify(detail));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "advice-not-ready.png"), fullPage: true });

  // Fix the flagged row in its drawer.
  await page.evaluate(() => [...document.querySelectorAll("tr[data-row-id]")].find((tr) => !tr.hasAttribute("data-line-ok")).children[2].click());
  await page.waitForSelector("[data-line-field='bank']", { timeout: 10000 });
  await page.select("[data-line-field='bank']", "other");
  await settle(150);
  await typeInto(page, "[data-line-field='routing']", "240100436");
  await typeInto(page, "[data-line-field='account']", "2001 2345 6789");
  await page.click("[data-advice-submit]");
  await page.waitForSelector("[data-advice-ready]", { timeout: 20000 }).catch(() => {});
  const readyNow = await page.evaluate(() => ({
    ready: Boolean(document.querySelector("[data-advice-ready]")),
    csvDisabled: document.querySelector("[data-advice-csv]")?.disabled,
    allOk: [...document.querySelectorAll("tr[data-row-id]")].every((tr) => tr.hasAttribute("data-line-ok")),
  }));
  check("fixed in its drawer: every row ready, the CSV free", readyNow.ready && readyNow.csvDisabled === false && readyNow.allOk, JSON.stringify(readyNow));

  const csvSeen = new Promise((resolve) => {
    page.on("response", async (r) => {
      if (r.url().includes(`/bank-advices/${adviceId}/csv`)) resolve({ status: r.status(), body: await r.text().catch(() => "") });
    });
  });
  const client = await page.createCDPSession();
  await client.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  await page.click("[data-advice-csv]");
  const got = await Promise.race([csvSeen, settle(15000).then(() => null)]);
  await settle(1500);
  const stampedText = await page.evaluate(() => document.querySelector("[data-advice-ready]")?.textContent ?? "");
  // The body of a fetch the page turned into a blob is not always readable
  // from here; what the file holds is proved in C, through the same route.
  check("Download CSV fetches the file, and the page then says it was downloaded", got?.status === 200 && (got.body === "" || got.body.startsWith("H,P,")) && /Downloaded/.test(stampedText), `${got?.status} ${stampedText.slice(0, 80)}`);

  // Add a payment, then take it off.
  await page.click("[data-advice-add-line]");
  await page.waitForSelector("[data-line-field='name']", { timeout: 10000 });
  await page.type("[data-line-field='name']", "Rent Landlord");
  await page.select("[data-line-field='bank']", "scb");
  await page.type("[data-line-field='account']", "01122334401");
  await page.type("[data-line-field='amount']", "25000");
  await page.select("[data-line-field='type']", "BT");
  await page.type("[data-line-field='details']", "Rent");
  await page.click("[data-advice-submit]");
  await settle(2000);
  const four = await page.$$eval("tr[data-row-id]", (trs) => trs.map((tr) => tr.children[2].textContent.trim()));
  check("Add payment puts a fourth row in", four.length === 4 && four.some((t) => t.startsWith("Rent Landlord")), four.join(" | "));
  const rentId = await page.evaluate(() => [...document.querySelectorAll("tr[data-row-id]")].find((tr) => tr.children[2].textContent.includes("Rent Landlord"))?.getAttribute("data-row-id"));
  await page.click(`tr[data-row-id='${rentId}'] button[aria-label='Delete']`);
  await settle(400);
  await page.click("[role='dialog'] input[type='checkbox']");
  await page.type("[role='dialog'] input.font-mono", "delete");
  await page.evaluate(() => [...document.querySelectorAll("[role='dialog'] button")].find((b) => /Yes, delete/.test(b.textContent))?.click());
  await page.waitForFunction((id) => !document.querySelector(`tr[data-row-id='${id}']`), { timeout: 15000 }, rentId).catch(() => {});
  const three = await page.$$eval("tr[data-row-id]", (trs) => trs.length);
  check("…and Delete takes it off again", three === 3, String(three));
  const wide = await page.evaluate(() => {
    const box = document.querySelector("tr[data-row-id]")?.closest(".overflow-x-auto");
    return document.documentElement.scrollWidth <= window.innerWidth && Boolean(box) && box.scrollWidth <= box.clientWidth;
  });
  check("nothing scrolls sideways at 1440 — the page or the payments table", wide);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "advice-ready.png"), fullPage: true });

  // The list: a row click opens it; status says Downloaded.
  await page.goto(`${WEB}/payroll/bank-advice`, { waitUntil: "networkidle0" });
  await settle(900);
  const listRow = await page.evaluate((id) => [...(document.querySelector(`tr[data-row-id='${id}']`)?.children ?? [])].map((td) => td.textContent.trim()), adviceId);
  check("the list: name, sheet, account, date, 3 payments, Downloaded", listRow.length > 0 && listRow[1].startsWith(MARK) && listRow[2] === "July 2031" && listRow[4] === "31/07/2031" && listRow[5] === "3" && listRow[7].startsWith("Downloaded"), JSON.stringify(listRow));
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "advice-list.png") });
  const fitsList = await page.evaluate((id) => {
    const tr = document.querySelector(`tr[data-row-id='${id}']`);
    const box = tr?.closest(".overflow-x-auto");
    const bin = tr?.querySelector("button[aria-label='Move to trash']");
    return Boolean(box && bin) && box.scrollWidth <= box.clientWidth && bin.getBoundingClientRect().right <= box.getBoundingClientRect().right;
  }, adviceId);
  check("at 1440 the list's table fits, the row's buttons in view", fitsList);
  await page.click(`tr[data-row-id='${adviceId}'] td:nth-child(2)`);
  await page.waitForFunction((id) => location.pathname.endsWith(id), { timeout: 15000 }, adviceId).catch(() => {});
  check("a click on a row opens the advice", await page.evaluate((id) => location.pathname.endsWith(id), adviceId));
  await context.close();

  // HR reads, does not build.
  if (users.hr) {
    const hr = await open(users.hr, `/payroll/bank-advice/${adviceId}`);
    const view = await hr.page.evaluate(() => ({
      csv: Boolean(document.querySelector("[data-advice-csv]")),
      add: Boolean(document.querySelector("[data-advice-add-line]")),
      build: Boolean(document.querySelector("[data-advice-build]")),
      rows: document.querySelectorAll("tr[data-row-id]").length,
    }));
    await hr.page.click("tr[data-row-id] td:nth-child(3)");
    await settle(700);
    const popup = await hr.page.evaluate(() => document.querySelector("[data-popup] h2")?.textContent ?? "");
    check("HR sees the payments, no Download or Add; a row click shows it read-only", view.rows === 3 && !view.csv && !view.add && /^Payment to /.test(popup), JSON.stringify({ ...view, popup }));
    await hr.context.close();
  }

  // The bin, from the list.
  const bin = await open(users.super_admin, "/payroll/bank-advice");
  await bin.page.click(`tr[data-row-id='${adviceId}'] button[aria-label='Move to trash']`);
  await settle(400);
  await bin.page.click("[role='dialog'] input[type='checkbox']");
  await bin.page.type("[role='dialog'] input.font-mono", "trash");
  await bin.page.evaluate(() => [...document.querySelectorAll("[role='dialog'] button")].find((b) => /Yes, trash this bank advice/.test(b.textContent))?.click());
  await bin.page.waitForFunction((id) => !document.querySelector(`tr[data-row-id='${id}']`), { timeout: 15000 }, adviceId).catch(() => {});
  const gone = (await q(`select deleted_at is not null as gone from bank_advices where id = $1`, [adviceId]))[0];
  check("Move to trash on the list", gone?.gone === true);
  await bin.context.close();

  for (const url of ["/payroll/bank-advice", "/payroll"]) {
    const phone = await open(users.super_admin, url, 390);
    const fits = await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    check(`${url} at 390px: nothing scrolls sideways`, fits);
    await phone.context.close();
  }

  console.log("");
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await wipe();
  const left = await q(`select (select count(*) from bank_advices where title like $1)::int a, (select count(*) from team_members where full_name like $2)::int m, (select count(*) from payroll_runs where notes = $3)::int r`, [`%${MARK}%`, `${MARK} %`, MARK]);
  check("cleaned up — no advice, person or sheet left behind", left[0].a === 0 && left[0].m === 0 && left[0].r === 0, JSON.stringify(left[0]));
  await db.end();
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
