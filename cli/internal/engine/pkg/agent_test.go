package pkg

import (
	"reflect"
	"testing"
)

const validAgent = `---
name: reviewer
description: Reviews code changes.
tools: [read, mcp:docs/search]
---

Review the change.
`

func TestParseAgentAcceptsAValidAgent(t *testing.T) {
	a, findings := ParseAgent("dev.smartharness/agents/reviewer.agent.md", []byte(validAgent), map[string]bool{"docs": true})

	if len(findings) != 0 {
		t.Fatalf("unexpected findings: %+v", findings)
	}
	want := []Tool{{Kind: ToolRead}, {Kind: ToolMCP, Server: "docs", Name: "search"}}
	if !reflect.DeepEqual(a.Tools, want) {
		t.Fatalf("tools = %+v, want %+v", a.Tools, want)
	}
	if a.Prompt != "Review the change." {
		t.Fatalf("prompt = %q", a.Prompt)
	}
}

// The four errors of docs/contracts/agent.md, plus SH-AGT-005 for a malformed file.
func TestParseAgentContractErrors(t *testing.T) {
	cases := []struct {
		name  string
		agent string
		code  string
		line  int
	}{
		{"tools missing", "---\nname: reviewer\ndescription: Reviews.\n---\n\nBody.\n", "SH-AGT-001", 1},
		{"tools empty", "---\nname: reviewer\ndescription: Reviews.\ntools: []\n---\n\nBody.\n", "SH-AGT-001", 4},
		{"hooks forbidden", "---\nname: reviewer\ndescription: Reviews.\ntools: [read]\nhooks: {}\n---\n\nBody.\n", "SH-AGT-002", 5},
		{"mcpServers forbidden", "---\nname: reviewer\ndescription: Reviews.\ntools: [read]\nmcpServers: {}\n---\n\nBody.\n", "SH-AGT-002", 5},
		{"permissionMode forbidden", "---\nname: reviewer\ndescription: Reviews.\ntools: [read]\npermissionMode: plan\n---\n\nBody.\n", "SH-AGT-002", 5},
		{"unknown tool", "---\nname: reviewer\ndescription: Reviews.\ntools:\n  - read\n  - Bash\n---\n\nBody.\n", "SH-AGT-003", 4},
		{"malformed mcp tool", "---\nname: reviewer\ndescription: Reviews.\ntools: [\"mcp:\"]\n---\n\nBody.\n", "SH-AGT-003", 4},
		{"undeclared server", "---\nname: reviewer\ndescription: Reviews.\ntools: [mcp:github]\n---\n\nBody.\n", "SH-AGT-004", 4},
		{"no frontmatter", "Body only.\n", "SH-AGT-005", 1},
		{"name differs from file", "---\nname: other\ndescription: Reviews.\ntools: [read]\n---\n\nBody.\n", "SH-AGT-005", 2},
		{"name parsed as bool", "---\nname: \"true\"\ndescription: Reviews.\ntools: [read]\n---\n\nBody.\n", "SH-AGT-005", 2},
		{"description missing", "---\nname: reviewer\ntools: [read]\n---\n\nBody.\n", "SH-AGT-005", 0},
		{"tools not a list", "---\nname: reviewer\ndescription: Reviews.\ntools: read\n---\n\nBody.\n", "SH-AGT-005", 4},
		{"model with spaces", "---\nname: reviewer\ndescription: Reviews.\ntools: [read]\nmodel: \"a b\"\n---\n\nBody.\n", "SH-AGT-005", 5},
		{"empty body", "---\nname: reviewer\ndescription: Reviews.\ntools: [read]\n---\n\n\n", "SH-AGT-005", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, findings := ParseAgent("dev.smartharness/agents/reviewer.agent.md", []byte(tc.agent), map[string]bool{"docs": true})

			if len(findings) != 1 {
				t.Fatalf("findings = %+v, want exactly one %s", findings, tc.code)
			}
			if f := findings[0]; f.Code != tc.code || f.Line != tc.line {
				t.Fatalf("finding = %s at line %d (%s), want %s at line %d", f.Code, f.Line, f.Message, tc.code, tc.line)
			}
		})
	}
}

func TestParseAgentReportsEveryDefect(t *testing.T) {
	agent := "---\nname: reviewer\ndescription: Reviews.\ntools: [read, write, mcp:github]\nhooks: {}\n---\n\nBody.\n"

	_, findings := ParseAgent("dev.smartharness/agents/reviewer.agent.md", []byte(agent), nil)

	var codes []string
	for _, f := range findings {
		codes = append(codes, f.Code)
	}
	want := []string{"SH-AGT-002", "SH-AGT-003", "SH-AGT-004"}
	if !reflect.DeepEqual(codes, want) {
		t.Fatalf("codes = %v, want %v", codes, want)
	}
}

func TestParseAgentNormalizesTheBody(t *testing.T) {
	agent := "---\r\nname: reviewer\r\ndescription: Reviews.\r\ntools: [read]\r\n---\r\n\r\n\r\nLine one.\r\nLine two.\r\n\r\n\r\n"

	a, findings := ParseAgent("dev.smartharness/agents/reviewer.agent.md", []byte(agent), nil)

	if len(findings) != 0 {
		t.Fatalf("unexpected findings: %+v", findings)
	}
	if a.Prompt != "Line one.\nLine two." {
		t.Fatalf("prompt = %q", a.Prompt)
	}
}
