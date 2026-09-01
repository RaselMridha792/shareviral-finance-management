/**
 * The register opens on this month, and the plan has a page of its own.
 *
 * #19, in the owner's words: *"ekhane sudhu current month dekhabe oi month a
 * jodi kono subscription thake oigula dekhabe. r current month a new kena hole
 * otao dekhabe."* A plan is in a month if it had STARTED by the end of it —
 * everything running then, plus anything bought during it.
 *
 * #22: *"sl, date, account, invoice, transaction, login account, username,
 * depertment, billing cycle, next renewal date, status aigula important and
 * baki gula single page a jabe."*
 *
 * The two failures worth driving rather than reading:
 *
 *   THE FILTER MUST ACTUALLY NARROW. A filter wired to a query key the server
 *   ignores looks identical on screen — the same rows, no error. So this
 *   creates a plan started long ago and one started this month, and requires an
 *   OLD month to show the first and not the second.
 *
 *   THE SIX COLUMNS MUST NOT VANISH. They left the table; if they are not on
 *   the plan's page, the owner has lost data he could see yesterday.
 *
 *     node .subsmonthqa.mjs      (local only — writes and deletes)
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
const thisMonth = TODAY.slice(0, 7);
const wipe = async () => {
  const ids = (
    await db.query("select id from subscriptions where tool_name like 'SMQA %'")
  ).rows.map((r) => r.id);
  for (const id of ids) {
    await db.query("delete from subscription_users where subscription_id=$1", [id]);
    await db.query("delete from subscriptions where id=$1", [id]);
  }
  return ids.length;
};
await wipe();

const mk = async (toolName, startDate, extra = {}) =>
  (
    await call("POST", "/subscriptions", {
      toolName,
      planName: `${toolName} Team`,
      category: "ai_tool",
      costUsd: "20.00",
      usdRate: "122.50",
      costBdt: "2450.00",
      billingCycle: "monthly",
      startDate,
      notes: `${toolName} — a note long enough that a table cell would have cut it off well before the end of this sentence`,
      ...extra,
    })
  ).body;

/* One started long ago, one started this month. */
const old = await mk("SMQA Old Tool", "2024-02-10");
const fresh = await mk("SMQA New Tool", `${thisMonth}-03`);
check(
  "two plans exist, one old and one bought this month",
  Boolean(old?.id && fresh?.id),
  `${old?.startDate} / ${fresh?.startDate}`,
);

/* --------------------------- the filter, on the wire ------------------- */

const listed = async (startedBy) =>
  (
    await call(
      "GET",
      `/subscriptions?pageSize=200${startedBy ? `&startedBy=${startedBy}` : ""}`,
    )
  ).body?.items?.filter((r) => String(r.toolName ?? "").startsWith("SMQA")) ?? [];

const everyMonth = await listed(null);
check(
  "with no month, both are listed",
  everyMonth.length === 2,
  everyMonth.map((r) => r.toolName).join(", "),
);

const thisMonthEnd = (
  await db.query(
    `select (date_trunc('month', $1::date) + interval '1 month - 1 day')::date::text d`,
    [TODAY],
  )
).rows[0].d;
const now = await listed(thisMonthEnd);
check(
  "this month shows both — the old one is still running, the new one was just bought",
  now.length === 2,
  now.map((r) => r.toolName).join(", "),
);

/* THE ONE THAT CATCHES A FILTER THAT IS NOT WIRED UP. */
const past = await listed("2024-06-30");
check(
  "a month BEFORE the new plan existed does not show it",
  past.length === 1 && past[0].toolName === "SMQA Old Tool",
  past.map((r) => r.toolName).join(", ") || "nothing",
);
const beforeBoth = await listed("2023-12-31");
check(
  "and a month before either existed shows neither",
  beforeBoth.length === 0,
  beforeBoth.map((r) => r.toolName).join(", ") || "none",
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
await browser.setCookie({
  name: "sfm_access",
  value: token,
  domain: "localhost",
  path: "/",
});
const page = await browser.newPage();
await page.setViewport({ width: 1800, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2800);

const table = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("thead th")].map((h) =>
    (h.textContent ?? "").trim(),
  );
  const first = document.querySelector("tbody tr");
  const monthSelect = [...document.querySelectorAll("select")].find((s) =>
    s.getAttribute("aria-label") === "Month",
  );
  return {
    heads,
    cells: first ? first.querySelectorAll("td").length : 0,
    monthValue:
      monthSelect?.options[monthSelect.selectedIndex]?.textContent?.trim() ?? null,
    hasEveryMonth: [...(monthSelect?.options ?? [])].some(
      (o) => o.textContent?.trim() === "Every month",
    ),
  };
});

check(
  "19: the register carries a Month control",
  table.monthValue !== null,
  table.monthValue ?? "no Month select",
);
check(
  "19: and it opens on this month, not on Every month",
  table.monthValue !== "Every month" && /[0-9]{4}/.test(table.monthValue ?? ""),
  table.monthValue ?? "",
);
check(
  "19: with Every month one row away",
  table.hasEveryMonth,
  table.hasEveryMonth ? "" : "no escape from the month",
);

const GONE = ["Category", "Equivalent (BDT)", "Cost (USD)", "USD Rate", "Payment Method", "Notes"];
const KEPT = [
  "Start Date",
  "Tool Name",
  "Account/Card",
  "Invoice",
  "Reference",
  "Login accounts",
  "User Name",
  "User Department",
  "Billing Cycle",
  "Next Renewal Date",
  "Status",
];
check(
  "22: the six the owner does not read here are off the table",
  GONE.every((h) => !table.heads.includes(h)),
  GONE.filter((h) => table.heads.includes(h)).join(", ") || "all six gone",
);
check(
  "22: and the eleven he does read are still there",
  KEPT.every((h) => table.heads.includes(h)),
  KEPT.filter((h) => !table.heads.includes(h)).join(", ") || "all eleven present",
);
check(
  "22: the headings and the cells still agree on how many columns there are",
  table.cells === table.heads.length,
  `${table.heads.length} headings, ${table.cells} cells`,
);

/* ----------------------- the plan's own page --------------------------- */

await page.goto(`${WEB}/subscriptions/${old.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2600);
const detail = await page.evaluate(() => ({
  text: (document.querySelector("main")?.textContent ?? "").replace(/\s+/g, " "),
  backLink: Boolean(
    [...document.querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "/subscriptions",
    ),
  ),
}));

check(
  "22: the plan has a page of its own",
  detail.text.includes("SMQA Old Tool"),
  detail.text.slice(0, 90),
);
/*
 * The six that left the table, each by the label the page gives it. The
 * category is shown as its VALUE under the title ("AI Tool") rather than as a
 * labelled field, which is why it is checked differently — an earlier version
 * of this check looked for the word "Category" and reported the page as
 * missing something it shows more prominently than the rest.
 */
const onPage = [
  ["Cost (USD)", detail.text.includes("Cost (USD)")],
  ["USD rate", detail.text.includes("USD rate")],
  ["Equivalent (BDT)", detail.text.includes("Equivalent (BDT)")],
  ["Payment method", detail.text.includes("Payment method")],
  ["Notes", detail.text.includes("Notes")],
  ["the category", /AI Tool/i.test(detail.text)],
];
check(
  "22: and it carries every one of the six the table dropped",
  onPage.every(([, found]) => found),
  onPage
    .filter(([, found]) => !found)
    .map(([label]) => label)
    .join(", ") || "all six present",
);
check(
  "22: the note is shown whole, not cut off",
  detail.text.includes("well before the end of this sentence"),
  detail.text.includes("well before the end of this sentence")
    ? ""
    : "the note is truncated on its own page",
);
check(
  "22: with a way back to the register",
  detail.backLink,
  detail.backLink ? "" : "no way back",
);

/* And the table's name reaches it. */
await page.goto(`${WEB}/subscriptions`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2600);
const nameLink = await page.evaluate(() => {
  const row = [...document.querySelectorAll("tbody tr")].find((r) =>
    (r.textContent ?? "").includes("SMQA Old Tool"),
  );
  const link = [...(row?.querySelectorAll("a") ?? [])].find((a) =>
    (a.textContent ?? "").trim() === "SMQA Old Tool",
  );
  return link?.getAttribute("href") ?? null;
});
check(
  "22: the tool's name in the table opens its page",
  nameLink === `/subscriptions/${old.id}`,
  `${nameLink}`,
);

await browser.close();
const removed = await wipe();
check("the throwaway plans are removed again", removed === 2, `${removed}`);
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
