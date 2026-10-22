package main

import (
	"fmt"
	"io"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/localtools"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/reconcile"
)

func runTools(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "expected tools install, check or run")
	}
	action := args[0]
	if (action == "check" && len(args) > 2) || (action == "install" && len(args) != 2) || (action == "run" && len(args) < 3) {
		return usageError(stderr, "invalid tools arguments")
	}
	if action != "check" && action != "install" && action != "run" {
		return usageError(stderr, "unknown tools command")
	}
	paths, err := local.ResolvePaths()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	selected := localtools.All()
	if len(args) >= 2 {
		tool, err := localtools.Find(args[1])
		if err != nil {
			return failure(stderr, exitUsage, err)
		}
		selected = []localtools.Tool{tool}
	}
	if action == "install" {
		unlock, err := local.Lock(paths.LockFile())
		if err != nil {
			return failure(stderr, exitFailure, err)
		}
		defer unlock()
		if err := selected[0].Install(paths.ConfigDir, stdout, stderr); err != nil {
			return failure(stderr, exitFailure, err)
		}
		return exitOK
	}
	if action == "run" {
		if err := selected[0].Run(paths.ConfigDir, args[2:], stdout, stderr); err != nil {
			return failure(stderr, exitFailure, err)
		}
		return exitOK
	}
	failed := false
	for _, tool := range selected {
		if err := tool.Check(paths.ConfigDir); err != nil {
			fmt.Fprintln(stderr, err)
			failed = true
			continue
		}
		fmt.Fprintf(stdout, "ok %s %s\n", tool.Name, tool.Version)
	}
	if failed {
		return exitFailure
	}
	return exitOK
}

func checkLocalTools(config string, desired reconcile.Desired) error {
	for _, tool := range localtools.All() {
		if _, wanted := desired.Plugins[tool.Name]; wanted {
			if err := tool.Check(config); err != nil {
				return err
			}
		}
	}
	return nil
}

func localToolChecks(s *session) []check {
	var checks []check
	for _, tool := range localtools.All() {
		if _, installed := s.cfg.Plugins[tool.Name]; !installed {
			continue
		}
		c := check{name: "local-tool " + tool.Name, detail: tool.Version, ok: true}
		if err := tool.Check(s.paths.ConfigDir); err != nil {
			c.ok, c.detail, c.fix = false, err.Error(), "harness tools install "+tool.Name
		}
		checks = append(checks, c)
	}
	return checks
}
