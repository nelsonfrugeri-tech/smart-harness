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
