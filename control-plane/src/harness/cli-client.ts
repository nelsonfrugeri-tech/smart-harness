// Runs the `harness` binary with execFile: arguments go straight to the process, never through a shell.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Component } from "../domain/marketplace.ts";
import type { HarnessClient, ValidationFinding, ValidationReport } from "../domain/publish.ts";

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

// Keeps the report fields the API uses: each finding with its hint and line, and the plugin,
// version and components the binary read. The raw-tree digest is dropped on purpose: the digest
// that matters is the one `harness pack` prints after `generate`.
export function parseReport(output: string): ValidationReport | undefined {
  let value: Partial<ValidationReport>;
  try {
    value = JSON.parse(output) as Partial<ValidationReport>;
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || typeof value.valid !== "boolean") return undefined;
  if (value.description !== undefined && typeof value.description !== "string") return undefined;
  if (value.keywords !== undefined && (!Array.isArray(value.keywords) || value.keywords.some((tag) => typeof tag !== "string"))) return undefined;
  return {
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.keywords === undefined ? {} : { keywords: value.keywords }),
    valid: value.valid,
    findings: Array.isArray(value.findings) ? value.findings.map(finding) : [],
    ...(typeof value.plugin === "string" ? { plugin: value.plugin } : {}),
    ...(typeof value.version === "string" ? { version: value.version } : {}),
    ...(Array.isArray(value.components) ? { components: value.components.map(component) } : {}),
  };
}

function finding(raw: ValidationFinding): ValidationFinding {
  return {
    code: String(raw.code ?? ""),
    message: String(raw.message ?? ""),
    ...(typeof raw.severity === "string" ? { severity: raw.severity } : {}),
    ...(typeof raw.hint === "string" ? { hint: raw.hint } : {}),
    ...(typeof raw.path === "string" ? { path: raw.path } : {}),
    ...(typeof raw.line === "number" ? { line: raw.line } : {}),
  };
}

function component(raw: Component): Component {
  return { kind: raw.kind, name: String(raw.name ?? ""), description: String(raw.description ?? "") };
}
