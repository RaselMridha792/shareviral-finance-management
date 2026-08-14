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
import { spawn } from "node:child_process";
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
const stopAll = () => {
  for (const child of started) {
    if (child.exitCode !== null || child.killed) continue;
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
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
    console.log(`${name}: already running`);
    return;
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
await ensure("Web", `${WEB}/login`, path.join(REPO, "apps/web"), ["run", "dev"], {
  PORT: String(WEB_PORT),
  API_URL: API,
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
