import type { PoolConfig } from "pg";

/**
 * Turns a connection string into pg options.
 *
 * `sslmode` is stripped from the URL and replaced with an explicit `ssl`
 * object. pg currently reads `sslmode=require` as verify-full but warns that it
 * will adopt weaker libpq semantics in v9 — deciding here means the behaviour
 * is pinned and the warning goes away.
 */
export function poolOptionsFor(connectionString: string): PoolConfig {
  const url = new URL(connectionString);
  const mode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("channel_binding");

  return {
    connectionString: url.toString(),
    ssl: sslFor(url.hostname, mode),
  };
}

function sslFor(hostname: string, mode: string | null): PoolConfig["ssl"] {
  if (mode === "disable") return false;

  // A self-hosted Postgres with a self-signed certificate needs this. Never set
  // it against a managed provider — it disables certificate verification.
  if (process.env.DATABASE_SSL_INSECURE === "true") {
    return { rejectUnauthorized: false };
  }

  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(hostname);
  if (isLocal && !mode) return false;

  return { rejectUnauthorized: true };
}
