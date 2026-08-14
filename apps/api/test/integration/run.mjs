/**
 * The integration suite.
 *
 * Boots the API on a free port against the real database, signs in as each of
 * the five roles, runs every suite in order, and puts the demo books back
 * between them. Nothing here needs a server started by hand.
 *
 *   npm run test:integration            everything
 *   npm run test:integration -- fx      only the suites whose name matches
 *
 * These are not unit tests and are not meant to be. Each one asserts something
 * that only shows up once the whole stack is standing: that the register ties
 * to the bank to the paisa, that HR gets a 403 rather than a hidden menu item,
 * that a replayed refresh token takes its whole family down. The unit tests in
 * packages/shared cover the arithmetic underneath; this covers the promises.
 *
 * Every suite must leave the books as it found them. The runner checks that
 * after each one and fails the run if a suite silently changed the world —
 * a test that leaves money moved is a test that will lie to the next one.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import jwt from "jsonwebtoken";

import { booksState, loadEnv, openDb, resetDemoBooks } from "./reset.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "../..");

/**
 * A port the operating system just told us is free, rather than a number
 * chosen in advance.
 *
 * A fixed port fails the moment two runs happen back to back: the previous
 * server is still letting go of it, the new one cannot bind, and the health
 * check answers from the dying process — so the run reports "did not finish"
 * for reasons that have nothing to do with the code under test.
 */
async function freePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const PORT = Number(process.env.TEST_API_PORT) || (await freePort());
const BASE = `http://127.0.0.1:${PORT}/api`;

/**
 * Order matters in one place only: the two suites that move real money run
 * last, so that if one of them ever fails to unwind, the failure is isolated
 * rather than poisoning eight suites behind it.
 */
const SUITES = [
  ["01-money-tie.mjs", "the register ties to the bank, to the paisa"],
  ["02-ledger-payroll-audit.mjs", "ledger, payroll and the audit trail"],
  ["03-permissions.mjs", "every role against every endpoint"],
  ["04-exports.mjs", "downloads match the filtered view"],
  ["05-fx.mjs", "one rate governs every screen"],
  ["06-periods.mjs", "both financial years, and the boundary between them"],
  ["07-auth.mjs", "rotation, reuse detection, role changes, lockout"],
  ["08-payroll-tax-import.mjs", "paying a run, the TDS arithmetic, importing"],
  ["09-payroll-reopen.mjs", "reopening a run after voiding its payment"],
  ["10-batch-of-drafts.mjs", "many records saved one at a time, one bad row and none stranded"],
  ["11-tds-over-deposit.mjs", "a challan larger than the month it covers is reported, not clamped away"],
];

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const chosen = only.length
  ? SUITES.filter(([file]) => only.some((o) => file.includes(o)))
  : SUITES;

if (!chosen.length) {
  console.error(`No suite matches ${only.join(", ")}. Available:`);
  for (const [file] of SUITES) console.error(`  ${file}`);
  process.exit(1);
}

const env = loadEnv();
if (!env.DATABASE_URL && !env.DATABASE_URL_UNPOOLED) {
  console.error("apps/api/.env has no DATABASE_URL — nothing to test against.");
  process.exit(1);
}

/* -------------------------------------------------------------- the server */

/**
 * Booted with `nest start`, not with tsx.
 *
 * tsx compiles through esbuild, which does not emit the decorator metadata
 * Nest's injector reads — the app starts, then every guard fails with an
 * undefined Reflector on the first request. Slower to boot, but this is the
 * same command that runs the app in development, which is the point.
 */
console.log(`\nBooting the API on ${PORT}…`);
const server = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "start"],
  {
    cwd: API_ROOT,
    env: { ...process.env, ...env, PORT: String(PORT), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  },
);

const serverLog = [];
server.stdout.on("data", (d) => serverLog.push(String(d)));
server.stderr.on("data", (d) => serverLog.push(String(d)));

const stopServer = () => {
  if (server.exitCode === null && !server.killed) {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(server.pid), "/f", "/t"], { stdio: "ignore" });
    } else {
      server.kill("SIGTERM");
    }
  }
};
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });

async function waitForHealth(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) return false;
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

if (!(await waitForHealth())) {
  console.error("\nThe API never came up. Its output:\n");
  console.error(serverLog.join("").slice(-3000));
  stopServer();
  process.exit(1);
}
console.log("up.\n");

/* ------------------------------------------------------------ role tokens */

const db = await openDb(env);

const people = (
  await db.query(
    "select id, role, token_version from users where deleted_at is null and status = 'active'",
  )
).rows;

const NEEDED = ["super_admin", "ceo", "admin", "finance", "hr"];
const tokens = {};
for (const role of NEEDED) {
  const who = people.find((p) => p.role === role);
  if (!who) {
    console.error(`No active ${role} in the database. Run \`npm run db:seed\` first.`);
    await db.end();
    stopServer();
    process.exit(1);
  }
  tokens[role.toUpperCase()] = jwt.sign(
    { sub: who.id, role: who.role, tv: who.token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "2h" },
  );
}

// The suites read these from a file beside them, the way they were written.
// It is deleted again at the end — signed-in tokens do not belong on disk.
const rolesFile = path.join(HERE, "roles.env");
fs.writeFileSync(
  rolesFile,
  Object.entries(tokens).map(([k, v]) => `${k}=${v}`).join("\n"),
  "utf8",
);

/* ------------------------------------------------------ before we start */

const undoneFirst = await resetDemoBooks(db);
if (undoneFirst.length) console.log(`Books reset before starting: ${undoneFirst.join(", ")}\n`);
const baseline = await booksState(db);
console.log(
  `Baseline: ${baseline.transactions} transactions · ` +
    baseline.balances.map((b) => `${b.name} ${b.b}`).join(" · ") +
    "\n",
);

/* --------------------------------------------------------------- the run */

const runSuite = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, file)], {
      cwd: HERE,
      env: { ...process.env, API: BASE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });

const results = [];
let totalPass = 0, totalFail = 0, totalNote = 0;

for (const [file, what] of chosen) {
  process.stdout.write(`${file.padEnd(30)} ${what}\n`);
  const { code, out } = await runSuite(file);

  // The suites print their own detail; keep the failures and the tally.
  for (const line of out.split(/\r?\n/)) {
    if (/^\s*(FAIL|\?\?\?\?)\s/.test(line)) console.log(`   ${line.trim()}`);
  }

  const tally = /(\d+) passed, (\d+) failed, (\d+) inconclusive/.exec(out);
  const [, p, f, n] = tally ?? [];
  const passed = Number(p ?? 0), failed = Number(f ?? 0), noted = Number(n ?? 0);
  totalPass += passed; totalFail += failed; totalNote += noted;

  if (!tally) {
    console.log(`   the suite did not finish — its output:\n${out.split(/\r?\n/).slice(-12).map((l) => "     " + l).join("\n")}`);
    results.push({ file, ok: false, note: "did not finish" });
  } else {
    results.push({ file, ok: code === 0 && failed === 0, passed, failed, noted });
    console.log(`   ${passed} passed, ${failed} failed, ${noted} inconclusive`);
  }

  // A suite must not change the books. If it did, say so and put them back —
  // the next suite is entitled to the state it was promised.
  const undone = await resetDemoBooks(db);
  const after = await booksState(db);
  if (undone.length) {
    console.log(`   LEFT BEHIND: ${undone.join(", ")} — put back before the next suite`);
    results.at(-1).ok = false;
    results.at(-1).leftBehind = undone.join(", ");
    totalFail += 1;
  } else if (after.transactions !== baseline.transactions) {
    console.log(`   LEFT BEHIND: ${after.transactions} transactions, baseline is ${baseline.transactions}`);
    results.at(-1).ok = false;
    totalFail += 1;
  }
  console.log("");
}

/* ------------------------------------------------------------- teardown */

fs.rmSync(rolesFile, { force: true });
const finalState = await booksState(db);
await db.end();
stopServer();

/* --------------------------------------------------------------- report */

const failed = results.filter((r) => !r.ok);
console.log("─".repeat(72));
for (const r of results) {
  const mark = r.ok ? "ok  " : "FAIL";
  const detail = r.note ?? r.leftBehind ?? `${r.passed ?? 0} passed`;
  console.log(`${mark}  ${r.file.padEnd(30)} ${detail}`);
}
console.log("─".repeat(72));
console.log(`${totalPass} passed, ${totalFail} failed, ${totalNote} inconclusive across ${results.length} suite(s)`);
console.log(
  `Books: ${finalState.transactions} transactions · ` +
    finalState.balances.map((b) => `${b.name} ${b.b}`).join(" · "),
);

process.exit(failed.length ? 1 : 0);
