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
await db.query("delete from users where email = $1", [email]);
await db.query(
  `insert into users (email, full_name, password_hash, role, status)
   values ($1, 'Captcha QA', $2, 'cfo', 'active')`,
  [email, await bcrypt.hash(password, 4)],
);
const started = new Date();

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function login(port, body) {
  const t = Date.now();
  const res = await fetch(`http://localhost:${port}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "finance-web" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, message: json.message, ms: Date.now() - t };
}

async function account() {
  const { rows } = await db.query(
    "select failed_login_count, locked_until from users where email = $1",
    [email],
  );
  return rows[0];
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

console.log("\nLogs and audit");
const logs = logB + logC + logD + logE;
check("no log line carries the test secret", !logs.includes(PASS) && !logs.includes(FAIL));
check("no log line carries the token", !logs.includes(DUMMY));
for (const line of logs.split(/\r?\n/).filter((l) => /CaptchaService/.test(l))) {
  console.log("     " + line.replace(/\x1b\[[0-9;]*m/g, "").slice(0, 220));
}
const { rows: audit } = await db.query(
  "select summary from audit_logs where summary like $1 and occurred_at >= $2",
  [`%${email}%human check refused%`, started],
).catch((e) => ({ rows: [{ summary: "ERR " + e.message }] }));
check("each refusal is in the audit log", audit.length >= 12, `${audit.length} rows`);

await db.query("delete from users where email = $1", [email]);
await db.end();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
