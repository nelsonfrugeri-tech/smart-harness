// Command harness is the Smart Harness CLI.
package main

import (
	"fmt"
	"io"
	"os"
)

// version and commit are set at build time with -ldflags "-X main.version=... -X main.commit=...".
var (
	version = "dev"
	commit  = "unknown"
)

const usage = "usage: harness version"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run executes the requested command and returns the exit code.
// With no argument or an unknown command, it prints the usage to stderr and returns 2.
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 1 && args[0] == "version" {
		fmt.Fprintf(stdout, "harness %s (commit %s)\n", version, commit)
		return 0
	}
	fmt.Fprintln(stderr, usage)
	return 2
}
