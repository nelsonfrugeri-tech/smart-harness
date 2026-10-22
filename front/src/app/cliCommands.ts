export const CLAUDE_SETUP_URL = "https://code.claude.com/docs/en/setup";
export const CLAUDE_GATEWAY_URL =
  "https://code.claude.com/docs/en/llm-gateway-connect";
const recommendedTools = ["github", "trello", "notion", "graphify", "deja-vu"];
const recommendedSkills = ["md2poui", "code-review"];
export const recommendedPlugins = [...recommendedTools, ...recommendedSkills];
export const cliCommands = {
  installTools: `harness tools install ${recommendedTools.join(" ")}`,
  installSkills: `harness skills install ${recommendedSkills.join(" ")}`,
  checkTools: "harness tools check",
  checkSkills: "harness skills check",
  doctor: "harness doctor",
  graphify: "harness tools run graphify update ./src",
  start: "claude --model openrouter/free",
  reviewSkill: "/code-review:code-review",
};
export function installerCommand(rawURL: string): string | null {
  try {
    const url = new URL(rawURL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      Array.from(rawURL).some(
        (character) =>
          character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
      ) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    )
      return null;
    const value = url.toString().replace(/\/+$/, "").replaceAll("'", "'\\''");
    return `curl -fsSL '${value}/install' | sh`;
  } catch {
    return null;
  }
}
