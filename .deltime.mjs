/* How long does confirming a trash actually take, from click to row? */
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

await db.query("delete from transactions where ref_no like 'TXN-DT-%'");
const account = (
  await db.query("select id from accounts where deleted_at is null limit 1")
).rows[0];
const cat = (
  await db.query(
    "select id from categories where kind='out' and deleted_at is null limit 1",
  )
).rows[0];
const row = (
  await db.query(
    `insert into transactions (ref_no, account_id, direction, txn_date, amount, currency, category_id, description, created_by, updated_by)
     values ('TXN-DT-1', $1, 'out', '2026-08-19', '99.00', 'BDT', $2, 'DELTIME the row to delete', $3, $3)
     returning id`,
    [account.id, cat?.id ?? null, person.id],
  )
).rows[0];

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000 });
const net = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/trash")) net.push(`${r.request().method()} ${r.status()} ${u.split("/api")[1]} at +${Date.now() - t0}ms`);
});
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/transactions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);

await page.evaluate(() => {
  const r = [...document.querySelectorAll("tbody tr")].find((x) =>
    (x.textContent ?? "").includes("DELTIME the row to delete"),
  );
  r.querySelector('button[aria-label="Move to trash"]').click();
});
await settle(800);

/*
 * Cancel and reopen first. That is the only thing the failing harness does
 * that the passing probe did not, and it is also what a person does: open the
 * dialog, think better of it, then come back to it.
 */
await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /to the trash\?/i.test(x.textContent ?? ""),
  );
  [...d.querySelectorAll("button")].find((b) => /No, keep it/i.test(b.textContent ?? "")).click();
});
await settle(700);
await page.evaluate(() => {
  const r = [...document.querySelectorAll("tbody tr")].find((x) =>
    (x.textContent ?? "").includes("DELTIME the row to delete"),
  );
  r.querySelector('button[aria-label="Move to trash"]').click();
});
await settle(900);
console.log(
  "after reopening:",
  JSON.stringify(
    await page.evaluate(() => ({
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      checkboxes: document.querySelectorAll('[role="dialog"] input[type="checkbox"]').length,
      wordFields: [...document.querySelectorAll('[role="dialog"] input')].filter((i) =>
        i.className.includes("font-mono"),
      ).length,
    })),
  ),
);

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
const armed = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /to the trash\?/i.test(x.textContent ?? ""),
  );
  const reason = [...d.querySelectorAll("input")].find(
    (i) => i.type !== "checkbox" && !i.className.includes("font-mono"),
  );
  if (reason) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(reason, "DELTIME reason");
    reason.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const btn = [...d.querySelectorAll("button")].find((b) =>
    /^Yes, trash/i.test(b.textContent ?? ""),
  );
  return {
    reasonFound: Boolean(reason),
    reasonPlaceholder: reason?.placeholder ?? null,
    wordValue: [...d.querySelectorAll("input")].find((i) =>
      i.className.includes("font-mono"),
    )?.value,
    confirmDisabled: btn?.disabled,
  };
});
console.log("before clicking confirm:", JSON.stringify(armed));

var t0 = Date.now();
await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /to the trash\?/i.test(x.textContent ?? ""),
  );
  [...d.querySelectorAll("button")]
    .find((b) => /^Yes, trash/i.test(b.textContent ?? ""))
    .click();
});

let landed = null;
for (let i = 0; i < 75; i++) {
  const r = (
    await db.query(
      "select deleted_at, delete_reason, voided_at from transactions where id = $1",
      [row.id],
    )
  ).rows[0];
  if (r.deleted_at) {
    landed = { ms: Date.now() - t0, reason: r.delete_reason, voided: Boolean(r.voided_at) };
    break;
  }
  await settle(200);
}
console.log("row deleted after:", landed ? JSON.stringify(landed) : "never within 15s");
const gone = await page.evaluate(
  () => !document.body.innerText.includes("DELTIME the row to delete"),
);
console.log("left the table:", gone);
console.log("trash calls:", net.join(" | ") || "none seen");

await browser.close();
await db.query("delete from transactions where ref_no like 'TXN-DT-%'");
await db.end();
