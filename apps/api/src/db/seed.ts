/**
 * Creates the first Super Admin, and optionally one user per role for testing.
 *
 *   npm run db:push          create the tables
 *   npm run db:seed          create the accounts
 *
 * Reads SEED_EMAIL / SEED_PASSWORD / SEED_NAME from the environment; falls back
 * to a development default that must not survive into production.
 */

import { randomBytes } from "node:crypto";

import { ROLES, ROLE_LABELS, type Role } from "@finance/shared";
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";

import { poolOptionsFor } from "./connection";
import * as schema from "./schema";
import { auditLogs, users } from "./schema";

config({ path: ".env.local" });
config({ path: ".env" });

const BCRYPT_ROUNDS = 12;

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set. Add your connection string to apps/api/.env first.",
  );
  process.exit(1);
}

const pool = new Pool(poolOptionsFor(url));
const db = drizzle(pool, { schema });

/** Test account address for a role. Kept distinct from every other role's. */
function emailForRole(role: Role): string {
  return `${role.replace(/_/g, "")}@shareviral.cash`;
}

/** Meets the 12-character minimum and is genuinely random. */
function generatePassword(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * Passing this re-issues a password for an account that already exists.
 *
 * The passwords are printed once and stored nowhere, which is right — but it
 * also means losing the terminal output locks you out of a seeded account with
 * no way back. This is the way back.
 */
const RESET = process.argv.slice(2).includes("--reset-passwords");

async function upsertUser(
  email: string,
  fullName: string,
  role: Role,
  password: string,
): Promise<{ created: boolean; password: string | null }> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);

  if (existing && !RESET) return { created: false, password: null };

  if (existing) {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await db
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: true,
        // Every live token for this account dies with the password.
        tokenVersion: sql`${users.tokenVersion} + 1`,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));

    await db.insert(auditLogs).values({
      action: "update",
      entityTable: "users",
      entityId: existing.id,
      summary: `Reset the password for ${email} from the seed script`,
      module: "seed",
    });

    return { created: false, password };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [created] = await db
    .insert(users)
    .values({
      email: email.toLowerCase(),
      fullName,
      role,
      passwordHash,
      status: "active",
      mustChangePassword: true,
    })
    .returning({ id: users.id });

  await db.insert(auditLogs).values({
    action: "create",
    entityTable: "users",
    entityId: created.id,
    summary: `Seeded ${fullName} as ${ROLE_LABELS[role]}`,
    module: "seed",
    after: { email: email.toLowerCase(), fullName, role },
  });

  return { created: true, password };
}

async function main() {
  // Not "admin@" — that is the Admin role's address, and the two would collide.
  const adminEmail = process.env.SEED_EMAIL ?? emailForRole("super_admin");
  const adminName = process.env.SEED_NAME ?? "Super Admin";
  const adminPassword = process.env.SEED_PASSWORD ?? generatePassword();

  const clashingRole = ROLES.find(
    (role) =>
      role !== "super_admin" &&
      emailForRole(role).toLowerCase() === adminEmail.toLowerCase(),
  );
  if (clashingRole) {
    console.error(
      `SEED_EMAIL (${adminEmail}) is the same address the ${clashingRole} test account uses.\n` +
        "Pick a different SEED_EMAIL, or that account will silently not be created.",
    );
    process.exit(1);
  }

  // SEED_RESET=true wipes users (and their sessions, via cascade) plus the
  // audit log, then seeds fresh. Only ever for a database with no real data.
  if (process.env.SEED_RESET === "true") {
    if (process.env.NODE_ENV === "production") {
      console.error("SEED_RESET is refused when NODE_ENV=production.");
      process.exit(1);
    }
    const [{ count: existing }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs);
    console.log(`Resetting: deleting all users and ${existing} audit rows…\n`);
    await db.delete(auditLogs);
    await db.delete(users);
  }

  console.log("Seeding users…\n");

  const results: Array<{ role: Role; email: string; password: string | null }> =
    [];

  const admin = await upsertUser(
    adminEmail,
    adminName,
    "super_admin",
    adminPassword,
  );
  results.push({
    role: "super_admin",
    email: adminEmail,
    password: admin.password,
  });

  // One account per remaining role, so the permission boundaries can actually
  // be tested end to end. Skip with SEED_ROLES_ONLY=false in production.
  if (process.env.SEED_TEST_ROLES !== "false") {
    for (const role of ROLES) {
      if (role === "super_admin") continue;
      const email = emailForRole(role);
      const password = generatePassword();
      const result = await upsertUser(
        email,
        `${ROLE_LABELS[role]} (test)`,
        role,
        password,
      );
      results.push({ role, email, password: result.password });
    }
  }

  const width = Math.max(...results.map((r) => r.email.length));
  console.log("  Role          Email".padEnd(width + 20) + "Password");
  console.log("  " + "─".repeat(width + 46));
  for (const row of results) {
    const password = row.password ?? "(already existed — unchanged)";
    console.log(
      `  ${ROLE_LABELS[row.role].padEnd(13)} ${row.email.padEnd(width + 2)} ${password}`,
    );
  }

  console.log(
    "\nEvery seeded account must change its password at first sign-in.",
  );
  console.log("Copy these now — the passwords are not stored anywhere else.");
  console.log(
    RESET
      ? "Every session for these accounts has been signed out.\n"
      : "Lost them? Run  npm run db:seed -- --reset-passwords  to issue new ones.\n",
  );
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error("Seed failed:", error);
    await pool.end();
    process.exit(1);
  });
