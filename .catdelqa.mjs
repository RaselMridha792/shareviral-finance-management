/**
 * Deleting a heading says what goes with it, and then that is what goes.
 *
 * The owner's rule: show the parent and the things under it in the warning,
 * with the same `›` the screen already uses; if the person agrees, it deletes.
 *
 * The part worth testing is that the warning is TRUE. Before this, a heading
 * could not be deleted from any screen at all, and the API left its children
 * behind — pointing at a parent in the trash, so drawn nowhere (the panel
 * renders headings and their children) while payments carried on being filed
 * against them. Invisible and still in use.
 *
 *     node .catdelqa.mjs      (local only — writes and deletes)
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
  await db.query("delete from categories where name like 'CDQA%'");
};
await wipe();

const heading = (
  await db.query(
    `insert into categories (name, slug, kind, is_active, created_by, updated_by)
     values ('CDQA Heading', 'cdqa-heading', 'out', true, $1, $1) returning id`,
    [person.id],
  )
).rows[0].id;
const kids = [];
for (const name of ["CDQA Rent", "CDQA Power", "CDQA Water"]) {
  kids.push(
    (
      await db.query(
        `insert into categories (name, slug, kind, parent_id, is_active, created_by, updated_by)
         values ($1, lower(replace($1, ' ', '-')), 'out', $2, true, $3, $3) returning id`,
        [name, heading, person.id],
      )
    ).rows[0].id,
  );
}
// One that was already deleted on its own — it must NOT come back with the
// heading later.
const lonely = (
  await db.query(
    `insert into categories (name, slug, kind, parent_id, is_active, deleted_at, deleted_by, created_by, updated_by)
     values ('CDQA Gone Before', 'cdqa-gone-before', 'out', $1, true, now() - interval '3 days', $2, $2, $2) returning id`,
    [heading, person.id],
  )
).rows[0].id;

/* ------------------------------------------------- the API takes them along */

const removed = await call("POST", `/trash/category/${heading}`, {
  reason: "Category QA",
});
check("a heading moves to the trash", removed.status === 201, `HTTP ${removed.status}`);
check(
  "and reports that its three sub-categories went with it",
  removed.body?.deleted === 4,
  `deleted ${removed.body?.deleted}`,
);

const state = async () =>
  (
    await db.query(
      `select name, deleted_at is not null as gone from categories
        where name like 'CDQA%' order by name`,
    )
  ).rows;
const afterDelete = await state();
check(
  "every child really is in the trash, not left pointing at a deleted parent",
  afterDelete.every((r) => r.gone),
  JSON.stringify(afterDelete.map((r) => `${r.name}:${r.gone}`)),
);

const tree = await call("GET", "/categories/tree?includeInactive=true");
const stillDrawn = JSON.stringify(tree.body ?? []).includes("CDQA");
check("so nothing of it is left on the categories screen", !stillDrawn, "");

const audit = (
  await db.query(
    `select summary from audit_logs where summary like 'Deleted category "CDQA Heading"%'
      order by occurred_at desc limit 1`,
  )
).rows[0];
check(
  "the audit line says what came along, in its own words",
  /and its 3 sub-categories/.test(audit?.summary ?? ""),
  audit?.summary ?? "no audit row",
);

/* ------------------------------------------------ and gives them back again */

const back = await call("POST", `/trash/category/${heading}/restore`);
check("restoring the heading works", back.status === 201, `HTTP ${back.status}`);
const afterRestore = await state();
const byName = Object.fromEntries(afterRestore.map((r) => [r.name, r.gone]));
check(
  "the three that went with it come back",
  byName["CDQA Heading"] === false &&
    byName["CDQA Rent"] === false &&
    byName["CDQA Power"] === false &&
    byName["CDQA Water"] === false,
  JSON.stringify(byName),
);
check(
  "and the one deleted on its own days earlier stays in the trash",
  byName["CDQA Gone Before"] === true,
  `CDQA Gone Before gone: ${byName["CDQA Gone Before"]}`,
);

/* --------------------------------------------------------------- the screen */

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
await page.setViewport({ width: 1500, height: 1200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/settings?tab=categories`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(3000);

const opened = await page.evaluate(() => {
  const card = [...document.querySelectorAll("div")].find(
    (d) =>
      (d.textContent ?? "").includes("CDQA Heading") &&
      d.querySelector('button[aria-label="Move to trash"]'),
  );
  if (!card) return false;
  card.querySelector('button[aria-label="Move to trash"]').click();
  return true;
});
await settle(1200);
const warning = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /to the trash\?/i.test(x.textContent ?? ""),
  );
  if (!d) return null;
  const text = (d.textContent ?? "").replace(/\s+/g, " ");
  const svgs = d.querySelectorAll("svg.lucide-chevron-right").length;
  return {
    title: d.querySelector("h2,h3")?.textContent?.trim() ?? null,
    namesEachChild: ["CDQA Rent", "CDQA Power", "CDQA Water"].every((n) =>
      text.includes(n),
    ),
    saysHowMany: /All 3 things under this heading/.test(text),
    repeatsTheHeadingBesideEach: (text.match(/CDQA Heading/g) ?? []).length >= 4,
    chevrons: svgs,
    saysRestoreBringsThemBack: /Restoring the heading brings all of them back/.test(text),
    saysTotalsHold: /every total stays the same/.test(text),
    confirmDisabled: [...d.querySelectorAll("button")].find((b) =>
      /^Yes, trash/i.test(b.textContent ?? ""),
    )?.disabled,
  };
});
check("the heading offers a trash button on the screen", opened, "");
check(
  "the warning names every sub-category, each behind its heading",
  Boolean(warning?.namesEachChild) &&
    Boolean(warning?.saysHowMany) &&
    Boolean(warning?.repeatsTheHeadingBesideEach),
  JSON.stringify(warning),
);
check(
  "and draws the same > it uses on the screen, one per child",
  (warning?.chevrons ?? 0) >= 3,
  `chevrons: ${warning?.chevrons}`,
);
check(
  "it promises the restore, and that totals do not move",
  Boolean(warning?.saysRestoreBringsThemBack) && Boolean(warning?.saysTotalsHold),
  "",
);
check(
  "and it is still disarmed until the person agrees",
  warning?.confirmDisabled === true,
  "",
);

// A heading with nothing under it must not claim to take anything.
await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /to the trash\?/i.test(x.textContent ?? ""),
  );
  [...d.querySelectorAll("button")]
    .find((b) => /No, keep it/i.test(b.textContent ?? ""))
    .click();
});
await settle(600);
await db.query(
  `insert into categories (name, slug, kind, is_active, created_by, updated_by)
   values ('CDQA Empty Heading', 'cdqa-empty-heading', 'out', true, $1, $1)`,
  [person.id],
);
await page.reload({ waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);
const emptyOpened = await page.evaluate(() => {
  const card = [...document.querySelectorAll("div")].find(
    (d) =>
      (d.textContent ?? "").includes("CDQA Empty Heading") &&
      d.querySelector('button[aria-label="Move to trash"]'),
  );
  if (!card) return false;
  card.querySelector('button[aria-label="Move to trash"]').click();
  return true;
});
await settle(1000);
const emptyWarning = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /to the trash\?/i.test(x.textContent ?? ""),
  );
  return (d?.textContent ?? "").replace(/\s+/g, " ");
});
check(
  "a heading with nothing under it makes no claim about sub-categories",
  emptyOpened &&
    !/under this heading/.test(emptyWarning) &&
    /every total stays the same/.test(emptyWarning),
  emptyOpened ? "" : "no trash button on the empty heading",
);

// And a sub-category can be deleted on its own.
const chipButton = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) =>
    /^Move CDQA Rent to trash$/.test(x.getAttribute("aria-label") ?? ""),
  );
  return Boolean(b);
});
check("each sub-category carries its own trash button too", chipButton, "");

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
