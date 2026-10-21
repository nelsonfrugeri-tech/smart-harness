// Spike H2: does the GitHub remote MCP accept a credential injected by the server?
// The token comes from `gh auth token` at runtime and is never printed or stored.
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = "https://api.githubcopilot.com/mcp/";
const owner = process.env.H2_OWNER ?? "nelsonfrugeri-tech";
const repo = process.env.H2_REPO ?? "smart-harness";

const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
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
