// Command harness is the Smart Harness CLI.
package main

import (
	"fmt"
	"io"
	"os"
	"strings"
)

// version and commit are set at build time with -ldflags "-X main.version=... -X main.commit=...".
var (
	version = "dev"
	commit  = "unknown"
)

const usage = `usage:
  harness version
  harness validate <dir> [--json] [--gateway-origin <url>]
  harness generate <dir> --target <name> [--gateway-origin <url>]
  harness digest <dir>
  harness pack <dir> -o <file.tar.gz>
  harness unpack <file.tar.gz> <dest> [--expect-digest sha256:<hex>]
  harness login --api-url <url>
  harness install <name> [name...]
  harness setup <project> [--api-url <url>] [--include-optional <plugin>[,<plugin>...]]
  harness sync
  harness tools install <graphify|deja-vu>
  harness tools check [graphify|deja-vu]
  harness tools serve <graphify|deja-vu>
  harness tools run <graphify|deja-vu> <args...>
  harness doctor
  harness draft pull <id> [--dir <dir>]`

// Exit codes: 0 success, 1 invalid package or rejected operation, 2 usage or I/O error.
const (
	exitOK      = 0
	exitFailure = 1
	exitUsage   = 2
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run executes the requested command and returns the exit code.
// With no argument, an unknown command or bad arguments, it prints the usage to stderr and returns 2.
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "")
	}
	cmd, rest := args[0], args[1:]
	switch cmd {
	case "version":
		if len(rest) != 0 {
			return usageError(stderr, "")
		}
		fmt.Fprintf(stdout, "harness %s (commit %s)\n", version, commit)
		return exitOK
	case "validate":
		return runValidate(rest, stdout, stderr)
	case "generate":
		return runGenerate(rest, stdout, stderr)
	case "digest":
		return runDigest(rest, stdout, stderr)
	case "pack":
		return runPack(rest, stdout, stderr)
	case "unpack":
		return runUnpack(rest, stdout, stderr)
	case "login":
		return runLogin(rest, stdout, stderr)
	case "install":
		return runInstall(rest, stdout, stderr)
	case "setup":
		return runSetup(rest, stdout, stderr)
	case "tools":
		return runTools(rest, stdout, stderr)
	case "sync":
		return runSync(rest, stdout, stderr)
	case "doctor":
		return runDoctor(rest, stdout, stderr)
	case "draft":
		return runDraft(rest, stdout, stderr)
	}
	return usageError(stderr, "")
}

// usageError prints an optional message and the usage, and returns exitUsage.
func usageError(stderr io.Writer, msg string) int {
	if msg != "" {
		fmt.Fprintln(stderr, "harness: "+msg)
	}
	fmt.Fprintln(stderr, usage)
	return exitUsage
}

// failure prints an error and returns code.
func failure(stderr io.Writer, code int, err error) int {
	fmt.Fprintln(stderr, "harness: "+err.Error())
	return code
}

// cmdArgs holds parsed positional arguments and flags.
type cmdArgs struct {
	positional []string
	values     map[string]string
	bools      map[string]bool
}

// parseArgs accepts flags before or after positional arguments, as "--name value" or "--name=value".
// valueFlags take a value; boolFlags do not. Any other flag is an error.
func parseArgs(args []string, valueFlags, boolFlags []string) (cmdArgs, error) {
	out := cmdArgs{values: map[string]string{}, bools: map[string]bool{}}
	isValue := map[string]bool{}
	for _, f := range valueFlags {
		isValue[f] = true
	}
	isBool := map[string]bool{}
	for _, f := range boolFlags {
		isBool[f] = true
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if !strings.HasPrefix(arg, "-") || arg == "-" {
			out.positional = append(out.positional, arg)
			continue
		}
		name, value, hasValue := strings.Cut(arg, "=")
		switch {
		case isBool[name] && !hasValue:
			out.bools[name] = true
		case isValue[name] && hasValue:
			out.values[name] = value
		case isValue[name] && i+1 < len(args):
			i++
			out.values[name] = args[i]
		default:
			return out, fmt.Errorf("unknown or incomplete flag %q", arg)
		}
	}
	return out, nil
}
