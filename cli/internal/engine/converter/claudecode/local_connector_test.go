package claudecode

import (
	"encoding/json"
	"reflect"
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
