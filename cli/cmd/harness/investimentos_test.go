package main

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Exercise the author package through the CLI, then compare its generated archive to the
// published fixture. A source, converter or archive change cannot silently drift from the seed.
func TestInvestimentosBaseline(t *testing.T) {
	source := "../../../marketplace/investimentos-base"
	directory := filepath.Join(t.TempDir(), "package")
	if err := os.CopyFS(directory, os.DirFS(source)); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"validate", directory, "--json"},
		{"generate", directory, "--target", "claude-code"},
		{"validate", directory, "--json"},
	} {
		if code, out, errOut := harness(args...); code != 0 {
			t.Fatalf("%v: exit %d: %s %s", args, code, out, errOut)
		}
	}
	core, err := os.ReadFile(filepath.Join(directory, "mcp.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Servers map[string]map[string]string `json:"mcpServers"`
	}
	if err := json.Unmarshal(core, &config); err != nil {
		t.Fatal(err)
	}
	if len(config.Servers) != 4 {
		t.Fatalf("MCP servers: %v", config.Servers)
	}
	for _, server := range []string{"project", "github", "trello", "notion"} {
		entry := config.Servers[server]
		if len(entry) != 2 || entry["type"] != "streamable-http" || entry["url"] != "http://127.0.0.1:8081/mcp/projects/investimentos-api/"+server {
			t.Fatalf("unexpected core MCP configuration for %s: %v", server, entry)
		}
	}
	for _, agent := range []string{"investimentos-guide", "reviewer"} {
		data, err := os.ReadFile(filepath.Join(directory, "agents", agent+".md"))
		if err != nil {
			t.Fatal(err)
		}
		frontmatter := strings.SplitN(string(data), "---", 3)[1]
		for _, forbidden := range []string{"Bash", "Edit", "Write", "Agent"} {
			if strings.Contains(frontmatter, forbidden) {
				t.Fatalf("%s exposes %s", agent, forbidden)
			}
		}
		for _, server := range []string{"project", "github", "trello", "notion"} {
			if !strings.Contains(frontmatter, "mcp__plugin_investimentos-base_"+server+"__*") {
				t.Fatalf("%s missing %s tools", agent, server)
			}
		}
		for _, skill := range []string{"go-idioms", "dynamodb-single-table", "dev-workflow"} {
			if !strings.Contains(frontmatter, `"`+skill+`"`) {
				t.Fatalf("%s missing skill %s", agent, skill)
			}
		}
	}
	archive := filepath.Join(t.TempDir(), "package.tar.gz")
	if code, out, errOut := harness("pack", directory, "-o", archive); code != 0 {
		t.Fatalf("pack: %s %s", out, errOut)
	}
	built, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile("../../../control-plane/seed/packages/investimentos-base-1.2.0.tar.gz")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(built, fixture) {
		t.Fatal("seed archive differs from the canonical source and converter; bump the version and rebuild")
	}
	if err := filepath.WalkDir(source, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Name() == ".mcp.json" || entry.Name() == ".claude-plugin" {
			t.Fatalf("generated layer leaked into canonical source: %s", path)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
