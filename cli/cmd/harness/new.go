package main

import (
	"fmt"
	"io"
	"path/filepath"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/scaffold"
)

func runNew(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, []string{"--directory"}, nil)
	if err != nil || len(a.positional) != 2 {
		return usageError(stderr, "new requires tool|skill|agent <name> [--directory <path>]")
	}
	kind, name := a.positional[0], a.positional[1]
	if kind != "tool" && kind != "skill" && kind != "agent" {
		return usageError(stderr, "new kind must be tool, skill or agent")
	}
	if !scaffold.ValidName(name) {
		return usageError(stderr, "name must be 1-64 lowercase letters, digits and single hyphens, starting with a letter")
	}
	destination := a.values["--directory"]
	if destination == "" {
		destination = name
	}
	if err := scaffold.Create(kind, name, destination); err != nil {
		return failure(stderr, exitFailure, err)
	}
	fmt.Fprintf(stdout, "created %s %s in %s\n", kind, name, destination)
	fmt.Fprintf(stdout, "validate: harness validate %s\n", filepath.Join(destination, "package"))
	return exitOK
}
