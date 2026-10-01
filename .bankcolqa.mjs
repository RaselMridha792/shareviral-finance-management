/**
 * #123 — the bank's instructions, column by column, against the files.
 *
 * "Preparing Excel File.pdf" (Standard Chartered, S2B) gives a rule for each
 * yellow column and for the rows around them. Each rule below is checked on
 * the CSV's own bytes and on the Excel's own cells — not on the page, and not
 * on Google Sheets, which reads 0001702374701 as the figure 1702374701.
 *
 *   rows   H first (H, P), a P row per payment, T last; no column names
 *          (row 1 deleted); CSV (Comma delimited): CRLF, no BOM, plain ASCII
 *   B      ACH / RTGS / BT / PAY
 *   C G H  ON, BD, DHK on every P row, as the bank's filled example has them
 *   I      the debit account, two zeros first: 01122334401 → 0001122334401 —
 *          whether picked from Accounts, TYPED without the zeros (the #123
 *          fault), or saved that way before the fix
 *   J      DD/MM/YYYY, today or later
 *   K      the beneficiary's name
 *   P      SCBLBDDXXXX for SCB, else 00 + the routing number as typed, of
 *          any length (#129: 857376 → 00857376), and never twice
 *   T      digits only
 *   U      the payment details
 *   AL AM  BDT, and the amount as a number
 *   AR     the email, or nothing
 *   rest   empty
 *   xlsx   I, J, P, T are text cells with Excel's apostrophe, zeros kept;
 *          AM is a number
 *   guard  a debit account that is not 00 + 11 digits stops the file
 *
 *     node .bankcolqa.mjs      (needs `npm run dev`: web :3000, api :4001)
 */
import fs from "node:fs";
import JSZip from "jszip";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const WEB = "http://localhost:3000";
const API = "http://localhost:4001/api";
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
const [admin] = await q(`select id, role, token_version from users where role = 'super_admin' and status = 'active' and deleted_at is null order by created_at limit 1`);
const token = jwt.sign({ sub: admin.id, role: admin.role, tv: admin.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: "1h" });
const call = async (method, p, body, raw = false) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "X-Requested-With": "finance-web", "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return res;
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail) => {
  results.push(pass);
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const MARK = `BCOL${Date.now().toString(36).toUpperCase()}`;
const SCB = "SCBLBDDXXXX";
/* An SCB account on file, the way the Accounts screen holds one. */
const [account] = await q(`select id, account_number from accounts where deleted_at is null and account_number ~ '^0[0-9]{10}$' limit 1`);
if (!account) {
  console.log("No account with an 11-digit SCB-shaped number here to pay from.");
  process.exit(1);
}
const ELEVEN = account.account_number;
const THIRTEEN = `00${ELEVEN}`;

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
const [ty, tm, td] = today.split("-");
const bankToday = `${td}/${tm}/${ty}`;

/* The payments: one per payment type, the codes typed the ways people type. */
const LINES = [
  { paymentType: "PAY", beneficiaryName: `${MARK} Amir Faysal`, bankCode: "scblbddxxxx", accountNo: "18-2516827-01", paymentDetails: "Salary September 2026", amount: "25000", email: "amir@example.com" },
  { paymentType: "ACH", beneficiaryName: `${MARK} Yeasin Hossain`, bankCode: "070270602", accountNo: "1083451057575", paymentDetails: "Salary September 2026", amount: "12500.50", email: "" },
  { paymentType: "RTGS", beneficiaryName: `${MARK} Sagar Biswas`, bankCode: "00120157154", accountNo: "2102 8879 9851", paymentDetails: "Supplier Payment", amount: "600000", email: "" },
  { paymentType: "BT", beneficiaryName: `${MARK} Rasel Mridha`, bankCode: SCB, accountNo: "54869542568", paymentDetails: "Rent", amount: "10", email: "" },
  /* #129: a routing number that is not nine digits, as a record holds it —
     and the same one typed with the file's zeros already on. */
  { paymentType: "ACH", beneficiaryName: `${MARK} Alamin Zaman`, bankCode: "857376", accountNo: "412894150", paymentDetails: "Salary October 2026", amount: "59584", email: "" },
  { paymentType: "ACH", beneficiaryName: `${MARK} Typed Zeros`, bankCode: "00857376", accountNo: "412894151", paymentDetails: "Salary October 2026", amount: "100", email: "" },
];
const WANT = [
  { B: "PAY", P: SCB, T: "18251682701", AM: "25000", AR: "amir@example.com" },
  { B: "ACH", P: "00070270602", T: "1083451057575", AM: "12500.5", AR: "" },
  { B: "RTGS", P: "00120157154", T: "210288799851", AM: "600000", AR: "" },
  { B: "BT", P: SCB, T: "54869542568", AM: "10", AR: "" },
  { B: "ACH", P: "00857376", T: "412894150", AM: "59584", AR: "" },
  { B: "ACH", P: "00857376", T: "412894151", AM: "100", AR: "" },
];
const N = LINES.length;

/* Column letters → index. */
const idx = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const COLS = { A: idx("A"), B: idx("B"), C: idx("C"), G: idx("G"), H: idx("H"), I: idx("I"), J: idx("J"), K: idx("K"), P: idx("P"), T: idx("T"), U: idx("U"), AL: idx("AL"), AM: idx("AM"), AR: idx("AR") };
const FILLED = new Set(Object.values(COLS));

let adviceId = null;
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  /* ------------------------------------------------------------------ */
  console.log("\nColumn I — typed without its zeros");
  const created = await call("POST", "/bank-advices", { title: `${MARK} Columns`, accountId: account.id, debitAccountNo: ELEVEN, debitCityCode: "DHK", valueDate: today });
  adviceId = created.body?.id;
  const [stored] = await q(`select debit_account_no from bank_advices where id = $1`, [adviceId]);
  check(`typed ${ELEVEN} is kept as ${THIRTEEN}`, created.status === 201 && stored?.debit_account_no === THIRTEEN, `${created.status} ${stored?.debit_account_no}`);

  for (const line of LINES) {
    const added = await call("POST", `/bank-advices/${adviceId}/lines`, line);
    if (added.status >= 300) console.log("   line refused:", added.status, JSON.stringify(added.body));
  }
  const advice = (await call("GET", `/bank-advices/${adviceId}`)).body;
  check(`${N} payments, nothing flagged — a routing number of six digits included`, advice?.lines?.length === N && advice.problems.length === 0 && advice.lines.every((l) => l.problems.length === 0), JSON.stringify([advice?.problems, advice?.lines?.map((l) => l.problems)]));
  const [sixDigit] = await q(`select bank_code from bank_advice_lines where bank_advice_id = $1 and beneficiary_name = $2`, [adviceId, `${MARK} Alamin Zaman`]);
  const shortLine = advice?.lines?.find((l) => l.beneficiaryName === `${MARK} Alamin Zaman`);
  check("857376 is stored as typed and read with the file's zeros, 00857376", sixDigit?.bank_code === "857376" && shortLine?.bankCode === "00857376", `${sixDigit?.bank_code} ${shortLine?.bankCode}`);

  /* ------------------------------------------------------------------ */
  console.log("\nThe CSV, read as bytes");
  const res = await call("GET", `/bank-advices/${adviceId}/csv`, undefined, true);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("latin1");
  check("200, a .csv file", res.status === 200 && /\.csv/.test(res.headers.get("content-disposition") ?? ""), `${res.status}`);
  check("CSV (Comma delimited): no BOM, CRLF only, plain ASCII", buf[0] !== 0xef && /\r\n/.test(text) && !/[^\r]\n/.test(text) && [...buf].every((b) => b === 13 || b === 10 || (b >= 32 && b <= 126)));
  const rows = text.split("\r\n");
  if (rows.at(-1) === "") rows.pop();
  const cells = rows.map((r) => r.split(","));
  check("row 1 deleted: H first, then a P row per payment, T last", rows.length === N + 2 && cells[0][0] === "H" && cells[0][1] === "P" && cells.slice(1, N + 1).every((c) => c[0] === "P") && cells[N + 1][0] === "T" && !text.includes("Record Type"), `${rows.length} rows`);
  check("44 fields on every row, as Excel saves A to AR", cells.every((c) => c.length === 44), cells.map((c) => c.length).join(","));
  check("the H and T rows: nothing past their own letters", cells[0].slice(2).every((v) => v === "") && cells[N + 1].slice(1).every((v) => v === ""));

  const payRows = cells.slice(1, N + 1);
  payRows.forEach((c, n) => {
    const want = WANT[n];
    const who = LINES[n].beneficiaryName;
    const got = Object.fromEntries(Object.entries(COLS).map(([k, i]) => [k, c[i]]));
    console.log(`   ${want.B.padEnd(4)} I=${got.I} J=${got.J} P=${got.P} T=${got.T} AM=${got.AM}`);
    check(`${want.B}: B ${want.B}; C ON, G BD, H DHK`, got.B === want.B && got.C === "ON" && got.G === "BD" && got.H === "DHK");
    check(`${want.B}: I is the debit account with two zeros first (${THIRTEEN})`, got.I === THIRTEEN && /^00\d{11}$/.test(got.I), got.I);
    check(`${want.B}: J is DD/MM/YYYY, today (${bankToday})`, got.J === bankToday && /^\d{2}\/\d{2}\/\d{4}$/.test(got.J), got.J);
    check(`${want.B}: K is the name`, got.K === who, got.K);
    check(`${want.B}: P is ${want.P === SCB ? "SCBLBDDXXXX" : `00 + the routing number (${want.P})`}`, got.P === want.P && (got.P === SCB || /^00\d+$/.test(got.P)), got.P);
    check(`${want.B}: T is digits only`, got.T === want.T && /^\d+$/.test(got.T), got.T);
    check(`${want.B}: U, AL, AM, AR`, got.U === LINES[n].paymentDetails && got.AL === "BDT" && got.AM === want.AM && got.AR === want.AR, `${got.U} ${got.AL} ${got.AM} ${got.AR}`);
    check(`${want.B}: every other column empty`, c.every((v, i) => FILLED.has(i) || v === ""), c.map((v, i) => (!FILLED.has(i) && v !== "" ? i : null)).filter((i) => i !== null).join(","));
  });

  /* ------------------------------------------------------------------ */
  console.log("\nThe Excel, read as cells");
  const xres = await call("GET", `/bank-advices/${adviceId}/xlsx`, undefined, true);
  const zip = await JSZip.loadAsync(Buffer.from(await xres.arrayBuffer()));
  const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const shared = [...(await zip.file("xl/sharedStrings.xml").async("string")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
  const styles = await zip.file("xl/styles.xml").async("string");
  const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf [^>]*?(\/>|>[\s\S]*?<\/xf>)/g);
  const cell = (ref) => {
    const m = sheet.match(new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`));
    if (!m) return null;
    const type = m[1].match(/ t="(\w+)"/)?.[1] ?? null;
    const style = Number(m[1].match(/ s="(\d+)"/)?.[1]);
    const v = m[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
    return { type, value: type === "s" ? shared[Number(v)] : v, quoted: /quotePrefix="1"/.test(xfs[style] ?? "") };
  };
  check("row 1 keeps the bank's column names; row 2 is H", cell("A1")?.value === "Record Type" && cell("A2")?.value === "H" && cell("B2")?.value === "P");
  for (let r = 3; r <= N + 2; r++) {
    const want = WANT[r - 3];
    const I = cell(`I${r}`), J = cell(`J${r}`), P = cell(`P${r}`), T = cell(`T${r}`), AM = cell(`AM${r}`);
    check(
      `row ${r} (${want.B}): I, J, P, T are text with the apostrophe, zeros kept; AM a number`,
      I?.type === "s" && I.quoted && I.value === THIRTEEN &&
        J?.type === "s" && J.quoted && J.value === bankToday &&
        P?.type === "s" && P.quoted && P.value === want.P &&
        T?.type === "s" && T.quoted && T.value === want.T &&
        AM?.type === null && AM.value === want.AM,
      JSON.stringify({ I, P, T, AM }),
    );
  }
  check(`row ${N + 3} is T`, cell(`A${N + 3}`)?.value === "T");

  /* ------------------------------------------------------------------ */
  console.log("\nSaved before the fix");
  await q(`update bank_advices set debit_account_no = $1 where id = $2`, [ELEVEN, adviceId]);
  const old = (await call("GET", `/bank-advices/${adviceId}`)).body;
  const oldCsv = await (await call("GET", `/bank-advices/${adviceId}/csv`, undefined, true)).text();
  const listed = (await call("GET", `/bank-advices?q=${encodeURIComponent(MARK)}`)).body?.items?.[0];
  check("an advice stored without the zeros is read, listed and written with them", old?.debitAccountNo === THIRTEEN && oldCsv.split("\r\n")[1].split(",")[COLS.I] === THIRTEEN && listed?.debitAccountNo === THIRTEEN, `${old?.debitAccountNo} ${listed?.debitAccountNo}`);

  /* ------------------------------------------------------------------ */
  console.log("\nThe guard on column I");
  const short = ELEVEN.slice(1);
  const bad = await call("PATCH", `/bank-advices/${adviceId}`, { title: `${MARK} Columns`, accountId: account.id, debitAccountNo: short, debitCityCode: "DHK", valueDate: today });
  const flagged = (await call("GET", `/bank-advices/${adviceId}`)).body;
  const refused = await call("GET", `/bank-advices/${adviceId}/csv`);
  check(
    `a 10-digit number (${short}, a zero lost) is flagged, and the file is refused`,
    bad.status === 200 && flagged?.debitAccountNo === `00${short}` && flagged.problems.some((p) => p.includes("11-digit")) && refused.status === 400 && /11-digit/.test(refused.body?.message ?? ""),
    `${bad.status} ${flagged?.debitAccountNo} ${refused.status} ${refused.body?.message}`,
  );
  const back = await call("PATCH", `/bank-advices/${adviceId}`, { title: `${MARK} Columns`, accountId: account.id, debitAccountNo: THIRTEEN, debitCityCode: "DHK", valueDate: today });
  const fine = (await call("GET", `/bank-advices/${adviceId}`)).body;
  check("typed with its zeros, it is kept as it is and the file is free again", back.status === 200 && fine?.debitAccountNo === THIRTEEN && fine.problems.length === 0, `${fine?.debitAccountNo}`);

  /* ------------------------------------------------------------------ */
  console.log("\nThe page");
  const context = await browser.createBrowserContext();
  await context.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
  const page = await context.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  await page.goto(`${WEB}/payroll/bank-advice/${adviceId}`, { waitUntil: "networkidle0", timeout: 120000 });
  await page.waitForSelector("[data-advice-files]", { timeout: 20000 });
  const note = await page.evaluate(() => document.querySelector("[data-advice-files]").textContent);
  check("the note names Google Sheets and Excel, and says which file shows the zeros", /Google Sheets or Excel/.test(note) && /Open\s+this one to check the file/.test(note), note.slice(0, 120));
  const shown = await page.evaluate((n) => document.body.textContent.includes(n), THIRTEEN);
  check("the page shows the debit account as the file writes it", shown);

  /* #129: the six-digit routing number, on the page and in its drawer. */
  const row = await page.evaluate((name) => {
    const tr = [...document.querySelectorAll("tr[data-row-id]")].find((r) => r.textContent.includes(name));
    return tr ? { ok: tr.hasAttribute("data-line-ok"), text: tr.textContent } : null;
  }, `${MARK} Alamin Zaman`);
  check("its row is ready and shows 00857376", row?.ok === true && row.text.includes("00857376"), row?.text.slice(0, 160));
  await page.evaluate((name) => [...document.querySelectorAll("tr[data-row-id]")].find((r) => r.textContent.includes(name)).children[2].click(), `${MARK} Alamin Zaman`);
  await page.waitForSelector("[data-line-field='routing']", { timeout: 10000 });
  const drawer = await page.evaluate(() => {
    const input = document.querySelector("[data-line-field='routing']");
    return {
      value: input.value,
      hint: input.closest("label, div").parentElement.textContent,
      problems: Boolean(document.querySelector("[data-line-problems]")),
    };
  });
  check("its drawer: the routing number as typed, 857376; the file writes 00857376; no warning", drawer.value === "857376" && drawer.hint.includes("The file writes 00857376") && !drawer.hint.includes("Nine digits") && !drawer.problems, JSON.stringify(drawer));
  await page.keyboard.press("Escape");
  await page.click("[data-advice-edit]");
  await page.waitForSelector("[data-advice-field='debit']", { timeout: 10000 });
  const box = await page.$("[data-advice-field='debit']");
  await box.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await box.type(ELEVEN);
  const hint = await page.evaluate(() => document.querySelector("[data-advice-field='debit']").closest("label, div").parentElement.textContent);
  check(`typing ${ELEVEN} on the form says the file will hold ${THIRTEEN}`, hint.includes(`In the file: ${THIRTEEN}`), hint.slice(0, 140));
  check("no page errors, no 5xx", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
} finally {
  const ids = (await q(`select id from bank_advices where title like $1`, [`${MARK}%`])).map((r) => r.id);
  if (ids.length) {
    await q(`delete from audit_logs where entity_id::text = any($1)`, [ids]);
    await q(`delete from bank_advices where id = any($1::uuid[])`, [ids]);
  }
  const left = (await q(`select count(*)::int n from bank_advices where title like $1`, [`${MARK}%`]))[0].n;
  check("cleaned up", left === 0);
  await db.end();
  await browser.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
