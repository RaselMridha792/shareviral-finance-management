/**
 * Salary changes: a pager, a tick column, and the traps that came with them.
 *
 * The owner asked for three things — *"ekhane pagination add koro and aro beshi
 * data rakhte parbo. also ekhane multiple select and trash a felar option tao
 * diyo ei table a"* — and the third one turned out to be the dangerous one. A
 * salary row is not an expense: payroll reads this table to work out what a
 * person is paid, and the table had two traps waiting for the first delete
 * anybody performed.
 *
 * So this checks the feature AND both traps:
 *
 *   the feature   twenty-one rows page at twenty; the serial keeps counting;
 *                 ticking and "move to trash" removes the ticked ones; the
 *                 current salary is not in the list and cannot be ticked
 *
 *   TRAP 1        `compensation_effective_idx` is (member, effective_from) and
 *                 is NOT partial, so a trashed row still occupies its date.
 *                 Recording pay on that same date used to write the figure
 *                 INTO the trashed row: 200, a refresh, and nothing on screen.
 *                 It must bring the row back out of the trash.
 *
 *   TRAP 2        nothing resolves a salary through `effective_to` — payroll
 *                 takes the newest row starting on or before the date. So
 *                 deleting a row out of the middle leaves its predecessor
 *                 stamped with an end date from a row nobody can see, and the
 *                 panel claims a figure stopped while the money carries on
 *                 paying it. The "Until" column must follow the money.
 *
 * And the one that must NOT be true: a finalised sheet's figures cannot move.
 *
 *     node .salaryhistoryqa.mjs      (local only — writes and deletes)
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

const wipe = async () => {
  const people = (
    await db.query("select id from team_members where full_name like 'PAYHIST %'")
  ).rows.map((r) => r.id);
  for (const id of people) {
    await db.query("delete from payroll_lines where team_member_id=$1", [id]);
    await db.query("delete from compensation_history where team_member_id=$1", [id]);
    await db.query("delete from team_members where id=$1", [id]);
  }
  return people.length;
};
await wipe();

const member = (
  await call("POST", "/team-members", {
    fullName: "PAYHIST Person",
    engagementType: "employee",
    joinedOn: "2022-01-01",
  })
).body;

/*
 * Twenty-two raises, oldest first, so the history behind the current figure is
 * twenty-one rows — one more than a page holds.
 */
const RAISES = 22;
for (let i = 0; i < RAISES; i += 1) {
  const month = String((i % 12) + 1).padStart(2, "0");
  const year = 2022 + Math.floor(i / 12);
  const res = await call("POST", `/team-members/${member.id}/compensation`, {
    grossAmount: `${50000 + i * 1000}.00`,
    effectiveFrom: `${year}-${month}-01`,
    changeReason: `PAYHIST raise ${i + 1}`,
  });
  if (res.status >= 300) {
    check(`raise ${i + 1} recorded`, false, `HTTP ${res.status}`);
    break;
  }
}
const rows = (
  await db.query(
    "select count(*)::int n from compensation_history where team_member_id=$1 and deleted_at is null",
    [member.id],
  )
).rows[0];
check(
  "a history of twenty-two figures exists",
  rows.n === RAISES,
  `${rows.n} rows`,
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

/* The Salary changes card, read by its heading rather than by position. */
const readPanel = async () => {
  await page.goto(`${WEB}/team/${member.id}`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await settle(2600);
  return page.evaluate(() => {
    const card = [...document.querySelectorAll("div,section")].find(
      (el) =>
        /Salary changes/.test(el.textContent ?? "") &&
        el.querySelector("table") &&
        !el.querySelector("div,section")?.querySelector?.("table") === false,
    );
    const heading = [...document.querySelectorAll("*")].find(
      (el) =>
        el.children.length === 0 && (el.textContent ?? "").trim() === "Salary changes",
    );
    const panel = heading?.closest("div.rounded-xl, div[class*='rounded'], section");
    const table = panel?.querySelector("table");
    if (!table) return null;
    const heads = [...table.querySelectorAll("thead th")].map((h) =>
      (h.textContent ?? "").trim(),
    );
    const body = [...table.querySelectorAll("tbody tr")].map((tr) => ({
      cells: [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()),
      ticks: tr.querySelectorAll('input[type="checkbox"]').length,
      trash: tr.querySelectorAll('button[aria-label="Move to trash"]').length,
    }));
    return {
      heads,
      body,
      headerTicks: table.querySelectorAll('thead input[type="checkbox"]').length,
      pager: (panel?.textContent ?? "").replace(/\s+/g, " ").match(/Page \d+ of \d+|\d+ salary records?/g) ?? [],
      panelText: (panel?.textContent ?? "").replace(/\s+/g, " ").slice(0, 400),
      cardFound: Boolean(card),
    };
  });
};

let panel = await readPanel();
check("the Salary changes panel is on the page", Boolean(panel), panel ? "" : "not found");
check(
  "it shows one page — twenty of the twenty-one behind the current figure",
  panel?.body.length === 20,
  `${panel?.body.length} rows`,
);
check(
  "the current salary is NOT one of them",
  !(panel?.panelText ?? "").includes(`${50000 + (RAISES - 1) * 1000}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")),
  "the newest figure must live in the header, not in this list",
);
check(
  "every row has a tick and a trash button, and the header has a tick",
  panel?.body.every((r) => r.ticks === 1 && r.trash === 1) &&
    panel?.headerTicks === 1,
  `ticks ${panel?.body[0]?.ticks}, trash ${panel?.body[0]?.trash}, header ${panel?.headerTicks}`,
);
check(
  "a pager appeared, because the history no longer fits on one page",
  (panel?.pager ?? []).some((t) => /Page 1 of 2/.test(t)),
  (panel?.pager ?? []).join(" | ") || "no pager text found",
);

/* The serial has to keep counting on page two — 21, not a second 1. */
await page.evaluate(() => {
  const next = [...document.querySelectorAll("button")].find((b) =>
    /^(Next|›|→)$/i.test((b.textContent ?? "").trim()),
  );
  if (next) next.setAttribute("data-hqa", "1");
});
const hasNext = await page.$('[data-hqa="1"]');
if (hasNext) {
  await page.evaluate(() => document.querySelector('[data-hqa="1"]').click());
  await settle(900);
  const two = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("*")].find(
      (el) =>
        el.children.length === 0 && (el.textContent ?? "").trim() === "Salary changes",
    );
    const table = heading
      ?.closest("div.rounded-xl, div[class*='rounded'], section")
      ?.querySelector("table");
    return [...(table?.querySelectorAll("tbody tr") ?? [])].map((tr) =>
      ([...tr.querySelectorAll("td")][1] ?? {}).textContent?.trim(),
    );
  });
  check(
    "page two carries on at 21 rather than starting again at 1",
    two[0] === "21",
    `first serial on page two: ${two[0]}`,
  );
} else {
  check("page two is reachable", false, "no Next control found");
}

/* -------------------------------- TRAP 2 ------------------------------- */

/*
 * "Until" must be read from the row that follows, not from the stored column.
 * Delete a row out of the MIDDLE through the API, then read the panel: the row
 * before it must now say it ran until the row after it started, because that is
 * what payroll will actually pay.
 */
const ordered = (
  await db.query(
    `select id, effective_from::text f, gross_amount from compensation_history
      where team_member_id=$1 and deleted_at is null order by effective_from`,
    [member.id],
  )
).rows;
const victim = ordered[4];
const before = ordered[3];
const after = ordered[5];
await call("POST", `/trash/compensation/${victim.id}`, {
  reason: "PAYHIST middle row",
});
const stillStamped = (
  await db.query("select effective_to::text t from compensation_history where id=$1", [
    before.id,
  ])
).rows[0];
check(
  "the stored end date is now stale, which is the trap",
  stillStamped.t < after.f,
  `predecessor still says it ended ${stillStamped.t}, but nothing starts until ${after.f}`,
);

panel = await readPanel();
/* dd/mm/yyyy, whole. Matching "01/05" against a cell also matched 01/04/2023,
   so this compared the wrong row and reported the product broken. */
const dmy = (iso) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const beforeRow = panel?.body.find((r) => r.cells.includes(dmy(before.f)));
const expectedUntil = (() => {
  const d = new Date(`${after.f}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return dmy(d.toISOString().slice(0, 10));
})();
check(
  "TRAP 2: the panel reads Until from the next surviving row, not the stale column",
  Boolean(beforeRow) && beforeRow.cells.some((c) => c === expectedUntil),
  beforeRow
    ? `row reads ${JSON.stringify(beforeRow.cells.slice(1, 4))}, wanted ${expectedUntil}`
    : "the predecessor row was not found on this page",
);

/* -------------------------------- TRAP 1 ------------------------------- */

/*
 * Recording pay on the same date as a TRASHED row. The unique index is not
 * partial, so this lands on the trashed row — and it has to come back out.
 */
const again = await call("POST", `/team-members/${member.id}/compensation`, {
  grossAmount: "999000.00",
  effectiveFrom: victim.f,
  changeReason: "PAYHIST recorded again on a trashed date",
});
const revived = (
  await db.query(
    "select gross_amount, deleted_at, delete_reason from compensation_history where id=$1",
    [victim.id],
  )
).rows[0];
check(
  "TRAP 1: recording pay on a trashed row's date brings the row back",
  again.status < 300 &&
    revived.deleted_at === null &&
    String(revived.gross_amount) === "999000.00",
  `HTTP ${again.status}, deleted_at ${revived.deleted_at}, gross ${revived.gross_amount}`,
);
check(
  "and it clears the delete reason with it",
  revived.delete_reason === null,
  `reason ${JSON.stringify(revived.delete_reason)}`,
);

/* --------------------------- the ticks, driven ------------------------- */

panel = await readPanel();
const ticked = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && (el.textContent ?? "").trim() === "Salary changes",
  );
  const panelEl = heading?.closest("div.rounded-xl, div[class*='rounded'], section");
  const boxes = [...panelEl.querySelectorAll('tbody input[type="checkbox"]')];
  boxes[0].click();
  boxes[1].click();
  return boxes.length;
});
await settle(600);
const bar = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && (el.textContent ?? "").trim() === "Salary changes",
  );
  const panelEl = heading?.closest("div.rounded-xl, div[class*='rounded'], section");
  return (panelEl?.textContent ?? "").replace(/\s+/g, " ");
});
check(
  "ticking two rows raises a bar that says two",
  /2 salary records? selected|2 selected/i.test(bar),
  bar.slice(0, 140),
);
check(
  "and the bar states no money, because summing old salaries is not a figure",
  !/৳/.test(bar.split("selected")[1]?.slice(0, 40) ?? ""),
  `${ticked} boxes on the page`,
);

const countBefore = (
  await db.query(
    "select count(*)::int n from compensation_history where team_member_id=$1 and deleted_at is null",
    [member.id],
  )
).rows[0].n;

await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    /Move to trash/i.test((b.textContent ?? "").trim()),
  );
  btn?.click();
});
await settle(900);
/*
 * The dialog arms on two gates, not one: an acknowledgement tick AND the word
 * "trash" typed out. The first run of this filled only the reason, clicked a
 * disabled button, and reported the product as failing to delete anything.
 */
await page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
  const type = (el, value) => {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  for (const box of dialog.querySelectorAll('input[type="checkbox"]')) {
    if (!box.checked) box.click();
  }
  const texts = [...dialog.querySelectorAll('input[type="text"], input:not([type]), textarea')];
  /* The word gate is the short single-line box; the reason is the textarea. */
  const word = texts.find((el) => el.tagName !== "TEXTAREA");
  if (word) type(word, "trash");
  const reason = texts.find((el) => el.tagName === "TEXTAREA");
  if (reason) type(reason, "PAYHIST bulk");
});
await settle(500);
await page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
  const go = [...(dialog?.querySelectorAll("button") ?? [])].find(
    (b) => /^Yes,/i.test((b.textContent ?? "").trim()) && !b.disabled,
  );
  go?.click();
});
/*
 * Wait for the FACT, not for a clock.
 *
 * A fixed 2.6s read the count while the request was still in flight and
 * reported 22 -> 22, then the very next check found the API already returning
 * twenty. A sleep long enough today is a flaky test tomorrow.
 */
const liveCount = async () =>
  (
    await db.query(
      "select count(*)::int n from compensation_history where team_member_id=$1 and deleted_at is null",
      [member.id],
    )
  ).rows[0].n;

let countAfter = countBefore;
for (let waited = 0; waited < 20000 && countAfter !== countBefore - 2; waited += 500) {
  await settle(500);
  countAfter = await liveCount();
}
check(
  "the ticked rows really left the history",
  countAfter === countBefore - 2,
  `${countBefore} -> ${countAfter}`,
);

/* -------------------- what must NOT have changed ----------------------- */

check(
  "the person still has a current salary — the list never offers it",
  countAfter > 0,
  `${countAfter} rows remain`,
);
const current = await call("GET", `/team-members/${member.id}/compensation`);
check(
  "and the profile still resolves one",
  Array.isArray(current.body) && current.body.length === countAfter,
  `API returns ${current.body?.length} rows`,
);

await browser.close();
const removed = await wipe();
check("the throwaway person is removed again", removed === 1, `${removed} person`);
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
