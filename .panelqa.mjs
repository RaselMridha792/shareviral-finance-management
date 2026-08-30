/**
 * Every Settings tab, and every table inside the period statement.
 *
 * Both are places where a screen is really several screens, and a sweep that
 * loads the route only ever sees the first one. A panel that throws on its own
 * fetch, or a statement table that renders its heading and no rows, is
 * invisible from outside.
 */
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import pg from "pg";
import puppeteer from "puppeteer-core";

const REPO = "d:/codes/Finance-Management-software";
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
await c.end();

const token = jwt.sign(
  { sub: u.id, role: u.role, tv: u.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
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

const problems = [];

/* ---- Settings, tab by tab --------------------------------------------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1100 });
  const bad = [];
  page.on("console", (m) => {
    if (m.type() === "error") bad.push(m.text().slice(0, 90));
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/api/"))
      bad.push(`${r.status()} ${r.url().replace(/.*\/api/, "")}`);
  });

  await page
    .goto("http://localhost:3000/settings", { waitUntil: "networkidle0", timeout: 120000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 2200));

  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()),
  );
  console.log(`Settings has ${tabs.length} tabs\n`);

  for (const label of tabs) {
    bad.length = 0;
    await page.evaluate((l) => {
      [...document.querySelectorAll('[role="tab"]')]
        .find((t) => t.textContent.trim() === l)
        ?.click();
    }, label);
    await new Promise((r) => setTimeout(r, 1800));

    const seen = await page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      const text = main.innerText;
      return {
        chars: text.length,
        /*
         * The app's own error sentences, not the word "failed".
         *
         * The audit panel lists an action called "Failed sign-in", and a
         * loose match on that word reported a perfectly healthy panel as
         * broken. A screen's content is not a diagnosis of the screen.
         */
        broken:
          /this page couldn.t load|could not load|could not read|something went wrong/i.test(
            text,
          ),
        controls: main.querySelectorAll("input,select,textarea,button").length,
        tables: main.querySelectorAll(".table-data").length,
      };
    });

    const trouble = [...new Set(bad)];
    console.log(
      `   ${label.padEnd(24)} ${String(seen.controls).padStart(3)} controls  ` +
        `${seen.tables} table(s)  ` +
        (seen.broken ? "SAYS IT FAILED" : trouble.length ? "errors" : "renders"),
    );
    if (seen.broken) problems.push(`Settings → ${label}: the panel says it failed`);
    for (const t of trouble.slice(0, 2))
      problems.push(`Settings → ${label}: ${t}`);
  }
  await page.close();
}

/* ---- the statement's inner tables ------------------------------------- */
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1400 });
  await page
    .goto("http://localhost:3000/reports", { waitUntil: "networkidle0", timeout: 120000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 2800));

  const tables = await page.evaluate(() =>
    [...document.querySelectorAll(".table-data")].map((t) => {
      const caption =
        t.closest("section,div")?.querySelector("h2,h3")?.textContent?.trim() || "";
      const body = [...t.querySelectorAll("tbody tr")];
      return {
        caption: caption.slice(0, 34),
        heads: [...t.querySelectorAll("thead th")].filter((h) => h.textContent.trim())
          .length,
        rows: body.length,
        empty: body.filter((r) => r.querySelector("td[colspan]")).length,
      };
    }),
  );

  console.log(`\nReports carries ${tables.length} tables\n`);
  for (const [i, t] of tables.entries()) {
    console.log(
      `   ${String(i + 1).padStart(2)}. ${(t.caption || "(no heading)").padEnd(36)} ` +
        `${t.heads} cols  ${t.rows} row(s)` +
        (t.empty ? "  (an empty-state row)" : ""),
    );
  }
  await page.close();
}

await browser.close();

console.log("\n" + "=".repeat(70));
console.log(problems.length === 0 ? "nothing flagged" : problems.map((p) => "  " + p).join("\n"));
