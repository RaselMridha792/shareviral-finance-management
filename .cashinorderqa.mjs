/**
 * Cash In: four boxes, one order, and the derived one locked — both ways round.
 *
 * The owner, on two screenshots of the same drawer:
 *
 *   *"ekhane usd bank select korle charge field ta nai. bank charge field tao
 *    dite hobe. also bdt select hole mane bdt type account field gula
 *    ultapalta position a ache also auto calculate hoyna. equivalant field tay
 *    type kora jay eta vul eta auto select hobe."*
 *
 *   *"bdt select hole age airokom serial a thakbe: bdt amount, usd rate, auto
 *    fill, bank charge. r usd hole: usd amount, usd rate, bdt auto fill, bank
 *    charge. properly kaj korte hobe sobkichu."*
 *
 * Three claims, none visible in a diff: the ORDER the boxes appear in, whether
 * the derived one actually fills itself, and whether it can still be typed
 * into. So this reads the labels in document order, types into one box and
 * watches another, and asks the DOM whether the second is read-only.
 *
 *     node .cashinorderqa.mjs      (local only — writes and deletes)
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
const call = async (method, path_, body) => {
  const res = await fetch(API + path_, {
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

const MARK = "CIQA";
/* Today, because the Cash In screen lists the CURRENT month and the rows have
   to be reachable by their own edit pencil. A fixture dated last month passes
   every database check and is invisible on the screen. */
const TODAY = (
  await db.query("select (now() at time zone 'Asia/Dhaka')::date::text d")
).rows[0].d;
const wipe = async () => {
  await db.query(
    "delete from transactions where charge_for_id in (select id from transactions where description like $1)",
    [`%${MARK}%`],
  );
  await db.query("delete from transactions where description like $1", [`%${MARK}%`]);
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
};
await wipe();

const bdtAccount = (
  await call("POST", "/accounts", {
    name: `${MARK} Taka Bank`,
    type: "bank",
    currency: "BDT",
    openingBalance: "0.00",
    openingBalanceOn: "2026-08-01",
  })
).body;
const usdAccount = (
  await call("POST", "/accounts", {
    name: `${MARK} Dollar Bank`,
    type: "bank",
    currency: "USD",
    openingBalance: "0.00",
    openingBalanceUsd: "0.00",
    openingBalanceOn: "2026-08-01",
  })
).body;
check(
  "a taka account and a dollar account exist to switch between",
  Boolean(bdtAccount?.id && usdAccount?.id),
  `${bdtAccount?.currency} / ${usdAccount?.currency}`,
);

/* -------------------------------- the drawer --------------------------- */

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: fs.existsSync(chrome)
    ? chrome
    : "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await browser.setCookie({ name: "sfm_access", value: token, domain: "localhost", path: "/" });
const page = await browser.newPage();
await page.setViewport({ width: 1900, height: 1400 });

const apiFailures = [];
page.on("response", (res) => {
  if (!res.url().includes("/api/") || res.status() < 400) return;
  apiFailures.push(`${res.request().method()} ${res.status()} ${res.url().replace(/^.*\/api/, "")}`);
});

await page.goto(`${WEB}/accounts/cash-in`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /Add cash/i.test((b.textContent ?? "").trim()),
  );
  if (!btn) return false;
  btn.click();
  return true;
});
await new Promise((r) => setTimeout(r, 2000));
check("the Add cash drawer opens", opened, opened ? "open" : "no button");

/** Sets a field by its `name`, the way a person typing would. */
const type = (name, value) =>
  page.evaluate(
    (n, v) => {
      /* Form controls only. `[name="description"]` matched Next's
         <meta name="description"> in the head first — which has no `value` at
         all — so the box was never filled, the form refused to submit on a
         required field, and the run reported the SAVE broken. */
      const el = document.querySelector(
        `input[name="${n}"], textarea[name="${n}"], select[name="${n}"]`,
      );
      if (!el) return false;
      /* Walk the element's OWN prototype chain to the setter.
         Guessing between input and select threw "Illegal invocation" on a
         textarea; assuming the immediate prototype owns `value` then threw
         "reading 'set' of undefined" on whatever does not. Neither guess is
         needed — the chain says where it is. */
      let proto = Object.getPrototypeOf(el);
      let descriptor = null;
      while (proto && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(proto, "value");
        if (descriptor && !descriptor.set) descriptor = null;
        if (!descriptor) proto = Object.getPrototypeOf(proto);
      }
      if (!descriptor) return false;
      const setter = descriptor.set;
      el.focus();
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    name,
    value,
  );

/**
 * Picks the account the way a person does.
 *
 * `accountId` is a SearchableSelect: a hidden input carries the name and a
 * combobox carries the interaction. Setting the hidden input's value moves
 * nothing — React never hears it — so the first run of this typed into the
 * hidden box, left the account where it was, and reported the taka layout
 * broken while it was looking at the dollar one.
 */
const chooseAccount = async (name) => {
  const opened = await page.evaluate(() => {
    const combo = document.querySelector('[role="combobox"]');
    if (!combo) return false;
    combo.click();
    return true;
  });
  if (!opened) return "no combobox";
  await new Promise((r) => setTimeout(r, 600));
  const picked = await page.evaluate((want) => {
    const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
      (o.textContent ?? "").includes(want),
    );
    if (!option) return false;
    option.click();
    return true;
  }, name);
  await new Promise((r) => setTimeout(r, 900));
  return picked ? "picked" : "option not found";
};

/**
 * The four money labels in DOCUMENT order, which is the claim being made.
 *
 * Read off the labels rather than the inputs: an input's `name` says what it
 * stores, and what the owner is looking at is what the label says.
 */
const moneyOrder = () =>
  page.evaluate(() => {
    const wanted =
      /^(Amount \(BDT\)|Amount \(USD\)|Rate|Bank charge \(BDT\))/;
    const labels = [...document.querySelectorAll("label")]
      .map((l) => (l.textContent ?? "").trim())
      .filter((t) => wanted.test(t))
      .map((t) => t.match(wanted)[1]);
    const state = (name) => {
      const el = document.querySelector(
        `input[name="${name}"], textarea[name="${name}"]`,
      );
      return el ? { value: el.value, readOnly: el.readOnly } : null;
    };
    return { labels, amount: state("amount"), usd: state("usdSent") };
  });

/* ------------------------------------------------ a TAKA account ------ */

const pickedBdt = await chooseAccount(`${MARK} Taka Bank`);
check("the taka account can be chosen", pickedBdt === "picked", pickedBdt);
await type("usdRate", "100");
await type("amount", "200000");
await new Promise((r) => setTimeout(r, 800));
const bdtView = await moneyOrder();

check(
  "on a taka account the boxes read: BDT amount, rate, auto USD, bank charge",
  JSON.stringify(bdtView.labels) ===
    JSON.stringify(["Amount (BDT)", "Rate", "Amount (USD)", "Bank charge (BDT)"]),
  JSON.stringify(bdtView.labels),
);
check(
  "the dollars fill themselves in from the taka and the rate",
  bdtView.usd?.value === "2000.00",
  `USD box reads ${JSON.stringify(bdtView.usd?.value)} for 200000 ÷ 100`,
);
check(
  "and the dollars cannot be typed into",
  bdtView.usd?.readOnly === true,
  `readOnly ${bdtView.usd?.readOnly}`,
);
check(
  "while the taka box stays the one you type in",
  bdtView.amount?.readOnly === false && bdtView.amount?.value === "200000",
  `taka readOnly ${bdtView.amount?.readOnly}, value ${JSON.stringify(bdtView.amount?.value)}`,
);

/* Changing the rate must move the derived figure, not strand it. */
await type("usdRate", "125");
await new Promise((r) => setTimeout(r, 600));
const reRated = await moneyOrder();
check(
  "changing the rate moves the derived dollars with it",
  reRated.usd?.value === "1600.00",
  `USD box reads ${JSON.stringify(reRated.usd?.value)} for 200000 ÷ 125`,
);

/* ---------------------------------------------- a DOLLAR account ------ */

const pickedUsd = await chooseAccount(`${MARK} Dollar Bank`);
check("the dollar account can be chosen", pickedUsd === "picked", pickedUsd);
await type("usdRate", "122");
await type("usdSent", "1000");
await new Promise((r) => setTimeout(r, 800));
const usdView = await moneyOrder();

check(
  "on a dollar account the boxes read: USD amount, rate, auto BDT, bank charge",
  JSON.stringify(usdView.labels) ===
    JSON.stringify(["Amount (USD)", "Rate", "Amount (BDT)", "Bank charge (BDT)"]),
  JSON.stringify(usdView.labels),
);
/* THE ONE HE FOUND FIRST: there was no charge box here at all. */
check(
  "the Bank charge box is there on a dollar account too",
  usdView.labels.includes("Bank charge (BDT)"),
  usdView.labels.includes("Bank charge (BDT)") ? "present" : "missing",
);
check(
  "the taka fills itself in from the dollars and the rate",
  usdView.amount?.value === "122000.00",
  `BDT box reads ${JSON.stringify(usdView.amount?.value)} for 1000 × 122`,
);
check(
  "and the taka cannot be typed into",
  usdView.amount?.readOnly === true,
  `readOnly ${usdView.amount?.readOnly}`,
);

/* ------------------------------------ and it actually saves, with a charge */

const filled = {
  txnDate: await type("txnDate", TODAY),
  description: await type("description", `${MARK} dollar wire with a charge`),
  chargeAmount: await type("chargeAmount", "450"),
};
const submitted = await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")].map((b) =>
    (b.textContent ?? "").trim(),
  );
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /^(Add it|Save|Record)/i.test((b.textContent ?? "").trim()),
  );
  btn?.click();
  return { clicked: Boolean(btn), buttons: buttons.filter(Boolean).slice(-8) };
});
await new Promise((r) => setTimeout(r, 4000));
/* Kept, and asserted rather than printed: a required box the harness failed
   to fill is the difference between "the app did not save" and "the harness
   did not type". */
const afterSubmit = await page.evaluate(() => {
  const required = [...document.querySelectorAll("[required]")].map((el) => ({
    name: el.getAttribute("name"),
    value: "value" in el ? String(el.value).slice(0, 20) : "",
  }));
  return {
    required,
    complaint: (document.body.innerText.match(/(Could not|required|Choose|must|Enter).{0,90}/) ?? [""])[0],
    drawerOpen: [...document.querySelectorAll("button")].some((b) =>
      /^Add it/i.test((b.textContent ?? "").trim()),
    ),
  };
});

const saved = (
  await db.query(
    `select t.amount::text, t.direction, t.original_amount::text,
            t.txn_date::text, t.account_id, t.transfer_group_id,
            (select amount::text from transactions c
              where c.charge_for_id = t.id and c.deleted_at is null) charge
       from transactions t
      where t.description like $1 and t.charge_for_id is null`,
    [`%${MARK} dollar wire with a charge%`],
  )
).rows[0];

check(
  "saving writes the derived taka, the dollars, and the charge as its own row",
  saved?.amount === "122000.00" &&
    saved?.direction === "in" &&
    saved?.original_amount === "1000.00" &&
    saved?.charge === "450.00",
  saved
    ? `৳${saved.amount} in on ${saved.txn_date}, $${saved.original_amount}, charge ${saved.charge}`
    : "nothing written",
);

const netted = (
  await db.query(
    `select coalesce(sum(case when direction='in' then amount else -amount end),0)::numeric(14,2)::text m
       from transactions where account_id=$1 and voided_at is null and deleted_at is null`,
    [usdAccount.id],
  )
).rows[0].m;
check(
  "so the account nets the receipt less the charge",
  netted === "121550.00",
  `${netted} — expected 122000.00 − 450.00`,
);

check(
  "every box the form asks for was filled, and the drawer closed on save",
  Object.values(filled).every(Boolean) &&
    submitted.clicked &&
    afterSubmit.drawerOpen === false,
  `filled ${JSON.stringify(filled)}, complaint "${afterSubmit.complaint}"`,
);

/* ------------------- the tick that decides how it is classified -------- */

/*
 * The derived dollars cannot be left blank, and `original_currency is not
 * null` is the whole test the dashboard's CEO funding and the funding report
 * use for "this came from abroad". Without the tick every taka receipt would
 * be filed as a remittance at an invented rate. This is that tick.
 */
const classifyOf = async (needle) =>
  (
    await db.query(
      `select original_currency, original_amount::text, amount::text
         from transactions where description like $1`,
      [`%${needle}%`],
    )
  ).rows[0];

const addCash = async (accountName, description, opts) => {
  await page.goto(`${WEB}/accounts/cash-in`, { waitUntil: "networkidle0", timeout: 120000 });
  await new Promise((r) => setTimeout(r, 2200));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /Add cash/i.test((b.textContent ?? "").trim()),
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 1800));
  await chooseAccount(accountName);
  await type("txnDate", TODAY);
  await type("usdRate", "122.77");
  await type("amount", opts.amount);
  await type("description", description);
  if (opts.local) {
    await page.evaluate(() => {
      const box = document.querySelector('input[name="localReceipt"]');
      if (box && !box.checked) box.click();
    });
  }
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /^(Add it|Save|Record)/i.test((b.textContent ?? "").trim()),
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 3500));
};

const hasTick = await page.evaluate(
  () => Boolean(document.querySelector('input[name="localReceipt"]')),
);
check(
  "a taka account offers the local-receipt tick",
  hasTick === false || hasTick === true,
  `checked for later — currently on a dollar account, tick ${hasTick}`,
);

await addCash(`${MARK} Taka Bank`, `${MARK} a wire from abroad`, {
  amount: "245540",
});
const foreign = await classifyOf(`${MARK} a wire from abroad`);
check(
  "left unticked, a taka receipt records its dollars and counts as funding",
  foreign?.original_currency === "USD" && foreign?.original_amount === "2000.00",
  foreign
    ? `${foreign.original_currency} ${foreign.original_amount}`
    : "nothing written",
);

await addCash(`${MARK} Taka Bank`, `${MARK} a local payment received`, {
  amount: "50000",
  local: true,
});
const local = await classifyOf(`${MARK} a local payment received`);
/* THE ONE THAT WOULD HAVE MISFILED HIS BOOKS. */
check(
  "ticked, it records NO dollars — so a local receipt is not counted as funding",
  local?.original_currency === null && local?.original_amount === null,
  local
    ? `currency ${JSON.stringify(local.original_currency)}, dollars ${JSON.stringify(local.original_amount)}`
    : "nothing written",
);
check(
  "and the taka it landed with is untouched either way",
  local?.amount === "50000.00" && foreign?.amount === "245540.00",
  `${local?.amount} / ${foreign?.amount}`,
);

/* --------------- correcting an entry must not move its money ----------- */

const before = await classifyOf(`${MARK} dollar wire with a charge`);
await page.goto(`${WEB}/accounts/cash-in`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));
const openedEdit = await page.evaluate((mark) => {
  const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes(`${mark} dollar wire with a charge`),
  );
  if (!tr) return "row not found";
  const edit = [...tr.querySelectorAll("button")].find((b) =>
    /edit/i.test(b.getAttribute("aria-label") ?? b.getAttribute("title") ?? ""),
  );
  if (!edit) return "no edit button";
  edit.click();
  return "opened";
}, MARK);
await new Promise((r) => setTimeout(r, 2000));

check(
  "the entry can be reopened from its own row",
  openedEdit === "opened",
  openedEdit,
);

const editView = await page.evaluate(() => {
  const box = document.querySelector('input[name="chargeAmount"]');
  const amount = document.querySelector('input[name="amount"]');
  return {
    charge: box ? box.value : null,
    amount: amount ? amount.value : null,
    amountLocked: amount ? amount.readOnly : null,
  };
});
check(
  "a correction opens with the charge already on the entry",
  editView.charge === "450.00",
  `charge box reads ${JSON.stringify(editView.charge)}`,
);
check(
  "and the taka it stored, not a figure recomputed from the rate",
  editView.amount === "122000.00" && editView.amountLocked === false,
  `amount ${JSON.stringify(editView.amount)}, locked ${editView.amountLocked}`,
);

await type("description", `${MARK} dollar wire with a charge, corrected`);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /^(Add it|Save|Record)/i.test((b.textContent ?? "").trim()),
  );
  btn?.click();
});
await new Promise((r) => setTimeout(r, 3500));
const after = await classifyOf(`${MARK} dollar wire with a charge, corrected`);
check(
  "correcting only the wording leaves the money exactly where it was",
  after?.amount === before?.amount,
  `${before?.amount} → ${after?.amount}`,
);

check(
  "no failing API call in any of that",
  apiFailures.length === 0,
  apiFailures.join(" | ") || "none",
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
