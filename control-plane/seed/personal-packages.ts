import type { PackageManifest } from "../src/domain/marketplace.ts";

// Metadata matches the validated immutable archives. The seed does not execute their contents.
export const PERSONAL_FIXTURES: { file: string; manifest: PackageManifest }[] = [
  {
    "file": "github-1.0.0.tar.gz",
    "manifest": {
      "name": "github",
      "version": "1.0.0",
      "description": "Github MCP connector through the personal Smart Harness gateway.",
      "keywords": [
        "claude-code",
        "github",
        "mcp",
        "remote"
      ],
      "components": [
        {
          "kind": "mcp",
          "name": "github",
          "description": ""
        }
      ]
    }
  },
  {
    "file": "trello-1.0.0.tar.gz",
    "manifest": {
      "name": "trello",
      "version": "1.0.0",
      "description": "Trello MCP connector through the personal Smart Harness gateway.",
      "keywords": [
        "claude-code",
        "trello",
        "mcp",
        "remote"
      ],
      "components": [
        {
          "kind": "mcp",
          "name": "trello",
          "description": ""
        }
      ]
    }
  },
  {
    "file": "notion-1.0.0.tar.gz",
    "manifest": {
      "name": "notion",
      "version": "1.0.0",
      "description": "Notion MCP connector through the personal Smart Harness gateway.",
      "keywords": [
        "claude-code",
        "notion",
        "mcp",
        "remote"
      ],
      "components": [
        {
          "kind": "mcp",
          "name": "notion",
          "description": ""
        }
      ]
    }
  },
  {
    "file": "graphify-2.0.0.tar.gz",
    "manifest": {
      "name": "graphify",
      "version": "2.0.0",
      "description": "Curated local graphify MCP connector managed by Smart Harness.",
      "keywords": [
        "claude-code",
        "graphify",
        "mcp",
        "local"
      ],
      "components": [
        {
          "kind": "mcp",
          "name": "graphify",
          "description": ""
        }
      ]
    }
  },
  {
    "file": "deja-vu-2.0.0.tar.gz",
    "manifest": {
      "name": "deja-vu",
      "version": "2.0.0",
      "description": "Curated local deja-vu MCP connector managed by Smart Harness.",
      "keywords": [
        "claude-code",
        "deja-vu",
        "mcp",
        "local"
      ],
      "components": [
        {
          "kind": "mcp",
          "name": "deja-vu",
          "description": ""
        }
      ]
    }
  },
  {
    "file": "md2poui-1.0.0.tar.gz",
    "manifest": {
      "name": "md2poui",
      "version": "1.0.0",
      "description": "Skills for the TOTVS md2poui CLI, Markdown renderer and Angular artifact generator.",
      "keywords": [
        "claude-code",
        "totvs",
        "md2poui",
        "typescript",
        "markdown",
        "angular"
      ],
      "components": [
        {
          "kind": "skill",
          "name": "md2poui-angular-generation",
          "description": "Change or test md2poui generated Angular components, routes, menus and home artifacts, including flatDirs, recursion and exclusions."
        },
        {
          "kind": "skill",
          "name": "md2poui-cli-options",
          "description": "Change or test md2poui CLI arguments and option forwarding while preserving the library overloads, defaults and filesystem error behavior."
        },
        {
          "kind": "skill",
          "name": "md2poui-markdown-rendering",
          "description": "Change or test md2poui Markdown rendering, titles, escaping, links and asset rewriting using fixtures and observed generated HTML."
        }
      ]
    }
  },
  {
    "file": "code-review-1.1.0.tar.gz",
    "manifest": {
      "name": "code-review",
      "version": "1.1.0",
      "description": "Independent review against repository standards and task acceptance criteria, limited to evidenced BLOCKER and MAJOR findings.",
      "keywords": [
        "claude-code",
        "review",
        "quality"
      ],
      "components": [
        {
          "kind": "skill",
          "name": "code-review",
          "description": "Independently review a current diff against repository standards and task acceptance criteria, reporting only evidenced BLOCKER or MAJOR findings."
        }
      ]
    }
  }
];
