// Minimal echo MCP server. Logs only the presence and length of the Authorization header.
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const log = process.argv[2];
const reply = (res, id, result) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
};

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const auth = req.headers.authorization;
    const msg = body ? JSON.parse(body) : {};
    appendFileSync(
      log,
      JSON.stringify({
        method: msg.method,
        http: req.method,
        authPresent: Boolean(auth),
        authLen: auth ? auth.length : 0,
        bearerPrefix: auth ? auth.startsWith("Bearer ") : false,
      }) + "\n",
    );
    if (msg.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    if (msg.method === "initialize") {
      reply(res, msg.id, {
        protocolVersion: msg.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "echo", version: "0.0.1" },
      });
    } else if (msg.method === "tools/list") {
      reply(res, msg.id, {
        tools: [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: {} } }],
      });
    } else {
      reply(res, msg.id, {});
    }
  });
}).listen(8790, "127.0.0.1");
