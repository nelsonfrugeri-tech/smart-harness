import { buildServer } from "./server.ts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8080);

const app = buildServer({ logger: true });

// Closes the server when the container stops, without waiting for SIGKILL.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close());
}

await app.listen({ host, port });
