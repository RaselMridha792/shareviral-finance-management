/**
 * The sign-in's human check, measured against the real API (built dist).
 * Run from the repository root, after `npm run build:api`. Starts its own
 * API instances on 4011-4015 from apps/api/dist; creates and deletes one
 * account on the database apps/api/.env names.
 *
 * Cloudflare's published test secrets:
 *   1x0000000000000000000000000000000AA  always passes
 *   2x0000000000000000000000000000000AA  always fails
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import pg from "pg";

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

const PASS = "1x0000000000000000000000000000000AA";
const FAIL = "2x0000000000000000000000000000000AA";
const DUMMY = "XXXX.DUMMY.TOKEN.XXXX";
const SENTENCE = "Email or password is incorrect";

const email = "captchaqa@demo.sharevirals.test";
const password = "captcha-qa-" + crypto.randomBytes(8).toString("hex");
/* The HR portal's server (brief 2026-10-04): an HR account, and a Super Admin
   whose right password must not get past the check with the same secret. */
const hrEmail = "captchaqa-hr@demo.sharevirals.test";
const adminEmail = "captchaqa-admin@demo.sharevirals.test";
const HR_SECRET = "hr-secret-" + crypto.randomBytes(12).toString("hex");
const ALL = [email, hrEmail, adminEmail];
await db.query("delete from users where email = any($1)", [ALL]);
const hash = await bcrypt.hash(password, 4);
for (const [address, name, role] of [
  [email, "Captcha QA", "cfo"],
  [hrEmail, "Captcha QA HR", "hr"],
  [adminEmail, "Captcha QA Admin", "super_admin"],
]) {
  await db.query(
    `insert into users (email, full_name, password_hash, role, status)
     values ($1, $2, $3, $4, 'active')`,
    [address, name, hash, role],
  );
}
const started = new Date();

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function login(port, body, extraHeaders = {}) {
  const t = Date.now();
  const res = await fetch(`http://localhost:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "finance-web", ...extraHeaders },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, message: json.message, ms: Date.now() - t };
}

async function account(address = email) {
  const { rows } = await db.query(
    "select failed_login_count, locked_until from users where email = $1",
    [address],
  );
  return rows[0];
}

async function unlock() {
  await db.query(
    "update users set failed_login_count = 0, locked_until = null where email = any($1)",
    [ALL],
  );
}

async function withApi(port, extra, fn) {
  const child = spawn(process.execPath, ["dist/main.js"], {
    cwd: "apps/api",
    env: { ...process.env, PORT: String(port), ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    const up = await fetch(`http://localhost:${port}/api/health`).then((r) => r.ok, () => false);
    if (up) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    await fn();
  } finally {
    child.kill();
  }
  return log;
}

const right = { email, password };

console.log("\nA. no keys (4011): the sign-in works as before");
// "" rather than unset: a value in apps/api/.env must not switch it on here.
await withApi(4011, { TURNSTILE_SECRET_KEY: "" }, async () => {
  const r = await login(4011, right);
  check("right password, no token -> 200", r.status === 200, String(r.status));
  const w = await login(4011, { email, password: "wrong" });
  check("wrong password -> 401, the sentence", w.status === 401 && w.message === SENTENCE, `${w.status} ${w.message}`);
  const t = await login(4011, { ...right, captchaToken: "anything" });
  check("a token is ignored while off -> 200", t.status === 200, String(t.status));
  await db.query("update users set failed_login_count = 0, locked_until = null where email = $1", [email]);
});

console.log("\nB. passing test secret (4012)");
const logB = await withApi(4012, { TURNSTILE_SECRET_KEY: PASS }, async () => {
  const r = await login(4012, right);
  check("right password, no token -> 401, the sentence", r.status === 401 && r.message === SENTENCE, `${r.status} ${r.message}`);
  const e = await login(4012, { ...right, captchaToken: "" });
  check("right password, empty token -> 401, the sentence", e.status === 401 && e.message === SENTENCE, `${e.status} ${e.message}`);
  const long = await login(4012, { ...right, captchaToken: "x".repeat(2049) });
  check("a token over 2048 characters -> 400", long.status === 400, String(long.status));

  for (let i = 0; i < 5; i++) await login(4012, right);
  for (let i = 0; i < 5; i++) await login(4012, { email, password: "wrong" });
  const a = await account();
  check(
    "ten refused checks (5 right, 5 wrong passwords) -> not counted, not locked",
    a.failed_login_count === 0 && a.locked_until === null,
    `count ${a.failed_login_count}, locked ${a.locked_until}`,
  );
  const ok = await login(4012, { ...right, captchaToken: DUMMY });
  check("then the right password and a good token -> 200", ok.status === 200, `${ok.status} ${ok.message ?? ""}`);
  const wrongWithToken = await login(4012, { email, password: "wrong", captchaToken: DUMMY });
  check("good token, wrong password -> 401, the sentence", wrongWithToken.status === 401 && wrongWithToken.message === SENTENCE, `${wrongWithToken.status}`);
  const counted = await account();
  check("...and that one does count toward the lockout", counted.failed_login_count === 1, `count ${counted.failed_login_count}`);
  await db.query("update users set failed_login_count = 0, locked_until = null where email = $1", [email]);
});

console.log("\nC. failing test secret (4013)");
const logC = await withApi(4013, { TURNSTILE_SECRET_KEY: FAIL }, async () => {
  const r = await login(4013, { ...right, captchaToken: DUMMY });
  check("right password, token Cloudflare refuses -> 401, the sentence", r.status === 401 && r.message === SENTENCE, `${r.status} ${r.message}`);
});

console.log("\nD. verify URL that never answers (4014)");
const logD = await withApi(4014, { TURNSTILE_SECRET_KEY: PASS, TURNSTILE_VERIFY_URL: "http://10.255.255.1/siteverify" }, async () => {
  const r = await login(4014, { ...right, captchaToken: DUMMY });
  check("refused with the sentence", r.status === 401 && r.message === SENTENCE, `${r.status} ${r.message}`);
  check("within about 5 s", r.ms >= 4500 && r.ms < 7000, `${r.ms} ms`);
});

console.log("\nE. verify URL that refuses the connection (4015)");
const logE = await withApi(4015, { TURNSTILE_SECRET_KEY: PASS, TURNSTILE_VERIFY_URL: "http://127.0.0.1:9/siteverify" }, async () => {
  const r = await login(4015, { ...right, captchaToken: DUMMY });
  check("refused with the sentence", r.status === 401 && r.message === SENTENCE, `${r.status} ${r.message}`);
});

/*
 * The HR portal's server: no browser, so no token — the shared secret in
 * x-hr-secret instead, for an HR account only. The failing test secret, so
 * anything that did reach Cloudflare would be refused. HR_WEBHOOK_URL empty,
 * so nothing is ever sent anywhere.
 */
const hrRight = { email: hrEmail, password };
const adminRight = { email: adminEmail, password };
const header = { "x-hr-secret": HR_SECRET };
const SERVER = {
  TURNSTILE_SECRET_KEY: FAIL,
  HR_WEBHOOK_SECRET: HR_SECRET,
  HR_WEBHOOK_URL: "",
};

console.log("\nF. check on, the HR portal's secret (4016)");
const logF = await withApi(4016, SERVER, async () => {
  const r = await login(4016, hrRight, header);
  check("HR account, right secret, no token -> 200", r.status === 200, `${r.status} ${r.message ?? ""}`);

  const a = await login(4016, adminRight, header);
  check("Super Admin's right password, same secret -> 401, the sentence", a.status === 401 && a.message === SENTENCE, `${a.status} ${a.message}`);
  const counted = await account(adminEmail);
  check("...and it counts like a wrong password", counted.failed_login_count === 1, `count ${counted.failed_login_count}`);
  const c = await login(4016, right, header);
  check("a CFO's right password, same secret -> 401, the sentence", c.status === 401 && c.message === SENTENCE, `${c.status} ${c.message}`);

  const none = await login(4016, hrRight);
  check("HR account, no header, no token -> 401, the sentence", none.status === 401 && none.message === SENTENCE, `${none.status} ${none.message}`);
  const wrong = await login(4016, hrRight, { "x-hr-secret": HR_SECRET.slice(0, -1) + "x" });
  check("HR account, a wrong secret -> 401, the sentence", wrong.status === 401 && wrong.message === SENTENCE, `${wrong.status} ${wrong.message}`);
  const empty = await login(4016, hrRight, { "x-hr-secret": "" });
  check("HR account, an empty header -> 401, the sentence", empty.status === 401 && empty.message === SENTENCE, `${empty.status} ${empty.message}`);
  const notCounted = await account(hrEmail);
  check("...refused at the check, so not counted", notCounted.failed_login_count === 0, `count ${notCounted.failed_login_count}`);

  const bad = await login(4016, { email: hrEmail, password: "wrong" }, header);
  check("HR account, right secret, wrong password -> 401, the sentence", bad.status === 401 && bad.message === SENTENCE, `${bad.status} ${bad.message}`);
  check("...and it counts", (await account(hrEmail)).failed_login_count === 1);
  for (let i = 0; i < 4; i++) await login(4016, { email: hrEmail, password: "wrong" }, header);
  const locked = await account(hrEmail);
  check("five wrong passwords with the secret lock the HR account", locked.locked_until !== null, `locked ${locked.locked_until}`);
  const after = await login(4016, hrRight, header);
  check("...and then its right password waits", after.status === 401 && /Too many attempts/.test(after.message ?? ""), `${after.status} ${after.message}`);
  await unlock();
});

console.log("\nG. check on, our copy of the secret unset (4017)");
const logG = await withApi(4017, { ...SERVER, HR_WEBHOOK_SECRET: "" }, async () => {
  const r = await login(4017, hrRight, header);
  check("HR account with the header -> 401, the sentence", r.status === 401 && r.message === SENTENCE, `${r.status} ${r.message}`);
  const s = await login(4017, hrRight, { "x-hr-secret": "" });
  check("...and with an empty one", s.status === 401 && s.message === SENTENCE, `${s.status} ${s.message}`);
});

console.log("\nH. check off (4018): the header changes nothing");
const logH = await withApi(4018, { ...SERVER, TURNSTILE_SECRET_KEY: "" }, async () => {
  const a = await login(4018, adminRight, header);
  check("Super Admin with the header -> 200, as before", a.status === 200, `${a.status} ${a.message ?? ""}`);
  const w = await login(4018, hrRight, { "x-hr-secret": "wrong" });
  check("HR account with a wrong header -> 200, as before", w.status === 200, `${w.status} ${w.message ?? ""}`);
  const r = await login(4018, hrRight, header);
  check("HR account with the right header -> 200", r.status === 200, `${r.status} ${r.message ?? ""}`);
  await unlock();
});

console.log("\nLogs and audit");
const logs = logB + logC + logD + logE + logF + logG + logH;
check("no log line carries the test secret", !logs.includes(PASS) && !logs.includes(FAIL));
check("no log line carries the token", !logs.includes(DUMMY));
check("no log line carries the HR portal's secret", !logs.includes(HR_SECRET));
const { rows: leaked } = await db.query(
  "select count(*)::int as n from audit_logs where occurred_at >= $1 and audit_logs::text like $2",
  [started, `%${HR_SECRET}%`],
);
check("no audit row carries the HR portal's secret", leaked[0].n === 0, `${leaked[0].n} rows`);
const { rows: hrAudit } = await db.query(
  "select summary from audit_logs where occurred_at >= $1 and summary like 'Captcha QA HR signed in%' order by occurred_at",
  [started],
);
check(
  "the HR sign-in past the check says so; the one with the check off does not",
  hrAudit.length === 3 &&
    hrAudit[0].summary === "Captcha QA HR signed in (server, past the captcha)" &&
    hrAudit.slice(1).every((r) => r.summary === "Captcha QA HR signed in"),
  hrAudit.map((r) => r.summary).join(" | "),
);
const { rows: adminAudit } = await db.query(
  "select summary from audit_logs where occurred_at >= $1 and summary like $2",
  [started, `%${adminEmail}%not an HR account%`],
);
check("the Super Admin's refusal is in the audit log", adminAudit.length === 1, `${adminAudit.length} rows`);
for (const line of logs.split(/\r?\n/).filter((l) => /CaptchaService/.test(l))) {
  console.log("     " + line.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 220));
}
const { rows: audit } = await db.query(
  "select summary from audit_logs where summary like $1 and occurred_at >= $2",
  [`%${email}%human check refused%`, started],
).catch((e) => ({ rows: [{ summary: "ERR " + e.message }] }));
check("each refusal is in the audit log", audit.length >= 12, `${audit.length} rows`);

await db.query("delete from users where email = any($1)", [ALL]);
await db.end();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
