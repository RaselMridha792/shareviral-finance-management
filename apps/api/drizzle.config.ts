import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Nest reads these at boot; drizzle-kit runs outside Nest so it loads them itself.
config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "",
  },
  verbose: true,
  strict: true,
});
