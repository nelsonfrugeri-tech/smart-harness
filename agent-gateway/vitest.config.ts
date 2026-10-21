import { defineConfig } from "vitest/config";

// Production code lives in src/; tests and test helpers live in test/, mirroring src/.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
