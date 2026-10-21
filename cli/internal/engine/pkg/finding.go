package pkg

import "sort"

// Finding is one defect in a package. Line is 1-based; 0 means the defect has no line.
type Finding struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Hint    string `json:"hint"`
	Path    string `json:"path"`
	Line    int    `json:"line"`
}

// Rule codes. cli/README.md describes each one.
// pkg reports the codes that block building the model; validate reports the platform policy.
const (
	CodeManifest     = "AP-001"     // plugin.json missing, not JSON, or outside the manifest schema
	CodePluginName   = "AP-002"     // plugin name outside the Agent Plugins name rule
	CodeMCPConfig    = "AP-003"     // mcp.json outside the Agent Plugins MCP schema
	CodeSkillFile    = "AS-001"     // skill without SKILL.md, or SKILL.md without name or description
	CodeSkillName    = "AS-002"     // skill name outside the Agent Skills rule or different from its directory
	CodeSkillField   = "AS-003"     // description or compatibility outside the Agent Skills limits
	CodeAgentTools   = "SH-AGT-001" // tools missing or empty
	CodeAgentField   = "SH-AGT-002" // forbidden field
	CodeAgentTool    = "SH-AGT-003" // unknown logical tool
	CodeAgentServer  = "SH-AGT-004" // MCP server not declared in mcp.json
	CodeAgentFile    = "SH-AGT-005" // malformed agent file
	CodeHeaders      = "SH-SEC-001" // headers or env in mcp.json
	CodeSecret       = "SH-SEC-002" // credential-shaped text in a file
	CodeNotGateway   = "SH-MCP-001" // MCP server outside the Agent Gateway
	CodeLocalMCP     = "SH-MCP-002" // stdio server or command
	CodeHooks        = "SH-EXE-001" // hooks
	CodeExecutable   = "SH-EXE-002" // executable file
	CodeLayout       = "SH-STR-001" // file outside the package layout, symlink or special file
	CodeStale        = "SH-STR-002" // generated file that differs from the generator output
	CodeYAMLFeature  = "SH-STR-003" // anchor, alias, merge key, tag, duplicate key or extra document in YAML; duplicate key in JSON
	CodeReservedName = "SH-NAM-001" // plugin name reserved by a harness
	CodeDescription  = "SH-MAN-001" // description missing or blank
	CodeVersion      = "SH-VER-001" // version missing or outside SemVer
	CodeLimits       = "SH-LIM-001" // file count or size above the limits
)

// SortFindings orders findings by path, line, code and message, so reports are stable.
func SortFindings(fs []Finding) {
	sort.SliceStable(fs, func(i, j int) bool {
		a, b := fs[i], fs[j]
		if a.Path != b.Path {
			return a.Path < b.Path
		}
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		if a.Code != b.Code {
			return a.Code < b.Code
		}
		return a.Message < b.Message
	})
}
