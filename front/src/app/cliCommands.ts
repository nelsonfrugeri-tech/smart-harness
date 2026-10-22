export const CLI_RELEASE_VERSION = "v0.2.0";
export const CLI_RELEASE_URL = `https://github.com/nelsonfrugeri-tech/smart-harness/releases/tag/${CLI_RELEASE_VERSION}`;
export const CLI_DOWNLOAD_URL = `https://github.com/nelsonfrugeri-tech/smart-harness/releases/download/${CLI_RELEASE_VERSION}`;
export const CLAUDE_SETUP_URL = "https://code.claude.com/docs/en/setup";
export const CLAUDE_GATEWAY_URL =
  "https://code.claude.com/docs/en/llm-gateway-connect";
export const recommendedPlugins = [
  "github",
  "trello",
  "notion",
  "graphify",
  "deja-vu",
  "md2poui",
  "code-review",
];
export const cliCommands = {
  installPlugins: `harness install ${recommendedPlugins.join(" ")}`,
  doctor: "harness doctor",
  graphify: "harness tools run graphify update ./src",
  tools:
    "harness tools install graphify\nharness tools install deja-vu\nharness tools check",
  start: "claude",
  reviewSkill: "/code-review:code-review",
};
export function loginCommand(rawURL: string): string | null {
  try {
    const url = new URL(rawURL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    )
      return null;
    const value = url.toString().replace(/\/$/, "").replaceAll("'", "'\\''");
    return `harness login --api-url '${value}'`;
  } catch {
    return null;
  }
}
