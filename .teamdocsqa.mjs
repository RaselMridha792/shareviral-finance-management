/**
 * Team papers live in the app, and the drawer takes files, not links.
 *
 * The owner's rule: photo, CV and appointment letter are uploads into the
 * app's own store — no third-party URLs anywhere. The drawer (add AND edit —
 * one component, both doors) offers pickers; the profile's Documents card is
 * where the papers appear; the "Linked elsewhere" card is gone. And e-TIN is
 * optional, proven rather than assumed.
 *
 *     node .teamdocsqa.mjs      (local only — writes and deletes)
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
  await db.query(
    `delete from files where team_member_id in
       (select id from team_members where full_name like 'TDOC %')`,
  );
  await db.query(
    `delete from compensation_history where team_member_id in
       (select id from team_members where full_name like 'TDOC %')`,
  );
  await db.query("delete from team_members where full_name like 'TDOC %'");
};
await wipe();

/* ---------------- 1. e-TIN left blank is not an objection ---------------- */

const created = await call("POST", "/team-members", {
  fullName: "TDOC Papered Person",
  engagementType: "employee",
  designation: "Tester",
  joinedOn: "2026-08-01",
  // no etin at all — the point
});
check(
  "a person records with no e-TIN",
  created.status === 201,
  `HTTP ${created.status} ${JSON.stringify(created.body?.errors ?? "")}`,
);
const memberId = created.body?.id;

/* ------------- 2. the three papers upload into the app's store ----------- */

// A real one-pixel PNG and a minimal PDF — the store checks what things are.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 10 10]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF",
);
const upload = async (kind, name, bytes, mime) => {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), name);
  form.append("kind", kind);
  const res = await fetch(`${API}/files/team-member/${memberId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const photo = await upload("profile_photo", "tdoc-photo.png", PNG, "image/png");
const cv = await upload("cv", "tdoc-cv.pdf", PDF, "application/pdf");
const letter = await upload(
  "appointment_letter",
  "tdoc-letter.pdf",
  PDF,
  "application/pdf",
);
check(
  "photo, CV and appointment letter upload into the app's store",
  photo.status === 201 && cv.status === 201 && letter.status === 201,
  `${photo.status}/${cv.status}/${letter.status}`,
);
// `order by kind` on a pg enum sorts by declaration order, so sort here.
const stored = (
  await db.query(`select kind from files where team_member_id = $1`, [memberId])
).rows
  .map((r) => r.kind)
  .sort();
check(
  "all three sit on the person, each under its own kind",
  JSON.stringify(stored) ===
    JSON.stringify(["appointment_letter", "cv", "profile_photo"]),
  JSON.stringify(stored),
);
const dto = await call("GET", `/team-members/${memberId}`);
check(
  "the profile's photo now comes from the store, not a link",
  Boolean(dto.body?.photoFileId),
  `photoFileId ${dto.body?.photoFileId ? "set" : "missing"}`,
);

/* -------- 3. the browser: pickers in the drawer, no links anywhere -------- */

// Seed the OLD Drive columns on this person, to prove the card is gone even
// for somebody who has them.
await db.query(
  `update team_members
      set photo_url = 'https://drive.google.com/x',
          cv_url = 'https://drive.google.com/y',
          appointment_letter_url = 'https://drive.google.com/z'
    where id = $1`,
  [memberId],
);

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
await page.setViewport({ width: 1550, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// The ADD drawer.
await page.goto(`${WEB}/team`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2500);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Add person/.test(b.textContent ?? ""))
    ?.click();
});
await settle(1400);
/*
 * Scoped to the drawer, not the page: the profile behind it carries its own
 * uploaders (the Documents card, the photo button), and counting those as the
 * drawer's reported ten pickers where the drawer holds three.
 */
const readDrawer = () =>
  page.evaluate(() => {
    const scope =
      [...document.querySelectorAll('[role="dialog"]')].find((d) =>
        /Add a person|Edit person/.test(d.textContent ?? ""),
      ) ?? document;
    const text = scope === document ? document.body.innerText : scope.textContent ?? "";
    return {
      pickers: [...scope.querySelectorAll('input[type="file"]')].length,
      driveHint: /Drive file|drive\.google/.test(text),
      urlBoxes: [...scope.querySelectorAll("input")].filter((i) =>
        (i.placeholder ?? "").includes("https://"),
      ).length,
      etinOptional: /Optional — 12 digits/.test(text),
    };
  });
const addDrawer = await readDrawer();
check(
  "the Add drawer offers three file pickers and no link boxes",
  addDrawer.pickers === 3 && !addDrawer.driveHint && addDrawer.urlBoxes === 0,
  JSON.stringify(addDrawer),
);
check(
  "and says the e-TIN is optional",
  addDrawer.etinOptional === true,
  "",
);
await page.keyboard.press("Escape");
await settle(500);

// The EDIT drawer — same component, opened from the profile.
await page.goto(`${WEB}/team/${memberId}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2500);
const profileText = await page.evaluate(() => document.body.innerText);
check(
  'the profile no longer draws "Linked elsewhere", even with old Drive links stored',
  !/Linked elsewhere/.test(profileText),
  "",
);
check(
  "the Documents card lists the uploaded CV and appointment letter",
  /CV/.test(profileText) && /Appointment letter/.test(profileText) &&
    /tdoc-cv\.pdf|1 file|tdoc/.test(profileText),
  "",
);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => (b.textContent ?? "").trim() === "Edit")
    ?.click();
});
await settle(1600);
const editDrawer = await readDrawer();
check(
  "the Edit drawer is the same drawer — pickers, no link boxes",
  editDrawer.pickers === 3 && editDrawer.urlBoxes === 0 && !editDrawer.driveHint,
  JSON.stringify(editDrawer),
);

/* ------- 4. the drawer's own path: pick a file, save, it uploads -------- */
/*
 * The pieces above prove the endpoints; this proves the NEW code — the drawer
 * holds the file and uploads it after the create answers with an id.
 */
await page.keyboard.press("Escape");
await settle(500);
await page.goto(`${WEB}/team`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2200);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /Add person/.test(b.textContent ?? ""))
    ?.click();
});
await settle(1400);
fs.writeFileSync(".tdoc-tmp.png", PNG);
await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /Add a person/.test(x.textContent ?? ""),
  );
  const name = d.querySelector('input[name="fullName"]');
  const set = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  set.call(name, "TDOC Through The Drawer");
  name.dispatchEvent(new Event("input", { bubbles: true }));
});
const [photoInput] = await page.$$('[role="dialog"] input[type="file"]');
await photoInput.uploadFile(".tdoc-tmp.png");
await settle(400);
await page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].find((x) =>
    /Add a person/.test(x.textContent ?? ""),
  );
  [...d.querySelectorAll('button[type="submit"], button')]
    .find((b) => (b.textContent ?? "").trim() === "Add")
    ?.click();
});
await settle(4000);
const throughDrawer = (
  await db.query(
    `select m.id, (select count(*)::int from files f
        where f.team_member_id = m.id and f.kind = 'profile_photo') as photos
       from team_members m where m.full_name = 'TDOC Through The Drawer'`,
  )
).rows[0];
check(
  "picking a photo in the drawer and saving uploads it after the create",
  Boolean(throughDrawer?.id) && throughDrawer?.photos === 1,
  JSON.stringify(throughDrawer ?? null),
);
fs.unlinkSync(".tdoc-tmp.png");

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
