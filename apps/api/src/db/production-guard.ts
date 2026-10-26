/**
 * The seeders never write to the live books.
 *
 * The owner, 26 Oct 2026: *"amar application a akhon original data ache …
 * dekhe niyo jate kono seed jate na cole live data harano jabena"*. The live
 * database holds the company's real records now — the boss's sheet, May to
 * August 2026, and everything entered since.
 *
 * Nothing runs a seeder on deploy or at start-up. But they are compiled into
 * the production image (`apps/api/dist/db/…`), and a command run inside the
 * api container reaches the live database. `seed-bulk`'s `wipe` deletes every
 * account but two; `seed-demo` loads a made-up July and August beside the real
 * ones; `seed` adds four test sign-ins. Any of them, typed once by mistake on
 * the server, is a day of damage.
 *
 * So each one asks this first, and stops. The api image sets
 * NODE_ENV=production (deploy/api.Dockerfile); a laptop does not.
 */
export function refuseOnProduction(script: string): void {
  if (process.env.NODE_ENV === "production") {
    console.error(
      `${script} does not run in production: the live database holds the company's real books.\n` +
        "Seed a local database instead (apps/api/.env).",
    );
    process.exit(1);
  }
}
