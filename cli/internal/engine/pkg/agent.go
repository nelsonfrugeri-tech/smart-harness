package pkg

import (
	"fmt"
	"path"
	"regexp"
	"strings"
)

// forbiddenAgentFields are rejected by the agent contract (SH-AGT-002).
var forbiddenAgentFields = []string{"hooks", "mcpServers", "permissionMode"}

var (
	agentNameRe = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)
	// Values written without quotes in a generated frontmatter must stay plain YAML strings.
	plainValueRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:\[\]-]*$`)
	mcpPartRe    = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)
	// YAML 1.1 and 1.2 words that a parser would not read as a string.
	yamlWords = map[string]bool{"true": true, "false": true, "null": true, "yes": true, "no": true,
		"on": true, "off": true, "y": true, "n": true}
)

// ParseAgent applies the agent contract (docs/contracts/agent.md) to one agent file.
// declared holds the server names of mcp.json. All defects are reported, not only the first.
func ParseAgent(filePath string, data []byte, declared map[string]bool) (Agent, []Finding) {
	var findings []Finding
	add := func(code string, line int, hint, format string, a ...any) {
		findings = append(findings, Finding{Code: code, Path: filePath, Line: line, Message: fmt.Sprintf(format, a...), Hint: hint})
	}
	const contract = "see docs/contracts/agent.md"
	fm, body, ok := splitFrontmatter(data)
	if !ok {
		add(CodeAgentFile, 1, contract, "agent file must start with a YAML frontmatter between '---' lines")
		return Agent{}, findings
	}
	front, err := parseFrontmatter(fm)
	if err != nil {
		add(CodeAgentFile, 1, contract, "frontmatter is not a YAML mapping: %v", err)
		return Agent{}, findings
	}
	findings = append(findings, unsupportedFindings(filePath, front.unsupported)...)
	// Checked on the keys as written and on the mapping after merges, so a merge cannot hide a field.
	for _, key := range forbiddenAgentFields {
		if line, present := front.has(key); present {
			add(CodeAgentField, line, "remove the field; the platform does not allow it in agents", "field %q is not allowed", key)
		}
	}
	if len(front.unsupported) > 0 {
		return Agent{}, findings
	}
	fs := front.fields
	a := Agent{Path: filePath}

	stem := strings.TrimSuffix(path.Base(filePath), AgentSuffix)
	name, nl := fs.str("name")
	switch {
	case !nl.ok:
		add(CodeAgentFile, nl.line, contract, "name is required and must be a string")
	case !agentNameRe.MatchString(name) || len(name) > 64 || yamlWords[name]:
		add(CodeAgentFile, nl.line, "use 1-64 characters a-z, 0-9 and '-', starting with a letter", "agent name %q is invalid", name)
	case name != stem:
		add(CodeAgentFile, nl.line, "rename the file to "+name+AgentSuffix, "agent name %q must match the file name %q", name, stem+AgentSuffix)
	}
	a.Name = name

	desc, dl := fs.str("description")
	switch {
	case !dl.ok || strings.TrimSpace(desc) == "":
		add(CodeAgentFile, dl.line, contract, "description is required and must be a non-empty string")
	case strings.ContainsFunc(desc, func(r rune) bool { return r < 0x20 || r == 0x7f }):
		add(CodeAgentFile, dl.line, contract, "description must be one line without control characters")
	}
	a.Description = desc

	tools, tl := fs.list("tools")
	switch {
	case tl.present && !tl.ok:
		add(CodeAgentFile, tl.line, contract, "tools must be a list of strings")
	case len(tools) == 0:
		add(CodeAgentTools, max(tl.line, 1), "declare at least one logical tool: read, edit, shell, delegate, skill, mcp:<server>", "tools is missing or empty")
	}
	for _, raw := range tools {
		tool, err := parseTool(raw)
		if err != nil {
			add(CodeAgentTool, tl.line, "use read, edit, shell, delegate, skill, mcp:<server> or mcp:<server>/<tool>", "%v", err)
			continue
		}
		if tool.Kind == ToolMCP && !declared[tool.Server] {
			add(CodeAgentServer, tl.line, "declare the server in mcp.json or remove the tool", "MCP server %q is not declared in mcp.json", tool.Server)
			continue
		}
		a.Tools = append(a.Tools, tool)
	}

	skills, sl := fs.list("skills")
	if sl.present && !sl.ok {
		add(CodeAgentFile, sl.line, contract, "skills must be a list of strings")
	}
	for _, s := range skills {
		if !plainValueRe.MatchString(s) {
			add(CodeAgentFile, sl.line, contract, "skill %q has characters outside a-z, A-Z, 0-9, '.', '_', ':', '-'", s)
		}
	}
	a.Skills = skills

	model, ml := fs.str("model")
	if ml.present && (!ml.ok || !plainValueRe.MatchString(model)) {
		add(CodeAgentFile, ml.line, contract, "model must be a single word such as sonnet or a full model ID")
	}
	a.Model = model

	a.Prompt = trimBlankLines(body)
	if a.Prompt == "" {
		add(CodeAgentFile, 1, "write the agent prompt after the frontmatter", "agent body (the prompt) is empty")
	}
	if len(findings) > 0 {
		return Agent{}, findings
	}
	return a, nil
}

// parseTool reads one logical tool.
func parseTool(raw string) (Tool, error) {
	switch ToolKind(raw) {
	case ToolRead, ToolEdit, ToolShell, ToolDelegate, ToolSkill:
		return Tool{Kind: ToolKind(raw)}, nil
	}
	rest, ok := strings.CutPrefix(raw, "mcp:")
	if !ok {
		return Tool{}, fmt.Errorf("tool %q is unknown", raw)
	}
	server, name, hasName := strings.Cut(rest, "/")
	if !mcpPartRe.MatchString(server) || (hasName && !mcpPartRe.MatchString(name)) {
		return Tool{}, fmt.Errorf("tool %q is not a valid mcp:<server> or mcp:<server>/<tool>", raw)
	}
	return Tool{Kind: ToolMCP, Server: server, Name: name}, nil
}
