package pkg

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// Canonical schema identifiers of Agent Plugins 1.0.0.
const (
	PluginSchema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
	MCPSchema    = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
)

// Paths of the package core.
const (
	ManifestPath = "plugin.json"
	MCPPath      = "mcp.json"
	SkillsDir    = "skills/"
	AgentsDir    = "dev.smartharness/agents/"
	AgentSuffix  = ".agent.md"
)

// Parse builds the canonical model from a tree.
// A component with a finding is left out of the model, so the model is only complete when
// there are no findings. Policy rules (secrets, gateway, layout) are in package validate.
func Parse(t Tree) (Package, []Finding) {
	var p Package
	var findings []Finding
	add := func(f ...Finding) { findings = append(findings, f...) }

	manifest, fs := parseManifest(t)
	p.Manifest = manifest
	add(fs...)

	servers, declared, fs := parseMCP(t)
	p.MCPServers = servers
	add(fs...)

	skills, fs := parseSkills(t)
	p.Skills = skills
	add(fs...)

	for _, f := range t.Files {
		if !isAgentPath(f.Path) {
			continue
		}
		agent, fs := ParseAgent(f.Path, f.Data, declared)
		if len(fs) > 0 {
			add(fs...)
			continue
		}
		p.Agents = append(p.Agents, agent)
	}
	SortFindings(findings)
	return p, findings
}

// isAgentPath reports whether path is a direct child of dev.smartharness/agents/ ending in .agent.md.
func isAgentPath(path string) bool {
	rest, ok := strings.CutPrefix(path, AgentsDir)
	return ok && !strings.Contains(rest, "/") && strings.HasSuffix(rest, AgentSuffix) && len(rest) > len(AgentSuffix)
}

var manifestFields = map[string]bool{
	"$schema": true, "name": true, "version": true, "description": true, "author": true,
	"homepage": true, "repository": true, "license": true, "keywords": true, "extensions": true,
}

func parseManifest(t Tree) (Manifest, []Finding) {
	var m Manifest
	bad := func(format string, a ...any) []Finding {
		return []Finding{{Code: CodeManifest, Path: ManifestPath, Message: fmt.Sprintf(format, a...),
			Hint: "see https://agent-plugins.org/specification, section 5"}}
	}
	file, ok := t.File(ManifestPath)
	if !ok {
		return m, bad("plugin.json is missing at the package root")
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(file.Data, &raw); err != nil {
		return m, bad("plugin.json is not a JSON object: %v", err)
	}
	var findings []Finding
	for _, key := range sortedKeys(raw) {
		// hooks is reported by validate as SH-EXE-001, the more specific rule.
		if !manifestFields[key] && key != "hooks" {
			findings = append(findings, bad("field %q is not allowed in plugin.json", key)...)
		}
	}
	var schema string
	if !decodeString(raw, "$schema", &schema) || schema != PluginSchema {
		findings = append(findings, bad("$schema must be %q", PluginSchema)...)
	}
	if !decodeString(raw, "name", &m.Name) || m.Name == "" {
		findings = append(findings, bad("name is required and must be a string")...)
	} else if !validPluginName(m.Name) {
		findings = append(findings, Finding{Code: CodePluginName, Path: ManifestPath,
			Message: fmt.Sprintf("plugin name %q is invalid", m.Name),
			Hint:    "use 1-64 characters a-z, 0-9, '-' and '.', starting and ending with a letter or digit, without '--' or '..'"})
	}
	for key, dst := range map[string]*string{"version": &m.Version, "description": &m.Description,
		"homepage": &m.Homepage, "repository": &m.Repository, "license": &m.License} {
		if _, present := raw[key]; present && !decodeString(raw, key, dst) {
			findings = append(findings, bad("%s must be a string", key)...)
		}
	}
	if v, present := raw["keywords"]; present {
		if err := json.Unmarshal(v, &m.Keywords); err != nil || m.Keywords == nil {
			findings = append(findings, bad("keywords must be an array of strings")...)
		}
	}
	if v, present := raw["author"]; present {
		author, err := decodeAuthor(v)
		if err != nil {
			findings = append(findings, bad("author: %v", err)...)
		}
		m.Author = author
	}
	if v, present := raw["extensions"]; present && !isJSONObject(v) {
		findings = append(findings, bad("extensions must be an object")...)
	}
	sort.SliceStable(findings, func(i, j int) bool { return findings[i].Message < findings[j].Message })
	return m, findings
}

func decodeAuthor(v json.RawMessage) (*Author, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(v, &raw); err != nil || raw == nil {
		return nil, fmt.Errorf("must be an object")
	}
	var a Author
	for _, key := range sortedKeys(raw) {
		var dst *string
		switch key {
		case "name":
			dst = &a.Name
		case "email":
			dst = &a.Email
		case "url":
			dst = &a.URL
		default:
			return nil, fmt.Errorf("field %q is not allowed", key)
		}
		if !decodeString(raw, key, dst) {
			return nil, fmt.Errorf("%s must be a string", key)
		}
	}
	if a.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	return &a, nil
}

func parseMCP(t Tree) ([]MCPServer, map[string]bool, []Finding) {
	declared := map[string]bool{}
	file, ok := t.File(MCPPath)
	if !ok {
		return nil, declared, nil
	}
	bad := func(format string, a ...any) Finding {
		return Finding{Code: CodeMCPConfig, Path: MCPPath, Message: fmt.Sprintf(format, a...),
			Hint: "see https://agent-plugins.org/specification, section 7.2"}
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(file.Data, &raw); err != nil {
		return nil, declared, []Finding{bad("mcp.json is not a JSON object: %v", err)}
	}
	var findings []Finding
	for _, key := range sortedKeys(raw) {
		if key != "$schema" && key != "mcpServers" {
			findings = append(findings, bad("field %q is not allowed in mcp.json", key))
		}
	}
	var schema string
	if !decodeString(raw, "$schema", &schema) || schema != MCPSchema {
		findings = append(findings, bad("$schema must be %q", MCPSchema))
	}
	var entries map[string]json.RawMessage
	if err := json.Unmarshal(raw["mcpServers"], &entries); err != nil || entries == nil {
		return nil, declared, append(findings, bad("mcpServers must be an object"))
	}
	var servers []MCPServer
	for _, name := range sortedKeys(entries) {
		declared[name] = true
		server, f := parseServer(name, entries[name])
		if f != nil {
			findings = append(findings, bad("server %q: %s", name, f))
			continue
		}
		if server != nil {
			servers = append(servers, *server)
		}
	}
	return servers, declared, findings
}

// parseServer returns nil, nil for a stdio server or for fields that validate reports with a
// more specific code (headers, env, command): those servers never enter the model.
func parseServer(name string, v json.RawMessage) (*MCPServer, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(v, &raw); err != nil || raw == nil {
		return nil, fmt.Errorf("must be an object")
	}
	var typ string
	if !decodeString(raw, "type", &typ) {
		return nil, fmt.Errorf("type is required")
	}
	switch typ {
	case "stdio":
		return nil, nil // SH-MCP-002
	case "streamable-http", "sse":
	default:
		return nil, fmt.Errorf("type %q is unknown", typ)
	}
	policyOnly := false
	for _, key := range sortedKeys(raw) {
		switch key {
		case "type", "url":
		case "headers", "env", "command", "args", "cwd":
			policyOnly = true // SH-SEC-001 or SH-MCP-002
		default:
			return nil, fmt.Errorf("field %q is not allowed", key)
		}
	}
	var rawURL string
	if !decodeString(raw, "url", &rawURL) {
		return nil, fmt.Errorf("url is required")
	}
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("url must be an absolute HTTP or HTTPS URL")
	}
	if u.User != nil || u.Fragment != "" || strings.Contains(rawURL, "#") {
		return nil, fmt.Errorf("url must not contain user information or a fragment")
	}
	if u.Scheme == "http" && !isLoopback(u.Hostname()) {
		return nil, fmt.Errorf("url must use HTTPS for a non-loopback host")
	}
	origin := u.Scheme + "://" + u.Host
	path, ok := strings.CutPrefix(rawURL, origin)
	if !ok {
		return nil, fmt.Errorf("url must be written in lowercase canonical form, starting with %q", origin)
	}
	if policyOnly || typ != "streamable-http" {
		return nil, nil // reported by validate
	}
	return &MCPServer{Name: name, Origin: origin, Path: path}, nil
}

func isLoopback(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func parseSkills(t Tree) ([]Skill, []Finding) {
	byDir := map[string][]File{}
	for _, f := range t.Files {
		rest, ok := strings.CutPrefix(f.Path, SkillsDir)
		if !ok {
			continue
		}
		dir, _, nested := strings.Cut(rest, "/")
		if !nested {
			continue // a file directly under skills/ is a layout finding in validate
		}
		byDir[dir] = append(byDir[dir], f)
	}
	var skills []Skill
	var findings []Finding
	for _, dir := range sortedKeys(byDir) {
		skillPath := SkillsDir + dir + "/SKILL.md"
		file, ok := t.File(skillPath)
		if !ok {
			findings = append(findings, Finding{Code: CodeSkillFile, Path: SkillsDir + dir,
				Message: "skill directory has no SKILL.md", Hint: "add SKILL.md with name and description in the frontmatter"})
			continue
		}
		skill, fs := parseSkill(dir, skillPath, file.Data)
		if len(fs) > 0 {
			findings = append(findings, fs...)
			continue
		}
		skill.Files = byDir[dir]
		skills = append(skills, skill)
	}
	return skills, findings
}

func parseSkill(dir, path string, data []byte) (Skill, []Finding) {
	var s Skill
	finding := func(code string, line int, format string, a ...any) Finding {
		return Finding{Code: code, Path: path, Line: line, Message: fmt.Sprintf(format, a...),
			Hint: "see https://agentskills.io/specification"}
	}
	fm, _, ok := splitFrontmatter(data)
	if !ok {
		return s, []Finding{finding(CodeSkillFile, 1, "SKILL.md must start with a YAML frontmatter between '---' lines")}
	}
	fields, err := frontmatterFields(fm)
	if err != nil {
		return s, []Finding{finding(CodeSkillFile, 1, "frontmatter is not a YAML mapping: %v", err)}
	}
	var findings []Finding
	name, nameField := fields.str("name")
	desc, descField := fields.str("description")
	if !nameField.ok || !descField.ok {
		return s, []Finding{finding(CodeSkillFile, 1, "frontmatter must have name and description as strings")}
	}
	if !validSkillName(name) {
		findings = append(findings, finding(CodeSkillName, nameField.line, "skill name %q is invalid", name))
	} else if name != dir {
		findings = append(findings, finding(CodeSkillName, nameField.line, "skill name %q must match its directory %q", name, dir))
	}
	if n := utf8.RuneCountInString(desc); n < 1 || n > 1024 {
		findings = append(findings, finding(CodeSkillField, descField.line, "description must have 1-1024 characters, has %d", n))
	}
	if compat, f := fields.str("compatibility"); f.present {
		if n := utf8.RuneCountInString(compat); !f.ok || n < 1 || n > 500 {
			findings = append(findings, finding(CodeSkillField, f.line, "compatibility must be a string of 1-500 characters"))
		}
	}
	s.Name, s.Description = name, desc
	return s, findings
}

var (
	skillNameRe  = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	pluginNameRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$`)
)

// validPluginName applies the Agent Plugins 1.0.0 name rule (section 5.5).
func validPluginName(s string) bool {
	return len(s) <= 64 && pluginNameRe.MatchString(s) && !strings.Contains(s, "--") && !strings.Contains(s, "..")
}

// validSkillName applies the Agent Skills name rule.
func validSkillName(s string) bool {
	return len(s) <= 64 && skillNameRe.MatchString(s)
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func decodeString(raw map[string]json.RawMessage, key string, dst *string) bool {
	v, ok := raw[key]
	if !ok || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
		return false
	}
	return json.Unmarshal(v, dst) == nil
}

func isJSONObject(v json.RawMessage) bool {
	var m map[string]json.RawMessage
	return json.Unmarshal(v, &m) == nil && m != nil
}
