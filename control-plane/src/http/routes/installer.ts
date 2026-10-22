import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { HttpProblem, notFound } from "../problem.ts";

import { publicApiUrl, installerVersion, type InstallerConfig } from "../../domain/installer.ts";

const shellLiteral = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const unavailable = () => new HttpProblem(503, "installer_unavailable", "Installer assets are unavailable. Configure INSTALLER_ASSETS_DIR with install.sh, the release binaries and SHA256SUMS.");

async function openAsset(directory: string | undefined, filename: string): Promise<FileHandle> {
  if (!directory) throw unavailable();
  let file: FileHandle | undefined;
  try {
    file = await open(join(directory, filename), constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!(await file.stat()).isFile()) throw unavailable();
    return file;
  } catch {
    await file?.close();
    throw unavailable();
  }
}

export function registerInstallerRoutes(app: FastifyInstance, config: InstallerConfig): void {
  const origin = publicApiUrl(config.publicApiUrl);
  const version = installerVersion(config.installerVersion);
  const filenames = new Set(["SHA256SUMS", ...["darwin-arm64", "darwin-amd64", "linux-arm64", "linux-amd64"]
    .map((platform) => `harness-${version}-${platform}`)]);

  // Public bootstrap: configuration owns the origin. Request/forwarded headers never reach shell code.
  app.get("/install", async (_request, reply) => {
    const file = await openAsset(config.installerAssetsDir, "install.sh");
    try {
      if ((await file.stat()).size > 128 * 1024) throw unavailable();
      const template = await file.readFile("utf8");
      if (!template.includes("@@API_URL_SHELL@@") || !template.includes("@@VERSION_SHELL@@")) throw unavailable();
      const script = template.replaceAll("@@API_URL_SHELL@@", shellLiteral(origin))
        .replaceAll("@@VERSION_SHELL@@", shellLiteral(version));
      return reply.header("content-type", "text/x-shellscript; charset=utf-8")
        .header("cache-control", "no-store").header("x-content-type-options", "nosniff").send(script);
    } finally { await file.close(); }
  });

  app.get<{ Params: { filename: string } }>("/install/:filename", async (request, reply) => {
    const { filename } = request.params;
    if (!filenames.has(filename)) throw notFound("installer asset not found");
    const file = await openAsset(config.installerAssetsDir, filename);
    return reply.header("content-type", filename === "SHA256SUMS" ? "text/plain; charset=utf-8" : "application/octet-stream")
      .header("content-disposition", `attachment; filename="${filename}"`)
      .header("cache-control", "no-store").header("x-content-type-options", "nosniff")
      .send(file.createReadStream({ autoClose: true }));
  });
}
