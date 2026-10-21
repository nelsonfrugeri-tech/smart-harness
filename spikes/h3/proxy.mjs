// Spike H3: proxy de POST /v1/messages (porta 8787) que repassa a https://api.anthropic.com sem buffer.
// Repassa os headers recebidos do cliente. Registra so nomes de headers e o tamanho de credenciais, nunca valores.
import { createServer } from "node:http";
import { Readable } from "node:stream";

const UPSTREAM = "https://api.anthropic.com";
const SENSITIVE = new Set(["authorization", "x-api-key"]);

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];

  const seen = Object.entries(req.headers).map(([k, v]) => (SENSITIVE.has(k) ? `${k}(len=${String(v).length})` : k));
  console.log(req.method, req.url, "headers:", seen.join(","));

  const up = await fetch(UPSTREAM + req.url, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const out = Object.fromEntries(up.headers);
  delete out["content-encoding"];
  delete out["content-length"];
  res.writeHead(up.status, out);
  console.log("upstream", up.status, up.headers.get("content-type"));
  if (up.body) Readable.fromWeb(up.body).pipe(res);
  else res.end();
}).listen(8787, "127.0.0.1");
