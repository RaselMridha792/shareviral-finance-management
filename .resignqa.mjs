/**
 * A resignation letter, for the people who have left.
 *
 * The owner's ask, and the two things that make it right rather than merely
 * present:
 *
 *   - the row is offered to somebody who has LEFT, not to every employee. A
 *     slot reading "Not on file" against eighteen working people is eighteen
 *     missing documents, which is not what it means.
 *   - but a letter already uploaded must never disappear. Move somebody back
 *     to Working and the row stays, because the file is still in the database
 *     and a hidden file reads as a lost one.
 *
 * Nothing here rewrites data: the migration only appends an enum value, and
 * every paper already uploaded stays where it is.
 *
 *     node .resignqa.mjs      (local only — writes and deletes)
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
       (select id from team_members where full_name like 'RQA %')`,
  );
  await db.query("delete from team_members where full_name like 'RQA %'");
};
await wipe();

const make = async (name, status, endedOn) =>
  (
    await db.query(
      `insert into team_members (full_name, engagement_type, designation, status, joined_on, ended_on, created_by, updated_by)
       values ($1, 'employee', 'Tester', $2, '2024-01-01', $3, $4, $4) returning id`,
      [name, status, endedOn, person.id],
    )
  ).rows[0].id;

const working = await make("RQA Still Here", "active", null);
const left = await make("RQA Has Resigned", "resigned", "2026-06-30");

/* ------------------- the enum knows the kind, on both sides -------------- */

const enumHas = (
  await db.query(
    "select 1 from pg_enum where enumtypid = 'file_kind'::regtype and enumlabel = 'resignation_letter'",
  )
).rows.length;
check(
  "the database's file_kind carries the new value",
  enumHas === 1,
  "applied by deploy/sql/2026-08-30-resignation-letter.sql",
);

const PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 20 Tf 30 120 Td (RESIGNATION) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`,
);
const upload = async (memberId, name) => {
  const form = new FormData();
  form.append("file", new Blob([PDF], { type: "application/pdf" }), name);
  form.append("kind", "resignation_letter");
  const res = await fetch(`${API}/files/team-member/${memberId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const put = await upload(left, "rqa-resignation.pdf");
check(
  "a resignation letter uploads onto somebody who has left",
  put.status === 201,
  `HTTP ${put.status} ${JSON.stringify(put.body?.message ?? "")}`.slice(0, 100),
);
const stored = (
  await db.query(
    "select kind, original_name from files where team_member_id = $1",
    [left],
  )
).rows[0];
check(
  "and it is stored under its own kind, on that person",
  stored?.kind === "resignation_letter" &&
    stored?.original_name === "rqa-resignation.pdf",
  JSON.stringify(stored ?? null),
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
await page.setViewport({ width: 1500, height: 1300 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const documentsCard = async (memberId) => {
  await page.goto(`${WEB}/team/${memberId}`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await settle(2600);
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("li")].map((li) =>
      (li.textContent ?? "").replace(/\s+/g, " ").trim(),
    );
    return {
      hasResignationRow: rows.some((r) => r.startsWith("Resignation letter")),
      showsTheFile: rows.some((r) => r.includes("rqa-resignation.pdf")),
      slotNames: rows
        .filter((r) =>
          /^(CV|Appointment letter|Salary certificate|National ID|e-TIN certificate|Resignation letter|Document)/.test(
            r,
          ),
        )
        .map((r) => r.split(/\s{2,}|Upload|Add another/)[0].trim().slice(0, 24)),
    };
  });
};

const leaver = await documentsCard(left);
check(
  "the leaver's profile offers the Resignation letter row",
  leaver.hasResignationRow,
  leaver.slotNames.join(" | "),
);
check(
  "and the uploaded letter is listed on it",
  leaver.showsTheFile,
  "",
);

const stayer = await documentsCard(working);
check(
  "somebody still working is not asked for one",
  !stayer.hasResignationRow,
  stayer.slotNames.join(" | "),
);

/* ------- and a letter already on file survives being marked Working ------ */

await db.query(
  "update team_members set status = 'active', ended_on = null where id = $1",
  [left],
);
const rehired = await documentsCard(left);
check(
  "a letter already uploaded does not vanish when they are marked Working again",
  rehired.hasResignationRow && rehired.showsTheFile,
  JSON.stringify({
    row: rehired.hasResignationRow,
    file: rehired.showsTheFile,
  }),
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
