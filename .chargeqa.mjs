/**
 * The card's charge, added to a plan's price wherever the price is used.
 *
 * The owner:
 *
 *   *"Ai tools and subscription er eikhane tumi charge name akta field rakhba
 *    jeta actual price er sathe add hobe calculation er somoy and table eo
 *    dekhabe + diye choto kore."*
 *
 * Two things are worth driving rather than reading here, and neither shows in
 * a diff:
 *
 *   THE MONEY. "Calculation er somoy" is not the form's own arithmetic — it is
 *   the moment a payment is recorded, when a real amount leaves a real
 *   account. So this records one and reads the LEDGER back, not the label.
 *
 *   THE THING IT MUST NOT BREAK. The three price figures derive from each
 *   other: type any two and the third follows. A charge that got folded into
 *   that group would make the rate somebody reads back off the plan wrong —
 *   so this types a new rate after setting a charge and asserts the charge did
 *   not move.
 *
 *     node .chargeqa.mjs      (local only — writes and deletes)
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

const MARK = "CHGQA";
const wipe = async () => {
  await db.query(
    "delete from transactions where subscription_id in (select id from subscriptions where tool_name like $1)",
    [`${MARK}%`],
  );
  await db.query("delete from subscriptions where tool_name like $1", [`${MARK}%`]);
  await db.query("delete from transactions where description like $1", [`${MARK}%`]);
  await db.query("delete from accounts where name like $1", [`${MARK}%`]);
};
await wipe();

const account = (
  await call("POST", "/accounts", {
    name: `${MARK} Card`,
    type: "card",
    currency: "USD",
    openingBalance: "1000000.00",
    openingBalanceOn: "2026-08-01",
  })
).body;

const makePlan = async (name, extra) =>
  (
    await call("POST", "/subscriptions", {
      toolName: name,
      planName: "Pro",
      category: "ai_tool",
      status: "active",
      costUsd: "100.00",
      usdRate: "122.77",
      costBdt: "12277.00",
      billingCycle: "monthly",
      startDate: "2026-08-01",
      accountId: account.id,
      paymentMethod: "card",
      ...extra,
    })
  ).body;

const withCharge = await makePlan(`${MARK} Charged`, { chargeUsd: "5.00" });
const noCharge = await makePlan(`${MARK} Plain`, {});

check(
  "a plan can be created with a charge on it",
  Boolean(withCharge?.id) && withCharge?.chargeUsd === "5.00",
  `chargeUsd ${withCharge?.chargeUsd}`,
);
check(
  "and one without still reads null rather than 0.00",
  noCharge?.chargeUsd === null,
  `chargeUsd ${JSON.stringify(noCharge?.chargeUsd)}`,
);

/* ---------------- THE ONE THAT MUST NOT BREAK: the derived triple ------- */

const reRated = await call("PATCH", `/subscriptions/${withCharge.id}`, {
  usdRate: "130.00",
  costBdt: "13000.00",
});
/* PATCH answers with nothing — the mutation returns void — so the plan is read
   back rather than believed. A first draft asserted against `reRated.body` and
   reported four undefineds, which said nothing about the app. */
const rePriced = (await call("GET", `/subscriptions/${withCharge.id}`)).body;
check(
  "re-pricing the plan leaves the charge exactly where it was",
  reRated.status < 300 && rePriced?.chargeUsd === "5.00",
  `rate 122.77 → ${rePriced?.usdRate}, charge ${rePriced?.chargeUsd}`,
);
check(
  "and the rate still ties out against the price it was derived from",
  Math.abs(
    Number(rePriced?.costBdt) -
      Number(rePriced?.costUsd) * Number(rePriced?.usdRate),
  ) < 0.01,
  `${rePriced?.costUsd} × ${rePriced?.usdRate} = ${rePriced?.costBdt}`,
);

/* Put it back, so the arithmetic below is the round number. */
await call("PATCH", `/subscriptions/${withCharge.id}`, {
  usdRate: "122.77",
  costBdt: "12277.00",
});

/* -------------------- THE MONEY: what actually leaves the account ------ */

const balanceOf = async () =>
  (
    await db.query(
      `select coalesce(sum(case when direction='in' then amount else -amount end),0)::numeric(14,2)::text m
         from transactions where account_id=$1 and voided_at is null and deleted_at is null`,
      [account.id],
    )
  ).rows[0].m;

const before = await balanceOf();
const paid = await call("POST", `/subscriptions/${withCharge.id}/pay`, {
  txnDate: "2026-08-05",
});
const after = await balanceOf();
const moved = (Number(before) - Number(after)).toFixed(2);

check(
  "recording a payment succeeds",
  paid.status < 300,
  `HTTP ${paid.status}${paid.status >= 300 ? ` ${JSON.stringify(paid.body).slice(0, 120)}` : ""}`,
);
check(
  "and the ledger takes out the price PLUS the charge, not the price",
  moved === "12890.85",
  `${moved} moved — expected 12277.00 + ($5.00 x 122.77) = 12890.85`,
);

const plainBefore = await balanceOf();
await call("POST", `/subscriptions/${noCharge.id}/pay`, { txnDate: "2026-08-05" });
const plainAfter = await balanceOf();
check(
  "a plan with no charge still takes out exactly its price — nothing regressed",
  (Number(plainBefore) - Number(plainAfter)).toFixed(2) === "12277.00",
  `${(Number(plainBefore) - Number(plainAfter)).toFixed(2)} moved`,
);

const typedBefore = await balanceOf();
await call("POST", `/subscriptions/${withCharge.id}/pay`, {
  txnDate: "2026-08-06",
  amount: "9000.00",
});
const typedAfter = await balanceOf();
check(
  "a typed amount still beats both — the box is why it exists",
  (Number(typedBefore) - Number(typedAfter)).toFixed(2) === "9000.00",
  `${(Number(typedBefore) - Number(typedAfter)).toFixed(2)} moved`,
);

/* -------------------------------- the screen --------------------------- */

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
await page.setViewport({ width: 1900, height: 1300 });

/* The plan's own page, which is where the money figures live. */
await page.goto(`${WEB}/subscriptions/${withCharge.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 2000));

const planPage = await page.evaluate(() => {
  const read = (label) => {
    const dt = [...document.querySelectorAll("dt")].find(
      (d) => (d.textContent ?? "").trim().toLowerCase() === label.toLowerCase(),
    );
    if (!dt) return null;
    const lines = [];
    let el = dt.nextElementSibling;
    while (el && el.tagName === "DD") {
      lines.push((el.textContent ?? "").trim());
      el = el.nextElementSibling;
    }
    return lines;
  };
  return {
    blank: document.body.innerText.length < 300,
    cost: read("Cost (USD)"),
    equivalent: read("Equivalent (BDT)"),
    total: read("Total per cycle"),
  };
});

check("the plan page rendered", !planPage.blank, planPage.blank ? "near-empty" : "content present");
check(
  "the charge is printed under the dollar price it is added to, signed with a +",
  (planPage.cost ?? []).length === 2 &&
    /^\+/.test(planPage.cost[1]) &&
    /5\.00/.test(planPage.cost[1]),
  JSON.stringify(planPage.cost),
);
check(
  "and the page states the total the two come to, in both currencies",
  /105\.00/.test((planPage.total ?? []).join(" ")) &&
    /12,?890\.85/.test((planPage.total ?? []).join(" ")),
  JSON.stringify(planPage.total),
);

/* A plan with no charge must print no mark at all. */
await page.goto(`${WEB}/subscriptions/${noCharge.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await new Promise((r) => setTimeout(r, 1500));
const plainPage = await page.evaluate(() => {
  const dt = [...document.querySelectorAll("dt")].find(
    (d) => (d.textContent ?? "").trim() === "Cost (USD)",
  );
  const lines = [];
  let el = dt?.nextElementSibling;
  while (el && el.tagName === "DD") {
    lines.push((el.textContent ?? "").trim());
    el = el.nextElementSibling;
  }
  return lines;
});
check(
  "a plan with no charge prints no + at all — a mark on everything marks nothing",
  plainPage.length === 1,
  JSON.stringify(plainPage),
);

/* ---- the register: one Total column, the split small underneath ---- */

await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

const table = await page.evaluate((mark) => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const col = heads.findIndex((h) => /^Total \/ cycle$/i.test(h));
  const read = (needle) => {
    const tr = [...document.querySelectorAll("tbody tr")].find((r) =>
      (r.textContent ?? "").includes(needle),
    );
    if (!tr) return null;
    const cell = [...tr.querySelectorAll("td")][col];
    if (!cell) return null;
    const box = cell.firstElementChild ?? cell;
    return {
      lines: [...box.children].map((el) => (el.textContent ?? "").trim()),
      text: (cell.textContent ?? "").trim(),
    };
  };
  return {
    blank: document.body.innerText.length < 300,
    heads,
    col,
    charged: read(`${mark} Charged`),
    plain: read(`${mark} Plain`),
  };
}, MARK);

check("the register rendered", !table.blank, table.blank ? "near-empty" : "content present");
check(
  "the register carries one Total / cycle column",
  table.col >= 0,
  table.heads.join(" | ").slice(0, 140),
);
check(
  "a charged plan shows the total that leaves the account",
  /12,?890\.85/.test(table.charged?.text ?? ""),
  table.charged?.text ?? "row not found",
);
check(
  "with the split under it in dollars, small",
  (table.charged?.lines ?? []).length === 2 &&
    /\$100\.00\s*\+\s*\$5\.00/.test(table.charged.lines[1]),
  JSON.stringify(table.charged?.lines),
);
check(
  "and a plan with no charge shows the figure alone — no empty + line",
  (table.plain?.lines ?? []).length === 1 &&
    /12,?277\.00/.test(table.plain.lines[0]),
  JSON.stringify(table.plain?.lines),
);

/* The form: the box, and the running total beside it. */
await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await new Promise((r) => setTimeout(r, 2000));
const formOpened = await page.evaluate(() => {
  const add = [...document.querySelectorAll("button")].find((b) =>
    /add a subscription|add subscription|^add$/i.test((b.textContent ?? "").trim()),
  );
  if (add) add.click();
  return Boolean(add);
});
await new Promise((r) => setTimeout(r, 1500));

const form = await page.evaluate(() => {
  const labels = [...document.querySelectorAll("label")].map((l) =>
    (l.textContent ?? "").trim(),
  );
  const chargeLabel = [...document.querySelectorAll("label")].find((l) =>
    /^Charge \(USD\)/.test((l.textContent ?? "").trim()),
  );
  const box = chargeLabel
    ? (chargeLabel.control ??
      chargeLabel.parentElement?.querySelector("input"))
    : null;
  return {
    opened: labels.length > 0,
    labels: labels.slice(0, 30),
    hasCharge: Boolean(box),
    totalLine: document.body.innerText.match(/Total per \w+:.*/)?.[0] ?? "",
  };
});

check("the add drawer opened", formOpened && form.opened, `labels ${form.labels.length}`);
check(
  "it offers a Charge (USD) box",
  form.hasCharge,
  form.labels.filter((l) => /charge|BDT|USD/i.test(l)).join(" | ").slice(0, 90),
);
check(
  "and shows the running total the two come to, so nobody adds it up themselves",
  /Total per/.test(form.totalLine),
  form.totalLine.slice(0, 90) || "no total line",
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
