import type { Component } from "../src/domain/marketplace.ts";
import type { Fixture } from "./marketplace.ts";

const development: Component = { kind: "skill", name: "md2poui-development",
  description: "Develops an md2poui CLI change from its story and ADR with real subprocess tests and an authorized fork PR." };
const review: Component = { kind: "skill", name: "md2poui-review",
  description: "Reviews an md2poui change independently against its story and ADR and reports only evidenced BLOCKER or MAJOR findings." };

// Skill-only packages reuse the baseline's canonical skill sources at build time.
export const DEMO_FIXTURES: Fixture[] = [
  {
    file: "md2poui-base-1.0.0.tar.gz", tenant: "investimentos", visibility: "squad",
    manifest: { name: "md2poui-base", version: "1.0.0",
      description: "Development and independent review agents for the TOTVS md2poui demo.",
      keywords: ["claude-code", "totvs", "md2poui", "typescript", "development", "review"],
      components: [
        { kind: "agent", name: "developer", description: "Implements an accepted md2poui task using project context and subprocess tests, then opens a PR in the authorized fork." },
        { kind: "agent", name: "reviewer", description: "Independently reviews an md2poui PR against its story and ADR, reporting only evidenced BLOCKER or MAJOR findings." },
        ...["project", "github", "trello", "notion"].map((name): Component => ({
          kind: "mcp", name, description: `${name} through the md2poui project gateway.`,
        })),
        development, review,
      ],
    },
  },
  ...[development, review].map((skill): Fixture => ({
    file: `${skill.name}-1.0.0.tar.gz`, tenant: "investimentos", visibility: "squad",
    manifest: { name: skill.name, version: "1.0.0", description: skill.description,
      keywords: ["claude-code", "totvs", "md2poui", "typescript", "skill", skill.name.replace("md2poui-", "")],
      components: [skill],
    },
  })),
];

// Local tool executables remain managed by harness tools; these archives ship their skills.
DEMO_FIXTURES.push(
  {
    file: "graphify-1.0.0.tar.gz", tenant: "investimentos", visibility: "squad",
    manifest: { name: "graphify", version: "1.0.0",
      description: "Smart Harness skill for local Graphify 0.9.56 code navigation in Claude Code. Requires uv, Python 3.10+ and harness tools install graphify; no MCP or hooks.",
      keywords: ["claude-code", "graphify", "local", "code-navigation"],
      components: [{ kind: "skill", name: "graphify",
        description: "Navigate the md2poui source graph before editing or reviewing its CLI. Use the managed local Graphify CLI to locate symbols and source relationships." }],
    },
  },
  {
    file: "deja-vu-1.0.0.tar.gz", tenant: "investimentos", visibility: "squad",
    manifest: { name: "deja-vu", version: "1.0.0",
      description: "Smart Harness skill for local deja-vu 0.16.8 history in Claude Code. Requires Go 1.25+ and harness tools install deja-vu; no MCP or hooks.",
      keywords: ["claude-code", "deja-vu", "local", "history"],
      components: [{ kind: "skill", name: "deja-vu",
        description: "Retrieve real local preparation decisions and session history for md2poui before implementation or review; record useful decisions for later sessions." }],
    },
  },
);
