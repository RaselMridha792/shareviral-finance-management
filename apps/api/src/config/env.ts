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
