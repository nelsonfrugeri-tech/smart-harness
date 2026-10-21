import { defineConfig, loadEnv } from "vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    define: {
      __HARNESS_PUBLIC_API_URL__: JSON.stringify(
        env.HARNESS_PUBLIC_API_URL ||
          env.HARNESS_API_TARGET ||
          "http://127.0.0.1:8080",
      ),
    },
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
