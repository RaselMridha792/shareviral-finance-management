/**
 * One e-Return per income year, and the year it is filed against.
 *
 * The owner: *"E Return (akhane akta kore ortho bochor thakbe like 2026-2027
 * and document upload korar option thakbe. Ata every year a 1 ta hobe)"*.
 *
 * Two things here are easy to get backwards and expensive to find later:
 *
 *   THE YEAR. Bangladesh's income year runs July to June, so a filing on
 *   1 September 2026 belongs to 2026-2027 and one on 30 June 2026 belongs to
 *   2025-2026. A picker that offers the wrong label files a return against a
 *   year that has not started.
 *
 *   ONE PER YEAR. Enforced by a PARTIAL unique index, not by the screen — so
 *   two people recording the same year from two tabs get one row. Partial is
 *   the half that matters: a year that was trashed and is recorded again must
 *   not collide with its own deleted row, which is the bug this repo hit on
 *   `compensation_history` the same week.
 *
 *     node .ereturnqa.mjs      (local only — writes and deletes)
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
    await db.query("select id from team_members where full_name like 'ETRQA %'")
  ).rows.map((r) => r.id);
  for (const id of people) {
    await db.query("delete from team_ereturns where team_member_id=$1", [id]);
    await db.query("delete from team_socials where team_member_id=$1", [id]);
    await db.query("delete from files where team_member_id=$1", [id]);
    await db.query("delete from team_members where id=$1", [id]);
  }
  return people.length;
};
await wipe();

const member = (
  await call("POST", "/team-members", {
    fullName: "ETRQA Person",
    engagementType: "employee",
    joinedOn: "2020-01-01",
    etin: "123456789012",
  })
).body;
check("a person exists, with an e-TIN", Boolean(member?.id), member?.etin ?? "");

const rows = async () =>
  (
    await db.query(
      `select fiscal_year, submitted_on::text s, notes, deleted_at
         from team_ereturns where team_member_id=$1 order by fiscal_year desc`,
      [member.id],
    )
  ).rows;

/* -------------------------------- the API ------------------------------ */

const first = await call("PUT", `/team-members/${member.id}/ereturns`, {
  fiscalYear: 2025,
  submittedOn: "2026-11-30",
  notes: "ETRQA filed on time",
});
check(
  "a year is recorded",
  first.status < 300 && (await rows()).length === 1,
  `HTTP ${first.status}`,
);

/* The same year again is a correction, not a second return. */
const again = await call("PUT", `/team-members/${member.id}/ereturns`, {
  fiscalYear: 2025,
  submittedOn: "2026-12-01",
  notes: "ETRQA corrected",
});
const afterAgain = await rows();
check(
  "recording the same year again corrects it rather than adding a second",
  again.status < 300 &&
    afterAgain.length === 1 &&
    afterAgain[0].notes === "ETRQA corrected" &&
    afterAgain[0].s === "2026-12-01",
  `${afterAgain.length} rows, notes ${afterAgain[0]?.notes}`,
);

const second = await call("PUT", `/team-members/${member.id}/ereturns`, {
  fiscalYear: 2024,
  notes: "ETRQA the year before",
});
check(
  "a different year is a different return",
  second.status < 300 && (await rows()).length === 2,
  `${(await rows()).length} rows`,
);

/* THE PARTIAL INDEX: trash a year and record it again. */
await db.query(
  "update team_ereturns set deleted_at = now() where team_member_id=$1 and fiscal_year=2024",
  [member.id],
);
const afterTrash = await call("PUT", `/team-members/${member.id}/ereturns`, {
  fiscalYear: 2024,
  notes: "ETRQA recorded again after trashing",
});
const live = (await rows()).filter((r) => r.deleted_at === null);
check(
  "a trashed year can be recorded again — the unique index is partial",
  afterTrash.status < 300 &&
    live.some(
      (r) => r.fiscal_year === 2024 && r.notes === "ETRQA recorded again after trashing",
    ),
  `HTTP ${afterTrash.status}; live years ${live.map((r) => r.fiscal_year).join(",")}`,
);

/* Refusals. */
const silly = await call("PUT", `/team-members/${member.id}/ereturns`, {
  fiscalYear: 1990,
});
check("a year outside the sane range is refused", silly.status === 400, `HTTP ${silly.status}`);
const badDate = await call("PUT", `/team-members/${member.id}/ereturns`, {
  fiscalYear: 2023,
  submittedOn: "not-a-date",
});
check("a date that is not one is refused", badDate.status === 400, `HTTP ${badDate.status}`);

/* The API's own reading of the list. */
const listed = await call("GET", `/team-members/${member.id}/ereturns`);
check(
  "the list comes back newest year first, with the file slot present",
  Array.isArray(listed.body) &&
    listed.body[0]?.fiscalYear >= listed.body[1]?.fiscalYear &&
    "fileId" in (listed.body[0] ?? {}),
  (listed.body ?? []).map((r) => r.fiscalYear).join(" > "),
);

/* -------------------------------- the screen --------------------------- */

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

await page.goto(`${WEB}/team/${member.id}`, {
  waitUntil: "networkidle0",
  timeout: 120000,
});
await settle(2800);

const card = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && (el.textContent ?? "").trim() === "E-Return",
  );
  const panel = heading?.closest("div.rounded-xl, div[class*='rounded'], section");
  if (!panel) return null;
  return {
    years: [...panel.querySelectorAll("tbody tr")].map((tr) =>
      ([...tr.querySelectorAll("td")][1]?.textContent ?? "").trim(),
    ),
    text: (panel.textContent ?? "").replace(/\s+/g, " "),
    hasButton: [...panel.querySelectorAll("button")].some((b) =>
      /Record a year/i.test(b.textContent ?? ""),
    ),
  };
});
check("the profile has an E-Return section", Boolean(card), card ? "" : "not found");
check(
  "the income year is written out in full, the way the owner asked",
  card?.years.includes("2025-2026"),
  (card?.years ?? []).join(" | "),
);
check(
  "and a year with no acknowledgement says so",
  /Nothing attached/.test(card?.text ?? ""),
  (card?.text ?? "").slice(0, 120),
);
check("with a way to record one", card?.hasButton === true, "");

/* The picker: this income year at the top, and nothing in the future. */
await page.evaluate(() => {
  const heading = [...document.querySelectorAll("*")].find(
    (el) => el.children.length === 0 && (el.textContent ?? "").trim() === "E-Return",
  );
  const panel = heading?.closest("div.rounded-xl, div[class*='rounded'], section");
  [...(panel?.querySelectorAll("button") ?? [])]
    .find((b) => /Record a year/i.test(b.textContent ?? ""))
    ?.click();
});
await settle(1400);
const picker = await page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"]')].pop();
  const select = dialog?.querySelector("select");
  return {
    options: [...(select?.options ?? [])].map((o) => ({
      label: o.textContent?.trim(),
      disabled: o.disabled,
    })),
  };
});
check(
  "the picker leads with the income year now running, in full",
  picker.options[0]?.label?.startsWith("2026-2027"),
  picker.options
    .slice(0, 3)
    .map((o) => o.label)
    .join(" | "),
);
check(
  "and offers nothing that has not started",
  !picker.options.some((o) => Number(String(o.label).slice(0, 4)) > 2026),
  picker.options.map((o) => String(o.label).slice(0, 9)).join(" "),
);
check(
  "a year already recorded is greyed out rather than silently overwritten",
  picker.options.some((o) => o.label?.includes("2025-2026") && o.disabled),
  picker.options
    .filter((o) => o.disabled)
    .map((o) => o.label)
    .join(" | ") || "none disabled",
);

/* The acknowledgement has exactly one home: the person's Documents card. */
const slots = await page.evaluate(() =>
  (document.querySelector("main")?.textContent ?? "").replace(/\s+/g, " "),
);
check(
  "the acknowledgement has a slot on the person's Documents card",
  /e-Return acknowledgement/i.test(slots),
  /e-Return acknowledgement/i.test(slots) ? "" : "no slot found",
);

await browser.close();
const removed = await wipe();
check("the throwaway person is removed again", removed === 1, `${removed}`);
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
