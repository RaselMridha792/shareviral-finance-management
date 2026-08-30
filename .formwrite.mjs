/**
 * The form, not the endpoint.
 *
 * `.writeqa.mjs` proved the API moves the ledger correctly. That says nothing
 * about whether the drawer reaches it with what was typed — a field bound to
 * the wrong key, a number sent as text, a default silently overriding an entry,
 * all leave the endpoint blameless and the row wrong.
 *
 * So: type into the drawer the way a person does, press the button it offers,
 * and then ask the database what arrived. The same drawer serves five screens,
 * so this is the single most-used write path in the app.
 *
 * It cleans up after itself.
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
const MARK = "QA form probe " + Math.random().toString(36).slice(2, 8);
const AMOUNT = "3141.59";

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const c = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const u = (
  await c.query(
    "select id, role, token_version from users where role='super_admin' and status='active' and deleted_at is null limit 1",
  )
).rows[0];

const totals = async () =>
  (
    await c.query(
      `select count(*)::int as n,
              coalesce(sum(signed_amount::numeric) filter (where voided_at is null),0) as net
         from transactions`,
    )
  ).rows[0];

const token = jwt.sign(
  { sub: u.id, role: u.role, tv: u.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "30m" },
);
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
await page.setViewport({ width: 1500, height: 1100 });

let created = null;
try {
  const before = await totals();
  console.log(`ledger before: ${before.n} entries, net ${Number(before.net).toFixed(2)}`);

  await page
    .goto("http://localhost:3000/expenses/administrative", {
      waitUntil: "networkidle0",
      timeout: 120000,
    })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 2200));

  await page.evaluate(() => {
    const scope = document.querySelector("main") || document.body;
    [...scope.querySelectorAll("button")]
      .find((x) => /^add\b/i.test(x.textContent.trim()))
      ?.click();
  });
  await new Promise((r) => setTimeout(r, 1600));

  /*
   * React owns these inputs, so assigning `.value` is ignored — the framework
   * re-renders from its own state and the character never happened. The native
   * setter plus a dispatched `input` is the version React notices.
   */
  const typed = await page.evaluate(
    ({ mark, amount }) => {
      const set = (el, v) => {
        const proto =
          el.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const d = document.querySelector('input[name="description"]');
      const a = document.querySelector('input[name="amount"]');
      if (!d || !a) return null;
      set(d, mark);
      set(a, amount);
      return { description: d.value, amount: a.value };
    },
    { mark: MARK, amount: AMOUNT },
  );
  console.log(`typed into the drawer: ${JSON.stringify(typed)}`);

  const pressed = await page.evaluate(() => {
    // "Record it" exactly. A looser match caught "add Administrative" — the
    // button that opened the drawer — and re-opened it instead of submitting,
    // which then reported the drawer as never reaching the ledger.
    const b = [...document.querySelectorAll("button")].find(
      (x) => /^(record it|save changes|save)$/i.test(x.textContent.trim()) && !x.disabled,
    );
    if (!b) return null;
    b.click();
    return b.textContent.trim();
  });
  console.log(`pressed: ${pressed}`);
  await new Promise((r) => setTimeout(r, 3000));

  /* ---- what actually arrived ----------------------------------------- */
  const row = (
    await c.query(
      `select id, amount::numeric as amount, direction, description,
              to_char(txn_date,'YYYY-MM-DD') as on_date, category_id, account_id
         from transactions where description = $1`,
      [MARK],
    )
  ).rows[0];

  if (!row) {
    console.log("\n   NOTHING WAS WRITTEN — the drawer did not reach the ledger");
  } else {
    created = row.id;
    const after = await totals();
    console.log("\n   what the drawer wrote:");
    console.log(`      description  ${row.description}`);
    console.log(
      `      amount       ${Number(row.amount).toFixed(2)}   ${Number(row.amount).toFixed(2) === AMOUNT ? "as typed" : "NOT WHAT WAS TYPED (" + AMOUNT + ")"}`,
    );
    console.log(`      direction    ${row.direction}   ${row.direction === "out" ? "an expense, correct for this screen" : "WRONG"}`);
    console.log(`      date         ${row.on_date}`);
    console.log(
      `      category     ${row.category_id ? "set" : "MISSING — the screen's own category did not travel"}`,
    );
    console.log(
      `      account      ${row.account_id ? "set" : "MISSING"}`,
    );
    const moved = Number(after.net) - Number(before.net);
    console.log(
      `\n   the ledger moved ${moved.toFixed(2)}, expected ${(-Number(AMOUNT)).toFixed(2)}   ${Math.abs(moved + Number(AMOUNT)) < 0.005 ? "correct" : "WRONG"}`,
    );
    console.log(`   entries ${before.n} -> ${after.n}`);

    /* is it on the screen it was added from? */
    await page.reload({ waitUntil: "networkidle0", timeout: 120000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2200));
    const onScreen = await page.evaluate(
      (mark) => (document.querySelector("main") || document.body).innerText.includes(mark),
      MARK,
    );
    console.log(`   visible on the page it was added from: ${onScreen ? "yes" : "NO"}`);
  }
} finally {
  if (created) {
    await c.query("delete from audit_logs where entity_table='transactions' and entity_id=$1", [created]);
    await c.query("delete from transactions where id=$1", [created]);
    const back = await totals();
    console.log(`\n   probe removed; ${back.n} entries, net ${Number(back.net).toFixed(2)}`);
  }
  await c.end();
  await browser.close();
}
