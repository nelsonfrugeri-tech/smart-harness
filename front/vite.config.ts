import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: {
      proxy: {
        "/v1": {
          target: env.HARNESS_API_TARGET || "http://127.0.0.1:8080",
          changeOrigin: true,
        },
      },
    },
  };
});
