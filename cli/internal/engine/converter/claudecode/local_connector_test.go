package claudecode

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

func TestCuratedStdioAndCrossPackageTools(t *testing.T) {
	for _, name := range []string{"graphify", "deja-vu"} {
		files, err := (Adapter{}).Convert(pkg.Package{Manifest: pkg.Manifest{Name: name}, MCPServers: []pkg.MCPServer{{Name: name, Local: true}}})
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, file := range files {
			if file.Path != ".mcp.json" {
				continue
			}
			found = true
			var document struct {
				Servers map[string]struct {
					Type, Command string
					Args          []string
				} `json:"mcpServers"`
			}
			if err := json.Unmarshal(file.Data, &document); err != nil {
				t.Fatal(err)
			}
			server := document.Servers[name]
			if server.Type != "stdio" || server.Command != "${HARNESS_CLI_BIN}" || !reflect.DeepEqual(server.Args, []string{"tools", "serve", name}) {
				t.Fatalf("unexpected command %+v", server)
			}
		}
		if !found {
			t.Fatal("missing MCP configuration")
		}
	}
	got := Tools("md2poui", pkg.Tool{Kind: pkg.ToolConnector, Server: "deja-vu"})
	if !reflect.DeepEqual(got, []string{"mcp__plugin_deja-vu_deja-vu__*"}) {
		t.Fatal(got)
	}
}

func TestBundledMCPsUseTheAgentPackageNamespace(t *testing.T) {
	p := pkg.Package{Manifest: pkg.Manifest{Name: "agent-md2poui"}, Agents: []pkg.Agent{{Name: "md2poui", Description: "Help contributors", Prompt: "Read the project."}}}
	for _, name := range []string{"github", "trello", "notion", "graphify", "deja-vu"} {
		p.MCPServers = append(p.MCPServers, pkg.MCPServer{Name: name, Local: name == "graphify" || name == "deja-vu", Origin: "http://127.0.0.1:8081", Path: "/mcp/me/" + name})
		p.Agents[0].Tools = append(p.Agents[0].Tools, pkg.Tool{Kind: pkg.ToolMCP, Server: name})
	}
	files, err := (Adapter{}).Convert(p)
	if err != nil {
		t.Fatal(err)
	}
	var servers map[string]json.RawMessage
	var agent string
	for _, file := range files {
		if file.Path == ".mcp.json" {
			var document struct {
				Servers map[string]json.RawMessage `json:"mcpServers"`
			}
			if err := json.Unmarshal(file.Data, &document); err != nil {
				t.Fatal(err)
			}
			servers = document.Servers
		}
		if file.Path == "agents/md2poui.md" {
			agent = string(file.Data)
		}
	}
	if len(servers) != 5 {
		t.Fatalf("servers=%v", servers)
	}
	for _, name := range []string{"github", "trello", "notion", "graphify", "deja-vu"} {
		if !strings.Contains(agent, "mcp__plugin_agent-md2poui_"+name+"__*") {
			t.Fatal(agent)
		}
		var server map[string]any
		if err := json.Unmarshal(servers[name], &server); err != nil {
			t.Fatal(err)
		}
		if name == "graphify" || name == "deja-vu" {
			if server["type"] != "stdio" || server["command"] != "${HARNESS_CLI_BIN}" || !reflect.DeepEqual(server["args"], []any{"tools", "serve", name}) {
				t.Fatal(server)
			}
		} else if server["type"] != "http" || !strings.HasSuffix(server["url"].(string), "/mcp/me/"+name) {
			t.Fatal(server)
		}
	}
}
