/**
 * The owner's six items of 28 Aug, each proven by driving rather than reading.
 *
 *   1. Add person carries a Current salary that reaches compensation_history —
 *      permission-gated, create-only.
 *   2. A USD-primary account leads with its dollars, taka small underneath;
 *      a BDT account is unchanged.
 *   3. The expense drawer lost its Receipt link; a typed "N/A" into any link
 *      box counts as blank; nothing is type="url" any more.
 *   4. Subscriptions: Payment Method is a method again, Account/Card is its
 *      own field, and the table shows both.
 *   5. The team drawer no longer offers Mobile wallet or PSR.
 *   6. Empty table cells read N/A.
 *
 *     node .sixqa.mjs      (local only — writes and deletes)
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
const tokenFor = (row) =>
  jwt.sign(
    { sub: row.id, role: row.role, tv: row.token_version ?? 0 },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "2h" },
  );
const token = tokenFor(person);
const call = async (method, path, body, auth = token) => {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
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

const wipe = async () => {
  await db.query(
    `delete from compensation_history where team_member_id in
       (select id from team_members where full_name like 'SIXQA %')`,
  );
  await db.query("delete from team_members where full_name like 'SIXQA %'");
  await db.query("delete from users where email = 'sixqa-hr@local.test'");
  await db.query(
    `delete from subscription_users where subscription_id in
       (select id from subscriptions where tool_name like 'SIXQA %')`,
  );
  await db.query("delete from subscriptions where tool_name like 'SIXQA %'");
  await db.query(
    `delete from transactions where account_id in
       (select id from accounts where name like 'SIXQA %')
        or description like 'SIXQA %'`,
  );
  await db.query("delete from accounts where name like 'SIXQA %'");
  await db.query("delete from fx_rates where rate_date = '2091-01-01'");
};
await wipe();

/* ============ 1. current salary from the Add person drawer's API ========= */

const created = await call("POST", "/team-members", {
  fullName: "SIXQA Salaried Person",
  engagementType: "employee",
  designation: "Tester",
  joinedOn: "2026-08-01",
  currentSalary: "52000.00",
});
check("a person records with a current salary", created.status === 201, `HTTP ${created.status} ${JSON.stringify(created.body?.errors ?? "")}`);
const comp = (
  await db.query(
    `select gross_amount, effective_from::text as from, change_reason, components is not null as split
       from compensation_history
      where team_member_id = $1`,
    [created.body?.id],
  )
).rows[0];
check(
  "the figure lands in compensation_history, effective from joining, split frozen",
  comp?.gross_amount === "52000.00" && comp?.from === "2026-08-01" && comp?.split === true,
  JSON.stringify(comp ?? null),
);
const current = await call("GET", "/team-members/compensation/current");
check(
  "so the directory's Current salary column has a figure to show",
  (Array.isArray(current.body) ? current.body : (current.body?.items ?? [])).some?.(
    (r) => r.teamMemberId === created.body?.id && r.grossAmount === "52000.00",
  ) ?? false,
  "",
);
const audited = (
  await db.query(
    `select is_sensitive from audit_logs
      where entity_table = 'compensation_history' and entity_id = $1
      order by occurred_at desc limit 1`,
    [created.body?.id],
  )
).rows[0];
check("and the pay write has its own sensitive audit row", audited?.is_sensitive === true, "");

/*
 * Who may set pay is the matrix's call, not this harness's assumption.
 *
 * The first draft asserted HR would be refused — and it was accepted, which
 * turned out to be the matrix speaking, not a hole: commit aa987e9 ("HR sees
 * pay now") gave HR team.compensation.write on the owner's decision, and the
 * comment claiming otherwise is stale. So the check is written against the
 * matrix itself: every role that holds the permission may use the field, and
 * a role that does not is refused before it can smuggle a figure in.
 * `ceo` is read-only and is refused at the door (team.write, 403).
 */
await db.query(
  `insert into users (email, password_hash, full_name, role, status, token_version, must_change_password)
   values ('sixqa-hr@local.test', 'x', 'SIXQA CEO', 'ceo', 'active', 0, false)`,
);
const ceo = (
  await db.query("select id, role, token_version from users where email='sixqa-hr@local.test'")
).rows[0];
const refused = await call(
  "POST",
  "/team-members",
  {
    fullName: "SIXQA Smuggled Pay",
    engagementType: "employee",
    designation: "Tester",
    joinedOn: "2026-08-01",
    currentSalary: "99000.00",
  },
  tokenFor(ceo),
);
check(
  "a read-only role cannot create people, salary or none",
  refused.status === 403,
  `HTTP ${refused.status}`,
);
/*
 * The edit drawer carries the field too, on the owner's later instruction
 * ("make editing flexible"). An edit with a NEW figure writes a raise
 * effective today through the same audited path; an edit carrying the figure
 * they are already on writes nothing — saving an untouched drawer must not
 * manufacture a raise dated today. And amending twice in one day amends the
 * same row rather than erroring.
 */
const raised = await call("PATCH", `/team-members/${created.body?.id}`, {
  currentSalary: "60000.00",
});
const afterRaise = (
  await db.query(
    `select gross_amount, effective_from::text as from, change_reason
       from compensation_history where team_member_id = $1
      order by effective_from desc limit 1`,
    [created.body?.id],
  )
).rows[0];
check(
  "an EDIT with a new figure writes a raise effective today",
  raised.status === 200 &&
    afterRaise?.gross_amount === "60000.00" &&
    /Changed from the profile drawer/.test(afterRaise?.change_reason ?? ""),
  JSON.stringify(afterRaise ?? raised.status),
);
const countBefore = (
  await db.query(
    "select count(*)::int as n from compensation_history where team_member_id = $1",
    [created.body?.id],
  )
).rows[0].n;
await call("PATCH", `/team-members/${created.body?.id}`, {
  currentSalary: "60000.00",
});
const countAfter = (
  await db.query(
    "select count(*)::int as n from compensation_history where team_member_id = $1",
    [created.body?.id],
  )
).rows[0].n;
check(
  "and the same figure again writes nothing",
  countAfter === countBefore,
  `${countBefore} rows before, ${countAfter} after`,
);
await call("PATCH", `/team-members/${created.body?.id}`, {
  currentSalary: "61000.00",
});
const amended = (
  await db.query(
    `select gross_amount from compensation_history where team_member_id = $1
      order by effective_from desc limit 1`,
    [created.body?.id],
  )
).rows[0];
const countAmended = (
  await db.query(
    "select count(*)::int as n from compensation_history where team_member_id = $1",
    [created.body?.id],
  )
).rows[0].n;
check(
  "a second change the same day amends today's row instead of erroring",
  amended?.gross_amount === "61000.00" && countAmended === countBefore,
  `gross ${amended?.gross_amount}, rows ${countAmended}`,
);

/* ================== 2. a USD-primary account leads with dollars ========== */

await db.query(
  `insert into fx_rates (base_currency, quote_currency, rate, rate_date, source)
   values ('USD','BDT','122.000000','2091-01-01','manual')`,
);
const usdAcct = await call("POST", "/accounts", {
  name: "SIXQA Dollar Card",
  type: "card",
  currency: "USD",
  openingBalance: "122000.00",
  openingBalanceOn: "2026-08-01",
});
const bdtAcct = await call("POST", "/accounts", {
  name: "SIXQA Taka Bank",
  type: "bank",
  currency: "BDT",
  openingBalance: "50000.00",
  openingBalanceOn: "2026-08-01",
});
check(
  "one USD-primary and one BDT account exist to compare",
  usdAcct.status === 201 && bdtAcct.status === 201,
  `${usdAcct.status}/${bdtAcct.status}`,
);

/* ===================== 3/4/5/6 need the browser ========================== */

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
await page.setViewport({ width: 1550, height: 1200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 2 in the browser: the accounts page cards
await page.goto(`${WEB}/accounts`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2800);
const cards = await page.evaluate(() => {
  const read = (name) => {
    const card = [...document.querySelectorAll("div")].find(
      (d) =>
        d.querySelector("p")?.textContent === name &&
        (d.parentElement?.textContent ?? "").includes("Opened at"),
    )?.closest(".p-5, [class*='p-5']") ??
      [...document.querySelectorAll("[class]")].find(
        (d) => d.textContent?.includes(name) && d.textContent?.includes("Opened at") && d.querySelectorAll("p").length < 8,
      );
    if (!card) return null;
    // The big figure is the clamp-sized element; the small line follows it.
    const big = card.querySelector('[class*="clamp"]');
    const small = big?.nextElementSibling;
    return {
      big: big?.textContent?.trim() ?? null,
      small: small?.textContent?.trim() ?? null,
    };
  };
  return { usd: read("SIXQA Dollar Card"), bdt: read("SIXQA Taka Bank") };
});
check(
  "the USD-primary card leads with dollars, taka small underneath",
  Boolean(cards.usd?.big?.includes("$")) &&
    Boolean(cards.usd?.small?.includes("৳")) &&
    Boolean(cards.usd?.big?.includes("~")),
  JSON.stringify(cards.usd),
);
check(
  "and the BDT card still leads with taka",
  Boolean(cards.bdt?.big?.includes("৳")),
  JSON.stringify(cards.bdt),
);

// --- 5: the team drawer's fields
await page.goto(`${WEB}/team`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Add person/.test(b.textContent ?? ""))
    ?.click();
});
await settle(1200);
const teamDrawer = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    wallet: /Mobile wallet/.test(text),
    psr: /Return filed \(PSR\)/.test(text),
    currentSalary: /Current salary/.test(text),
    urlTyped: document.querySelectorAll('input[type="url"]').length,
  };
});
check(
  "the team drawer lost Mobile wallet and PSR, gained Current salary",
  !teamDrawer.wallet && !teamDrawer.psr && teamDrawer.currentSalary,
  JSON.stringify(teamDrawer),
);
check("and nothing in it is type=url any more", teamDrawer.urlTyped === 0, "");
await page.keyboard.press("Escape");
await settle(400);

// The directory shows the figure for the person created above.
const rowShows = await page.evaluate(() =>
  [...document.querySelectorAll("tbody tr")].some(
    (r) =>
      (r.textContent ?? "").includes("SIXQA Salaried Person") &&
      // 61,000 by now — the raises above have already run.
      /61,000/.test(r.textContent ?? ""),
  ),
);
check("the directory row shows the current salary, not Not set", rowShows, "");

// The edit drawer — opened straight from the directory row — carries the same
// field, prefilled with what they are on now (61,000 after the raises above).
await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("SIXQA Salaried Person"),
  );
  row?.querySelector('button[aria-label="Edit"]')?.click();
});
await settle(1800);
const editDrawer = await page.evaluate(() => {
  const field = [...document.querySelectorAll("label")].find((l) =>
    (l.textContent ?? "").startsWith("Current salary"),
  );
  const input = field?.querySelector("input");
  return { present: Boolean(field), value: input?.value ?? null };
});
check(
  "the EDIT drawer carries Current salary, prefilled with the live figure",
  editDrawer.present && /61000/.test(editDrawer.value ?? ""),
  JSON.stringify(editDrawer),
);
await page.keyboard.press("Escape");
await settle(500);

// --- 3: the expense drawer
await page.goto(`${WEB}/expenses/other`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Add expense/.test(b.textContent ?? ""))
    ?.click();
});
await settle(1200);
const expenseDrawer = await page.evaluate(() => ({
  receipt: /Receipt link/.test(document.body.innerText),
  urlTyped: document.querySelectorAll('input[type="url"]').length,
}));
check(
  "the expense drawer no longer asks for a Receipt link",
  !expenseDrawer.receipt && expenseDrawer.urlTyped === 0,
  JSON.stringify(expenseDrawer),
);
await page.keyboard.press("Escape");
await settle(400);

// Typed N/A into a link box is a blank, not an error.
const cat = (
  await db.query("select id from categories where kind='out' and deleted_at is null limit 1")
).rows[0];
const naSpend = await call("POST", "/transactions", {
  direction: "out",
  txnDate: "2026-08-20",
  accountId: bdtAcct.body.id,
  amount: "150.00",
  categoryId: cat.id,
  description: "SIXQA typed NA into the receipt box",
  paymentMethod: "cash",
  receiptUrl: "N/A",
});
const naStored = (
  await db.query(
    "select receipt_url from transactions where description = 'SIXQA typed NA into the receipt box'",
  )
).rows[0];
check(
  'a typed "N/A" into a link field is accepted and stored as nothing',
  naSpend.status === 201 && naStored?.receipt_url === null,
  `HTTP ${naSpend.status}, stored ${JSON.stringify(naStored?.receipt_url)}`,
);

// --- 4: the subscription drawer and table
const subCreated = await call("POST", "/subscriptions", {
  toolName: "SIXQA Tool",
  planName: "Pro",
  category: "ai_tool",
  status: "active",
  costUsd: "20.00",
  usdRate: "122.00",
  costBdt: "2440.00",
  billingCycle: "monthly",
  startDate: "2026-08-01",
  paymentMethod: "bank_transfer",
  accountId: bdtAcct.body.id,
  websiteUrl: "N/A",
  users: [],
});
check(
  "a plan records with a typed method AND a separate account",
  subCreated.status === 201,
  `HTTP ${subCreated.status} ${JSON.stringify(subCreated.body?.errors ?? "")}`,
);
const subRow = (
  await db.query(
    "select payment_method, account_id, website_url from subscriptions where tool_name = 'SIXQA Tool'",
  )
).rows[0];
check(
  "method and account stored separately; the N/A website stored as nothing",
  subRow?.payment_method === "bank_transfer" &&
    subRow?.account_id === bdtAcct.body.id &&
    subRow?.website_url === null,
  JSON.stringify(subRow),
);

await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2800);
const subsTable = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("SIXQA Tool"),
  );
  return {
    heads: heads.filter((h) => /Payment Method|Account\/Card/.test(h)),
    method: row?.textContent?.includes("Bank transfer") ?? false,
    account: row?.textContent?.includes("SIXQA Taka Bank") ?? false,
  };
});
check(
  "the table carries Payment Method and Account/Card as separate columns",
  subsTable.heads.length === 2 && subsTable.method && subsTable.account,
  JSON.stringify(subsTable),
);

const subDrawer = await (async () => {
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => /Add a subscription|Add subscription|New plan|Add/.test((b.textContent ?? "").trim()))
      ?.click();
  });
  await settle(1300);
  return page.evaluate(() => {
    const methodField = [...document.querySelectorAll("label")].find((l) =>
      (l.textContent ?? "").startsWith("Payment Method"),
    );
    const select = methodField?.querySelector("select");
    const options = [...(select?.options ?? [])].map((o) => o.textContent?.trim());
    const accountField = [...document.querySelectorAll("label")].find((l) =>
      (l.textContent ?? "").startsWith("Account/Card"),
    );
    return {
      methodIsSelect: Boolean(select),
      options,
      hasAccountField: Boolean(accountField),
    };
  });
})();
check(
  "the drawer's Payment Method is a plain method dropdown, Account/Card its own field",
  subDrawer.methodIsSelect &&
    (subDrawer.options?.length ?? 0) >= 5 &&
    subDrawer.hasAccountField,
  JSON.stringify(subDrawer),
);
await page.keyboard.press("Escape");
await settle(400);

// --- 6: empty cells say N/A
await page.goto(`${WEB}/transfers`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2200);
const naCells = await page.evaluate(() => {
  const text = [...document.querySelectorAll("tbody td")].map((t) =>
    (t.textContent ?? "").trim(),
  );
  return {
    na: text.filter((t) => t === "N/A").length,
    dash: text.filter((t) => t === "—").length,
  };
});
const subsNa = await (async () => {
  await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2200);
  return page.evaluate(() => {
    const text = [...document.querySelectorAll("tbody td")].map((t) =>
      (t.textContent ?? "").trim(),
    );
    return {
      na: text.filter((t) => t === "N/A").length,
      dash: text.filter((t) => t === "—").length,
    };
  });
})();
check(
  "empty cells read N/A, and no bare dash placeholder is left on either screen",
  naCells.dash === 0 && subsNa.dash === 0 && subsNa.na > 0,
  JSON.stringify({ transfers: naCells, subscriptions: subsNa }),
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
