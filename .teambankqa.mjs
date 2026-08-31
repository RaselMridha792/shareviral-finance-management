/**
 * The six bank fields a salary transfer actually needs.
 *
 * The owner listed them and three had nowhere to go:
 *
 *   Bank Name           existed
 *   Account Holder Name MISSING — and it is the one most likely to be the
 *                       reason a payment bounced: a salary often goes to an
 *                       account in a name that is not exactly the employee's,
 *                       and a bank refuses a transfer whose beneficiary name
 *                       does not match
 *   Account Number      existed
 *   Branch Name         MISSING
 *   Routing             existed
 *   SWIFT Code          MISSING
 *
 * Wallet and Wallet number come off the profile in the same breath. The
 * COLUMNS stay — nothing recorded is thrown away to tidy a card — so this also
 * checks the three that already existed still read back, which is the half a
 * diff cannot show.
 *
 *     node .teambankqa.mjs      (local only — writes and deletes)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const API = "http://localhost:4001/api";
const WEB = "http://localhost:3000";
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

const wipe = async () => {
  await db.query("delete from team_members where full_name like 'BANKQA %'");
};
await wipe();

/* ----------------------------- the API keeps them ---------------------- */

const made = await call("POST", "/team-members", {
  fullName: "BANKQA Bank Person",
  engagementType: "employee",
  designation: "Tester",
  joinedOn: "2024-05-01",
  bankName: "Bank Asia Limited",
  bankAccountHolder: "MD YEASIN HOSSAIN (FATHER)",
  bankAccountNumber: "1083451057575",
  bankBranch: "Gulshan",
  bankRouting: "070270602",
  bankSwift: "BALBBDDH",
});
check(
  "a person records with all six bank fields",
  made.status === 201,
  `HTTP ${made.status} ${JSON.stringify(made.body?.message ?? made.body?.errors ?? "")}`.slice(0, 140),
);
const id = made.body?.id;

const stored = (
  await db.query(
    `select bank_name n, bank_account_holder h, bank_account_number a,
            bank_branch b, bank_routing r, bank_swift s
       from team_members where id = $1`,
    [id],
  )
).rows[0];
check(
  "THE ASK: the three that were missing are stored",
  stored?.h === "MD YEASIN HOSSAIN (FATHER)" &&
    stored?.b === "Gulshan" &&
    stored?.s === "BALBBDDH",
  `holder ${stored?.h} | branch ${stored?.b} | swift ${stored?.s}`,
);
check(
  "and the three that already existed still are",
  stored?.n === "Bank Asia Limited" &&
    stored?.a === "1083451057575" &&
    stored?.r === "070270602",
  `${stored?.n} | ${stored?.a} | ${stored?.r}`,
);

/* A wrong SWIFT is a salary that does not arrive; it must be refused. */
const bad = await call("PATCH", `/team-members/${id}`, { bankSwift: "NOPE" });
check(
  "a SWIFT that is not a SWIFT is refused",
  bad.status === 400,
  `HTTP ${bad.status} ${JSON.stringify(bad.body?.errors ?? bad.body?.message ?? "")}`.slice(0, 120),
);

/* ------------------------------- the screens --------------------------- */

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
await page.setViewport({ width: 1600, height: 1400 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/team/${id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2600);

const card = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("*")].find(
    (e) =>
      e.children.length === 0 &&
      /^Where they are paid$/i.test((e.textContent ?? "").trim()),
  );
  const box = heading?.closest("section, div[class*=rounded]");
  return (box?.textContent ?? "").replace(/\s+/g, " ");
});
check(
  "THE ASK: the profile shows the account holder, branch and SWIFT",
  /Account holder/i.test(card) &&
    /MD YEASIN HOSSAIN/i.test(card) &&
    /Branch/i.test(card) &&
    /Gulshan/.test(card) &&
    /SWIFT/i.test(card) &&
    /BALBBDDH/.test(card),
  card.slice(0, 200),
);
check(
  "THE ASK: Wallet and Wallet number are gone",
  !/Wallet/i.test(card),
  /Wallet/i.test(card) ? card.slice(0, 160) : "",
);

/* The drawer offers all six. */
await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  [...main.querySelectorAll("button")]
    .find((b) => (b.textContent ?? "").trim() === "Edit")
    ?.click();
});
await settle(1900);

const fields = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /Employee ID|Bank/i.test(x.textContent ?? ""),
  );
  const named = [...(d?.querySelectorAll("input[name], select[name]") ?? [])];
  return Object.fromEntries(
    named.map((i) => [i.getAttribute("name"), i.value ?? ""]),
  );
});
for (const [name, want] of [
  ["bankName", "Bank Asia Limited"],
  ["bankAccountHolder", "MD YEASIN HOSSAIN (FATHER)"],
  ["bankAccountNumber", "1083451057575"],
  ["bankBranch", "Gulshan"],
  ["bankRouting", "070270602"],
  ["bankSwift", "BALBBDDH"],
]) {
  check(
    `the drawer opens with ${name} already filled in`,
    fields[name] === want,
    `${JSON.stringify(fields[name])} (expected ${JSON.stringify(want)})`,
  );
}

await browser.close();
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
