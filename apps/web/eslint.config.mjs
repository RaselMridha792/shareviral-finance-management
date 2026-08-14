import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    /**
     * The browser suite writes each assertion as `condition ? pass() : fail()`,
     * which the rule reads as an expression doing nothing. It is doing the
     * whole job: one line that states the claim and both outcomes, which is
     * why the suites are readable as a description of what the app promises.
     */
    files: ["test/**/*.mjs"],
    rules: { "@typescript-eslint/no-unused-expressions": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
