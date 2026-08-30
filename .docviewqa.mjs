/**
 * An uploaded document opens where it was uploaded.
 *
 * The owner's bug: every paper on a team member's profile answered
 * "api.hellonizam.com refused to connect". The app is on one host and the API
 * on another, and the API sends `X-Frame-Options: SAMEORIGIN` plus
 * `frame-ancestors 'self'`, so a frame pointed straight at it is refused. The
 * ledger's documents dialog had already met this wall and fetches the bytes
 * to frame a `blob:`; the shared `DocumentViewer` had not.
 *
 * So the checks are: the wall is real, the viewer no longer walks into it, and
 * nothing else in the app does either.
 *
 *     node .docviewqa.mjs      (local only — writes and deletes)
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
       (select id from team_members where full_name like 'DVQA %')`,
  );
  await db.query("delete from team_members where full_name like 'DVQA %'");
};
await wipe();
const member = (
  await db.query(
    `insert into team_members (full_name, engagement_type, designation, status, joined_on, created_by, updated_by)
     values ('DVQA Papered Person', 'employee', 'Tester', 'active', '2026-01-01', $1, $1) returning id`,
    [person.id],
  )
).rows[0].id;

/* A PDF with a word in it, so "did it draw" has something to look for. */
const PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 62>>stream
BT /F1 24 Tf 40 100 Td (DVQA CONTRACT) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`,
);
const form = new FormData();
form.append("file", new Blob([PDF], { type: "application/pdf" }), "dvqa-cv.pdf");
form.append("kind", "cv");
const uploaded = await fetch(`${API}/files/team-member/${member}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
const fileId = (await uploaded.json().catch(() => null))?.id;
check("a PDF uploads onto the person", uploaded.status === 201 && Boolean(fileId), `HTTP ${uploaded.status}`);

/* ------------------- the wall is real, and still standing ---------------- */

const headers = await fetch(`${API}/health`).then((r) => ({
  xfo: r.headers.get("x-frame-options"),
  csp: r.headers.get("content-security-policy") ?? "",
}));
check(
  "the API still refuses to be framed by anybody — the header is not the fix",
  headers.xfo === "SAMEORIGIN" && /frame-ancestors 'self'/.test(headers.csp),
  `${headers.xfo}, ${/frame-ancestors 'self'/.test(headers.csp) ? "frame-ancestors 'self'" : "no frame-ancestors"}`,
);

/* -------------------------------- the screen ---------------------------- */

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
await page.setViewport({ width: 1500, height: 1150 });

/*
 * The browser's own refusal message is the decisive signal. A refused frame
 * and a loaded cross-origin frame both throw on `contentDocument`, so reading
 * that proves nothing; this sentence is the one the owner saw.
 */
const refusals = [];
page.on("console", (m) => {
  const t = m.text();
  if (/Refused to (display|frame)|X-Frame-Options|frame-ancestors/i.test(t)) {
    refusals.push(t.slice(0, 140));
  }
});
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${WEB}/team/${member}`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);

/*
 * By its exact label. A loose /view/i match found "Expense overview" in the
 * rail first and clicked that — a harness that reports "I clicked something"
 * while clicking the wrong thing is worse than one that finds nothing.
 */
const opened = await page.evaluate(() => {
  const eye = document.querySelector(
    'button[aria-label="View dvqa-cv.pdf"]',
  );
  if (!eye) return false;
  eye.click();
  return true;
});
await settle(3500);

const viewer = await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    (x.getAttribute("aria-label") ?? "").includes("dvqa-cv.pdf"),
  );
  const frame = d?.querySelector("iframe");
  return {
    open: Boolean(d),
    hasFrame: Boolean(frame),
    /* The point: a blob: source is this page's own origin, which is why the
       frame is allowed at all. An API URL here would be the bug returning. */
    src: frame?.getAttribute("src") ?? null,
    stuckOpening: /Opening…/.test(d?.textContent ?? ""),
    failedMessage: /could not be opened/.test(d?.textContent ?? ""),
  };
});
check("the eye opens the viewer", opened && viewer.open, JSON.stringify({ opened, open: viewer.open }));
check(
  "it frames a blob of this page's own origin, not the API host",
  viewer.hasFrame && (viewer.src ?? "").startsWith("blob:"),
  `src: ${(viewer.src ?? "none").slice(0, 40)}`,
);
check(
  "and it neither hangs on Opening nor reports a failure",
  !viewer.stuckOpening && !viewer.failedMessage,
  JSON.stringify({ opening: viewer.stuckOpening, failed: viewer.failedMessage }),
);
check(
  "the browser refused nothing — the owner's message is gone",
  refusals.length === 0,
  refusals.join(" | "),
);

/* ------- and nowhere else in the app frames the API host directly -------- */

const sources = fs
  .readdirSync("apps/web/src/components", { recursive: true })
  .filter((f) => typeof f === "string" && f.endsWith(".tsx"))
  .map((f) => `apps/web/src/components/${f}`);
/*
 * Only what an <iframe> itself is pointed at. The first version scanned whole
 * files and flagged documents-dialog.tsx for an <img src={fileHref(...)}> —
 * images are not governed by frame-ancestors, and a sweep that cries about
 * them is a sweep somebody learns to ignore.
 */
const offenders = [];
for (const file of sources) {
  const text = fs.readFileSync(file, "utf8");
  for (const tag of text.match(/<iframe[\s\S]{0,240}?\/?>/g) ?? []) {
    const src = tag.match(/src=\{([^}]*)\}/)?.[1] ?? "";
    if (/fileHref|PUBLIC_BASE_URL|api\//.test(src)) offenders.push(`${file}: ${src.trim()}`);
  }
}
check(
  "no component frames a file URL directly any more",
  offenders.length === 0,
  offenders.join(", "),
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
