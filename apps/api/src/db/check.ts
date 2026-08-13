/**
 * Checks that the database connection string actually works.
 *
 *   npm run db:check
 *
 * Run this straight after pasting a connection string into .env, before
 * db:push — a clear answer here saves a confusing migration error later.
 */

import { config } from "dotenv";
import { Pool } from "pg";

import { poolOptionsFor } from "./connection";

config({ path: ".env.local" });
config({ path: ".env" });

type Check = { label: string; url: string | undefined; required: boolean };

const checks: Check[] = [
  {
    label: "DATABASE_URL (pooled, used by the app)",
    url: process.env.DATABASE_URL,
    required: true,
  },
  {
    label: "DATABASE_URL_UNPOOLED (direct, used by migrations)",
    url: process.env.DATABASE_URL_UNPOOLED,
    required: false,
  },
];

function describe(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    database: parsed.pathname.replace(/^\//, ""),
    user: parsed.username,
    pooled: parsed.hostname.includes("-pooler"),
    sslmode: parsed.searchParams.get("sslmode") ?? "(not set)",
  };
}

async function test(
  url: string,
): Promise<
  | { ok: true; version: string; latencyMs: number }
  | { ok: false; error: string }
> {
  const pool = new Pool({
    ...poolOptionsFor(url),
    connectionTimeoutMillis: 15_000,
  });

  try {
    // The first query pays for TLS setup and, on Neon, waking a suspended
    // compute — often over a second and nothing to do with region. Measure the
    // second one, which is the latency every real request will see.
    const result = await pool.query<{ version: string }>("select version()");
    const started = Date.now();
    await pool.query("select 1");
    return {
      ok: true,
      version: result.rows[0].version.split(",")[0],
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  let failed = false;

  for (const check of checks) {
    console.log(`\n${check.label}`);

    if (!check.url) {
      if (check.required) {
        console.log("  ✗ not set in apps/api/.env");
        failed = true;
      } else {
        console.log("  – not set (falls back to DATABASE_URL, which is fine)");
      }
      continue;
    }

    let info: ReturnType<typeof describe>;
    try {
      info = describe(check.url);
    } catch {
      console.log("  ✗ that is not a valid connection string");
      failed = true;
      continue;
    }

    console.log(`  host      ${info.host}`);
    console.log(`  database  ${info.database}`);
    console.log(`  user      ${info.user}`);
    console.log(`  pooled    ${info.pooled ? "yes" : "no"}`);
    console.log(`  sslmode   ${info.sslmode}`);

    const result = await test(check.url);
    if (result.ok) {
      console.log(`  ✓ connected — ${result.version}`);
      console.log(`  round trip ${result.latencyMs}ms (warm)`);
      if (result.latencyMs > 250) {
        console.log(
          "    (slow for a warm query — check the region is near Bangladesh)",
        );
      }
    } else {
      console.log(`  ✗ could not connect: ${result.error}`);
      failed = true;
    }
  }

  // The two strings must differ only by "-pooler"; a mismatch means one was
  // copied from a different project and the migration would hit the wrong database.
  const pooled = process.env.DATABASE_URL;
  const direct = process.env.DATABASE_URL_UNPOOLED;
  if (pooled && direct) {
    const a = new URL(pooled);
    const b = new URL(direct);
    if (
      a.hostname.replace("-pooler", "") !== b.hostname.replace("-pooler", "")
    ) {
      console.log(
        "\n⚠ The two connection strings point at different hosts. They should be the same database — one pooled, one direct.",
      );
      failed = true;
    }
  }

  console.log(
    failed
      ? "\nSomething is wrong — fix the above, then run this again.\n"
      : "\nAll good. Next: npm run db:push\n",
  );
  process.exit(failed ? 1 : 0);
}

void main();
