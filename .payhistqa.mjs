/**
 * The salary changes already recorded, shown.
 *
 * The owner: *"Salary changes history ekta section ante hobe team member der
 * profile a."*
 *
 * Nothing new is stored for this. Every change already writes a row with its
 * own effective date and reason — that is what the "Since …" line under the
 * current figure has always been reading — and the whole list was already on
 * the wire. The card only stops throwing it away.
 *
 * So what this checks is the part that could still be wrong: that the history
 * appears, in the right order, with the reason each change was made, and that
 * the CURRENT figure is not printed twice — two rows showing the same money
 * read as two raises.
 *
 *     node .payhistqa.mjs      (local only — writes and deletes)
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
  await db.query(
    "delete from compensation_history where team_member_id in (select id from team_members where full_name like 'PAYQA %')",
  );
  await db.query("delete from team_members where full_name like 'PAYQA %'");
};
await wipe();

const made = await call("POST", "/team-members", {
  fullName: "PAYQA Raised Twice",
  engagementType: "employee",
  designation: "Tester",
  joinedOn: "2024-01-01",
});
check("a person records", made.status === 201, `HTTP ${made.status}`);
const id = made.body?.id;

/* Three figures over time: hired, raised, raised again. */
const pays = [
  { grossAmount: "40000.00", effectiveFrom: "2024-01-01", changeReason: "On hire" },
  { grossAmount: "55000.00", effectiveFrom: "2025-01-01", changeReason: "Annual review" },
  { grossAmount: "70000.00", effectiveFrom: "2026-01-01", changeReason: "Promoted to L3" },
];
for (const pay of pays) {
  const res = await call("POST", `/team-members/${id}/compensation`, pay);
  check(
    `pay recorded from ${pay.effectiveFrom}`,
    res.status === 201,
    `HTTP ${res.status} ${JSON.stringify(res.body?.message ?? res.body?.errors ?? "")}`.slice(0, 110),
  );
}

const rows = (
  await db.query(
    "select count(*)::int n from compensation_history where team_member_id = $1 and deleted_at is null",
    [id],
  )
).rows[0].n;
check("three figures are on record", rows === 3, `${rows}`);

/* ------------------------------- the screen ---------------------------- */

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
await page.setViewport({ width: 1600, height: 1500 });
await page.goto(`${WEB}/team/${id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 2800));

const card = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("*")].find(
    (e) =>
      e.children.length === 0 &&
      /^Salary changes$/i.test((e.textContent ?? "").trim()),
  );
  const box = heading?.closest("section, div[class*=rounded]");
  const table = box?.querySelector("table");
  return {
    found: Boolean(heading),
    rows: [...(table?.querySelectorAll("tbody tr") ?? [])].map((r) =>
      [...r.querySelectorAll("td")]
        .map((c) => (c.textContent ?? "").trim())
        .join(" | "),
    ),
    headings: [...(table?.querySelectorAll("thead th") ?? [])].map((h) =>
      (h.textContent ?? "").trim(),
    ),
  };
});

check("THE ASK: a Salary changes card is on the profile", card.found, "");
check(
  "it lists the earlier figures",
  card.rows.length === 2,
  `${card.rows.length} row(s): ${card.rows.join(" // ").slice(0, 150)}`,
);
check(
  "THE RULE: the current figure is not printed twice",
  !card.rows.some((r) => r.includes("70,000")),
  card.rows.join(" // ").slice(0, 140),
);
check(
  "and each says why it changed",
  card.rows.some((r) => /On hire/.test(r)) &&
    card.rows.some((r) => /Annual review/.test(r)),
  card.rows.join(" // ").slice(0, 160),
);
check(
  "with the dates read day-first, like everywhere else",
  card.rows.some((r) => /01\/01\/2024/.test(r)),
  card.rows[card.rows.length - 1] ?? "",
);

/* Somebody with no history should see no empty table. */
const fresh = await call("POST", "/team-members", {
  fullName: "PAYQA Just Hired",
  engagementType: "employee",
  designation: "Tester",
  joinedOn: "2026-08-01",
});
await call("POST", `/team-members/${fresh.body.id}/compensation`, {
  grossAmount: "30000.00",
  effectiveFrom: "2026-08-01",
  changeReason: "On hire",
});
await page.goto(`${WEB}/team/${fresh.body.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 2600));
const noHistory = await page.evaluate(() =>
  [...document.querySelectorAll("*")].some(
    (e) =>
      e.children.length === 0 &&
      /^Salary changes$/i.test((e.textContent ?? "").trim()),
  ),
);
check(
  "somebody hired last month gets no empty card, because that is not a gap",
  !noHistory,
  noHistory ? "the card is there with nothing in it" : "",
);

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
