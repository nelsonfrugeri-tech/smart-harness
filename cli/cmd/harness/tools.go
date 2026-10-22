package main

import (
	"io"

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
