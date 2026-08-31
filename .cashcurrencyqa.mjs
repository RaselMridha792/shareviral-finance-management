/**
 * Cash In asks in the currency the chosen account thinks in.
 *
 * The owner, with two screenshots: *"account switch holeo currency switch
 * hocchena. ekhane field take primary usd thakbe jokhon usd thake oi card er
 * primary currency. r bdt thakbe oi card er type bdt thakle."*
 *
 * The form asked Amount (USD) → Rate → Amount (BDT) for every account, whatever
 * it was. Now the account decides: a USD-primary account is asked for dollars
 * and the taka is worked out; a BDT account is asked for the taka FIRST,
 * because that is what the statement states, and the dollars follow as the
 * optional pair.
 *
 * THE THING THAT MUST NOT CHANGE, and the reason half of these checks exist:
 * every figure in this app's ledger is BDT, a USD account's included.
 * `accounts.currency` says which account is for foreign spend; it does not
 * denominate anything. So this moves which box is asked first and which is
 * computed — and `transactions.amount` must still be the taka that landed,
 * `original_amount` still the dollars, on both kinds of account.
 *
 *     node .cashcurrencyqa.mjs      (local only — writes and deletes)
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

/* ------------------------------------------------------------- fixtures */

const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const month = TODAY.slice(0, 8);
/*
 * Cleared in dependency order, and never allowed to take the run down.
 *
 * An account cannot be deleted while anything points at it, and another
 * harness running at the same time will happily hang a TDS deposit off "the
 * first account" — which, for the minute this file's fixtures exist, can be
 * one of these. The battery runs sequentially for exactly this reason; this
 * makes the file survive being run next to something anyway, and leaves the
 * accounts soft-deleted rather than throwing if a stranger's row still holds
 * them.
 */
const wipe = async () => {
  const ids = (
    await db.query("select id from accounts where name like 'CCQA %'")
  ).rows.map((r) => r.id);
  await db.query("delete from transactions where description like 'CCQA%'");
  for (const id of ids) {
    await db.query("delete from transactions where account_id = $1", [id]);
    await db.query("update tds_deposits set account_id = null where account_id = $1", [id]);
    try {
      await db.query("delete from accounts where id = $1", [id]);
    } catch {
      await db.query(
        "update accounts set deleted_at = now(), name = name || ' (CCQA leftover)' where id = $1",
        [id],
      );
    }
  }
};
await wipe();

/*
 * One of each. The dev database has no USD account at all, which is why this
 * builds both rather than picking whatever happens to be first — a harness that
 * silently exercised one kind twice would have proved nothing about the change.
 */
const mkAccount = async (name, currency) =>
  (
    await call("POST", "/accounts", {
      name,
      type: "bank",
      currency,
      openingBalance: "0.00",
      openingBalanceOn: month + "01",
    })
  ).body;
const bdtAccount = await mkAccount("CCQA Taka Bank", "BDT");
const usdAccount = await mkAccount("CCQA Dollar Bank", "USD");
check(
  "one BDT account and one USD account exist",
  Boolean(bdtAccount?.id && usdAccount?.id),
  `${bdtAccount?.currency} / ${usdAccount?.currency}`,
);

/* -------------------------------- browser ------------------------------ */

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
await page.setViewport({ width: 1700, height: 1400 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const openDrawer = async () => {
  await page.goto(`${WEB}/accounts/cash-in`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await settle(2600);
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => /^Add cash$/i.test((b.textContent ?? "").trim()))
      ?.click();
  });
  await settle(1600);
};

/* React does not see a value poked onto a DOM node; the native setter plus an
   input event is what a person typing produces. */
const type = async (name, value) =>
  page.evaluate(
    ({ name, value }) => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
      const el = dialog.querySelector(`input[name="${name}"]`);
      const proto =
        el.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { name, value },
  );

/*
 * The account picker is a `SearchableSelect`: a trigger button, then a search
 * box, then `role="option"` buttons. Driving it means opening it, typing enough
 * to narrow the list, and clicking the option — and then CHECKING it took,
 * because a silent miss here leaves the form on its default account and every
 * check below measures the wrong one.
 */
const chooseAccount = async (label) => {
  const opened = await page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    const field = [...dialog.querySelectorAll("label")].find((l) =>
      /Received Bank Name/i.test(l.textContent ?? ""),
    );
    const trigger = [...(field?.querySelectorAll("button") ?? [])].find(
      (b) => b.getAttribute("aria-haspopup") || b.getAttribute("aria-expanded") !== null,
    ) ?? field?.querySelector("button");
    if (!trigger) return false;
    trigger.click();
    return true;
  });
  await settle(600);

  /* Type into the search box so the wanted row is certainly rendered — the
     list is capped and a fresh account can be below the fold. */
  await page.evaluate((wanted) => {
    const box = [...document.querySelectorAll("input")].find((el) =>
      /Type to find/i.test(el.getAttribute("placeholder") ?? ""),
    );
    if (!box) return;
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(box, wanted);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }, label);
  await settle(600);

  const clicked = await page.evaluate((wanted) => {
    const option = [...document.querySelectorAll('[role="option"]')].find((el) =>
      (el.textContent ?? "").trim().startsWith(wanted),
    );
    if (!option) {
      return {
        ok: false,
        saw: [...document.querySelectorAll('[role="option"]')]
          .map((el) => (el.textContent ?? "").trim().slice(0, 40))
          .slice(0, 8),
      };
    }
    option.click();
    return { ok: true };
  }, label);
  await settle(800);
  return { opened, ...clicked };
};

/** Which account the drawer currently believes it is recording into. */
const chosenAccount = () =>
  page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    const field = [...dialog.querySelectorAll("label")].find((l) =>
      /Received Bank Name/i.test(l.textContent ?? ""),
    );
    return {
      id: dialog.querySelector('input[name="accountId"]')?.value ?? null,
      shown: (field?.querySelector("button")?.textContent ?? "").trim(),
    };
  });

/** The amount fields, in the order the drawer actually renders them. */
const amountFields = () =>
  page.evaluate(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
    const wanted = /^(Amount \(USD\)|Amount \(BDT\)|Rate)/;
    return [...dialog.querySelectorAll("label")]
      .filter((l) => wanted.test((l.textContent ?? "").trim()))
      .map((l) => {
        const input = l.querySelector("input");
        return {
          label: (l.textContent ?? "").trim().split(/(?<=\))|(?<=Rate)/)[0],
          name: input?.name ?? null,
          value: input?.value ?? null,
          readOnly: input?.readOnly ?? null,
          required: input?.required ?? null,
        };
      });
  });

/* ------------------------------ a BDT account -------------------------- */

await openDrawer();
await chooseAccount("CCQA Taka Bank");
const picked = await chosenAccount();
check(
  "the drawer really switched to the BDT account",
  picked.shown.includes("CCQA Taka Bank") && picked.id === bdtAccount.id,
  JSON.stringify(picked) + ` wanted ${bdtAccount.id}`,
);
let fields = await amountFields();
check(
  "BDT account: the taka is the FIRST amount box",
  fields[0]?.name === "amount",
  fields.map((f) => f.name).join(" → "),
);
check(
  "BDT account: and the taka box can be typed in",
  fields.find((f) => f.name === "amount")?.readOnly === false,
  JSON.stringify(fields.find((f) => f.name === "amount")),
);
check(
  "BDT account: the dollars are not required",
  fields.find((f) => f.name === "usdSent")?.required === false,
  JSON.stringify(fields.find((f) => f.name === "usdSent")),
);

/* The dangerous one: filling in the optional dollars and a rate must NOT
   overwrite the taka somebody typed. */
await type("amount", "50000");
await type("usdSent", "1000");
await type("usdRate", "122.00");
await settle(700);
fields = await amountFields();
check(
  "BDT account: dollars and a rate do NOT overwrite the taka that was typed",
  fields.find((f) => f.name === "amount")?.value === "50000",
  `taka reads ${fields.find((f) => f.name === "amount")?.value} (122,000 would mean the app argued with the statement)`,
);

/* ------------------------------ a USD account -------------------------- */

await openDrawer();
await chooseAccount("CCQA Dollar Bank");
fields = await amountFields();
check(
  "USD account: the dollars are the FIRST amount box",
  fields[0]?.name === "usdSent",
  fields.map((f) => f.name).join(" → "),
);
check(
  "USD account: and the dollars are required",
  fields.find((f) => f.name === "usdSent")?.required === true,
  JSON.stringify(fields.find((f) => f.name === "usdSent")),
);

await type("usdSent", "1000");
await type("usdRate", "122.00");
await settle(700);
fields = await amountFields();
const takaField = fields.find((f) => f.name === "amount");
check(
  "USD account: the taka is worked out and read-only",
  takaField?.value === "122000.00" && takaField?.readOnly === true,
  JSON.stringify(takaField),
);

/* ------------------- switching accounts keeps the figure --------------- */

await chooseAccount("CCQA Taka Bank");
await settle(700);
fields = await amountFields();
check(
  "switching to a BDT account keeps the figure that was on screen",
  fields.find((f) => f.name === "amount")?.value === "122000.00",
  `taka reads ${fields.find((f) => f.name === "amount")?.value}`,
);
check(
  "and hands the box back to the person",
  fields.find((f) => f.name === "amount")?.readOnly === false,
  JSON.stringify(fields.find((f) => f.name === "amount")),
);
check(
  "and the taka is first again",
  fields[0]?.name === "amount",
  fields.map((f) => f.name).join(" → "),
);

/* ------------- WHAT MUST NOT CHANGE: the ledger is still BDT ----------- */

const recorded = await call("POST", "/transactions/cash-in", {
  txnDate: TODAY,
  accountId: usdAccount.id,
  amount: "122000.00",
  description: "CCQA into the dollar account",
  usdRate: "122.00",
  usdSent: "1000.00",
});
const row = (
  await db.query(
    `select amount::text, currency, original_amount::text oa, original_currency oc, fx_rate::text fr
       from transactions where description = 'CCQA into the dollar account'`,
  )
).rows[0];
check(
  "a receipt into a USD account still stores taka in `amount`",
  recorded.status === 201 && row?.amount === "122000.00" && row?.currency === "BDT",
  JSON.stringify(row),
);
check(
  "with the dollars in original_amount, not in the ledger figure",
  row?.oa === "1000.00" && row?.oc === "USD" && row?.fr === "122.000000",
  `${row?.oa} ${row?.oc} @ ${row?.fr}`,
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
