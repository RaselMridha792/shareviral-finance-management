/*
 * Tick the box, say no, open it again. What is the dialog holding?
 *
 * The gate is meant to be disarmed every time it opens — that is the whole
 * point of a mandatory tick. If the tick survives a cancel, somebody who
 * changed their mind comes back to a confirmation that is already half-armed.
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
    `select id, role, token_version from users where role='super_admin' and deleted_at is null limit 1`,
  )
).rows[0];
const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "1h" },
);
await db.query("delete from transactions where ref_no like 'TXN-RO-%'");
const account = (
  await db.query("select id from accounts where deleted_at is null limit 1")
).rows[0];
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];
await db.query(
  `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, category_id, description, created_by, updated_by)
   values ('TXN-RO-1', $1, 'out', '2026-08-19', '77.00', 'BDT', $2, 'REOPEN the row', $3, $3)`,
  [account.id, cat?.id ?? null, person.id],
);

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/transactions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);

const openIt = () =>
  page.evaluate(() => {
    const r = [...document.querySelectorAll("tbody tr")].find((x) =>
      (x.textContent ?? "").includes("REOPEN the row"),
    );
    r.querySelector('button[aria-label="Move to trash"]').click();
  });
const readIt = () =>
  page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
      /to the trash\?/i.test(x.textContent ?? ""),
    );
    if (!d) return { open: false };
    const box = d.querySelector('input[type="checkbox"]');
    const word = [...d.querySelectorAll("input")].find((i) =>
      i.className.includes("font-mono"),
    );
    const reason = [...d.querySelectorAll("input")].find(
      (i) => i.type !== "checkbox" && !i.className.includes("font-mono"),
    );
    const btn = [...d.querySelectorAll("button")].find((b) =>
      /^Yes, trash/i.test(b.textContent ?? ""),
    );
    return {
      open: true,
      ticked: box?.checked,
      word: word?.value ?? null,
      reason: reason?.value ?? null,
      confirmDisabled: btn?.disabled,
    };
  });

await openIt();
await settle(800);
console.log("1. freshly opened     ", JSON.stringify(await readIt()));

await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /to the trash\?/i.test(x.textContent ?? ""),
  );
  d.querySelector('input[type="checkbox"]').click();
  const word = [...d.querySelectorAll("input")].find((i) =>
    i.className.includes("font-mono"),
  );
  word.focus();
});
await page.keyboard.type("trash", { delay: 12 });
await settle(300);
console.log("2. ticked and typed   ", JSON.stringify(await readIt()));

await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /to the trash\?/i.test(x.textContent ?? ""),
  );
  [...d.querySelectorAll("button")]
    .find((b) => /No, keep it/i.test(b.textContent ?? ""))
    .click();
});
await settle(800);
console.log("3. after saying no    ", JSON.stringify(await readIt()));

await openIt();
await settle(900);
const again = await readIt();
console.log("4. opened again       ", JSON.stringify(again));
console.log(
  again.ticked === false && !again.word
    ? "\n  the gate is fully disarmed on reopen"
    : "\n  IT IS NOT DISARMED — ticked: " + again.ticked + ", word: " + JSON.stringify(again.word),
);

await browser.close();
await db.query("delete from transactions where ref_no like 'TXN-RO-%'");
await db.end();
