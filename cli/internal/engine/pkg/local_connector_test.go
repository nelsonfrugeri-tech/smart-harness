package pkg

import (
	"fmt"
	"testing"
)

func TestCuratedLocalConnector(t *testing.T) {
	for _, tc := range []struct {
		name, connector string
		valid           bool
	}{{"graphify", "graphify", true}, {"deja-vu", "deja-vu", true}, {"other", "graphify", false}, {"graphify", "sh", false}} {
		tree := Tree{Files: []File{{Path: "plugin.json", Data: []byte(fmt.Sprintf(`{"$schema":%q,"name":%q,"version":"2.0.0","description":"Local connector","extensions":{"dev.smartharness":{"local_connector":%q}}}`, PluginSchema, tc.name, tc.connector))}}}
		p, fs := Parse(tree)
		if (len(fs) == 0) != tc.valid {
			t.Fatalf("%+v findings=%v", tc, fs)
		}
		if tc.valid && (len(p.MCPServers) != 1 || p.MCPServers[0].Name != tc.name) {
			t.Fatalf("missing connector component: %+v", p)
		}
	}
}

func TestCrossPackageConnectorTools(t *testing.T) {
	for _, name := range []string{"github", "trello", "notion", "graphify", "deja-vu"} {
		tool, err := parseTool("connector:" + name)
		if err != nil || tool.String() != "connector:"+name {
			t.Fatalf("%s: %+v %v", name, tool, err)
		}
	}
	for _, name := range []string{"unknown", "github/tool", "../github", "github;sh"} {
		if _, err := parseTool("connector:" + name); err == nil {
			t.Fatalf("accepted %s", name)
		}
	}
}
