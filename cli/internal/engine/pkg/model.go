// Package pkg defines the canonical package model and loads it from disk.
//
// The model has no detail of any coding agent harness: adapters in
// converter/<harness> turn it into the files that harness reads.
package pkg

// Platform names shared by every adapter. They belong to the platform, not to a harness.
const (
	// GatewayURLEnv overrides the gateway origin on the developer machine.
	GatewayURLEnv = "SMART_HARNESS_GATEWAY_URL"
	// TokenEnv holds the developer gateway token. Only generated layers reference it.
	TokenEnv = "SMART_HARNESS_TOKEN"
	// DefaultAuthor is the author name used when plugin.json has no author.
	DefaultAuthor = "Smart Harness"
)

// Package is the canonical, harness-independent view of a plugin.
// Agents, Skills and MCPServers are sorted by name, so a directory always yields the same value.
type Package struct {
	Manifest   Manifest
	Agents     []Agent
	Skills     []Skill
	MCPServers []MCPServer
}

// Manifest holds the plugin.json fields the platform uses.
type Manifest struct {
	Name           string
	Version        string
	Description    string
	Author         *Author // nil when absent
	Homepage       string
	Repository     string
	License        string
	Keywords       []string
	LocalConnector string
}

// Author is the plugin.json author object.
type Author struct {
	Name  string
	Email string
	URL   string
}

// Agent is dev.smartharness/agents/<name>.agent.md, as defined in docs/contracts/agent.md.
type Agent struct {
	Name        string
	Description string
	Tools       []Tool   // written order, duplicates kept
	Skills      []string // written order, duplicates kept
	Model       string   // empty when absent
	Prompt      string   // body with LF line endings, without leading or trailing blank lines
	Path        string   // source path relative to the package root
}

// ToolKind is a logical tool, independent of any harness.
type ToolKind string

// Logical tools of the agent contract.
const (
	ToolRead      ToolKind = "read"
	ToolSkill     ToolKind = "skill"
	ToolEdit      ToolKind = "edit"
	ToolShell     ToolKind = "shell"
	ToolDelegate  ToolKind = "delegate"
	ToolMCP       ToolKind = "mcp"
	ToolConnector ToolKind = "connector"
)

// Tool is one logical tool. Server is set only for ToolMCP. Name is set only for mcp:<server>/<tool>.
type Tool struct {
	Kind   ToolKind
	Server string
	Name   string
}

// String returns the logical form, such as "read", "mcp:docs" or "mcp:docs/search".
func (t Tool) String() string {
	switch {
	case t.Kind == ToolConnector:
		return "connector:" + t.Server
	case t.Kind != ToolMCP:
		return string(t.Kind)
	case t.Name == "":
		return "mcp:" + t.Server
	default:
		return "mcp:" + t.Server + "/" + t.Name
	}
}

// Skill is skills/<name>/ with every file under it.
type Skill struct {
	Name        string
	Description string
	Files       []File // paths relative to the package root, sorted
}

// MCPServer is a remote MCP server reached through the Agent Gateway.
// Its URL is Origin + Path, for example "http://127.0.0.1:8081" + "/mcp/projects/p/docs".
type MCPServer struct {
	Local  bool
	Name   string
	Origin string
	Path   string
}

// File is a regular file with a slash-separated path relative to the package root.
type File struct {
	Path string
	Data []byte
}
