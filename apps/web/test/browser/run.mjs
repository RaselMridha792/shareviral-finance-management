/**
 * The browser pass.
 *
 * Boots the API and the web app, signs in through the real login form, and
 * walks every screen at four widths in both themes looking for the ways a
 * finance screen actually goes wrong: a table that escapes its container, text
 * that cannot be read against what is behind it, taka grouped in thousands, a
 * hyphen standing in for a minus, a translated dollar figure with no rate
 * beside it saying where it came from.
 *
 *   npm run test:browser
 *
 * Needs a Chrome or Edge on the machine; set CHROME_PATH if it is somewhere
 * unusual. Slower than the API suites because Next compiles each route on
 * first visit, so give it a few minutes.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import jwt from "jsonwebtoken";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(REPO, "apps/api/.env"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

/**
 * The web app's port is fixed at 3000 and the API's at 4001, because the
 * browser reaches the API through Next's rewrite rather than directly — that
 * is what production does, and pointing the test at the API port instead would
 * pass locally while hiding every bug that only exists on the rewritten path.
 */
const API_PORT = Number(process.env.TEST_API_PORT ?? 4001);
const WEB_PORT = Number(process.env.TEST_WEB_PORT ?? 3000);
const API = `http://127.0.0.1:${API_PORT}/api`;
// localhost, not 127.0.0.1: this is the origin a person types, and the one
// the dev server treats as its own.
const WEB = `http://localhost:${WEB_PORT}`;

const started = [];
/**
 * Kill what this run started, synchronously.
 *
 * `spawn` here was the bug: an `exit` handler gets no event loop turns, so the
 * asynchronous taskkill was queued and then thrown away as the process died.
 * Every failed run left its API — and sometimes its web server — listening, and
 * the next run either refused to start or, worse, quietly tested the stale one.
 * `spawnSync` finishes before the handler returns, which is the whole
 * requirement.
 *
 * It also stops the crash on the way out: spawning a child while libuv is
 * tearing its handles down aborts node with
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, so a run that had
 * merely failed exited looking like a segfault.
 */
const stopAll = () => {
  for (const child of started) {
    if (child.exitCode !== null || child.killed) continue;
    if (process.platform === "win32") {
      // /t for the tree: `npm run start` is a shell that owns the real server,
      // and killing the shell alone leaves the port held.
      spawnSync("taskkill", ["/pid", String(child.pid), "/f", "/t"], {
        stdio: "ignore",
      });
    } else child.kill("SIGTERM");
  }
};
process.on("exit", stopAll);
process.on("SIGINT", () => { stopAll(); process.exit(130); });

const alive = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return r.status < 500;
  } catch {
    return false;
  }
};

async function ensure(name, url, cwd, args, extraEnv = {}) {
  if (await alive(url)) {
    /**
     * Something is on the port, and this suite cannot know what code it is.
     *
     * It used to print "already running" and carry on, which meant a run could
     * report on a build from an hour ago — and it did: a leftover `next start`
     * from a previous run served the old bundle, the suite skipped the build
     * entirely, and eight screens were flagged for a fault that had already
     * been fixed in the source. A pass or a fail against unknown code is worth
     * nothing either way.
     *
     * Refusing is the honest answer. `REUSE_SERVERS=1` is there for the loop of
     * running the suite repeatedly against a server you are keeping up on
     * purpose, and it says out loud what it is doing.
     */
    if (process.env.REUSE_SERVERS === "1") {
      console.log(
        `${name}: already running — REUSE_SERVERS=1, so this run tests whatever is on that port, not necessarily your current code`,
      );
      return;
    }
    console.error(
      `${name} is already listening on ${url}.\n` +
        `This suite builds the code under test, so it cannot run against a server it did not start —\n` +
        `the results would be about whatever that process is serving.\n` +
        `Stop it and run again, or set REUSE_SERVERS=1 if you know it is current.`,
    );
    process.exit(1);
  }
  console.log(`${name}: starting…`);
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd,
    env: { ...process.env, ...env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  started.push(child);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      console.error(`${name} exited. Its output:\n${log.join("").slice(-2000)}`);
      process.exit(1);
    }
    if (await alive(url)) {
      console.log(`${name}: up`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`${name} never came up. Its output:\n${log.join("").slice(-2000)}`);
  process.exit(1);
}

await ensure("API", `${API}/health`, path.join(REPO, "apps/api"), ["run", "start"], {
  PORT: String(API_PORT),
});
/**
 * The web app is served from a production build, not `next dev`.
 *
 * Prefetching only runs in production, and the suite checks that a table of
 * records does not prefetch a page per record. Against `next dev` that check
 * sees no traffic at all and would pass whatever the code says. It costs a
 * build at the start of the run and buys a check that means something.
 *
 * `next start` also serves the same output Vercel does, so the pass says
 * something about what is deployed rather than about a dev server.
 */
// Same rule as `ensure`: a server this suite did not start is serving code this
// suite cannot identify, so the build is not optional unless you say so.
if (await alive(`${WEB}/login`)) {
  if (process.env.REUSE_SERVERS !== "1") {
    console.error(
      `Something is already listening on ${WEB}.\n` +
        `Stop it and run again, or set REUSE_SERVERS=1 if you know it is serving your current code.`,
    );
    process.exit(1);
  }
  console.log("Web: already running — skipping the build, per REUSE_SERVERS=1");
} else {
  console.log("Web: building…");
  const built = await new Promise((resolve) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
      cwd: path.join(REPO, "apps/web"),
      /**
       * `apps/api/.env` is the API's environment, and only two things in it
       * concern this build.
       *
       * Spreading the whole file in put `NODE_ENV=development` in front of
       * `next build`, which is not a configuration Next supports: it resolved
       * React's development build for some entries and its production build
       * for others, and the prerender of `/_global-error` died on
       * `Cannot read properties of null (reading 'useContext')`. The suite
       * then exited with "the web build failed" and never ran a single check —
       * which is the worst way for a test to be broken, because a run that
       * never happened looks exactly like a run that found nothing.
       *
       * Whatever the API is configured as, this build is production.
       */
      env: {
        ...process.env,
        NODE_ENV: "production",
        API_URL: API,
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const log = [];
    child.stdout.on("data", (d) => log.push(String(d)));
    child.stderr.on("data", (d) => log.push(String(d)));
    child.on("close", (code) => {
      if (code) console.error(log.join("").slice(-2000));
      resolve(code);
    });
  });
  if (built) {
    console.error("The web build failed — nothing below would be testable.");
    process.exit(1);
  }
}

await ensure("Web", `${WEB}/login`, path.join(REPO, "apps/web"), ["run", "start"], {
  PORT: String(WEB_PORT),
  API_URL: API,
  // `ensure` spreads the API's .env for the API's sake, and this is the one
  // key in it that must not reach the web server: serving a production build
  // under NODE_ENV=development is a combination Next does not support, and the
  // whole point of building here is that the pass says something about what
  // gets deployed.
  NODE_ENV: "production",
});

/* ------------------------------------------------------------ role tokens */

const db = new pg.Client({
  connectionString: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();
const [admin] = (
  await db.query(
    "select id, role, token_version from users where role = 'super_admin' and status = 'active' limit 1",
  )
).rows;
await db.end();

if (!admin) {
  console.error("No active super_admin. Run `npm run db:seed` first.");
  process.exit(1);
}

const rolesFile = path.join(HERE, "roles.env");
fs.writeFileSync(
  rolesFile,
  `SUPER_ADMIN=${jwt.sign(
    { sub: admin.id, role: admin.role, tv: admin.token_version },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "2h" },
  )}\n`,
  "utf8",
);

/* ----------------------------------------------------------------- the run */

const suites = ["screens.mjs", "batch.mjs"];
let code = 0;
for (const suite of suites) {
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(HERE, suite)], {
      cwd: HERE,
      env: { ...process.env, API, WEB },
      stdio: "inherit",
    });
    child.on("close", resolve);
  });
  if (result) code = result;
}

fs.rmSync(rolesFile, { force: true });
stopAll();
process.exit(code ?? 1);
