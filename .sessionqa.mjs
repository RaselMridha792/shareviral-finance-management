/**
 * How long a session lasts, and what still kills it.
 *
 * Two things were signing people out early:
 *
 *   1. The screen gave up after twenty minutes of no typing. It is two hours
 *      now, on the owner's rule: the session does not end while somebody is
 *      working, and two hours of nothing sends them back to sign in.
 *   2. Two refreshes arriving together — two tabs, or one screen whose fetches
 *      all 401 at once — were read as a stolen token being replayed, and the
 *      whole family was revoked. Measured before the fix: `alive = 0`, so even
 *      the winner's brand-new token was dead.
 *
 * The fix narrows reuse detection rather than switching it off, so most of what
 * is below is the proof that it still fires: a replay after the window, a
 * replay into a dead family, and a token revoked by signing out.
 *
 *     node .sessionqa.mjs      (local only — creates and deletes one account)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcryptjs";
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

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const EMAIL = "session-probe@local.test";
const secret = crypto.randomBytes(18).toString("base64url") + "aA1!"; // never printed
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

const wipe = async () => {
  await db.query(
    "delete from refresh_tokens where user_id in (select id from users where email=$1)",
    [EMAIL],
  );
  await db.query("delete from users where email=$1", [EMAIL]);
};
const makeUser = async () => {
  await wipe();
  await db.query(
    `insert into users (email, password_hash, full_name, role, status, token_version, must_change_password)
     values ($1, $2, 'Session Probe', 'admin', 'active', 0, false)`,
    [EMAIL, await bcrypt.hash(secret, 10)],
  );
};

const cookiesOf = (res) => {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const c of raw) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    jar[kv.slice(0, i).trim()] = kv.slice(i + 1);
  }
  return jar;
};
const asHeader = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
const signIn = async () => {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "finance-web" },
    body: JSON.stringify({ email: EMAIL, password: secret }),
  });
  return cookiesOf(res);
};
const refresh = (jar) =>
  fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { cookie: asHeader(jar), "X-Requested-With": "finance-web" },
  });
const familyState = async () =>
  (
    await db.query(
      `select count(*) filter (where revoked_at is null)::int as alive,
              max(revoked_reason) as why
         from refresh_tokens where user_id in (select id from users where email=$1)`,
      [EMAIL],
    )
  ).rows[0];

/* ---------------------------------------- 1. two at once, as two tabs do */

await makeUser();
let jar = await signIn();
check(
  "signing in issues both cookies",
  Boolean(jar.sfm_access && jar.sfm_refresh),
  Object.keys(jar).join(", "),
);

const [a, b] = await Promise.all([refresh(jar), refresh(jar)]);
check(
  "two refreshes arriving together both succeed",
  a.status === 200 && b.status === 200,
  `${a.status} and ${b.status}`,
);
const winner = cookiesOf(a).sfm_refresh ? cookiesOf(a) : cookiesOf(b);
const loser = cookiesOf(a).sfm_refresh ? cookiesOf(b) : cookiesOf(a);
check(
  "only one of them writes a refresh cookie",
  Boolean(winner.sfm_refresh) && !loser.sfm_refresh,
  `winner set ${Object.keys(winner).join("+")}, the other set ${Object.keys(loser).join("+") || "nothing"}`,
);
check("the loser still gets a fresh access token", Boolean(loser.sfm_access), "");
const after = await familyState();
check(
  "and the session is still alive",
  after.alive === 1 && !after.why,
  JSON.stringify(after),
);
const onward = await refresh({ ...jar, ...winner });
check("the session keeps refreshing afterwards", onward.status === 200, `HTTP ${onward.status}`);

/* --------------------------- 2. a replay after the window is still a replay */

await makeUser();
jar = await signIn();
const old = jar.sfm_refresh;
await refresh(jar);
// Age the rotation past the grace window without waiting for it.
await db.query(
  "update refresh_tokens set revoked_at = now() - interval '2 minutes' where token_hash = $1",
  [sha(old)],
);
const late = await refresh(jar);
const afterLate = await familyState();
check("the same token replayed after the window is refused", late.status === 401, `HTTP ${late.status}`);
check(
  "and it takes the whole family with it, as it always did",
  afterLate.alive === 0 && /reuse detected/.test(afterLate.why ?? ""),
  JSON.stringify(afterLate),
);

/* ------------------------- 3. a replay into a family that is already dead */

await makeUser();
jar = await signIn();
const first = await refresh(jar);
const head = cookiesOf(first);
// Kill the head, then present its predecessor inside the window.
await db.query(
  "update refresh_tokens set revoked_at = now(), revoked_reason = 'test' where token_hash = $1",
  [sha(head.sfm_refresh)],
);
const orphan = await refresh(jar);
check(
  "a straggler is refused when the family has no live head",
  orphan.status === 401,
  `HTTP ${orphan.status}`,
);

/* ------------------------------------ 4. signing out still ends the session */

await makeUser();
jar = await signIn();
await fetch(`${API}/auth/logout`, {
  method: "POST",
  headers: { cookie: asHeader(jar), "X-Requested-With": "finance-web" },
});
const afterLogout = await refresh(jar);
check(
  "a token that was signed out cannot refresh",
  afterLogout.status === 401,
  `HTTP ${afterLogout.status}`,
);

/* ------------------------------------------- 5. the screen waits an hour */

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
await makeUser();
jar = await signIn();
await browser.setCookie({
  name: "sfm_access",
  value: jar.sfm_access,
  domain: "localhost",
  path: "/",
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = "sfm.last-activity.v1";
const idleAfter = async (minutes) => {
  /*
   * The clock is wound back AFTER the page is up, not before: the component
   * stamps "now" the moment it mounts, so a value written ahead of the
   * navigation is overwritten and every reading comes back idle-for-zero.
   */
  await page.goto(`${WEB}/`, { waitUntil: "networkidle0", timeout: 120000 });
  await settle(2000);
  await page.evaluate(
    (k, ago) => window.localStorage.setItem(k, String(Date.now() - ago)),
    KEY,
    minutes * 60000,
  );
  await settle(7000);
  return page.evaluate(() => ({
    url: location.pathname + location.search,
    warning: [...document.querySelectorAll('[role="alertdialog"]')].some((d) =>
      /Still there\?/.test(d.textContent ?? ""),
    ),
  }));
};

const at60 = await idleAfter(60);
check(
  "an hour of nothing no longer signs anybody out",
  !at60.url.startsWith("/login") && !at60.warning,
  JSON.stringify(at60),
);
const at119 = await idleAfter(119.5);
check(
  "the warning comes in the last minute of the second hour",
  at119.warning && !at119.url.startsWith("/login"),
  JSON.stringify(at119),
);

/*
 * The owner's rule, tested where it actually applies: while somebody is
 * working, the clock never gets near the end.
 *
 * The wait before the click is not padding. Activity is written to
 * localStorage at most once every ten seconds, so a click within that window
 * of the page loading is throttled away — real use never notices, a test that
 * winds the clock back by hand does.
 */
await page.goto(`${WEB}/`, { waitUntil: "networkidle0", timeout: 120000 });
await settle(2000);
await page.evaluate(
  (k, ago) => window.localStorage.setItem(k, String(Date.now() - ago)),
  KEY,
  90 * 60000,
);
await settle(11000);
await page.mouse.click(700, 400);
await settle(1500);
const afterWorking = await page.evaluate((k) => ({
  url: location.pathname + location.search,
  warning: [...document.querySelectorAll('[role="alertdialog"]')].some((d) =>
    /Still there\?/.test(d.textContent ?? ""),
  ),
  idleSeconds: Math.round((Date.now() - Number(window.localStorage.getItem(k))) / 1000),
}), KEY);
check(
  "one click after ninety idle minutes puts the whole two hours back",
  !afterWorking.url.startsWith("/login") &&
    !afterWorking.warning &&
    afterWorking.idleSeconds < 30,
  JSON.stringify(afterWorking),
);

/*
 * And inside the final minute the dialog is deliberately deaf to movement
 * underneath it — a knocked desk must not answer for the person who left. The
 * way back in is the button, so that is what is tested.
 */
await page.evaluate(
  (k, ago) => window.localStorage.setItem(k, String(Date.now() - ago)),
  KEY,
  119.5 * 60000,
);
await settle(7000);
const warned = await page.evaluate(() =>
  [...document.querySelectorAll('[role="alertdialog"]')].some((d) =>
    /Still there\?/.test(d.textContent ?? ""),
  ),
);
const stayed = await page.evaluate(() => {
  const d = document.querySelector('[role="alertdialog"]');
  const b = [...(d?.querySelectorAll("button") ?? [])].find((x) =>
    /Stay signed in/i.test(x.textContent ?? ""),
  );
  if (!b) return false;
  b.click();
  return true;
});
await settle(2000);
const afterStaying = await page.evaluate((k) => ({
  url: location.pathname + location.search,
  warning: [...document.querySelectorAll('[role="alertdialog"]')].some((d) =>
    /Still there\?/.test(d.textContent ?? ""),
  ),
  idleSeconds: Math.round((Date.now() - Number(window.localStorage.getItem(k))) / 1000),
}), KEY);
check(
  "and \"Stay signed in\" is the way back from the last minute",
  warned && stayed && !afterStaying.warning && afterStaying.idleSeconds < 30,
  JSON.stringify(afterStaying),
);

const at121 = await idleAfter(121);
check(
  "and past two hours it still signs out, as it must",
  at121.url.startsWith("/login"),
  JSON.stringify(at121),
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
