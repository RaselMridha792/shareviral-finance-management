/**
 * T11 — AUTH
 *
 * The plan's Phase 1 acceptance test, run for real: replaying a rotated refresh
 * token must kill the whole family, and a role change must kill live access
 * tokens rather than waiting fifteen minutes.
 *
 * Everything runs against a throwaway account this script creates, so no real
 * person can be locked out by a lockout test. The account is removed at the
 * end, along with its tokens and audit rows.
 */
import fs from "node:fs";
import pg from "pg";

const API = process.env.API;
const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const TOK = Object.fromEntries(
  fs.readFileSync(new URL("./roles.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);

const ADMIN = { "content-type": "application/json", authorization: `Bearer ${TOK.SUPER_ADMIN}`, "x-requested-with": "finance-web" };
const asAdmin = async (p, m = "GET", b) => {
  const r = await fetch(`${API}${p}`, { method: m, headers: ADMIN, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

let pass = 0, fail = 0, note = 0;
const ok = (n, d) => { pass++; console.log(`  PASS  ${n}${d ? " — " + d : ""}`); };
const bad = (n, d) => { fail++; console.log(`  FAIL  ${n} — ${d}`); };
const meh = (n, d) => { note++; console.log(`  ????  ${n} — ${d}`); };

/** Cookies out of a Set-Cookie list, as a plain name→value map. */
const cookiesFrom = (res) => {
  const out = {};
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
};
const jarHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

const login = async (email, password) => {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "finance-web" },
    body: JSON.stringify({ email, password }),
  });
  return { status: r.status, body: await r.json().catch(() => null), jar: cookiesFrom(r) };
};

const refresh = async (refreshToken) => {
  const r = await fetch(`${API}/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "finance-web", cookie: `sfm_refresh=${refreshToken}` },
  });
  return { status: r.status, body: await r.json().catch(() => null), jar: cookiesFrom(r) };
};

const meWith = async (accessToken) => {
  const r = await fetch(`${API}/auth/me`, { headers: { authorization: `Bearer ${accessToken}`, "x-requested-with": "finance-web" } });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

console.log("\nT11 — AUTH\n");

/** Everything asserted about the audit log is counted from here, not from all time. */
const startedAt = (await db.query("select now() n")).rows[0].n;

/* ------------------------------------------------- a throwaway account */

const EMAIL = "t11.rotation.test@shareviral.cash";
const PASSWORD = "T11-rotation-Test-2026!";

await db.query("delete from refresh_tokens where user_id in (select id from users where email = $1)", [EMAIL]);
await db.query("delete from users where email = $1", [EMAIL]);

const created = await asAdmin("/users", "POST", {
  email: EMAIL, fullName: "T11 Rotation Test", role: "cfo",
  password: PASSWORD, mustChangePassword: false,
});
if (created.status !== 201 && created.status !== 200) {
  console.log(`  FAIL  could not create the test account — HTTP ${created.status} ${JSON.stringify(created.body)}`);
  await db.end();
  process.exit(1);
}
const userId = created.body.id;
ok("created a throwaway account for this test", `${EMAIL} (finance)`);

const tokenCount = async () => (await db.query("select count(*)::int n from refresh_tokens where user_id = $1", [userId])).rows[0].n;
const liveCount = async () => (await db.query("select count(*)::int n from refresh_tokens where user_id = $1 and revoked_at is null", [userId])).rows[0].n;

/* ------------------------------------------------------------- signing in */

const first = await login(EMAIL, PASSWORD);
first.status === 200 ? ok("the account can sign in", `HTTP 200, ${first.body?.fullName ?? ""}`) : bad("sign in", `HTTP ${first.status} ${JSON.stringify(first.body)}`);

const access1 = first.jar.sfm_access, refresh1 = first.jar.sfm_refresh;
access1 && refresh1
  ? ok("both cookies are set on login", "sfm_access and sfm_refresh")
  : bad("both cookies set", `access ${!!access1}, refresh ${!!refresh1}`);

const rawSetCookie = (await (async () => {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST", headers: { "content-type": "application/json", "x-requested-with": "finance-web" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  return r.headers.getSetCookie?.() ?? [];
})());
const refreshLine = rawSetCookie.find((l) => l.startsWith("sfm_refresh="));
/^.*HttpOnly/i.test(refreshLine ?? "") && /SameSite=Lax/i.test(refreshLine ?? "")
  ? ok("the refresh cookie is httpOnly and SameSite=Lax", "out of reach of page scripts")
  : bad("refresh cookie flags", refreshLine ?? "no sfm_refresh cookie");

/* --------------------------------------- the token itself is never stored */

const stored = (await db.query("select token_hash from refresh_tokens where user_id = $1", [userId])).rows;
stored.every((r) => r.token_hash !== refresh1) && stored.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))
  ? ok("only the SHA-256 of the refresh token is stored", `${stored.length} row(s), none holding the token itself`)
  : bad("refresh token is stored hashed", "the raw token appears in the table");

const byHash = (await db.query(
  "select count(*)::int n from refresh_tokens where user_id = $1 and token_hash = encode(sha256($2::bytea), 'hex')",
  [userId, refresh1])).rows[0].n;
byHash === 1
  ? ok("the stored hash really is the hash of the issued token", "a database dump yields no usable session")
  : bad("stored hash matches", `${byHash} row(s) matched`);

/* ------------------------------------------------------------- rotation */

const second = await refresh(refresh1);
const refresh2 = second.jar.sfm_refresh, access2 = second.jar.sfm_access;
second.status === 200 && refresh2 && refresh2 !== refresh1
  ? ok("refreshing rotates the token", "a new refresh token every use")
  : bad("refresh rotates", `HTTP ${second.status}, same token: ${refresh2 === refresh1}`);

access2 && access2 !== access1
  ? ok("a new access token comes with it", "")
  : bad("new access token", "unchanged");

const okAfterRotate = await meWith(access2);
okAfterRotate.status === 200
  ? ok("the new access token works", `/auth/me → ${okAfterRotate.body?.email}`)
  : bad("the new access token works", `HTTP ${okAfterRotate.status}`);

const [famRow] = (await db.query(
  "select count(distinct family_id)::int f, count(*)::int n from refresh_tokens where user_id = $1", [userId])).rows;
ok("rotation stays inside one family", `${famRow.n} token rows across ${famRow.f} famil(ies)`);

/* --------------------------- the whole point: replaying a rotated token */

// The cookie-flags check above signed in a second time, which starts a second
// family — a second device, in effect. That is what makes this test worth
// running: revocation must take the compromised family and leave the other.
const familyOf = async (token) => (await db.query(
  "select family_id from refresh_tokens where token_hash = encode(sha256($1::bytea), 'hex')", [token])).rows[0]?.family_id;
const liveInFamily = async (familyId) => (await db.query(
  "select count(*)::int n from refresh_tokens where family_id = $1 and revoked_at is null", [familyId])).rows[0].n;

const attacked = await familyOf(refresh2);
const otherFamilies = (await db.query(
  "select distinct family_id from refresh_tokens where user_id = $1 and family_id <> $2", [userId, attacked])).rows.map((r) => r.family_id);

const liveInAttackedBefore = await liveInFamily(attacked);
const liveElsewhereBefore = (await Promise.all(otherFamilies.map(liveInFamily))).reduce((a, b) => a + b, 0);

const replay = await refresh(refresh1); // the one already spent
replay.status === 401
  ? ok("replaying a spent refresh token is refused", `HTTP 401 "${replay.body?.message}"`)
  : bad("replay refused", `HTTP ${replay.status}`);

const liveInAttackedAfter = await liveInFamily(attacked);
liveInAttackedBefore > 0 && liveInAttackedAfter === 0
  ? ok("and it revokes every session in that family", `${liveInAttackedBefore} live before, ${liveInAttackedAfter} after`)
  : bad("replay revokes the family", `${liveInAttackedBefore} → ${liveInAttackedAfter}`);

const liveElsewhereAfter = (await Promise.all(otherFamilies.map(liveInFamily))).reduce((a, b) => a + b, 0);
otherFamilies.length > 0 && liveElsewhereAfter === liveElsewhereBefore
  ? ok("the other device is left signed in", `${otherFamilies.length} other famil(ies), ${liveElsewhereAfter} token(s) untouched — one stolen token does not sign you out everywhere`)
  : meh("other families untouched", `${otherFamilies.length} other famil(ies), ${liveElsewhereBefore} → ${liveElsewhereAfter}`);

const reasons = (await db.query(
  "select distinct revoked_reason from refresh_tokens where user_id = $1 and revoked_reason is not null", [userId])).rows.map((r) => r.revoked_reason);
reasons.some((r) => /reuse/i.test(r ?? ""))
  ? ok("the reason is recorded, not just the revocation", `"${reasons.find((r) => /reuse/i.test(r))}"`)
  : meh("revocation reason", `reasons seen: ${JSON.stringify(reasons)}`);

const reuseAudits = async () => (await db.query(
  `select count(*)::int n from audit_logs
    where module = 'auth' and summary ilike '%reuse detected%' and occurred_at > $1`,
  [startedAt])).rows[0].n;

// Counted here, before anything else touches a dead token — a presented token
// that is already revoked reads as reuse too, and would inflate the number.
const afterReplayAudits = await reuseAudits();
afterReplayAudits === 1
  ? ok("this reuse is written to the audit log", "one entry, from this replay, with nothing else in the window")
  : bad("reuse is audited", `${afterReplayAudits} entr(ies) since the run began, expected 1`);

const honest = await refresh(refresh2); // the legitimate holder's current token
honest.status === 401
  ? ok("the legitimate session dies too — the app cannot tell thief from owner", "both must sign in again")
  : bad("the legitimate token is revoked as well", `HTTP ${honest.status} — a thief's session would survive`);

(await reuseAudits()) === 2
  ? ok("presenting an already-revoked token is logged as reuse as well", "there is no way to tell it from a real theft, so it is not treated as one")
  : bad("the second presentation is audited", `${await reuseAudits()} entr(ies)`);

/* ------------------------------------------ a role change kills live tokens */

const fresh = await login(EMAIL, PASSWORD);
const liveAccess = fresh.jar.sfm_access;
(await meWith(liveAccess)).status === 200
  ? ok("signed in again after the revocation", "the account itself is unharmed")
  : bad("sign in again", "could not");

const [{ token_version: tvBefore }] = (await db.query("select token_version from users where id = $1", [userId])).rows;
const promoted = await asAdmin(`/users/${userId}`, "PATCH", { role: "hr" });
promoted.status === 200 ? ok("role changed finance → hr", "") : bad("role change", `HTTP ${promoted.status} ${JSON.stringify(promoted.body)}`);

const [{ token_version: tvAfter }] = (await db.query("select token_version from users where id = $1", [userId])).rows;
tvAfter === tvBefore + 1
  ? ok("the role change bumps tokenVersion", `${tvBefore} → ${tvAfter}`)
  : bad("tokenVersion bumped", `${tvBefore} → ${tvAfter}`);

const afterPromotion = await meWith(liveAccess);
afterPromotion.status === 401
  ? ok("the token issued a moment ago is dead at once", "no fifteen-minute window with the old role")
  : bad("live token dies on role change", `HTTP ${afterPromotion.status} — the old role is still usable`);

// And prove the old role's *power* is gone, not just the /me call.
const payrollWithOldToken = await fetch(`${API}/payroll/runs`, { headers: { authorization: `Bearer ${liveAccess}`, "x-requested-with": "finance-web" } });
payrollWithOldToken.status === 401
  ? ok("the old token cannot reach what its old role could", "HTTP 401 on /payroll/runs")
  : bad("old token still has reach", `HTTP ${payrollWithOldToken.status}`);

/**
 * Signing in again must produce the new role's reach, not the old one.
 *
 * This used to check that HR is refused the payroll list. HR reads the salary
 * sheet now, so that proved nothing about the role change — it had to become a
 * thing HR still cannot do. The ledger is the clean one: finance could open it,
 * HR cannot, and it has nothing to do with pay.
 */
const asHr = await login(EMAIL, PASSWORD);
const hrHeaders = { authorization: `Bearer ${asHr.jar.sfm_access}`, "x-requested-with": "finance-web" };

const hrLedger = await fetch(`${API}/transactions?page=1&pageSize=1`, { headers: hrHeaders });
hrLedger.status === 403
  ? ok("signing in again gives the new role, with the new limits", "the ledger was open to finance and is 403 to HR")
  : bad("the new role applies", `expected 403 on the ledger, got ${hrLedger.status}`);

// And the half of the new role that should work, so this is not just a
// demotion that broke everything.
const hrPayroll = await fetch(`${API}/payroll/runs`, { headers: hrHeaders });
hrPayroll.status === 200
  ? ok("and the new role's own reach works", "HR can read the salary sheet")
  : bad("the new role's reach", `expected 200 on payroll, got ${hrPayroll.status}`);

/* ------------------------------------------------- a password reset does too */

const beforeReset = await liveCount();
const stillGood = asHr.jar.sfm_access;
const reset = await asAdmin(`/users/${userId}/reset-password`, "POST", { newPassword: "T11-Reset-Password-2026!", mustChangePassword: true });
reset.status === 200 || reset.status === 201 ? ok("password reset accepted", "") : bad("password reset", `HTTP ${reset.status} ${JSON.stringify(reset.body)}`);

(await meWith(stillGood)).status === 401
  ? ok("resetting the password kills live access tokens as well", "")
  : bad("password reset kills tokens", "the old access token still works");

const afterReset = await liveCount();
afterReset === 0
  ? ok("and every refresh token with them", `${beforeReset} live before, ${afterReset} after`)
  : bad("password reset revokes refresh tokens", `${afterReset} still live`);

const oldPassword = await login(EMAIL, PASSWORD);
oldPassword.status === 401
  ? ok("the old password no longer works", "")
  : bad("old password rejected", `HTTP ${oldPassword.status}`);

/* --------------------------------------------------------------- lockout */

const NEW_PASSWORD = "T11-Reset-Password-2026!";
// Start from a clean count — the old-password check above was itself a failure.
await db.query("update users set failed_login_count = 0, locked_until = null where id = $1", [userId]);

let lockedAt = null;
const messages = [];
for (let attempt = 1; attempt <= 7; attempt++) {
  const r = await login(EMAIL, "definitely-not-the-password");
  messages.push(r.body?.message ?? "");
  if (/Too many attempts/i.test(r.body?.message ?? "")) { lockedAt = attempt; break; }
}
lockedAt === 6
  ? ok("the sixth attempt is locked out — five failures is the limit", `attempts 1-5 said "${messages[0]}", the 6th said "${messages[5]}"`)
  : lockedAt ? bad("lockout threshold", `locked on attempt ${lockedAt}, expected the 6th`) : bad("lockout", "never locked after seven wrong passwords");

const lockedOut = await login(EMAIL, NEW_PASSWORD);
/Too many attempts/i.test(lockedOut.body?.message ?? "")
  ? ok("the lock holds even against the correct password", `"${lockedOut.body.message}"`)
  : bad("lock holds", `HTTP ${lockedOut.status} ${JSON.stringify(lockedOut.body)}`);

/**
 * How long the lock lasts, which is the half the threshold test never covered.
 *
 * Asserted against the stored `locked_until` rather than only against the
 * message, because the message is rounded up with Math.ceil — it would still
 * read "5 minutes" for a lock of four minutes and one second, and a lock that
 * quietly shortened would go unnoticed. A window is allowed for the round trip
 * and the clock, not for a different setting.
 */
{
  const [row] = (
    await db.query(
      "select extract(epoch from (locked_until - now())) as seconds from users where id = $1",
      [userId],
    )
  ).rows;
  const seconds = Number(row?.seconds ?? 0);
  seconds > 4 * 60 && seconds <= 5 * 60
    ? ok("the lock lasts five minutes", `${Math.round(seconds)}s left on it`)
    : bad("lock duration", `expected just under 5 minutes, got ${Math.round(seconds)}s`);

  /Try again in 5 minutes/i.test(lockedOut.body?.message ?? "")
    ? ok("and says so in words", `"${lockedOut.body.message}"`)
    : bad("lock duration wording", `"${lockedOut.body?.message}" does not say 5 minutes`);
}

const unknown = await login("nobody@shareviral.cash", "whatever");
const wrongPw = await login(EMAIL.replace("t11", "t11x"), "whatever");
unknown.body?.message === wrongPw.body?.message
  ? ok("an unknown email and a wrong password read identically", `"${unknown.body.message}"`)
  : bad("no account enumeration", `"${unknown.body?.message}" vs "${wrongPw.body?.message}"`);

await db.query("update users set locked_until = null, failed_login_count = 0 where id = $1", [userId]);

/* ----------------------------------------------------------- logging out */

const finalLogin = await login(EMAIL, NEW_PASSWORD);
finalLogin.status === 200 ? ok("the lock can be cleared and the account signs in", "") : bad("sign in after unlock", `HTTP ${finalLogin.status}`);

const outRes = await fetch(`${API}/auth/logout`, {
  method: "POST",
  headers: { "x-requested-with": "finance-web", cookie: jarHeader(finalLogin.jar) },
});
outRes.status === 200 || outRes.status === 201 ? ok("logout accepted", "") : bad("logout", `HTTP ${outRes.status}`);

(await refresh(finalLogin.jar.sfm_refresh)).status === 401
  ? ok("the refresh token is dead after logout", "signing out really ends the session")
  : bad("logout kills the refresh token", "it still refreshes");

const cleared = cookiesFrom(outRes);
"sfm_refresh" in cleared && cleared.sfm_refresh === ""
  ? ok("logout clears the cookie in the browser too", "")
  : meh("logout clears the cookie", JSON.stringify(cleared));

/* ------------------------------------------- a garbage token gets nowhere */

const garbage = await refresh("this-is-not-a-real-refresh-token");
garbage.status === 401 ? ok("a made-up refresh token is refused", `HTTP 401`) : bad("garbage refused", `HTTP ${garbage.status}`);

const noToken = await fetch(`${API}/transactions`, { headers: { "x-requested-with": "finance-web" } });
noToken.status === 401 ? ok("no token reaches nothing", "HTTP 401 on the ledger") : bad("unauthenticated blocked", `HTTP ${noToken.status}`);

const tampered = TOK.SUPER_ADMIN.slice(0, -3) + "aaa";
(await meWith(tampered)).status === 401
  ? ok("a tampered signature is refused", "")
  : bad("tampered token refused", "it was accepted");

/* ------------------------------------------------------------- clean up */

await db.query("delete from refresh_tokens where user_id = $1", [userId]);
await db.query("delete from audit_logs where entity_id = $1", [userId]);
await db.query("delete from users where id = $1", [userId]);
const gone = (await db.query("select count(*)::int n from users where email = $1", [EMAIL])).rows[0].n;
gone === 0 ? ok("the throwaway account is removed", "no test user left behind") : bad("cleanup", `${gone} row(s) remain`);

const realUsers = (await db.query("select count(*)::int n from users where locked_until is not null and locked_until > now()")).rows[0].n;
realUsers === 0
  ? ok("no real account was locked by this run", "")
  : bad("a real account is locked", `${realUsers} account(s) locked — clear before the demo`);

await db.end();
console.log(`\n${pass} passed, ${fail} failed, ${note} inconclusive`);
process.exit(fail ? 1 : 0);
