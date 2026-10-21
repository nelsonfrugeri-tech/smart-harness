// Drafts: the files of a package, written by the author through the API.
// Every path is checked before anything touches the disk; validation then writes the files into
// a fresh temporary directory and runs the same validate, generate and pack steps as a publication.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { Component, PackageManifest, PreparedPackage } from "./marketplace.ts";
import { generateAndPack, readManifest, type HarnessClient, type ValidationReport } from "./publish.ts";

export interface DraftFile {
  path: string;
  content: string;
}

// Limits of one draft. The request body limit leaves room for JSON escaping of the contents.
export const MAX_DRAFT_FILES = 500;
export const MAX_DRAFT_PATH_LENGTH = 512;
export const MAX_DRAFT_FILE_BYTES = 1024 * 1024;
export const MAX_DRAFT_TOTAL_BYTES = 4 * 1024 * 1024;
export const DRAFT_BODY_LIMIT_BYTES = 6 * 1024 * 1024;

export interface FileProblem {
  index: number;
  reason: string;
}

// A relative POSIX path made of plain segments: no leading "/", no drive letter, no backslash,
// no NUL, and no empty, "." or ".." segment. Returns the reason when the path is refused.
export function pathProblem(path: string): string | undefined {
  if (path.length === 0 || path.length > MAX_DRAFT_PATH_LENGTH) {
    return `path must have 1 to ${MAX_DRAFT_PATH_LENGTH} characters`;
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "path must be relative";
  if (path.includes("\\") || path.includes("\0")) return "path must not contain a backslash or NUL";
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    return 'path must not contain empty, "." or ".." segments';
  }
  return undefined;
}

// Paths, duplicates and sizes of a whole file set, checked before the first write.
export function filesProblems(files: readonly DraftFile[]): { paths: FileProblem[]; tooLarge?: string } {
  const paths: FileProblem[] = [];
  const seen = new Set<string>();
  let total = 0;
  let tooLarge: string | undefined;
  files.forEach((file, index) => {
    const reason = pathProblem(file.path);
    if (reason !== undefined) paths.push({ index, reason });
    else if (seen.has(file.path)) paths.push({ index, reason: "path is repeated" });
    seen.add(file.path);

    const bytes = Buffer.byteLength(file.content, "utf8");
    total += bytes;
    if (bytes > MAX_DRAFT_FILE_BYTES) tooLarge ??= `${file.path} has more than ${MAX_DRAFT_FILE_BYTES} bytes`;
  });
  // "a" and "a/b" cannot both be files.
  files.forEach((file, index) => {
    const segments = file.path.split("/");
    for (let end = 1; end < segments.length; end += 1) {
      if (seen.has(segments.slice(0, end).join("/"))) {
        paths.push({ index, reason: "path is below another file" });
        break;
      }
    }
  });
  paths.sort((a, b) => a.index - b.index);
  if (files.length > MAX_DRAFT_FILES) tooLarge ??= `a draft has at most ${MAX_DRAFT_FILES} files`;
  if (total > MAX_DRAFT_TOTAL_BYTES) tooLarge ??= `a draft has at most ${MAX_DRAFT_TOTAL_BYTES} bytes in total`;
  return tooLarge === undefined ? { paths } : { paths, tooLarge };
}

export class DraftFilesError extends Error {
  readonly problems: FileProblem[];

  constructor(problems: FileProblem[]) {
    super("draft has invalid file paths");
    this.name = "DraftFilesError";
    this.problems = problems;
  }
}

export interface DraftBuild {
  report: ValidationReport;
  // Present only when the report is valid: the packed archive and what the approval publishes.
  prepared?: PreparedPackage;
}

// Writes the files into a new temporary directory, validates them and, when valid, generates and
// packs them. The manifest name and version come from plugin.json; description, keywords and
// components from the validation report (description and keywords fall back to plugin.json). Nothing is stored; the temporary directory is always removed.
export async function buildDraft(harness: HarnessClient, files: readonly DraftFile[]): Promise<DraftBuild> {
  const problems = filesProblems(files).paths;
  if (problems.length > 0) throw new DraftFilesError(problems);

  const workDir = await mkdtemp(join(tmpdir(), "harness-draft-"));
  try {
    const packageDir = join(workDir, "package");
    await writeFiles(packageDir, files);

    const report = await harness.validate(packageDir);
    if (!report.valid) return { report };

    // Description and keywords come from the report (v2) when the binary prints them.
    const manifest = withComponents(await readManifest(packageDir, report), report.components);
    const { archive, digest } = await generateAndPack(harness, packageDir, join(workDir, "package.tar.gz"));
    return { report, prepared: { manifest, archive, digest } };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function writeFiles(root: string, files: readonly DraftFile[]): Promise<void> {
  const base = resolve(root);
  // Second guard after pathProblem: a resolved path must stay below the root.
  const targets = files.map((file) => {
    const target = resolve(base, file.path);
    if (!target.startsWith(base + sep)) throw new Error(`draft path ${file.path} resolves outside the package`);
    return { target, content: file.content };
  });
  await mkdir(base, { recursive: true });
  for (const { target, content } of targets) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { flag: "wx" });
  }
}

function withComponents(manifest: PackageManifest, components: Component[] | undefined): PackageManifest {
  return components === undefined ? manifest : { ...manifest, components };
}
