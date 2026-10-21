// Package validate checks a package against the Agent Plugins and Agent Skills specs, the agent
// contract and the platform policy, and produces a stable report.
//
// pkg.Parse reports the spec and contract codes (AP-*, AS-*, SH-AGT-*) and SH-STR-003; this package adds the
// platform codes (SH-SEC, SH-MCP, SH-EXE, SH-STR, SH-NAM, SH-VER). cli/README.md lists them all.
package validate

import (
	"bytes"
	"fmt"
	"net/url"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pack"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

// DefaultGatewayOrigin is the Agent Gateway of the local compose (compose.yaml, port 8081).
// Packages store this canonical origin; SMART_HARNESS_GATEWAY_URL overrides it on the developer machine.
const DefaultGatewayOrigin = "http://127.0.0.1:8081"

// ReportVersion changes only when the report shape changes.
const ReportVersion = "2"

// Options configures a validation.
type Options struct {
	// GatewayOrigin is the only origin MCP servers may use, as scheme://host[:port].
	GatewayOrigin string
	// Adapters produce the generated layers. A file that is not part of the core is accepted
	// only when it is exactly what one of them generates.
	Adapters []converter.Adapter
}

// Report is the stable JSON output of `harness validate --json`. Keys keep this order.
type Report struct {
	ReportVersion string      `json:"report_version"`
	Valid         bool        `json:"valid"`
	Plugin        string      `json:"plugin"`      // name as written in plugin.json, "" when absent
	Version       string      `json:"version"`     // "" when absent
	Description   string      `json:"description"` // "" when absent
	Keywords      []string    `json:"keywords"`    // [] when absent
	Digest        string      `json:"digest"`      // what `harness pack` would print; "" when pack would refuse the directory
	Components    []Component `json:"components"`  // valid components only, sorted by kind and name
	Findings      []Finding   `json:"findings"`
}

// Component is one agent, skill or MCP server of the package.
type Component struct {
	Kind        string `json:"kind"` // "agent", "mcp" or "skill"
	Name        string `json:"name"`
	Description string `json:"description"` // "" for MCP servers, which have none
}

// Finding is one report entry. Every finding is an error in this version.
type Finding struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
	Hint     string `json:"hint"`
	Path     string `json:"path"`
	Line     int    `json:"line"` // 1-based, 0 when the defect has no line
}

// CheckOrigin rejects a gateway origin that is not scheme://host[:port].
func CheckOrigin(origin string) error {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Scheme+"://"+u.Host != origin {
		return fmt.Errorf("gateway origin %q must be scheme://host[:port] with http or https and no path", origin)
	}
	return nil
}

// Dir validates the package directory. The error is only for I/O or bad options.
func Dir(dir string, opts Options) (Report, pkg.Package, error) {
	if err := CheckOrigin(opts.GatewayOrigin); err != nil {
		return Report{}, pkg.Package{}, err
	}
	tree, findings, err := pkg.ReadTree(dir)
	if err != nil {
		return Report{}, pkg.Package{}, err
	}
	// A symlink, a special file or a broken limit makes pack refuse the directory: no digest.
	packable := len(findings) == 0
	var p pkg.Package
	if !limitReached(findings) {
		var parsed []pkg.Finding
		p, parsed = pkg.Parse(tree)
		findings = append(findings, parsed...)
		findings = append(findings, Policy(p, tree, parsed, opts)...)
	}
	r := newReport(p, findings)
	if packable {
		if d, err := pack.FilesDigest(tree.Files); err == nil {
			r.Digest = d
		}
	}
	return r, p, nil
}

func limitReached(findings []pkg.Finding) bool {
	for _, f := range findings {
		if f.Code == pkg.CodeLimits {
			return true
		}
	}
	return false
}

// Policy applies the platform rules. parsed holds the findings of pkg.Parse: when it is not
// empty the model is incomplete, so generated files cannot be compared and are not checked.
func Policy(p pkg.Package, tree pkg.Tree, parsed []pkg.Finding, opts Options) []pkg.Finding {
	var findings []pkg.Finding
	findings = append(findings, checkManifest(p, tree)...)
	findings = append(findings, checkMCP(tree, opts.GatewayOrigin)...)
	findings = append(findings, checkLayout(p, tree, len(parsed) == 0, opts.Adapters)...)
	for _, f := range tree.Files {
		findings = append(findings, checkExecutable(f, tree.Executable[f.Path])...)
		findings = append(findings, Secrets(f)...)
	}
	return findings
}

func newReport(p pkg.Package, findings []pkg.Finding) Report {
	pkg.SortFindings(findings)
	r := Report{ReportVersion: ReportVersion, Plugin: p.Manifest.Name, Version: p.Manifest.Version,
		Description: p.Manifest.Description, Keywords: append([]string{}, p.Manifest.Keywords...),
		Components: []Component{}, Findings: []Finding{}}
	for _, a := range p.Agents {
		r.Components = append(r.Components, Component{Kind: "agent", Name: a.Name, Description: a.Description})
	}
	for _, s := range p.MCPServers {
		r.Components = append(r.Components, Component{Kind: "mcp", Name: s.Name})
	}
	for _, s := range p.Skills {
		r.Components = append(r.Components, Component{Kind: "skill", Name: s.Name, Description: s.Description})
	}
	for _, f := range findings {
		r.Findings = append(r.Findings, Finding{Code: f.Code, Severity: "error", Message: f.Message, Hint: f.Hint, Path: f.Path, Line: f.Line})
	}
	r.Valid = len(r.Findings) == 0
	return r
}

// lineOf returns the 1-based line of a byte offset.
func lineOf(data []byte, offset int) int {
	return bytes.Count(data[:offset], []byte("\n")) + 1
}
