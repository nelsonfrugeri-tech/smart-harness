import { defineConfig } from "vitest/config";
export default defineConfig({
  define: {
    __HARNESS_PUBLIC_API_URL__: JSON.stringify("http://127.0.0.1:8080"),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
  },
});
