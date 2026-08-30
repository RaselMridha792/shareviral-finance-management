/**
 * $14,000 in, $14,000 shown — whatever the rate does afterwards.
 *
 * The owner's report: they put $14,000 into a dollar account and the card read
 * $13,969, then $13,485. Nothing had moved; the card was dividing the taka
 * balance by TODAY's governing rate, while the money had gone in at the rate
 * of its own day. The dollars each row already carried were never read.
 *
 * So the fixture is the complaint, exactly: money in at one rate, read back
 * under another, and then $7,000 taken out — the subtraction the owner did.
 *
 *     node .usdstableqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";

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
const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const person = (
  await db.query(
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);
const call = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const IN_RATE = 118.0; // the day the money arrived
const OUT_RATE = 120.0; // the day some of it left
const wipe = async () => {
  await db.query(
    `delete from transactions where account_id in
       (select id from accounts where name like 'USQA %')`,
  );
  await db.query("delete from accounts where name like 'USQA %'");
};
await wipe();

const usd = (
  await call("POST", "/accounts", {
    name: "USQA Dollar Bank",
    type: "bank",
    currency: "USD",
    openingBalance: "0.00",
    openingBalanceUsd: "0.00",
    openingBalanceOn: "2026-06-01",
  })
).body;
const taka = (
  await call("POST", "/accounts", {
    name: "USQA Taka Bank",
    type: "bank",
    currency: "BDT",
    openingBalance: "0.00",
    openingBalanceOn: "2026-06-01",
  })
).body;
check(
  "a dollar account records its opening in its own currency",
  Boolean(usd?.id) && usd?.openingBalanceUsd === "0.00",
  `openingBalanceUsd ${JSON.stringify(usd?.openingBalanceUsd)}`,
);

/* ------------------------- $14,000 in, at 118.00 ------------------------ */

const cashIn = await call("POST", "/transactions/cash-in", {
  txnDate: "2026-06-05",
  accountId: usd.id,
  amount: (14000 * IN_RATE).toFixed(2),
  description: "USQA funding fourteen thousand dollars",
  usdSent: "14000.00",
  usdRate: IN_RATE.toFixed(2),
});
check("$14,000 arrives", cashIn.status === 201, `HTTP ${cashIn.status}`);

const read = async () => {
  const list = await call("GET", "/accounts?includeInactive=true");
  const row = (list.body ?? list.body?.items ?? []).find?.(
    (a) => a.id === usd.id,
  );
  return {
    taka: row?.balance ?? null,
    own: row?.ownBalance ?? null,
    exact: row?.ownBalanceExact ?? null,
  };
};

const afterIn = await read();
check(
  "the card reads $14,000.00 — the figure that was put in",
  Number(afterIn.own) === 14000,
  `own ${afterIn.own}, taka ${afterIn.taka}`,
);
check(
  "and says so exactly, with no approximation mark",
  afterIn.exact === true,
  `exact ${afterIn.exact}`,
);
check(
  "the taka ledger is untouched — still what actually arrived",
  Number(afterIn.taka) === 14000 * IN_RATE,
  `${afterIn.taka} vs ${(14000 * IN_RATE).toFixed(2)}`,
);

/* --------- the rate moves, and the dollars must not move with it -------- */

await db.query(
  "update app_settings set fx_fixed_usd_bdt = '122.500000'",
);
const afterRateMove = await read();
check(
  "THE BUG: the rate changes to 122.50 and the dollars stay $14,000.00",
  Number(afterRateMove.own) === 14000,
  `own ${afterRateMove.own} (the old arithmetic gave ${(
    (14000 * IN_RATE) / 122.5
  ).toFixed(2)})`,
);

/* ----------------------- $7,000 out, at a third rate -------------------- */

const out = await call("POST", "/transactions/transfer", {
  txnDate: "2026-07-10",
  fromAccountId: usd.id,
  toAccountId: taka.id,
  amount: (7000 * OUT_RATE).toFixed(2),
  description: "USQA seven thousand dollars out",
  usdAmount: "7000.00",
  usdRate: OUT_RATE.toFixed(2),
});
check("$7,000 leaves", out.status === 201, `HTTP ${out.status}`);

const afterOut = await read();
check(
  "$14,000 less $7,000 is $7,000 — the owner's own subtraction",
  Number(afterOut.own) === 7000,
  `own ${afterOut.own}`,
);
check(
  "still exact: every row carried its own dollars",
  afterOut.exact === true,
  `exact ${afterOut.exact}`,
);
check(
  "and the taka is the real taka, not 7000 x any single rate",
  Number(afterOut.taka) === 14000 * IN_RATE - 7000 * OUT_RATE,
  `${afterOut.taka} — two different rates, as it happened`,
);

/* ------------- a row with no dollars makes it approximate, not wrong ---- */

const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];
/*
 * Asserted, not fired and forgotten. The first version ignored the status,
 * the create came back 400, no row was ever written — and the check that was
 * supposed to catch an unvalued row passed because there was no row to catch.
 */
const blind = await call("POST", "/transactions", {
  direction: "out",
  txnDate: "2026-07-20",
  accountId: usd.id,
  amount: "1200.00",
  categoryId: cat.id,
  description: "USQA a row with no dollars recorded",
  paymentMethod: "card",
});
check(
  "a plain expense records on the dollar account",
  blind.status === 201,
  `HTTP ${blind.status} ${JSON.stringify(blind.body?.errors ?? blind.body?.message ?? "")}`.slice(0, 140),
);
const afterBlind = await read();
check(
  "a row with neither dollars nor a rate makes the figure approximate",
  afterBlind.exact === false,
  `exact ${afterBlind.exact}`,
);
check(
  "and it does not silently change the dollars it cannot value",
  Number(afterBlind.own) === 7000,
  `own ${afterBlind.own}`,
);

/* -------------------- a taka account is untouched by all this ----------- */

const takaRow = await (async () => {
  const list = await call("GET", "/accounts?includeInactive=true");
  return (list.body ?? []).find?.((a) => a.id === taka.id);
})();
check(
  "a BDT account's own balance is simply its taka",
  Number(takaRow?.ownBalance) === Number(takaRow?.balance) &&
    Number(takaRow?.balance) === 7000 * OUT_RATE,
  `own ${takaRow?.ownBalance}, taka ${takaRow?.balance}`,
);

/* ---------- the transfer screen speaks the account's own currency -------- */
/*
 * The owner's second complaint: the From/To picker read
 * "Exprovia LLC — Tk 17,11,220.00" for a dollar account. It is the ledger's
 * figure, not the account's, and it is the number somebody is choosing by.
 */
const puppeteer = (await import("puppeteer-core")).default;
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1100 });
await page.goto("http://localhost:3000/transfers", {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 2600));

const table = await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("USQA seven thousand"),
  );
  return {
    found: Boolean(row),
    amountCell: (row?.querySelectorAll("td")[6]?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim(),
  };
});
check(
  "the transfer row leads with the dollars that were recorded on it",
  table.found && /\$7,000\.00/.test(table.amountCell),
  table.amountCell || "row not found",
);
check(
  "and keeps the taka underneath rather than instead",
  /8,40,000|840,000/.test(table.amountCell),
  table.amountCell,
);

await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /New transfer/.test(b.textContent ?? ""))
    ?.click();
});
await new Promise((r) => setTimeout(r, 1400));
const picker = await page.evaluate(() => {
  const sel = document.querySelector('select[name="fromAccountId"]');
  return [...(sel?.options ?? [])].map((o) => o.textContent?.trim() ?? "");
});
const dollarOption = picker.find((o) => o.startsWith("USQA Dollar Bank"));
const takaOption = picker.find((o) => o.startsWith("USQA Taka Bank"));
check(
  "the picker states a dollar account in dollars, not taka",
  Boolean(dollarOption) && dollarOption.includes("$") && !dollarOption.includes("৳"),
  dollarOption ?? "not listed",
);
check(
  "and a taka account still in taka",
  Boolean(takaOption) && takaOption.includes("৳"),
  takaOption ?? "not listed",
);

await browser.close();

await db.query("update app_settings set fx_fixed_usd_bdt = '122.500000'");
await wipe();
await db.end();

const failed = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failed.length === 0
    ? `all ${results.length} checks passed`
    : `${failed.length} of ${results.length} failed:\n` +
        failed.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failed.length === 0 ? 0 : 1);
