/**
 * Every picker in the app that holds a file offers to show it.
 *
 * The owner asked for this everywhere — "puro application a uploads a preview
 * setup korte hobe" — and everywhere is the part a per-screen fix keeps
 * getting wrong. So this opens each form that can hold a file before saving,
 * attaches one, and asks the page whether an eye appeared beside it.
 *
 * It drives the real screens rather than grepping for the component, because
 * an import that is never rendered reads exactly like a fix in a diff.
 *
 * The pickers that upload the instant a file is chosen are NOT here, and that
 * is deliberate rather than an omission: the profile's Documents card, the
 * signature fields, the subscription screenshot dialog and the file manager
 * all send the file straight to the server and then render what came back, so
 * there is no before-saving moment to preview and the stored row already opens.
 * The assistant composer and the importer take CSV and Excel, which the viewer
 * cannot frame and nobody wants framed.
 *
 *     node .previewsweep.mjs      (local only — writes and deletes)
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
    `select id, role, token_version from users
      where role='super_admin' and status='active' and deleted_at is null limit 1`,
  )
).rows[0];
const token = jwt.sign(
  { sub: person.id, role: person.role, tv: person.token_version },
  env.JWT_ACCESS_SECRET,
  { expiresIn: "2h" },
);

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* A real PNG on disk for the file chooser to pick up. */
const SCRATCH = "previewsweep-scan.png";
fs.writeFileSync(
  SCRATCH,
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR42mP8z8BQz0AEYBxVSF+FAAsLBAF6r4OeAAAAAElFTkSuQmCC",
    "base64",
  ),
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
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Click something by its visible text, inside the main region. */
const clickText = async (text) =>
  page.evaluate((wanted) => {
    const main = document.querySelector("main") ?? document.body;
    const el = [...main.querySelectorAll("button, a")].find(
      (b) => (b.textContent ?? "").replace(/\s+/g, " ").trim() === wanted,
    );
    if (!el) return false;
    el.click();
    return true;
  }, text);

/**
 * Put the scan into a file input INSIDE the open drawer.
 *
 * Scoped, because the team profile has six more behind the drawer — one per
 * document slot on the Documents card — and those upload the moment they are
 * given a file. Attaching to one of those tested the wrong thing entirely and
 * reported the drawer as having no preview.
 */
const attachTo = async (index) => {
  const scope = (await page.$('[role="dialog"]')) ?? page;
  const inputs = await scope.$$('input[type="file"]');
  if (!inputs[index]) return false;
  await inputs[index].uploadFile(SCRATCH);
  await settle(900);
  return true;
};

/** Every "Preview …" control currently on the page. */
const eyes = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => (b.getAttribute("aria-label") ?? "").trim())
      .filter((t) => /^Preview\b/i.test(t)),
  );

/**
 * One screen: open it, open the drawer, attach a file, look for the eye, and
 * confirm clicking it actually opens something.
 */
const sweep = async ({ label, url, open, inputIndex }) => {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2200);

  const opened = await open();
  if (!opened) {
    check(`${label}: the form opens`, false, "could not find the way in");
    return;
  }
  await settle(1600);

  const attached = await attachTo(inputIndex);
  if (!attached) {
    check(`${label}: it takes a file`, false, `no file input at ${inputIndex}`);
    return;
  }

  const found = await eyes();
  check(
    `${label}: the attached file can be previewed`,
    found.length > 0,
    found.join(" | ") || "no Preview control appeared",
  );
  if (!found.length) return;

  await page.evaluate((aria) => {
    document.querySelector(`button[aria-label="${aria}"]`)?.click();
  }, found[0]);
  await settle(1800);

  const shown = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    /* The viewer is the one holding an image or a frame, not the drawer. */
    const viewer = dialogs.find(
      (d) => d.querySelector("img") ?? d.querySelector("iframe"),
    );
    return {
      opened: Boolean(viewer),
      kind: viewer?.querySelector("img")
        ? "image"
        : viewer?.querySelector("iframe")
          ? "frame"
          : "none",
    };
  });
  check(
    `${label}: and clicking it actually opens the file`,
    shown.opened,
    shown.kind,
  );

  await page.keyboard.press("Escape");
  await settle(600);
};

/* ------------------------------------------------------------- the sweep */

const member = (
  await db.query(
    "select id from team_members where deleted_at is null order by joined_on limit 1",
  )
).rows[0];

await sweep({
  label: "Team — edit person",
  url: `${WEB}/team/${member.id}`,
  open: () => clickText("Edit"),
  inputIndex: 0, // the drawer's Photo row
});

/*
 * The transaction form is reached from an expenses screen, not from
 * /transactions — that screen lost its own Add button in an earlier revision,
 * so looking for one there tested nothing.
 */
await sweep({
  label: "Other expenses — new entry",
  url: `${WEB}/expenses/other`,
  open: () => clickText("Add expense"),
  inputIndex: 0,
});

await sweep({
  label: "Cash in",
  url: `${WEB}/accounts/cash-in`,
  open: () => clickText("Add cash"),
  inputIndex: 0,
});

await sweep({
  label: "Money transfer",
  url: `${WEB}/transfers`,
  open: async () =>
    (await clickText("New transfer")) || (await clickText("Add transfer")),
  inputIndex: 0,
});

await sweep({
  label: "AI tools and subscriptions",
  url: `${WEB}/subscriptions`,
  open: () => clickText("Add a subscription"),
  inputIndex: 0,
});

await browser.close();
fs.unlinkSync(SCRATCH);
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
