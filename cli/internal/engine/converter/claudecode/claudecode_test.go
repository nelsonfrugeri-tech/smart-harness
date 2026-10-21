package claudecode

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

const testdata = "../../testdata"

// Skill names that a YAML parser would read as a number, a boolean or null must stay strings.
func TestSkillNamesStayStrings(t *testing.T) {
	skills := []string{"123", "true", "null", "1.5", "a:b", "code-review"}
	agent := pkg.Agent{Name: "reviewer", Description: "Reviews.", Tools: []pkg.Tool{{Kind: pkg.ToolRead}}, Skills: skills, Prompt: "Review."}
	out := string(AgentMarkdown("example", agent))
	fm, _, _ := strings.Cut(strings.TrimPrefix(out, "---\n"), "\n---\n")

	var doc struct {
		Skills []any `yaml:"skills"`
	}
	if err := yaml.Unmarshal([]byte(fm), &doc); err != nil {
		t.Fatalf("frontmatter is not YAML: %v\n%s", err, fm)
	}

	if len(doc.Skills) != len(skills) {
		t.Fatalf("skills = %#v, want %q", doc.Skills, skills)
	}
	for i, v := range doc.Skills {
		if s, ok := v.(string); !ok || s != skills[i] {
			t.Errorf("skills[%d] = %#v (%T), want the string %q", i, v, v, skills[i])
		}
	}
}

// Acceptance test of docs/contracts/agent.md: reviewer.agent.md converts to reviewer.md byte for byte.
func TestReviewerExampleConvertsByteForByte(t *testing.T) {
	input := mustRead(t, filepath.Join(testdata, "agents", "reviewer.agent.md"))
	want := mustRead(t, filepath.Join(testdata, "agents", "reviewer.md"))

	agent, findings := pkg.ParseAgent("dev.smartharness/agents/reviewer.agent.md", input, map[string]bool{"docs": true})
	if len(findings) != 0 {
		t.Fatalf("unexpected findings: %+v", findings)
	}
	got := AgentMarkdown("example", agent)

	if string(got) != string(want) {
		t.Fatalf("output differs from reviewer.md\n--- got\n%s--- want\n%s", got, want)
	}
}

func TestExamplePackageGeneratesTheClaudeCodeLayer(t *testing.T) {
	p, _, findings, err := pkg.Load(filepath.Join(testdata, "packages", "example"))
	if err != nil || len(findings) != 0 {
		t.Fatalf("load: %v %+v", err, findings)
	}

	files, err := Adapter{}.Convert(p)
	if err != nil {
		t.Fatal(err)
	}

	got := map[string]string{}
	var paths []string
	for _, f := range files {
		got[f.Path] = string(f.Data)
		paths = append(paths, f.Path)
	}
	wantPaths := []string{".claude-plugin/plugin.json", ".mcp.json", "agents/reviewer.md", "skills/code-review/SKILL.md"}
	if !reflect.DeepEqual(paths, wantPaths) {
		t.Fatalf("paths = %v, want %v", paths, wantPaths)
	}
	wantManifest := `{
  "name": "example",
  "version": "1.0.0",
  "description": "Example package with one agent, one skill and one MCP server through the gateway.",
  "author": {
    "name": "Smart Harness"
  },
  "keywords": [
    "code-review",
    "example"
  ]
}
`
	if got[".claude-plugin/plugin.json"] != wantManifest {
		t.Errorf("plugin.json = %s", got[".claude-plugin/plugin.json"])
	}
	wantMCP := `{
  "mcpServers": {
    "docs": {
      "type": "http",
      "url": "${SMART_HARNESS_GATEWAY_URL:-http://127.0.0.1:8081}/mcp/projects/example/docs",
      "headers": {
        "Authorization": "Bearer ${SMART_HARNESS_TOKEN}"
      }
    }
  }
}
`
	if got[".mcp.json"] != wantMCP {
		t.Errorf(".mcp.json = %s", got[".mcp.json"])
	}
	if want := string(mustRead(t, filepath.Join(testdata, "agents", "reviewer.md"))); got["agents/reviewer.md"] != want {
		t.Errorf("agents/reviewer.md = %s", got["agents/reviewer.md"])
	}
	if want := string(mustRead(t, filepath.Join(testdata, "packages", "example", "skills", "code-review", "SKILL.md"))); got["skills/code-review/SKILL.md"] != want {
		t.Errorf("skill was not copied as it is")
	}
}

// The example package must keep the same agent as the contract example.
func TestExamplePackageUsesTheContractAgent(t *testing.T) {
	a := mustRead(t, filepath.Join(testdata, "agents", "reviewer.agent.md"))
	b := mustRead(t, filepath.Join(testdata, "packages", "example", "dev.smartharness", "agents", "reviewer.agent.md"))
	if string(a) != string(b) {
		t.Fatal("testdata/packages/example/dev.smartharness/agents/reviewer.agent.md differs from testdata/agents/reviewer.agent.md")
	}
}

func TestToolMapping(t *testing.T) {
	cases := []struct {
		plugin string
		tool   pkg.Tool
		want   []string
	}{
		{"example", pkg.Tool{Kind: pkg.ToolRead}, []string{"Read", "Glob", "Grep"}},
		{"example", pkg.Tool{Kind: pkg.ToolEdit}, []string{"Edit", "Write"}},
		{"example", pkg.Tool{Kind: pkg.ToolShell}, []string{"Bash"}},
		{"example", pkg.Tool{Kind: pkg.ToolSkill}, []string{"Skill"}},
		{"example", pkg.Tool{Kind: pkg.ToolDelegate}, []string{"Agent"}},
		{"example", pkg.Tool{Kind: pkg.ToolMCP, Server: "docs"}, []string{"mcp__plugin_example_docs__*"}},
		{"example", pkg.Tool{Kind: pkg.ToolMCP, Server: "docs", Name: "search"}, []string{"mcp__plugin_example_docs__search"}},
		{"acme.tools", pkg.Tool{Kind: pkg.ToolMCP, Server: "my.docs"}, []string{"mcp__plugin_acme_tools_my_docs__*"}},
	}
	for _, tc := range cases {
		if got := Tools(tc.plugin, tc.tool); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("Tools(%q, %s) = %v, want %v", tc.plugin, tc.tool, got, tc.want)
		}
	}
}

func TestAgentMarkdownDeduplicatesAndEscapes(t *testing.T) {
	a := pkg.Agent{
		Name:        "helper",
		Description: `Says "hi" \ waves`,
		Tools:       []pkg.Tool{{Kind: pkg.ToolEdit}, {Kind: pkg.ToolRead}, {Kind: pkg.ToolEdit}},
		Skills:      []string{"b", "a", "b"},
		Prompt:      "Help.",
	}

	got := string(AgentMarkdown("example", a))

	want := "---\nname: helper\ndescription: \"Says \\\"hi\\\" \\\\ waves\"\ntools: Edit, Write, Read, Glob, Grep\nskills:\n  - \"b\"\n  - \"a\"\n---\n\nHelp.\n"
	if got != want {
		t.Fatalf("got\n%q\nwant\n%q", got, want)
	}
}

func TestDefaultAuthorWhenManifestHasNone(t *testing.T) {
	files, err := Adapter{}.Convert(pkg.Package{Manifest: pkg.Manifest{Name: "x", Version: "1.0.0", Description: "d"}})
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n  \"name\": \"x\",\n  \"version\": \"1.0.0\",\n  \"description\": \"d\",\n  \"author\": {\n    \"name\": \"Smart Harness\"\n  }\n}\n"
	if len(files) != 1 || string(files[0].Data) != want {
		t.Fatalf("files = %+v", files)
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
