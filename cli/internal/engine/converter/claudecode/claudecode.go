// Package claudecode converts the canonical package into a Claude Code plugin layer:
// .claude-plugin/plugin.json, .mcp.json, agents/<name>.md, and the skills as they are.
//
// Agent rules: docs/contracts/agent.md. Verified against Claude Code 2.1.305.
package claudecode

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

// Name is the target name used by `harness generate --target`.
const Name = "claude-code"

// Adapter is the Claude Code adapter. The zero value is ready to use.
type Adapter struct{}

// Name returns "claude-code".
func (Adapter) Name() string { return Name }

// Convert returns the Claude Code layer, sorted by path. It does no I/O.
func (Adapter) Convert(p pkg.Package) ([]converter.File, error) {
	manifest, err := pluginJSON(p.Manifest)
	if err != nil {
		return nil, err
	}
	files := []converter.File{{Path: ".claude-plugin/plugin.json", Data: manifest}}
	if len(p.MCPServers) > 0 {
		mcp, err := mcpJSON(p.MCPServers)
		if err != nil {
			return nil, err
		}
		files = append(files, converter.File{Path: ".mcp.json", Data: mcp})
	}
	for _, a := range p.Agents {
		files = append(files, converter.File{Path: "agents/" + a.Name + ".md", Data: AgentMarkdown(p.Manifest.Name, a)})
	}
	for _, s := range p.Skills {
		files = append(files, s.Files...)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	for i := 1; i < len(files); i++ {
		if files[i].Path == files[i-1].Path {
			return nil, fmt.Errorf("claude-code: two components generate %s", files[i].Path)
		}
	}
	return files, nil
}

// manifest keeps the key order of the generated plugin.json.
type manifest struct {
	Name        string   `json:"name"`
	Version     string   `json:"version,omitempty"`
	Description string   `json:"description,omitempty"`
	Author      author   `json:"author"` // required by `claude plugin validate --strict`
	Homepage    string   `json:"homepage,omitempty"`
	Repository  string   `json:"repository,omitempty"`
	License     string   `json:"license,omitempty"`
	Keywords    []string `json:"keywords,omitempty"`
}

type author struct {
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
	URL   string `json:"url,omitempty"`
}

func pluginJSON(m pkg.Manifest) ([]byte, error) {
	a := author{Name: pkg.DefaultAuthor}
	if m.Author != nil {
		a = author{Name: m.Author.Name, Email: m.Author.Email, URL: m.Author.URL}
	}
	return marshal(manifest{Name: m.Name, Version: m.Version, Description: m.Description, Author: a,
		Homepage: m.Homepage, Repository: m.Repository, License: m.License, Keywords: m.Keywords})
}

type mcpServer struct {
	Type    string            `json:"type"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
}

// mcpJSON points every server at the gateway. The origin can be overridden on the developer
// machine and the token is read from the environment; the file never holds a secret.
func mcpJSON(servers []pkg.MCPServer) ([]byte, error) {
	out := map[string]any{} // encoding/json sorts map keys
	for _, s := range servers {
		if s.Local {
			if !pkg.IsLocalConnector(s.Name) {
				return nil, fmt.Errorf("unsupported local connector %q", s.Name)
			}
			out[s.Name] = map[string]any{"type": "stdio", "command": "${HARNESS_CLI_BIN}", "args": []string{"tools", "serve", s.Name}}
			continue
		}
		out[s.Name] = mcpServer{
			Type:    "http",
			URL:     "${" + pkg.GatewayURLEnv + ":-" + s.Origin + "}" + s.Path,
			Headers: map[string]string{"Authorization": "Bearer ${" + pkg.TokenEnv + "}"},
		}
	}
	return marshal(map[string]any{"mcpServers": out})
}

// marshal writes JSON with 2-space indentation, no HTML escaping and a final newline.
func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

var unsafeNameChar = regexp.MustCompile(`[^A-Za-z0-9_-]`)

// Tools maps one logical tool to Claude Code tool names, following docs/contracts/agent.md.
func Tools(plugin string, t pkg.Tool) []string {
	switch t.Kind {
	case pkg.ToolRead:
		return []string{"Read", "Glob", "Grep"}
	case pkg.ToolEdit:
		return []string{"Edit", "Write"}
	case pkg.ToolShell:
		return []string{"Bash"}
	case pkg.ToolSkill:
		return []string{"Skill"}
	case pkg.ToolDelegate:
		return []string{"Agent"}
	}
	if t.Kind == pkg.ToolConnector {
		plugin = t.Server
	}
	prefix := "mcp__plugin_" + unsafeNameChar.ReplaceAllString(plugin, "_") + "_" + unsafeNameChar.ReplaceAllString(t.Server, "_") + "__"
	if t.Name == "" {
		return []string{prefix + "*"}
	}
	return []string{prefix + t.Name}
}

// AgentMarkdown renders agents/<name>.md byte for byte as docs/contracts/agent.md defines.
func AgentMarkdown(plugin string, a pkg.Agent) []byte {
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString("name: " + a.Name + "\n")
	b.WriteString("description: " + quote(a.Description) + "\n")
	var tools []string
	for _, t := range a.Tools {
		tools = append(tools, Tools(plugin, t)...)
	}
	b.WriteString("tools: " + strings.Join(unique(tools), ", ") + "\n")
	if skills := unique(a.Skills); len(skills) > 0 {
		b.WriteString("skills:\n")
		for _, s := range skills {
			b.WriteString("  - " + quote(s) + "\n") // quoted: "123" or "true" must stay strings
		}
	}
	if a.Model != "" {
		b.WriteString("model: " + a.Model + "\n")
	}
	b.WriteString("---\n\n")
	b.WriteString(a.Prompt + "\n")
	return []byte(b.String())
}

// quote writes a YAML double-quoted string, escaping only '\' and '"'. Callers pass one-line
// values without control characters (the description and the skill names).
func quote(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

// unique keeps the first occurrence of each value, in order.
func unique(values []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range values {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
