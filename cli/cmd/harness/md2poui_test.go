package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMd2pouiPackages(t *testing.T) {
	for _, name := range []string{"md2poui-base", "md2poui-development", "md2poui-review"} {
		t.Run(name, func(t *testing.T) {
			directory := filepath.Join(t.TempDir(), "package")
			if err := os.CopyFS(directory, os.DirFS("../../../marketplace/"+name)); err != nil {
				t.Fatal(err)
			}
			if name != "md2poui-base" {
				if err := os.CopyFS(filepath.Join(directory, "skills", name), os.DirFS("../../../marketplace/md2poui-base/skills/"+name)); err != nil {
					t.Fatal(err)
				}
			}
			for _, args := range [][]string{{"validate", directory, "--json"}, {"generate", directory, "--target", "claude-code"}, {"validate", directory, "--json"}} {
				if code, out, stderr := harness(args...); code != 0 {
					t.Fatalf("%v: exit %d: %s %s", args, code, out, stderr)
				}
			}
			if name == "md2poui-base" {
				assertMd2pouiAgents(t, directory)
			}
			archive := filepath.Join(t.TempDir(), "package.tar.gz")
			if code, out, stderr := harness("pack", directory, "-o", archive); code != 0 {
				t.Fatalf("pack: %s %s", out, stderr)
			}
			built, err := os.ReadFile(archive)
			if err != nil {
				t.Fatal(err)
			}
			fixture, err := os.ReadFile("../../../control-plane/seed/packages/" + name + "-1.0.0.tar.gz")
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(built, fixture) {
				t.Fatal("published archive differs from the canonical skill source and converter")
			}
		})
	}
}

func assertMd2pouiAgents(t *testing.T, directory string) {
	t.Helper()
	for _, agent := range []string{"developer", "reviewer"} {
		data, err := os.ReadFile(filepath.Join(directory, "agents", agent+".md"))
		if err != nil {
			t.Fatal(err)
		}
		frontmatter := strings.SplitN(string(data), "---", 3)[1]
		for _, tool := range []string{"Read", "Bash", "Skill", "mcp__plugin_md2poui-base_project__*", "mcp__plugin_md2poui-base_github__*", "mcp__plugin_md2poui-base_trello__*", "mcp__plugin_md2poui-base_notion__*"} {
			if !strings.Contains(frontmatter, tool) {
				t.Fatalf("%s lacks %s", agent, tool)
			}
		}
		for _, tool := range []string{"Edit", "Write"} {
			if strings.Contains(frontmatter, tool) != (agent == "developer") {
				t.Fatalf("unexpected %s grant for %s", tool, agent)
			}
		}
		skill := "md2poui-development"
		if agent == "reviewer" {
			skill = "md2poui-review"
		}
		if !strings.Contains(string(data), "md2poui-base:"+skill) {
			t.Fatalf("%s does not explicitly load its bundled skill", agent)
		}
		if _, err := os.Stat(filepath.Join(directory, "skills", skill, "SKILL.md")); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(filepath.Join(directory, ".mcp.json"))
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Servers map[string]struct {
			URL string `json:"url"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if len(config.Servers) != 4 {
		t.Fatalf("unexpected servers: %v", config.Servers)
	}
	for _, server := range config.Servers {
		if !strings.Contains(server.URL, "/mcp/projects/md2poui/") {
			t.Fatalf("wrong project endpoint: %s", server.URL)
		}
	}
}
