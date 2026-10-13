import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "dist/**",
    ".build-cache/**", // Generated test/cleanup bundles, not authored source.
    "next-env.d.ts",
  ]),
  {
    // Existing legacy modules with inherited `any` at external API boundaries.
    // Keep this list explicit: new self-hosted modules still enforce the rule.
    files: [
      "app/workspace.tsx",
      "app/api/recovery/route.ts",
      "app/api/connection/route.ts",
      "app/api/file-name/route.ts",
      "app/api/jobs/route.ts",
      "app/api/presets/route.ts",
      "app/api/settings/route.ts",
      "lib/attribution-recovery.ts",
      "lib/batch-core.ts",
      "lib/campaign-build.ts",
      "lib/lead-form.ts",
      "lib/media-retry.ts",
      "lib/media.ts",
      "lib/meta-core.ts",
      "lib/model.ts",
      "lib/recovery-source.ts",
      "lib/server.ts",
      "lib/settings.ts",
      "lib/token-core.ts",
      "tests/meta.test.ts",
    ],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}", "hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
