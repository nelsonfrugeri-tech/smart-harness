package pkg

import (
	"fmt"
	"testing"
)

func TestCuratedLocalConnector(t *testing.T) {
	for _, tc := range []struct {
		name, connector string
		valid           bool
	}{{"graphify", "graphify", true}, {"deja-vu", "deja-vu", true}, {"observability", "observability", true}, {"claude-tap", "claude-tap", false}, {"observability", "graphify", false}, {"other", "graphify", false}, {"graphify", "sh", false}} {
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

func TestBundledLocalConnectorsWithRemoteServers(t *testing.T) {
	tree := Tree{Files: []File{
		{Path: "dev.smartharness/agents/onboard.agent.md", Data: []byte("---\nname: onboard\ndescription: Help contributors\ntools: [read, mcp:github, mcp:graphify, mcp:deja-vu]\n---\nRead the project before proposing changes.\n")},
		{Path: "mcp.json", Data: []byte(fmt.Sprintf(`{"$schema":%q,"mcpServers":{"github":{"type":"streamable-http","url":"http://127.0.0.1:8081/mcp/me/github"}}}`, MCPSchema))},
		{Path: "plugin.json", Data: []byte(fmt.Sprintf(`{"$schema":%q,"name":"agent-project","version":"1.0.0","description":"Project assistant","extensions":{"dev.smartharness":{"local_connectors":["graphify","deja-vu"]}}}`, PluginSchema))},
	}}
	p, findings := Parse(tree)
	if len(findings) > 0 || len(p.Agents) != 1 || len(p.MCPServers) != 3 {
		t.Fatalf("package=%+v findings=%v", p, findings)
	}
	for i, name := range []string{"deja-vu", "github", "graphify"} {
		if server := p.MCPServers[i]; server.Name != name || server.Local != (name != "github") {
			t.Fatalf("server=%+v", server)
		}
	}
}

func TestBundledLocalConnectorsRejectInvalidDeclarations(t *testing.T) {
	for _, extension := range []string{
		`{"local_connectors":null}`, `{"local_connectors":[]}`, `{"local_connectors":"graphify"}`,
		`{"local_connectors":["shell"]}`, `{"local_connectors":["graphify","graphify"]}`,
		`{"local_connector":"graphify","local_connectors":["graphify"]}`,
	} {
		tree := Tree{Files: []File{{Path: "plugin.json", Data: []byte(fmt.Sprintf(`{"$schema":%q,"name":"graphify","version":"1.0.0","description":"Project assistant","extensions":{"dev.smartharness":%s}}`, PluginSchema, extension))}}}
		if _, findings := Parse(tree); len(findings) == 0 {
			t.Fatalf("accepted extension %s", extension)
		}
	}
	tree := Tree{Files: []File{
		{Path: "mcp.json", Data: []byte(fmt.Sprintf(`{"$schema":%q,"mcpServers":{"graphify":{"type":"streamable-http","url":"http://127.0.0.1:8081/mcp/me/graphify"}}}`, MCPSchema))},
		{Path: "plugin.json", Data: []byte(fmt.Sprintf(`{"$schema":%q,"name":"agent-project","version":"1.0.0","description":"Project assistant","extensions":{"dev.smartharness":{"local_connectors":["graphify"]}}}`, PluginSchema))},
	}}
	if _, findings := Parse(tree); len(findings) == 0 {
		t.Fatal("accepted duplicate local and remote server")
	}
}
