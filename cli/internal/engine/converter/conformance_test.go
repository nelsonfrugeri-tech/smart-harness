package converter_test

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter/targets"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/validate"
)

// Every registered adapter passes this suite. plainAdapter is registered only here: it proves the
// port does not depend on Claude Code.
func TestConformance(t *testing.T) {
	adapters := append(targets.Adapters(), plainAdapter{})
	registry, err := converter.NewRegistry(adapters...)
	if err != nil {
		t.Fatal(err)
	}
	packages := conformancePackages(t)
	for _, a := range registry.Adapters() {
		for name, p := range packages {
			t.Run(a.Name()+"/"+name, func(t *testing.T) {
				if err := checkConformance(a, p); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

// The suite must be able to fail: each broken adapter breaks one property.
func TestConformanceCatchesBrokenAdapters(t *testing.T) {
	p := conformancePackages(t)["all-tools"]
	cases := []struct {
		adapter converter.Adapter
		want    string
	}{
		{droppingAdapter{}, "is not in any generated file"},
		{&nondeterministicAdapter{}, "not deterministic"},
		{leakingAdapter{}, "credential"},
		{vagueErrorAdapter{}, "UnsupportedError"},
		{unsortedAdapter{}, "sorted"},
	}
	for _, tc := range cases {
		err := checkConformance(tc.adapter, p)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want it to mention %q", tc.adapter.Name(), err, tc.want)
		}
	}
}

// checkConformance verifies the port contract for one adapter and one package.
func checkConformance(a converter.Adapter, p pkg.Package) error {
	first, err1 := a.Convert(p)
	second, err2 := a.Convert(p)
	if fmt.Sprint(err1) != fmt.Sprint(err2) || !reflect.DeepEqual(first, second) {
		return fmt.Errorf("%s: output is not deterministic", a.Name())
	}
	if err1 != nil {
		var unsupported *converter.UnsupportedError
		if !errors.As(err1, &unsupported) || unsupported.Target != a.Name() || unsupported.Component == "" {
			return fmt.Errorf("%s: a refusal must be an UnsupportedError naming the target and the component, got %v", a.Name(), err1)
		}
		if first != nil {
			return fmt.Errorf("%s: a refusal must not return files", a.Name())
		}
		return nil
	}
	for i, f := range first {
		if !fs.ValidPath(f.Path) || strings.Contains(f.Path, `\`) {
			return fmt.Errorf("%s: unsafe path %q", a.Name(), f.Path)
		}
		if i > 0 && first[i-1].Path >= f.Path {
			return fmt.Errorf("%s: paths must be sorted and unique, %q after %q", a.Name(), f.Path, first[i-1].Path)
		}
		if found := validate.Secrets(f); len(found) > 0 {
			return fmt.Errorf("%s: %s %s", a.Name(), f.Path, found[0].Message+" (credential)")
		}
	}
	all := bytes.Buffer{}
	for _, f := range first {
		all.Write(f.Data)
		all.WriteString("\n")
	}
	mentions := func(component, text string) error {
		if !strings.Contains(all.String(), text) {
			return fmt.Errorf("%s: %s is not in any generated file and was not refused", a.Name(), component)
		}
		return nil
	}
	for _, ag := range p.Agents {
		if err := mentions("agent "+ag.Name, ag.Prompt); err != nil {
			return err
		}
	}
	for _, s := range p.MCPServers {
		if err := mentions("MCP server "+s.Name, s.Path); err != nil {
			return err
		}
	}
	for _, s := range p.Skills {
		for _, f := range s.Files {
			if err := mentions("skill file "+f.Path, string(f.Data)); err != nil {
				return err
			}
		}
	}
	return nil
}

func conformancePackages(t *testing.T) map[string]pkg.Package {
	t.Helper()
	example, _, findings, err := pkg.Load(filepath.Join("..", "testdata", "packages", "example"))
	if err != nil || len(findings) != 0 {
		t.Fatalf("load example: %v %+v", err, findings)
	}
	manifest := pkg.Manifest{Name: "conformance", Version: "1.0.0", Description: "Conformance package."}
	return map[string]pkg.Package{
		"example":       example,
		"manifest-only": {Manifest: manifest},
		"all-tools": {
			Manifest: manifest,
			Agents: []pkg.Agent{
				{Name: "builder", Description: "Builds.", Prompt: "Build it.", Tools: []pkg.Tool{
					{Kind: pkg.ToolRead}, {Kind: pkg.ToolEdit}, {Kind: pkg.ToolShell}, {Kind: pkg.ToolMCP, Server: "tracker", Name: "create"},
				}},
				{Name: "lead", Description: "Delegates.", Prompt: "Delegate it.", Tools: []pkg.Tool{
					{Kind: pkg.ToolDelegate}, {Kind: pkg.ToolMCP, Server: "docs"},
				}},
			},
			Skills: []pkg.Skill{{Name: "notes", Description: "Notes.", Files: []pkg.File{
				{Path: "skills/notes/SKILL.md", Data: []byte("---\nname: notes\ndescription: Notes.\n---\n\nTake notes.\n")},
				{Path: "skills/notes/references/guide.md", Data: []byte("Guide.\n")},
			}}},
			MCPServers: []pkg.MCPServer{
				{Name: "docs", Origin: "http://127.0.0.1:8081", Path: "/mcp/projects/p/docs"},
				{Name: "tracker", Origin: "http://127.0.0.1:8081", Path: "/mcp/projects/p/tracker"},
			},
		},
	}
}

// plainAdapter is a test-only harness: one text file per agent and one for the MCP servers.
// It cannot express delegation, so it refuses agents that use it.
type plainAdapter struct{}

func (plainAdapter) Name() string { return "plain" }

func (plainAdapter) Convert(p pkg.Package) ([]converter.File, error) {
	var files []converter.File
	for _, a := range p.Agents {
		var b strings.Builder
		for _, tool := range a.Tools {
			if tool.Kind == pkg.ToolDelegate {
				return nil, &converter.UnsupportedError{Target: "plain", Component: "agent " + a.Name, Reason: "tool delegate"}
			}
			b.WriteString("tool " + tool.String() + "\n")
		}
		b.WriteString(a.Prompt + "\n")
		files = append(files, converter.File{Path: "plain/agents/" + a.Name + ".txt", Data: []byte(b.String())})
	}
	if len(p.MCPServers) > 0 {
		var b strings.Builder
		for _, s := range p.MCPServers {
			b.WriteString(s.Name + " ${" + pkg.GatewayURLEnv + "}" + s.Path + "\n")
		}
		files = append(files, converter.File{Path: "plain/servers.txt", Data: []byte(b.String())})
	}
	for _, s := range p.Skills {
		for _, f := range s.Files {
			files = append(files, converter.File{Path: "plain/" + f.Path, Data: f.Data})
		}
	}
	return files, nil
}

type droppingAdapter struct{}

func (droppingAdapter) Name() string { return "dropping" }
func (droppingAdapter) Convert(p pkg.Package) ([]converter.File, error) {
	return []converter.File{{Path: "manifest.txt", Data: []byte(p.Manifest.Name)}}, nil
}

type nondeterministicAdapter struct{ calls int }

func (*nondeterministicAdapter) Name() string { return "nondeterministic" }
func (a *nondeterministicAdapter) Convert(p pkg.Package) ([]converter.File, error) {
	a.calls++
	files, err := plainAdapter{}.Convert(pkg.Package{Manifest: p.Manifest})
	return append(files, converter.File{Path: "z.txt", Data: []byte(fmt.Sprint(a.calls))}), err
}

type leakingAdapter struct{}

func (leakingAdapter) Name() string { return "leaking" }
func (leakingAdapter) Convert(pkg.Package) ([]converter.File, error) {
	// Built by concatenation so the repository holds no credential-shaped literal.
	return []converter.File{{Path: "auth.txt", Data: []byte("Bearer " + strings.Repeat("a1", 16))}}, nil
}

type vagueErrorAdapter struct{}

func (vagueErrorAdapter) Name() string { return "vague" }
func (vagueErrorAdapter) Convert(pkg.Package) ([]converter.File, error) {
	return nil, errors.New("cannot convert")
}

type unsortedAdapter struct{}

func (unsortedAdapter) Name() string { return "unsorted" }
func (unsortedAdapter) Convert(pkg.Package) ([]converter.File, error) {
	return []converter.File{{Path: "b.txt"}, {Path: "a.txt"}}, nil
}

func TestRegistryListsTargetsOnUnknownName(t *testing.T) {
	r, err := converter.NewRegistry(plainAdapter{}, targets.Adapters()[0])
	if err != nil {
		t.Fatal(err)
	}

	_, err = r.Lookup("codex")

	if err == nil || err.Error() != `unknown target "codex"; available targets: claude-code, plain` {
		t.Fatalf("err = %v", err)
	}
}

func TestRegistryRejectsDuplicateNames(t *testing.T) {
	if _, err := converter.NewRegistry(plainAdapter{}, plainAdapter{}); err == nil {
		t.Fatal("duplicate adapter was accepted")
	}
}

func TestBuiltInTargets(t *testing.T) {
	if got := targets.Registry().Names(); !reflect.DeepEqual(got, []string{"claude-code"}) {
		t.Fatalf("targets = %v", got)
	}
}
