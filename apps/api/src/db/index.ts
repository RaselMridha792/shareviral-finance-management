import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { poolOptionsFor } from "./connection";
import * as schema from "./schema";

export { schema };

// The standard node-postgres driver, not Neon's serverless one.
//
// Neon speaks the ordinary Postgres wire protocol, so this works against Neon
// today and against a self-hosted Postgres container tomorrow with no code
// change — only the connection string moves. Neon's own driver would have
// locked us to Neon, and it is only worth using in edge/serverless runtimes
// where raw TCP is unavailable. This API is a long-lived server.

function createDb(connectionPool: Pool) {
  return drizzle(connectionPool, { schema });
}

export type Database = ReturnType<typeof createDb>;
/** The handle a service receives inside `db.transaction(...)`. */
export type DbTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/** True once a connection string is present. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

let pool: Pool | undefined;
let db: Database | undefined;

/**
 * Lazily creates the pool so the API can boot — and serve /health — before the
 * database is wired up.
 */
export function getDb(): Database {
  if (db) return db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add your connection string to apps/api/.env",
    );
  }

  pool = new Pool({
    ...poolOptionsFor(url),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // A pool error with no listener crashes the process; log and let the pool
  // discard the bad client instead.
  pool.on("error", (error) => {
    console.error("[db] idle client error:", error.message);
  });

  db = createDb(pool);
  return db;
}

/** Returns null instead of throwing when the database isn't configured yet. */
export function tryGetDb(): Database | null {
  return isDatabaseConfigured() ? getDb() : null;
}

/** Closes the pool. Called from the Nest shutdown hook. */
export async function closeDb(): Promise<void> {
  if (!pool) return;
  const closing = pool;
  pool = undefined;
  db = undefined;
  await closing.end();
}
