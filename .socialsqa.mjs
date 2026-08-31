/**
 * A team member's social accounts — the section, the icons, and the link.
 *
 * The owner: *"Team member ar social media add korte hobe eta ekta section
 * thakbe jekhane tara add new add new kore social media account add korte
 * parbe. eta obossoi icons soho hobe."*
 *
 * Three things worth driving rather than reading:
 *
 *   the list is REPLACED, not appended. Sending the whole thing each time is
 *   the shape this app uses elsewhere, and the failure it can have is specific:
 *   a save that leaves the old rows behind, so removing an account does nothing
 *   and the person accumulates duplicates nobody asked for.
 *
 *   the LINK has to land somewhere real. A handle is not a URL and a URL is not
 *   a handle, and people paste whichever they have. "@nizam" on LinkedIn must
 *   become linkedin.com/in/nizam, a pasted address must be used as typed, and a
 *   phone number must NOT become a link at all.
 *
 *   and the unique index is PARTIAL. Removing a platform and adding it straight
 *   back must work — a non-partial index over soft-deleted rows is the exact
 *   trap that cost this repo a silent data bug the same week.
 *
 *     node .socialsqa.mjs      (local only — writes and deletes)
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
    await db.query("select id from team_members where full_name like 'SOCQA %'")
  ).rows.map((r) => r.id);
  for (const id of people) {
    await db.query("delete from team_socials where team_member_id=$1", [id]);
    await db.query("delete from compensation_history where team_member_id=$1", [id]);
    await db.query("delete from payroll_lines where team_member_id=$1", [id]);
    await db.query("delete from team_members where id=$1", [id]);
  }
  return people.length;
};
await wipe();

const member = (
  await call("POST", "/team-members", {
    fullName: "SOCQA Person",
    engagementType: "employee",
    joinedOn: "2024-01-01",
  })
).body;
check("a person exists to hang accounts off", Boolean(member?.id), member?.id ?? "");

const stored = async () =>
  (
    await db.query(
      `select platform, handle, sort_order from team_socials
        where team_member_id=$1 and deleted_at is null order by sort_order`,
      [member.id],
    )
  ).rows;

/* -------------------------------- the API ------------------------------ */

const first = await call("PUT", `/team-members/${member.id}/socials`, {
  socials: [
    { platform: "linkedin", handle: "@nizam" },
    { platform: "website", handle: "shareviral.cash" },
    { platform: "whatsapp", handle: "01711111111" },
  ],
});
check(
  "three accounts save in one request",
  first.status < 300 && (await stored()).length === 3,
  `HTTP ${first.status}, ${(await stored()).length} rows`,
);
check(
  "and they keep the order they were sent in",
  (await stored()).map((r) => r.platform).join(",") ===
    "linkedin,website,whatsapp",
  (await stored()).map((r) => `${r.sort_order}:${r.platform}`).join(" "),
);

/* THE ONE THAT MATTERS: this replaces, it does not append. */
const second = await call("PUT", `/team-members/${member.id}/socials`, {
  socials: [{ platform: "github", handle: "nizam" }],
});
const after = await stored();
check(
  "sending a shorter list REPLACES rather than appends",
  second.status < 300 && after.length === 1 && after[0].platform === "github",
  `${after.length} rows: ${after.map((r) => r.platform).join(",")}`,
);

/* The partial unique index: gone and straight back must work. */
const removedThenBack = await call("PUT", `/team-members/${member.id}/socials`, {
  socials: [{ platform: "github", handle: "nizam-again" }],
});
check(
  "removing a platform and adding it straight back is not refused",
  removedThenBack.status < 300 &&
    (await stored())[0]?.handle === "nizam-again",
  `HTTP ${removedThenBack.status}, handle ${(await stored())[0]?.handle}`,
);

/* Refusals. */
const twice = await call("PUT", `/team-members/${member.id}/socials`, {
  socials: [
    { platform: "github", handle: "a" },
    { platform: "github", handle: "b" },
  ],
});
check(
  "the same platform twice in one request is refused",
  twice.status === 400,
  `HTTP ${twice.status}`,
);
const unknown = await call("PUT", `/team-members/${member.id}/socials`, {
  socials: [{ platform: "myspace", handle: "a" }],
});
check(
  "a platform the app does not know is refused",
  unknown.status === 400,
  `HTTP ${unknown.status}`,
);
const blank = await call("PUT", `/team-members/${member.id}/socials`, {
  socials: [{ platform: "github", handle: "   " }],
});
check(
  "an empty handle is refused rather than stored as whitespace",
  blank.status === 400,
  `HTTP ${blank.status}`,
);

/* Put a readable set back for the screen. */
await call("PUT", `/team-members/${member.id}/socials`, {
  socials: [
    { platform: "linkedin", handle: "@nizam" },
    { platform: "x", handle: "https://x.com/shareviral" },
    { platform: "whatsapp", handle: "01711111111" },
  ],
});

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

const readCard = async () => {
  await page.goto(`${WEB}/team/${member.id}`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await settle(2800);
  return page.evaluate(() => {
    const heading = [...document.querySelectorAll("*")].find(
      (el) =>
        el.children.length === 0 && (el.textContent ?? "").trim() === "Social media",
    );
    const card = heading?.closest("div.rounded-xl, div[class*='rounded'], section");
    if (!card) return null;
    return {
      entries: [...card.querySelectorAll("li")].map((li) => {
        const link = li.querySelector("a");
        const chip = li.querySelector('[aria-hidden="true"]');
        return {
          text: (li.textContent ?? "").replace(/\s+/g, " ").trim(),
          href: link?.getAttribute("href") ?? null,
          rel: link?.getAttribute("rel") ?? null,
          target: link?.getAttribute("target") ?? null,
          mark: (chip?.textContent ?? "").trim(),
          markColour: chip ? getComputedStyle(chip).backgroundColor : null,
        };
      }),
      hasButton: [...card.querySelectorAll("button")].some((b) =>
        /^(Add|Edit)$/.test((b.textContent ?? "").trim()),
      ),
    };
  });
};

const card = await readCard();
check("the profile has a Social media section", Boolean(card), card ? "" : "not found");
check(
  "with one entry per account",
  card?.entries.length === 3,
  `${card?.entries.length} entries`,
);
check(
  "and a way to add or edit them",
  card?.hasButton === true,
  card?.hasButton ? "" : "no Add/Edit button",
);

const linkedin = card?.entries.find((e) => e.text.includes("LinkedIn"));
check(
  "a handle becomes the platform's own address",
  linkedin?.href === "https://www.linkedin.com/in/nizam",
  `${linkedin?.href}`,
);
const x = card?.entries.find((e) => e.text.includes("X"));
check(
  "a pasted address is used exactly as typed",
  x?.href === "https://x.com/shareviral",
  `${x?.href}`,
);
const wa = card?.entries.find((e) => e.text.includes("WhatsApp"));
check(
  "a phone number is NOT turned into a link that goes nowhere",
  wa !== undefined && wa.href === null,
  `href ${JSON.stringify(wa?.href)} — ${wa?.text}`,
);
check(
  "every outward link opens in a new tab with noopener",
  card?.entries
    .filter((e) => e.href)
    .every((e) => e.target === "_blank" && /noopener/.test(e.rel ?? "")),
  card?.entries.map((e) => `${e.target ?? "-"}/${e.rel ?? "-"}`).join(" | "),
);

/*
 * The icons. lucide ships no brand marks, so each platform is a coloured chip —
 * what matters is that the chips are DISTINCT: a row of identical grey squares
 * would satisfy "there is an icon" and fail the thing icons are for.
 */
const marks = (card?.entries ?? []).map((e) => e.mark);
const colours = (card?.entries ?? []).map((e) => e.markColour);
check(
  "each account carries its own mark, and no two are the same",
  marks.length === 3 && new Set(marks).size === 3,
  marks.join(" "),
);
check(
  "and its own colour",
  colours.length === 3 && new Set(colours).size === 3,
  colours.join(" | "),
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
