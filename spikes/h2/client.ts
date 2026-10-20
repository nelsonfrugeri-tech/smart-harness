// Spike H2: o MCP remoto do GitHub aceita uma credencial injetada pelo servidor?
// O token vem de `gh auth token` em tempo de execucao e nunca e impresso nem gravado.
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_MCP = "https://api.githubcopilot.com/mcp/";
const owner = process.env.H2_OWNER ?? "nelsonfrugeri-tech";
const repo = process.env.H2_REPO ?? "smart-harness";

const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const transport = new StreamableHTTPClientTransport(new URL(URL_MCP), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: "spike-h2", version: "0.0.1" });

await client.connect(transport);
console.log("initialize ok:", client.getServerVersion()?.name);

const { tools } = await client.listTools();
console.log("tools/list:", tools.length, "tools");

const readTools = tools.filter((t) => t.annotations?.readOnlyHint === true);
for (const t of readTools) {
  const props = Object.keys(t.inputSchema.properties ?? {});
  const required = t.inputSchema.required ?? [];
  console.log(`${t.name} args=[${props.join(",")}] required=[${required.join(",")}]`);
}

const res = await client.callTool({
  name: "get_file_contents",
  arguments: { owner, repo, path: "README.md" },
});
const text = JSON.stringify(res.content);
console.log("get_file_contents isError:", res.isError ?? false, "bytes:", text.length);

await client.close();
