import { defineConfig } from "vitest/config";

// Production code lives in src/ and seed/; tests and test helpers live in test/, mirroring them.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
