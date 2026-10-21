package pkg

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

const (
	testManifest = `{"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": "example", "version": "1.0.0", "description": "Example."}`
	testMCP      = `{"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "mcpServers": {"docs": {"type": "streamable-http", "url": "http://127.0.0.1:8081/mcp/projects/example/docs"}}}`
	testSkill    = "---\nname: code-review\ndescription: Reviews code.\n---\n\nReview.\n"
)

// tree builds an in-memory tree; a nil value removes the path from the base package.
func tree(overrides map[string]*string) Tree {
	files := map[string]string{
		ManifestPath:                  testManifest,
		MCPPath:                       testMCP,
		"skills/code-review/SKILL.md": testSkill,
	}
	for p, v := range overrides {
		if v == nil {
			delete(files, p)
		} else {
			files[p] = *v
		}
	}
	var t Tree
	for p, data := range files {
		t.Files = append(t.Files, File{Path: p, Data: []byte(data)})
	}
	sort.Slice(t.Files, func(i, j int) bool { return t.Files[i].Path < t.Files[j].Path })
	return t
}

func ptr(s string) *string { return &s }

func codes(findings []Finding) []string {
	var out []string
	for _, f := range findings {
		out = append(out, f.Code)
	}
	return out
}

// Each Agent Plugins and Agent Skills rule has one case that passes and one that fails.
func TestParseSpecRules(t *testing.T) {
	long := strings.Repeat("x", 1025)
	cases := []struct {
		name      string
		overrides map[string]*string
		want      []string
	}{
		{"base package passes", nil, nil},
		{"AP-001 fails without plugin.json", map[string]*string{ManifestPath: nil}, []string{"AP-001"}},
		{"AP-001 fails with an unknown field", map[string]*string{ManifestPath: ptr(`{"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": "example", "agents": []}`)}, []string{"AP-001"}},
		{"AP-001 passes with extensions", map[string]*string{ManifestPath: ptr(`{"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": "example", "extensions": {"dev.smartharness": {}}}`)}, nil},
		{"AP-002 fails with uppercase name", map[string]*string{ManifestPath: ptr(`{"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": "Example"}`)}, []string{"AP-002"}},
		{"AP-002 passes with a dotted name", map[string]*string{ManifestPath: ptr(`{"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", "name": "acme.tools"}`)}, nil},
		{"AP-003 fails without $schema", map[string]*string{MCPPath: ptr(`{"mcpServers": {}}`)}, []string{"AP-003"}},
		{"AP-003 fails with plain http to a remote host", map[string]*string{MCPPath: ptr(`{"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "mcpServers": {"docs": {"type": "streamable-http", "url": "http://gateway.example.org/mcp/projects/p/docs"}}}`)}, []string{"AP-003"}},
		{"AP-003 passes without mcp.json", map[string]*string{MCPPath: nil}, nil},
		{"AS-001 fails without SKILL.md", map[string]*string{"skills/code-review/SKILL.md": nil, "skills/code-review/references/a.md": ptr("a")}, []string{"AS-001"}},
		{"AS-001 fails without description", map[string]*string{"skills/code-review/SKILL.md": ptr("---\nname: code-review\n---\n")}, []string{"AS-001"}},
		{"AS-002 fails when name differs from directory", map[string]*string{"skills/code-review/SKILL.md": ptr("---\nname: review\ndescription: d\n---\n")}, []string{"AS-002"}},
		{"AS-002 fails with a double hyphen", map[string]*string{"skills/code--review/SKILL.md": ptr("---\nname: code--review\ndescription: d\n---\n")}, []string{"AS-002"}},
		{"AS-003 fails with a long description", map[string]*string{"skills/code-review/SKILL.md": ptr("---\nname: code-review\ndescription: " + long + "\n---\n")}, []string{"AS-003"}},
		{"AS-003 passes at 1024 characters", map[string]*string{"skills/code-review/SKILL.md": ptr("---\nname: code-review\ndescription: " + long[:1024] + "\n---\n")}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, findings := Parse(tree(tc.overrides))

			if got := codes(findings); !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("codes = %v, want %v (%+v)", got, tc.want, findings)
			}
		})
	}
}

func TestParseBuildsASortedModel(t *testing.T) {
	agent := "---\nname: reviewer\ndescription: Reviews.\ntools: [read, mcp:docs]\n---\n\nBody.\n"
	p, findings := Parse(tree(map[string]*string{
		"dev.smartharness/agents/reviewer.agent.md": ptr(agent),
		"skills/a-first/SKILL.md":                   ptr("---\nname: a-first\ndescription: d\n---\n"),
	}))

	if len(findings) != 0 {
		t.Fatalf("unexpected findings: %+v", findings)
	}
	if got := []string{p.Skills[0].Name, p.Skills[1].Name}; !reflect.DeepEqual(got, []string{"a-first", "code-review"}) {
		t.Fatalf("skills = %v", got)
	}
	want := MCPServer{Name: "docs", Origin: "http://127.0.0.1:8081", Path: "/mcp/projects/example/docs"}
	if len(p.MCPServers) != 1 || p.MCPServers[0] != want {
		t.Fatalf("servers = %+v, want %+v", p.MCPServers, want)
	}
	if len(p.Agents) != 1 || p.Agents[0].Name != "reviewer" {
		t.Fatalf("agents = %+v", p.Agents)
	}
}

func TestReadTreeRejectsSymlinksAndRecordsExecutables(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, "plugin.json"), "{}", 0o644)
	mustWrite(t, filepath.Join(dir, "run.sh"), "echo", 0o755)
	if err := os.Symlink("plugin.json", filepath.Join(dir, "link.json")); err != nil {
		t.Fatal(err)
	}

	tr, findings, err := ReadTree(dir)

	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 1 || findings[0].Code != CodeLayout || findings[0].Path != "link.json" {
		t.Fatalf("findings = %+v, want SH-STR-001 for link.json", findings)
	}
	if !tr.Executable["run.sh"] || tr.Executable["plugin.json"] {
		t.Fatalf("executable = %v", tr.Executable)
	}
}

func TestReadTreeStopsAtTheFileLimit(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i <= MaxFiles; i++ { // MaxFiles + 1 files
		mustWrite(t, filepath.Join(dir, "f", fmt.Sprintf("%04d", i)), "", 0o644)
	}

	_, findings, err := ReadTree(dir)

	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 1 || findings[0].Code != CodeLimits {
		t.Fatalf("findings = %+v, want one SH-LIM-001", findings)
	}
}

func TestTallyAcceptsTheLimitsAndRejectsAboveThem(t *testing.T) {
	var atLimit Tally
	for i := 0; i < MaxTotalBytes/MaxFileBytes; i++ {
		if err := atLimit.Add("f", MaxFileBytes); err != nil {
			t.Fatalf("file %d at the limits: %v", i, err)
		}
	}
	if err := atLimit.Add("one-more", 1); err == nil {
		t.Fatal("total above the limit was accepted")
	}
	var big Tally
	if err := big.Add("big", MaxFileBytes+1); err == nil {
		t.Fatal("file above the limit was accepted")
	}
}

func mustWrite(t *testing.T, path, data string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(data), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil { // WriteFile mode is filtered by umask
		t.Fatal(err)
	}
}
