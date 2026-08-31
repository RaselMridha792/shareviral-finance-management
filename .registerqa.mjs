/**
 * The register shows; it does not take dictation.
 *
 * The owner: "jotogula account ache ekhane add record name ekta button ache
 * jetar dorkar nai ekhane karon ekhane kono record manually add korbona".
 *
 * Removing a button is the easiest change in the world to get wrong, because
 * the diff looks finished either way. Two things have to be true afterwards and
 * only one of them is visible in the diff:
 *
 *   - the button is gone from EVERY account's register, not the one that was
 *     open when the change was made;
 *   - editing a row and voiding one still work, because they act on entries
 *     that are already there, which is what a register is for.
 *
 *     node .registerqa.mjs      (local only — reads; writes nothing)
 */
import fs from "node:fs";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

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

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* Every account, not a sample: the button was rendered per screen. */
const accounts = (
  await db.query(
    "select id, name from accounts where deleted_at is null order by name",
  )
).rows;
check("there are accounts to look at", accounts.length > 0, `${accounts.length}`);

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
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

let withButton = [];
for (const account of accounts) {
  await page.goto(`${WEB}/accounts/${account.id}/register`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await settle(2000);
  const found = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return [...main.querySelectorAll("button")].some((b) =>
      /^\+?\s*Record$/i.test((b.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
  });
  if (found) withButton.push(account.name);
}
check(
  "THE ASK: no account's register offers a Record button",
  withButton.length === 0,
  withButton.join(" | ") || `checked ${accounts.length} registers`,
);

/* The register still has to be a register. */
const busiest = (
  await db.query(
    `select account_id, count(*)::int n from transactions
      where deleted_at is null group by 1 order by 2 desc limit 1`,
  )
).rows[0];

if (!busiest) {
  check("an account with entries exists to test the row actions", false, "none");
} else {
  await page.goto(`${WEB}/accounts/${busiest.account_id}/register`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await settle(2400);
  const row = await page.evaluate(() => {
    const first = document.querySelector("tbody tr");
    if (!first) return { rows: false };
    const labels = [...first.querySelectorAll("button, a")].map((b) =>
      (b.getAttribute("aria-label") ?? b.textContent ?? "").trim(),
    );
    return { rows: true, labels: labels.filter(Boolean) };
  });
  check("the register still lists entries", row.rows, "");
  check(
    "and a row can still be edited and voided",
    Boolean(row.labels?.some((l) => /edit/i.test(l))) &&
      Boolean(row.labels?.some((l) => /void|delete|trash/i.test(l))),
    (row.labels ?? []).join(" | ").slice(0, 140),
  );

  /* Editing must genuinely open — the drawer it uses is shared with the one
     that was removed, so a careless removal takes both. */
  const opened = await page.evaluate(() => {
    const first = document.querySelector("tbody tr");
    const edit = [...(first?.querySelectorAll("button") ?? [])].find((b) =>
      /edit/i.test(b.getAttribute("aria-label") ?? ""),
    );
    edit?.click();
    return Boolean(edit);
  });
  await settle(1800);
  const drawer = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"], aside')].some((d) =>
      /Amount|Description/i.test(d.textContent ?? ""),
    ),
  );
  check("the edit drawer still opens", opened && drawer, `clicked ${opened}`);
}

await browser.close();
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
