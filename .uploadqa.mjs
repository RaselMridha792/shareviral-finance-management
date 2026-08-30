/**
 * The three things the owner has asked for about uploads.
 *
 *   1. A drawer opened to EDIT shows what is already saved. Today the text
 *      boxes do, and the file rows do not — "Photo: Choose a file" against
 *      somebody whose photograph is on screen behind the drawer.
 *   2. Anything being uploaded can be previewed BEFORE it is saved, by
 *      clicking it, anywhere in the app.
 *   3. An uploaded document opens every time. "majhe majhe view korle error
 *      dekhay" — sometimes, which is the word that matters: the failure is a
 *      state bug, not a broken file, so it reproduces on the SECOND open of
 *      the same document rather than the first.
 *
 * Written to fail first, on purpose. A harness that only ever ran after the
 * fix proves the fix compiles, not that it was needed.
 *
 *     node .uploadqa.mjs      (local only — writes and deletes)
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

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------- fixtures */

const wipe = async () => {
  await db.query(
    `delete from files where team_member_id in
       (select id from team_members where full_name like 'UPQA %')`,
  );
  await db.query("delete from team_members where full_name like 'UPQA %'");
};
await wipe();

const memberId = (
  await db.query(
    `insert into team_members
       (full_name, engagement_type, designation, status, joined_on, created_by, updated_by)
     values ('UPQA Document Person', 'employee', 'Tester', 'active', '2024-03-01', $1, $1)
     returning id`,
    [person.id],
  )
).rows[0].id;

/* A real one-page PDF, and a real 2x2 PNG. Both have to survive a round trip. */
const PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 30 120 Td (UPQA CV) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`,
);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR42mP8z8BQz0AEYBxVSF+FAAsLBAF6r4OeAAAAAElFTkSuQmCC",
  "base64",
);

const upload = async (kind, bytes, name, type) => {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  form.append("kind", kind);
  const res = await fetch(`${API}/files/team-member/${memberId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const cv = await upload("cv", PDF, "upqa-cv.pdf", "application/pdf");
const photo = await upload("profile_photo", PNG, "upqa-face.png", "image/png");
check(
  "a CV and a photograph are on file before we start",
  cv.status === 201 && photo.status === 201,
  `cv HTTP ${cv.status}, photo HTTP ${photo.status}`,
);

/* --------------------------------------------------------------- browser */

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

/* Anything the page logs to the console that looks like a failure. */
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
page.on("requestfailed", (r) => {
  consoleErrors.push(`requestfailed ${r.url().slice(0, 90)}`);
});

await page.goto(`${WEB}/team/${memberId}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2500);

const onProfile = await page.evaluate(() =>
  document.body.innerText.includes("UPQA Document Person"),
);
check("the profile loads", onProfile, "");

/* ------------- 3. the document opens, and opens AGAIN --------------- */

const openTheCv = async () => {
  /*
   * By its exact aria-label. The first attempt walked "li, tr, div" for one
   * containing the file name and took the first button inside it that matched
   * /view/ — which found the whole page as the div and the sidebar's "Accounts
   * overview" as the button. Every check after it then passed or failed for
   * reasons that had nothing to do with documents.
   */
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="View upqa-cv.pdf"]');
    if (!btn) return "no view button";
    btn.click();
    return "clicked";
  });
  await settle(2200);
  const state = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.textContent ?? "";
    const frame = dialog?.querySelector("iframe");
    return {
      dialogOpen: Boolean(dialog),
      saysCouldNotOpen: /could not be opened/i.test(text),
      saysOpening: /Opening/i.test(text),
      frameSrc: frame?.getAttribute("src") ?? null,
    };
  });
  return { clicked, ...state };
};
const closeIt = async () => {
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const x = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (b) => (b.getAttribute("aria-label") ?? "") === "Close",
    );
    x?.click();
  });
  await settle(900);
};

const first = await openTheCv();
check(
  "the CV opens the first time",
  first.dialogOpen && !first.saysCouldNotOpen && Boolean(first.frameSrc),
  `${first.clicked}, frame ${first.frameSrc ? "yes" : "none"}${first.saysCouldNotOpen ? ", says it could not be opened" : ""}`,
);
const firstSrc = first.frameSrc;
await closeIt();

const second = await openTheCv();
check(
  "THE BUG: and opens again after being closed",
  second.dialogOpen && !second.saysCouldNotOpen && Boolean(second.frameSrc),
  second.saysCouldNotOpen
    ? "says it could not be opened"
    : `frame ${second.frameSrc ? "yes" : "none"}`,
);
check(
  "the second open is not showing the first open's revoked blob",
  Boolean(second.frameSrc) && second.frameSrc !== firstSrc,
  `${String(firstSrc).slice(0, 40)} vs ${String(second.frameSrc).slice(0, 40)}`,
);
await closeIt();

/* A failure must not stick to the document for the rest of the session. */
await page.setRequestInterception(true);
/*
 * Every fetch for the bytes, not just the first.
 *
 * Blocking one request stopped simulating "the server is unreachable" the
 * moment the viewer started mounting fresh on each open: React's development
 * mode runs an effect, tears it down and runs it again, so the single blocked
 * request was the discarded first pass and the real one sailed through. The
 * viewer then worked perfectly and the harness called that a failure to report
 * a failure.
 */
let blocking = true;
const blockWhileArmed = (req) => {
  if (blocking && /\/files\/.*inline=1/.test(req.url())) {
    void req.abort();
    return;
  }
  void req.continue();
};
page.on("request", blockWhileArmed);
const failed = await openTheCv();
check(
  "a document that genuinely fails says so",
  failed.saysCouldNotOpen,
  failed.saysCouldNotOpen ? "" : "it did not report the failure",
);
await closeIt();

/* The server comes back. Clicking again must be a real second attempt. */
blocking = false;

const recovered = await openTheCv();
check(
  "THE BUG: and it works again on the next try, rather than staying broken",
  recovered.dialogOpen && !recovered.saysCouldNotOpen && Boolean(recovered.frameSrc),
  recovered.saysCouldNotOpen
    ? "still says it could not be opened — the failure stuck to the document"
    : "recovered",
);
await closeIt();
page.off("request", blockWhileArmed);
await page.setRequestInterception(false);

/* ---------------- 1. the edit drawer knows what is saved --------------- */

const openEdit = async () => {
  await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const b = [...main.querySelectorAll("button")].find(
      (el) => (el.textContent ?? "").trim() === "Edit",
    );
    b?.click();
  });
  await settle(1800);
};
await openEdit();

const drawer = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('[role="dialog"], aside, form')];
  const el =
    panels.find((p) => /Edit person|Employee ID/i.test(p.textContent ?? "")) ??
    document.body;
  const text = (el.textContent ?? "").replace(/\s+/g, " ");
  const field = (label) => {
    const input = [...el.querySelectorAll("input, select, textarea")].find(
      (i) => i.getAttribute("name") === label,
    );
    return input ? input.value : null;
  };
  return {
    found: /Edit person/i.test(text) || /Employee ID/i.test(text),
    fullName: field("fullName"),
    nid: field("nid"),
    /* What the file rows say about what is already there. */
    photoSaysChooseAFile: /Photo[^]{0,80}Choose a file/i.test(text),
    /*
     * A photograph proves itself by being shown, not by being named: the
     * documents endpoint excludes profile_photo on purpose, so there is no
     * original filename to print here, and a thumbnail answers "is this the
     * right picture" which a filename does not.
     */
    namesTheStoredPhoto: Boolean(
      el.querySelector('img[alt="Current photo"]') ??
        [...el.querySelectorAll("button")].find((b) =>
          /^Preview Current photo$/i.test(b.getAttribute("aria-label") ?? ""),
        ),
    ),
    namesTheStoredCv: text.includes("upqa-cv.pdf"),
    saysOnFile: /on file|already|current/i.test(text),
  };
});
check("the edit drawer opens", drawer.found, "");
check(
  "it carries the saved text — the name",
  drawer.fullName === "UPQA Document Person",
  JSON.stringify(drawer.fullName),
);
check(
  "THE BUG: and it also shows the photograph already on file",
  drawer.namesTheStoredPhoto,
  drawer.photoSaysChooseAFile
    ? 'the Photo row just says "Choose a file"'
    : "no photo named",
);
check(
  "THE BUG: and the CV already on file",
  drawer.namesTheStoredCv,
  drawer.namesTheStoredCv ? "" : "the CV row does not mention upqa-cv.pdf",
);

/* -------------- 2. a file chosen but not yet saved can be seen --------- */

/*
 * Scoped to the drawer, and to aria-labels only. Reading button TEXT across the
 * page matched the sidebar's "Accounts overview" on the word "view" and
 * reported a preview affordance that was never there.
 */
const previewable = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="dialog"], aside, form')].find(
    (p) => /Employee ID/i.test(p.textContent ?? ""),
  );
  if (!el) return { hasPreviewAffordance: false, buttons: ["drawer not found"] };
  const labels = [...el.querySelectorAll("button, a")]
    .map((b) => (b.getAttribute("aria-label") ?? "").trim())
    .filter(Boolean);
  return {
    hasPreviewAffordance: labels.some((t) => /^(preview|view|look at)\b/i.test(t)),
    buttons: labels.slice(0, 14),
  };
});
check(
  "THE BUG: a file being uploaded can be previewed before saving",
  previewable.hasPreviewAffordance,
  previewable.buttons.join(" | ").slice(0, 180),
);

/*
 * One request was aborted on purpose above, to prove a failure does not stick.
 * Counting it here would make the harness report its own fixture as a defect,
 * so the deliberately-blocked fetch and the browser's noise about it are the
 * only things excused.
 */
const unexplained = consoleErrors.filter(
  (line) => !/inline=1|net::ERR_FAILED|Failed to load resource/i.test(line),
);
check(
  "nothing else in the page console broke while doing all this",
  unexplained.length === 0,
  unexplained.slice(0, 3).join(" ;; ").slice(0, 220),
);

await browser.close();
await wipe();
await db.end();

const failedChecks = results.filter((r) => !r.pass);
console.log("\n" + "=".repeat(70));
console.log(
  failedChecks.length === 0
    ? `all ${results.length} checks passed`
    : `${failedChecks.length} of ${results.length} failed:\n` +
        failedChecks.map((f) => `  ${f.name} — ${f.detail}`).join("\n"),
);
process.exit(failedChecks.length === 0 ? 0 : 1);
