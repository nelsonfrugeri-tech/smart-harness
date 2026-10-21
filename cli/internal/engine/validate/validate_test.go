package validate

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter/claudecode"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

const exampleDir = "../testdata/packages/example"

func options() Options {
	return Options{GatewayOrigin: DefaultGatewayOrigin, Adapters: []converter.Adapter{claudecode.Adapter{}}}
}

// copyExample copies the example package into a temporary directory.
func copyExample(t *testing.T) string {
	t.Helper()
	dst := t.TempDir()
	err := filepath.WalkDir(exampleDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(exampleDir, p)
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		write(t, dst, rel, string(data))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

func write(t *testing.T, dir, rel, data string) {
	t.Helper()
	p := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mcpWith(server string) string {
	return `{"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "mcpServers": {"docs": ` + server + `}}`
}

func manifestWith(name, version string) string {
	return fmt.Sprintf(`{"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": %q, "version": %q, "description": "d"}`, name, version)
}

// generate writes the Claude Code layer of dir, as `harness generate` does.
func generate(t *testing.T, dir string) {
	t.Helper()
	p, _, findings, err := pkg.Load(dir)
	if err != nil || len(findings) != 0 {
		t.Fatalf("load: %v %+v", err, findings)
	}
	files, err := claudecode.Adapter{}.Convert(p)
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		write(t, dir, f.Path, string(f.Data))
	}
}

// Each platform rule has one case that passes and one that fails. Spec and contract rules
// (AP, AS, SH-AGT) are covered in package pkg; two of them run here end to end.
func TestPlatformRules(t *testing.T) {
	// Credential-shaped text is built by concatenation so the repository holds no such literal.
	githubToken := "gh" + "p_" + strings.Repeat("A1b2", 9)
	cases := []struct {
		name   string
		mutate func(t *testing.T, dir string)
		want   []string
	}{
		{"example package passes", func(*testing.T, string) {}, nil},
		{"AS-002 fails end to end", func(t *testing.T, dir string) {
			write(t, dir, "skills/code-review/SKILL.md", "---\nname: review\ndescription: d\n---\n")
		}, []string{"AS-002"}},
		{"SH-AGT-004 fails end to end", func(t *testing.T, dir string) {
			write(t, dir, "mcp.json", `{"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "mcpServers": {}}`)
		}, []string{"SH-AGT-004"}},

		{"SH-SEC-001 fails with headers", func(t *testing.T, dir string) {
			write(t, dir, "mcp.json", mcpWith(`{"type": "streamable-http", "url": "http://127.0.0.1:8081/mcp/projects/example/docs", "headers": {"X-Team": "a"}}`))
		}, []string{"SH-SEC-001"}},
		{"SH-SEC-001 fails with env", func(t *testing.T, dir string) {
			write(t, dir, "mcp.json", mcpWith(`{"type": "streamable-http", "url": "http://127.0.0.1:8081/mcp/projects/example/docs", "env": {"A": "b"}}`))
		}, []string{"SH-SEC-001"}},
		{"SH-SEC-002 fails with a token in a skill", func(t *testing.T, dir string) {
			write(t, dir, "skills/code-review/references/setup.md", "Line one.\nexport TOKEN="+githubToken+"\n")
		}, []string{"SH-SEC-002"}},
		{"SH-SEC-002 passes with a token placeholder", func(t *testing.T, dir string) {
			write(t, dir, "skills/code-review/references/setup.md", "Send Authorization: Bearer ${SMART_HARNESS_TOKEN}.\n")
		}, nil},

		{"SH-MCP-001 fails with an external server", func(t *testing.T, dir string) {
			write(t, dir, "mcp.json", mcpWith(`{"type": "streamable-http", "url": "https://mcp.example.org/mcp"}`))
		}, []string{"SH-MCP-001"}},
		{"SH-MCP-001 fails when the path names another server", func(t *testing.T, dir string) {
			write(t, dir, "mcp.json", mcpWith(`{"type": "streamable-http", "url": "http://127.0.0.1:8081/mcp/projects/example/github"}`))
		}, []string{"SH-MCP-001"}},
		{"SH-MCP-001 fails with sse", func(t *testing.T, dir string) {
			write(t, dir, "mcp.json", mcpWith(`{"type": "sse", "url": "http://127.0.0.1:8081/mcp/projects/example/docs"}`))
		}, []string{"SH-MCP-001"}},
		{"SH-MCP-002 fails with stdio", func(t *testing.T, dir string) {
			write(t, dir, "mcp.json", mcpWith(`{"type": "stdio", "command": "node"}`))
		}, []string{"SH-MCP-002"}},

		{"SH-EXE-001 fails with hooks/hooks.json", func(t *testing.T, dir string) {
			write(t, dir, "hooks/hooks.json", `{"hooks": {}}`)
		}, []string{"SH-EXE-001"}},
		{"SH-EXE-001 fails with a hooks field", func(t *testing.T, dir string) {
			write(t, dir, "plugin.json", `{"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": "example", "version": "1.0.0", "description": "d", "hooks": {}}`)
		}, []string{"SH-EXE-001"}},
		{"SH-EXE-002 fails with a skill script", func(t *testing.T, dir string) {
			write(t, dir, "skills/code-review/scripts/run.py", "print(1)\n")
		}, []string{"SH-EXE-002"}},
		{"SH-EXE-002 fails with a shebang", func(t *testing.T, dir string) {
			write(t, dir, "skills/code-review/assets/tool", "#!/bin/sh\necho\n")
		}, []string{"SH-EXE-002"}},
		{"SH-EXE-002 fails with an execute bit", func(t *testing.T, dir string) {
			if err := os.Chmod(filepath.Join(dir, "skills/code-review/SKILL.md"), 0o755); err != nil {
				t.Fatal(err)
			}
		}, []string{"SH-EXE-002"}},
		{"SH-EXE-002 passes with an image asset", func(t *testing.T, dir string) {
			write(t, dir, "skills/code-review/assets/logo.png", "\x89PNG\r\n\x1a\n")
		}, nil},

		{"SH-STR-001 fails with an unknown file", func(t *testing.T, dir string) {
			write(t, dir, ".DS_Store", "x")
		}, []string{"SH-STR-001"}},
		{"SH-STR-001 fails with a hand-written agent", func(t *testing.T, dir string) {
			write(t, dir, "agents/other.md", "---\nname: other\n---\n")
		}, []string{"SH-STR-001"}},
		{"SH-STR-001 fails with a colon in a path", func(t *testing.T, dir string) {
			write(t, dir, "skills/code-review/references/a:b.md", "x")
		}, []string{"SH-STR-001"}},
		{"SH-STR-002 passes with the generated layer", func(t *testing.T, dir string) {
			generate(t, dir)
		}, nil},
		{"SH-STR-002 fails with a stale generated file", func(t *testing.T, dir string) {
			generate(t, dir)
			write(t, dir, ".mcp.json", `{"mcpServers": {}}`)
		}, []string{"SH-STR-002"}},

		{"SH-NAM-001 fails with a reserved prefix", func(t *testing.T, dir string) {
			write(t, dir, "plugin.json", manifestWith("claude-tools", "1.0.0"))
		}, []string{"SH-NAM-001"}},
		{"SH-NAM-001 fails with a dotted name", func(t *testing.T, dir string) {
			write(t, dir, "plugin.json", manifestWith("acme.tools", "1.0.0"))
		}, []string{"SH-NAM-001"}},
		{"SH-NAM-001 passes with claude inside a word", func(t *testing.T, dir string) {
			write(t, dir, "plugin.json", manifestWith("claudette-tools", "1.0.0"))
		}, nil},

		{"SH-VER-001 fails without SemVer", func(t *testing.T, dir string) {
			write(t, dir, "plugin.json", manifestWith("example", "1.0"))
		}, []string{"SH-VER-001"}},
		{"SH-VER-001 passes with a prerelease", func(t *testing.T, dir string) {
			write(t, dir, "plugin.json", manifestWith("example", "1.0.0-rc.1"))
		}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := copyExample(t)
			tc.mutate(t, dir)

			report, _, err := Dir(dir, options())

			if err != nil {
				t.Fatal(err)
			}
			var got []string
			for _, f := range report.Findings {
				got = append(got, f.Code)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("codes = %v, want %v (%+v)", got, tc.want, report.Findings)
			}
			if report.Valid != (len(tc.want) == 0) {
				t.Fatalf("valid = %v with findings %v", report.Valid, got)
			}
		})
	}
}

func TestLimitRule(t *testing.T) {
	dir := copyExample(t)
	for i := 0; i < pkg.MaxFiles; i++ { // with the example files, above the limit
		write(t, dir, fmt.Sprintf("skills/code-review/references/%04d.md", i), "")
	}

	report, _, err := Dir(dir, options())

	if err != nil {
		t.Fatal(err)
	}
	if len(report.Findings) != 1 || report.Findings[0].Code != "SH-LIM-001" || report.Digest != "" {
		t.Fatalf("report = %+v, want only SH-LIM-001 and no digest", report)
	}
}

func TestSecretMessageNeverEchoesTheMatch(t *testing.T) {
	secret := "sk-" + "ant-" + strings.Repeat("x9", 15)
	findings := Secrets(pkg.File{Path: "a.md", Data: []byte("a\nkey: " + secret + "\n")})

	if len(findings) != 1 || findings[0].Line != 2 {
		t.Fatalf("findings = %+v, want one at line 2", findings)
	}
	out, _ := json.Marshal(findings)
	if strings.Contains(string(out), secret) || strings.Contains(string(out), "x9x9") {
		t.Fatalf("finding echoes the secret: %s", out)
	}
}

// The JSON report has a fixed shape and key order; the same input gives the same bytes.
func TestReportJSONIsStable(t *testing.T) {
	dir := copyExample(t)
	write(t, dir, "plugin.json", manifestWith("claude", "1.0"))

	report, _, err := Dir(dir, options())
	if err != nil {
		t.Fatal(err)
	}
	got, _ := json.MarshalIndent(report, "", "  ")
	again, _, _ := Dir(dir, options())
	gotAgain, _ := json.MarshalIndent(again, "", "  ")

	want := `{
  "report_version": "1",
  "valid": false,
  "plugin": "claude",
  "version": "1.0",
  "digest": "` + report.Digest + `",
  "findings": [
    {
      "code": "SH-NAM-001",
      "severity": "error",
      "message": "plugin name \"claude\" is reserved or not kebab-case",
      "hint": "use kebab-case without '.' and without the words claude, anthropic or anthropics",
      "path": "plugin.json",
      "line": 0
    },
    {
      "code": "SH-VER-001",
      "severity": "error",
      "message": "version \"1.0\" is not SemVer",
      "hint": "set version such as 1.0.0",
      "path": "plugin.json",
      "line": 0
    }
  ]
}`
	if string(got) != want {
		t.Fatalf("report =\n%s\nwant\n%s", got, want)
	}
	if string(got) != string(gotAgain) {
		t.Fatal("same input gave different reports")
	}
}

func TestValidReportHasEmptyFindingsArray(t *testing.T) {
	report, _, err := Dir(copyExample(t), options())
	if err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(report)
	if !strings.Contains(string(out), `"findings":[]`) {
		t.Fatalf("findings must be [] not null: %s", out)
	}
}

func TestGatewayOriginMustBeAnOrigin(t *testing.T) {
	for _, origin := range []string{"", "127.0.0.1:8081", "http://127.0.0.1:8081/", "ftp://x", "http://h/mcp"} {
		if CheckOrigin(origin) == nil {
			t.Errorf("origin %q was accepted", origin)
		}
	}
	if err := CheckOrigin("https://gateway.example.org"); err != nil {
		t.Error(err)
	}
}

func TestGatewayOriginOptionChangesTheAcceptedServers(t *testing.T) {
	opts := options()
	opts.GatewayOrigin = "https://gateway.example.org"

	report, _, err := Dir(copyExample(t), opts)

	if err != nil {
		t.Fatal(err)
	}
	if len(report.Findings) != 1 || report.Findings[0].Code != "SH-MCP-001" {
		t.Fatalf("findings = %+v, want SH-MCP-001", report.Findings)
	}
}
