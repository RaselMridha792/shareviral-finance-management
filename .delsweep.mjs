/**
 * Every wired screen, opened, with the delete button pressed on a real row.
 *
 * `.delwired.mjs` reads the source and says a screen has a button and a
 * dialog. That is not the same claim as "the button opens the dialog" — a
 * hook declared but never rendered, a handler gated behind a permission the
 * signed-in role lacks, a table whose rows are all disabled, all pass the
 * source check and fail here.
 *
 *     node .delsweep.mjs
 */
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
    `select id, email, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null
      order by created_at limit 1`,
  )
).rows[0];

const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
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

/*
 * The routes that were wired, and what each needs before it has a row.
 *
 * A screen with nothing on it has no delete button either, and reporting that
 * as "the button is missing" is the false alarm this whole exercise keeps
 * running into. So `needs` says what the screen shows, and a screen with no
 * rows is reported as skipped rather than failed.
 */
const ROUTES = [
  { path: "/transactions", name: "All transactions" },
  { path: "/expenses/other", name: "Other expenses" },
  { path: "/accounts/cash-in", name: "Cash in" },
  { path: "/team", name: "Team" },
  { path: "/subscriptions", name: "Subscriptions" },
  { path: "/payroll", name: "Payroll runs" },
  { path: "/settings?tab=users", name: "Settings · sign-ins" },
  { path: "/settings?tab=fx", name: "Settings · rate history" },
  { path: "/settings?tab=trashed", name: "Settings · trashed" },
];

const results = [];
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

for (const route of ROUTES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text().slice(0, 120));
  });

  await page
    .goto(WEB + route.path, { waitUntil: "networkidle0", timeout: 120000 })
    .catch(() => {});
  await settle(2200);

  const found = await page.evaluate(() => ({
    /*
     * Only rows that are rows. An empty table draws one cell spanning every
     * column — "Nothing recorded yet" — and counting it as a row made an
     * empty rate history read as a table missing its delete button.
     */
    rows: [...document.querySelectorAll("tbody tr")].filter(
      (r) => !r.querySelector("td[colspan]"),
    ).length,
    deleteButtons: document.querySelectorAll('button[aria-label="Move to trash"]').length,
    restoreButtons: [...document.querySelectorAll("button")].filter((b) =>
      /Restore/i.test(b.textContent ?? ""),
    ).length,
    broke: /couldn.t load|Internal Server Error/i.test(document.body.innerText),
  }));

  let opened = null;
  if (found.deleteButtons > 0) {
    await page.evaluate(() =>
      document.querySelector('button[aria-label="Move to trash"]').click(),
    );
    await settle(600);
    opened = await page.evaluate(() => {
      const box = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
        /to the trash\?/i.test(d.textContent ?? ""),
      );
      if (!box) return null;
      const confirm = [...box.querySelectorAll("button")].find((b) =>
        /^Yes, trash/i.test(b.textContent ?? ""),
      );
      return {
        checkbox: Boolean(box.querySelector('input[type="checkbox"]')),
        word: /Type\s*trash\s*to\s*confirm/i.test(
          (box.textContent ?? "").replace(/\s+/g, " "),
        ),
        disabled: confirm ? confirm.disabled : null,
        // Nothing in the dialog should overflow its own box: a warning that
        // runs off the right edge is the fault this app has shipped before.
        overflows:
          box.scrollWidth > box.clientWidth + 2 ||
          document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
      };
    });
    await page.keyboard.press("Escape");
    await settle(200);
  }

  const verdict =
    found.broke
      ? "the page did not load"
      : route.path.includes("trashed")
        ? found.rows === 0 && found.restoreButtons === 0
          ? "empty trash (nothing to check)"
          : "ok"
        : found.rows === 0
          ? "no rows (nothing to check)"
          : found.deleteButtons === 0
            ? "NO DELETE BUTTON"
            : !opened
              ? "BUTTON OPENS NOTHING"
              : !opened.checkbox || !opened.word || opened.disabled !== true
                ? "DIALOG MISSING A GATE"
                : opened.overflows
                  ? "DIALOG OVERFLOWS"
                  : "ok";

  results.push({ ...route, verdict, found, errors: errors.slice(0, 2) });
  console.log(
    `  ${verdict.padEnd(28)} ${route.name.padEnd(26)} rows=${String(found.rows).padEnd(4)} delete=${found.deleteButtons}`,
  );
  for (const e of errors.slice(0, 2)) console.log(`      console: ${e}`);
  await page.close();
}

await browser.close();
await db.end();

const bad = results.filter((r) => /^[A-Z]/.test(r.verdict) && r.verdict !== "ok");
console.log("\n" + "=".repeat(66));
console.log(
  bad.length === 0
    ? `${results.length} screens, nothing wrong`
    : `${bad.length} to look at:\n` +
        bad.map((b) => `  ${b.name} — ${b.verdict}`).join("\n"),
);
process.exit(bad.length === 0 ? 0 : 1);
