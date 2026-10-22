import type { PluginProvenance, RelatedProject } from "../src/domain/plugin-provenance.ts";

// These describe the upstream projects, not the internally authored wrapper/skill packages.
// License evidence and inspected revisions are recorded in the control-plane README.
const RELATED_PROJECTS: Readonly<Record<string, RelatedProject>> = {
  graphify: { kind: "open-source", name: "Graphify", repository_url: "https://github.com/Graphify-Labs/graphify", license: "Apache-2.0" },
  "deja-vu": { kind: "open-source", name: "deja-vu", repository_url: "https://github.com/vshulcz/deja-vu", license: "MIT" },
  observability: { kind: "open-source", name: "claude-tap", repository_url: "https://github.com/liaohch3/claude-tap", license: "MIT" },
  md2poui: { kind: "open-source", name: "TOTVS md2poui", repository_url: "https://github.com/totvs/md2poui", license: "MIT" },
};

export function personalProvenance(name: string): PluginProvenance {
  const related = RELATED_PROJECTS[name];
  return {
    source: { kind: "internal", repository_url: "https://github.com/nelsonfrugeri-tech/smart-harness" },
    ...(related ? { related_project: related } : {}),
  };
}
