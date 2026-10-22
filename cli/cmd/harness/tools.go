package main

import (
	"fmt"
	"io"
	"sort"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/localtools"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/reconcile"
)

func runTools(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "expected tools install, check, run or serve")
	}
	action := args[0]
	if action == "install" {
		return runCategoryInstall(args[1:], "tools", stdout, stderr)
	}
	if action == "check" {
		return runCategoryCheck(args[1:], "tools", stdout, stderr)
	}
	if (action == "run" && len(args) < 3) || (action == "serve" && len(args) != 2) {
		return usageError(stderr, "invalid tools arguments")
	}
	if action != "run" && action != "serve" {
		return usageError(stderr, "unknown tools command")
	}
	paths, err := local.ResolvePaths()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	tool, err := localtools.Find(args[1])
	if err != nil {
		return failure(stderr, exitUsage, err)
	}
	if action == "serve" {
		if err := tool.Serve(paths.ConfigDir, stdin, stdout, stderr); err != nil {
			return failure(stderr, exitFailure, err)
		}
		return exitOK
	}
	if action == "run" {
		if err := tool.Run(paths.ConfigDir, args[2:], stdout, stderr); err != nil {
			return failure(stderr, exitFailure, err)
		}
		return exitOK
	}
	return exitOK
}

// packageLocalTools includes bundled runtimes as well as the legacy standalone packages.
func packageLocalTools(name string, components []api.Component) []localtools.Tool {
	names := map[string]bool{name: true}
	for _, component := range components {
		if component.Kind == "mcp" {
			names[component.Name] = true
		}
	}
	var result []localtools.Tool
	for _, tool := range localtools.All() {
		if names[tool.Name] {
			result = append(result, tool)
		}
	}
	return result
}

func checkLocalTools(config string, desired reconcile.Desired) error {
	checked := map[string]bool{}
	for name, item := range desired.Plugins {
		for _, tool := range packageLocalTools(name, item.Item.Components) {
			if checked[tool.Name] {
				continue
			}
			if err := tool.Check(config); err != nil {
				return fmt.Errorf("%w; repair with %s", err, packageInstallCommand(name, item.Item.Components))
			}
			checked[tool.Name] = true
		}
	}
	return nil
}

func localToolChecks(s *session) []check {
	var checks []check
	needed := map[string]string{}
	names := make([]string, 0, len(s.cfg.Plugins))
	for name := range s.cfg.Plugins {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		record := s.cfg.Plugins[name]
		for _, tool := range packageLocalTools(name, record.Components) {
			needed[tool.Name] = packageInstallCommand(name, record.Components)
		}
	}
	for _, tool := range localtools.All() {
		if needed[tool.Name] == "" {
			continue
		}
		c := check{name: "local-tool " + tool.Name, detail: tool.Version, ok: true}
		if err := tool.Check(s.paths.ConfigDir); err != nil {
			c.ok, c.detail, c.fix = false, err.Error(), needed[tool.Name]
		}
		checks = append(checks, c)
	}
	return checks
}

func packageInstallCommand(name string, components []api.Component) string {
	kind := category(components)
	if kind == "unknown" {
		return "harness install " + name
	}
	return "harness " + kind + " install " + name
}
