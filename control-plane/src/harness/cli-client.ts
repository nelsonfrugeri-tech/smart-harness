// Runs the `harness` binary with execFile: arguments go straight to the process, never through a shell.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HarnessClient, ValidationReport } from "../domain/publish.ts";

const run = promisify(execFile);

// A package command is local CPU and disk work; one minute is far above the expected time.
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export function createCliHarnessClient(binary = "harness"): HarnessClient {
  const exec = (args: string[]) =>
    run(binary, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, encoding: "utf8" });

  return {
    // `harness validate <dir> --json` prints {valid, findings}; an invalid package also exits non-zero.
    async validate(dir) {
      let stdout: string;
      try {
        ({ stdout } = await exec(["validate", dir, "--json"]));
      } catch (error) {
        const output = (error as { stdout?: string }).stdout;
        const report = output === undefined ? undefined : parseReport(output);
        if (report === undefined || report.valid) throw error;
        return report;
      }
      const report = parseReport(stdout);
      if (report === undefined) {
        throw new Error("harness validate --json printed an unexpected report");
      }
      return report;
    },

    async generate(dir, target) {
      await exec(["generate", dir, "--target", target]);
    },

    // `harness pack <dir> -o <file>` prints the digest of the archive.
    async pack(dir, outFile) {
      const { stdout } = await exec(["pack", dir, "-o", outFile]);
      const printed = stdout.trim();
      const digest = /^[0-9a-f]{64}$/.test(printed) ? `sha256:${printed}` : printed;
      if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
        throw new Error(`harness pack printed an unexpected digest: ${JSON.stringify(printed.slice(0, 100))}`);
      }
      return { digest };
    },
  };
}

function parseReport(output: string): ValidationReport | undefined {
  try {
    const value = JSON.parse(output) as Partial<ValidationReport>;
    if (typeof value.valid !== "boolean") return undefined;
    return { valid: value.valid, findings: Array.isArray(value.findings) ? value.findings : [] };
  } catch {
    return undefined;
  }
}
