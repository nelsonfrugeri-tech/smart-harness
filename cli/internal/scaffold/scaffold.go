// Package scaffold creates an authoring repository with a validated Agent Plugins package.
package scaffold

import (
	"bytes"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"text/template"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter/targets"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/validate"
)

//go:embed templates/*
var templates embed.FS

var namePattern = regexp.MustCompile(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`)

// ValidName accepts the shared subset of plugin, skill and agent names.
func ValidName(name string) bool { return len(name) <= 64 && namePattern.MatchString(name) }

// Create publishes a complete scaffold only into an absent or empty directory.
// A failed validation leaves the destination untouched. The parent directory must exist.
func Create(kind, name, destination string) error {
	if !ValidName(name) {
		return fmt.Errorf("name must be 1-64 lowercase letters, digits and single hyphens, starting with a letter")
	}
	if kind != "tool" && kind != "skill" && kind != "agent" {
		return fmt.Errorf("kind must be tool, skill or agent")
	}
	destination, err := filepath.Abs(destination)
	if err != nil {
		return err
	}
	if err := checkDestination(destination); err != nil {
		return err
	}
	staging, err := os.MkdirTemp(filepath.Dir(destination), ".harness-new-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	if err := writeTemplates(staging, kind, name); err != nil {
		return err
	}
	report, _, err := validate.Dir(filepath.Join(staging, "package"), validate.Options{GatewayOrigin: validate.DefaultGatewayOrigin, Adapters: targets.Registry().Adapters()})
	if err != nil {
		return err
	}
	if !report.Valid {
		return fmt.Errorf("scaffold is invalid: %s", report.Findings[0].Message)
	}
	if err := os.Chmod(staging, 0755); err != nil {
		return err
	}
	if err := checkDestination(destination); err != nil {
		return err
	}
	// os.Remove refuses a non-empty directory, including one changed since the check.
	if err := os.Remove(destination); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return os.Rename(staging, destination)
}

func checkDestination(destination string) error {
	info, err := os.Lstat(destination)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("destination %s must be a directory, not a file or symlink", destination)
	}
	entries, err := os.ReadDir(destination)
	if err != nil {
		return err
	}
	if len(entries) > 0 {
		return fmt.Errorf("destination %s is not empty; nothing was changed", destination)
	}
	return nil
}

func writeTemplates(dir, kind, name string) error {
	files := map[string]string{
		"README.md":                     "README.md.tmpl",
		".github/workflows/release.yml": "release.yml.tmpl",
		"package/plugin.json":           "plugin.json.tmpl",
	}
	switch kind {
	case "tool":
		files["package/mcp.json"] = "mcp.json.tmpl"
	case "skill":
		files["package/skills/"+name+"/SKILL.md"] = "SKILL.md.tmpl"
	case "agent":
		files["package/dev.smartharness/agents/"+name+".agent.md"] = "agent.md.tmpl"
	}
	paths := make([]string, 0, len(files))
	for path := range files {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	data := struct{ Name, Kind string }{name, kind}
	for _, path := range paths {
		source, err := templates.ReadFile("templates/" + files[path])
		if err != nil {
			return err
		}
		// Distinct delimiters leave GitHub's ${{ expressions }} intact.
		compiled, err := template.New(path).Delims("[[", "]]").Parse(string(source))
		if err != nil {
			return err
		}
		var contents bytes.Buffer
		if err := compiled.Execute(&contents, data); err != nil {
			return err
		}
		target := filepath.Join(dir, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		if err := os.WriteFile(target, contents.Bytes(), 0644); err != nil {
			return err
		}
	}
	return nil
}
