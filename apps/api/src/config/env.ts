import { z } from "zod";

/**
 * Fail fast on boot rather than at the first request that needs a missing var.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // 4000 is commonly taken (Local by Flywheel), so the API defaults to 4001.
  PORT: z.coerce.number().int().default(4001),

  // Comma-separated list of origins allowed to call this API.
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  // Neon. Optional for now so the skeleton boots before the database exists.
  DATABASE_URL: z.string().optional(),
  DATABASE_URL_UNPOOLED: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(16).default("dev-access-secret-change-me"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16)
    .default("dev-refresh-secret-change-me"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),

  /**
   * Seals the stored Anthropic key. Declared here or it is thrown away.
   *
   * This schema is not just a check — ConfigModule writes what it returns back
   * into `process.env`, and `z.object` drops keys it does not know. So
   * `SECRET_ENCRYPTION_KEY` set in a `.env` file never reached the code that
   * reads it: `secret-box` fell back to `JWT_REFRESH_SECRET` and sealed the key
   * with that instead, silently. Rotating the JWT secret then orphaned it.
   *
   * A real environment variable — Render, Docker, the shell — survives,
   * because it is already in `process.env` before this runs. That is why the
   * same deployment worked in production and not locally, and why the symptom
   * was "no API key has been set" when one plainly had been.
   */
  SECRET_ENCRYPTION_KEY: z.string().min(16).optional(),

  /** The fallback the assistant uses when Settings holds no key. */
  ANTHROPIC_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // A key present but blank in .env (FOO=) should fall back to its default
  // rather than fail as an empty string.
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== ""),
  );
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

export function corsOrigins(env: Env): string[] {
  return env.CORS_ORIGINS.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}
