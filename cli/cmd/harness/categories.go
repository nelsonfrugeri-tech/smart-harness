package main

import (
	"fmt"
	"io"
	"sort"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/localtools"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/reconcile"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

// category follows the catalog precedence for mixed packages.
func category(components []api.Component) string {
	result := ""
	for _, component := range components {
		if component.Kind == "agent" {
			return "agents"
		}
		if component.Kind == "mcp" {
			result = "tools"
		} else if component.Kind == "skill" && result == "" {
			result = "skills"
		}
	}
	if result == "" {
		return "unknown"
	}
	return result
}

func validateCategory(names []string, want string, desired reconcile.Desired) error {
	for _, name := range names {
		item := desired.Plugins[name]
		if item == nil {
			return fmt.Errorf("package %s is not available", name)
		}
		actual := category(item.Item.Components)
		if actual != want {
			return fmt.Errorf("package %s belongs to %s, not %s; nothing was changed", name, actual, want)
		}
	}
	return nil
}

var installLocalRuntime = func(tool localtools.Tool, config string, stdout, stderr io.Writer) error {
	return tool.Install(config, stdout, stderr)
}

func installRequestedRuntimes(names []string, config string, desired reconcile.Desired, stdout, stderr io.Writer) error {
	for _, name := range names {
		tool, err := localtools.Find(name)
		if err != nil || category(desired.Plugins[name].Item.Components) != "tools" {
			continue
		}
		if err := installLocalRuntime(tool, config, stdout, stderr); err != nil {
			return err
		}
	}
	return nil
}

func runSkills(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "expected skills install or check")
	}
	switch args[0] {
	case "install":
		return runCategoryInstall(args[1:], "skills", stdout, stderr)
	case "check":
		return runCategoryCheck(args[1:], "skills", stdout, stderr)
	default:
		return usageError(stderr, "expected skills install or check")
	}
}

// Category checks inspect managed installations without requiring API availability.
// Authentication, gateway and settings diagnostics remain in harness doctor.
func runCategoryCheck(args []string, want string, stdout, stderr io.Writer) int {
	if len(args) > 1 {
		return usageError(stderr, "check accepts at most one installed package name")
	}
	s, err := openSession()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	names := []string{}
	if len(args) == 1 {
		if !api.ValidPluginName(args[0]) {
			return usageError(stderr, "invalid package name")
		}
		if _, ok := s.cfg.Plugins[args[0]]; !ok {
			return failure(stderr, exitFailure, fmt.Errorf("%s is not installed", args[0]))
		}
		names = append(names, args[0])
	} else {
		for name := range s.cfg.Plugins {
			names = append(names, name)
		}
		sort.Strings(names)
	}
	checked, failed := 0, false
	for _, name := range names {
		record := s.cfg.Plugins[name]
		components := record.Components
		if len(components) == 0 {
			model, _, findings, err := pkg.Load(s.store.Dir(name))
			if err != nil || len(findings) > 0 {
				fmt.Fprintf(stderr, "FAIL %s: cannot identify installed package category; run harness sync\n", name)
				failed = true
				continue
			}
			for _, v := range model.MCPServers {
				components = append(components, api.Component{Kind: "mcp", Name: v.Name})
			}
			for _, v := range model.Agents {
				components = append(components, api.Component{Kind: "agent", Name: v.Name})
			}
			for _, v := range model.Skills {
				components = append(components, api.Component{Kind: "skill", Name: v.Name})
			}
		}
		if category(components) != want {
			if len(args) > 0 {
				fmt.Fprintf(stderr, "FAIL %s: package is not in %s\n", name, want)
				failed = true
			}
			continue
		}
		checked++
		// Reuse the same digest check as doctor, scoped to this category.
		isolated := *s
		isolated.cfg = s.cfg
		isolated.cfg.Plugins = map[string]local.Installed{name: record}
		result := pluginChecks(&isolated)[0]
		if !result.ok {
			fmt.Fprintf(stderr, "FAIL %s: %s; %s\n", name, result.detail, result.fix)
			failed = true
			continue
		}
		if want == "tools" {
			if tool, err := localtools.Find(name); err == nil {
				if err := tool.Check(s.paths.ConfigDir); err != nil {
					fmt.Fprintln(stderr, err)
					failed = true
					continue
				}
			}
		}
		fmt.Fprintf(stdout, "ok %s %s\n", name, record.Version)
	}
	if checked == 0 && !failed {
		fmt.Fprintf(stdout, "empty %s: no packages installed\n", want)
	}
	if failed {
		return exitFailure
	}
	return exitOK
}
