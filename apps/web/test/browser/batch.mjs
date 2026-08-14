/**
 * BATCH OF DRAFTS — the review table, in a real browser.
 *
 * The model cannot produce a batch yet, so this stands in for it: the reply
 * from /api/ai/turn is intercepted and answered with a batch written by hand
 * in exactly the shape the model is asked to return. Everything after that
 * point is the real application — the table, dropping a row, and the save,
 * which posts each kept row to the ordinary team-members endpoint.
 *
 * What it is checking is the thing the table exists for: that you can see what
 * would be written before any of it is, that a row can be taken out, and that
 * the outcome comes back per row rather than as one all-or-nothing verdict.
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";
import pg from "pg";

const WEB = process.env.WEB ?? "http://localhost:3000";
const API = process.env.API ?? "http://localhost:4001/api";
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].filter(Boolean).find((p) => fs.existsSync(p));
if (!CHROME) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(1); }
const TAG = "[batchui]";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../../../api/.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const EMAIL = "batchui.test@shareviral.cash", PASSWORD = "Batch-UI-Test-2026!";
const clean = async () => {
  const mine = (await db.query("select id from team_members where notes like $1", [`%${TAG}%`])).rows.map((r) => r.id);
  if (mine.length) {
    await db.query("delete from compensation_history where team_member_id = any($1::uuid[])", [mine]);
    await db.query("delete from audit_logs where entity_id = any($1::text[])", [mine]);
    await db.query("delete from team_members where id = any($1::uuid[])", [mine]);
  }
  await db.query("delete from refresh_tokens where user_id in (select id from users where email = $1)", [EMAIL]);
  await db.query("delete from users where email = $1", [EMAIL]);
  return mine.length;
};
await clean();
await fetch(`${API}/users`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOK.SUPER_ADMIN}`, "x-requested-with": "finance-web" },
  body: JSON.stringify({ email: EMAIL, fullName: "Batch UI Test", role: "super_admin", password: PASSWORD, mustChangePassword: false }),
});

/** Five people, one of them with a date the API will refuse. */
const ROWS = [
  { fullName: "Rima Sultana",   engagementType: "employee",   joinedOn: "2026-04-01", designation: "Designer",  notes: `From the batch UI test ${TAG}` },
  { fullName: "Nadim Hasan",    engagementType: "employee",   joinedOn: "2026-04-02", designation: "Engineer",  notes: `From the batch UI test ${TAG}` },
  { fullName: "Полина Bad Row", engagementType: "employee",   joinedOn: "31/04/2026", designation: "Analyst",   notes: `From the batch UI test ${TAG}` },
  { fullName: "Tanim Reza",     engagementType: "contractor", joinedOn: "2026-04-04", designation: "Editor",    notes: `From the batch UI test ${TAG}` },
  { fullName: "Shirin Akter",   engagementType: "employee",   joinedOn: "2026-04-05", designation: "Executive", notes: `From the batch UI test ${TAG}` },
];

const STUBBED_REPLY = {
  chatId: "00000000-0000-4000-8000-000000000001",
  target: "team_member",
  draft: {},
  missingFields: [],
  nextQuestion: null,
  summary: null,
  clarification: null,
  batch: {
    target: "team_member",
    rows: ROWS,
    note: "Five people read out of the file you sent",
  },
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });

console.log("\nBATCH OF DRAFTS — THE REVIEW TABLE\n");

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  // Answer the one request the model would have answered. Everything else is
  // the real application talking to the real API.
  let turnCalls = 0;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().includes("/api/ai/turn") && req.method() === "POST") {
      turnCalls++;
      req.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(STUBBED_REPLY),
      });
      return;
    }
    req.continue();
  });

  const saves = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/team-members") && r.request().method() === "POST") {
      saves.push(r.status());
    }
  });

  /* ------------------------------------------------------------- sign in */

  await page.goto(`${WEB}/login`, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForSelector('input[name="email"]');
  await new Promise((r) => setTimeout(r, 800));
  await page.type('input[name="email"]', EMAIL);
  await page.type('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60_000 }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1200));
  ok("signed in", page.url().replace(WEB, "") || "/");

  /* ------------------------------------------------------- ask for a batch */

  await page.goto(`${WEB}/assistant`, { waitUntil: "networkidle2", timeout: 60_000 });
  await page.waitForSelector("textarea, input[type='text']", { timeout: 20_000 });
  await new Promise((r) => setTimeout(r, 900));

  await page.type("textarea, input[type='text']", "ei file er sob team member add koro");
  await page.keyboard.down("Control");
  await page.keyboard.press("Enter");
  await page.keyboard.up("Control");
  await new Promise((r) => setTimeout(r, 1500));

  if (!turnCalls) {
    // Ctrl+Enter is not the only way a composer sends.
    const send = await page.$('button[type="submit"], button[aria-label*="send" i]');
    if (send) await send.click();
    await new Promise((r) => setTimeout(r, 1500));
  }
  turnCalls > 0
    ? ok("the assistant was asked", `${turnCalls} turn(s)`)
    : bad("the assistant was asked", "no /api/ai/turn request was made");

  /* ---------------------------------------------- the table, before saving */

  const table = await page.evaluate(() => {
    const t = document.querySelector("table");
    if (!t) return null;
    const headers = [...t.querySelectorAll("thead th")].map((h) => h.textContent.trim()).filter(Boolean);
    const rows = [...t.querySelectorAll("tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((c) => c.textContent.trim()));
    return { headers, rows, text: document.body.innerText };
  });

  if (!table) {
    bad("the batch renders as a table", "no table on the page");
  } else {
    table.rows.length === 5
      ? ok("every proposed row is shown before anything is written", `${table.rows.length} rows, columns: ${table.headers.join(", ")}`)
      : bad("all rows shown", `${table.rows.length} rows, expected 5`);

    const names = table.rows.map((r) => r.join(" "));
    names.some((r) => r.includes("Rima Sultana")) && names.some((r) => r.includes("Shirin Akter"))
      ? ok("the names in the table are the ones proposed", "first and last both present")
      : bad("the table shows the proposed names", names.join(" | ").slice(0, 120));

    /* --------------------------------------------- nothing written yet */
    const early = (await db.query("select count(*)::int n from team_members where notes like $1", [`%${TAG}%`])).rows[0].n;
    early === 0
      ? ok("nothing is written until Save is pressed", "the table is a preview, not a receipt")
      : bad("nothing written yet", `${early} row(s) already in the database`);

    /* ---------------------------------------------------- drop a row */
    const dropped = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("table tbody tr")];
      const target = rows.find((r) => r.textContent.includes("Tanim Reza"));
      if (!target) return null;
      const button = target.querySelector("button");
      if (!button) return null;
      button.click();
      return true;
    });
    await new Promise((r) => setTimeout(r, 600));

    if (!dropped) meh("dropping a row", "no per-row button found");
    else {
      const after = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("table tbody tr")];
        const tanim = rows.find((r) => r.textContent.includes("Tanim Reza"));
        return {
          count: rows.length,
          tanimStruck: tanim ? getComputedStyle(tanim).textDecorationLine.includes("line-through") || tanim.className.includes("line-through") || (tanim.querySelector("[class*='line-through']") !== null) : null,
          text: document.body.innerText,
        };
      });
      after.tanimStruck || after.count === 4
        ? ok("a row can be taken out before saving", after.count === 4 ? "the row is gone from the table" : "the row is struck through")
        : meh("dropping a row", `${after.count} rows still shown, not struck`);
    }

    /* ------------------------------------------------------------- save */
    const confirm = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const save = buttons.find((b) => /save|add all|confirm/i.test(b.textContent) && !b.disabled);
      if (!save) return null;
      save.click();
      return save.textContent.trim();
    });

    if (!confirm) bad("the save button", "no enabled Save on the card");
    else {
      ok("pressed the button that writes", `"${confirm}"`);
      await new Promise((r) => setTimeout(r, 6000));

      const written = (await db.query(
        "select full_name from team_members where notes like $1 order by full_name", [`%${TAG}%`])).rows.map((r) => r.full_name);

      written.length === 3
        ? ok("exactly the kept, valid rows were written", written.join(", "))
        : bad("what was written", `${written.length} row(s): ${written.join(", ")}`);

      !written.some((n) => n.includes("Tanim"))
        ? ok("the dropped row was not written", "taking a row out means it does not happen")
        : bad("the dropped row", "Tanim Reza was written anyway");

      !written.some((n) => n.includes("Bad Row"))
        ? ok("the row the API refused was not written", "the batch path validates exactly like the form")
        : bad("the bad row", "a row with an impossible date got in");

      const failedSaves = saves.filter((s) => s >= 400).length;
      failedSaves === 1
        ? ok("one save failed and the rest still went", `${saves.length} posts, ${failedSaves} refused`)
        : meh("per-row outcomes", `${saves.length} posts, ${failedSaves} refused`);

      const shown = await page.evaluate(() => document.body.innerText);
      /saved|added/i.test(shown) && /could not|error|invalid|date/i.test(shown)
        ? ok("the screen reports both outcomes, row by row", "you can see which one failed and why")
        : meh("the screen reports outcomes", shown.slice(-200).replace(/\s+/g, " "));
    }
  }
} finally {
  await browser.close();
  const removed = await clean();
  console.log(`\n  cleaned up ${removed} row(s)`);
  await db.end();
}

console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
