package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter/targets"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/digest"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pack"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/validate"
)

func validateOptions(a cmdArgs) validate.Options {
	origin := a.values["--gateway-origin"]
	if origin == "" {
		origin = validate.DefaultGatewayOrigin
	}
	return validate.Options{GatewayOrigin: origin, Adapters: targets.Registry().Adapters()}
}

// runValidate prints the report. Exit 0 when valid, 1 when invalid, 2 on usage or I/O error.
func runValidate(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, []string{"--gateway-origin"}, []string{"--json"})
	if err != nil || len(a.positional) != 1 {
		return usageError(stderr, errText(err))
	}
	report, _, err := validate.Dir(a.positional[0], validateOptions(a))
	if err != nil {
		return failure(stderr, exitUsage, err)
	}
	if a.bools["--json"] {
		out, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			return failure(stderr, exitUsage, err)
		}
		fmt.Fprintf(stdout, "%s\n", out)
	} else {
		printFindings(stdout, report.Findings)
		if report.Valid {
			fmt.Fprintf(stdout, "valid %s\n", report.Digest)
		}
	}
	if !report.Valid {
		return exitFailure
	}
	return exitOK
}

func printFindings(w io.Writer, findings []validate.Finding) {
	for _, f := range findings {
		loc := f.Path
		if f.Line > 0 {
			loc = fmt.Sprintf("%s:%d", f.Path, f.Line)
		}
		fmt.Fprintf(w, "%s: %s %s", loc, f.Code, f.Message)
		if f.Hint != "" {
			fmt.Fprintf(w, " (%s)", f.Hint)
		}
		fmt.Fprintln(w)
	}
}

// runGenerate validates the package, converts it with the target adapter and writes the files
// into the package directory. A stale generated file (SH-STR-002) does not block: it is rewritten.
func runGenerate(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, []string{"--target", "--gateway-origin"}, nil)
	if err != nil || len(a.positional) != 1 || a.values["--target"] == "" {
		return usageError(stderr, errText(err))
	}
	dir := a.positional[0]
	adapter, err := targets.Registry().Lookup(a.values["--target"])
	if err != nil {
		return failure(stderr, exitUsage, err)
	}
	report, p, err := validate.Dir(dir, validateOptions(a))
	if err != nil {
		return failure(stderr, exitUsage, err)
	}
	var blocking []validate.Finding
	for _, f := range report.Findings {
		if f.Code != pkg.CodeStale {
			blocking = append(blocking, f)
		}
	}
	if len(blocking) > 0 {
		printFindings(stderr, blocking)
		return failure(stderr, exitFailure, errors.New("package is invalid; nothing was generated"))
	}
	files, err := adapter.Convert(p)
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	for _, f := range files {
		if err := writeIfChanged(dir, f); err != nil {
			return failure(stderr, exitUsage, err)
		}
		fmt.Fprintln(stdout, f.Path)
	}
	return exitOK
}

// writeIfChanged writes a generated file inside dir, leaving identical files untouched.
func writeIfChanged(dir string, f pkg.File) error {
	if !fs.ValidPath(f.Path) || strings.Contains(f.Path, `\`) {
		return fmt.Errorf("adapter produced unsafe path %q", f.Path)
	}
	target := filepath.Join(dir, filepath.FromSlash(f.Path))
	if old, err := os.ReadFile(target); err == nil && bytes.Equal(old, f.Data) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, f.Data, 0o644)
}

func runDigest(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, nil, nil)
	if err != nil || len(a.positional) != 1 {
		return usageError(stderr, errText(err))
	}
	d, err := digest.Dir(a.positional[0])
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	fmt.Fprintln(stdout, d)
	return exitOK
}

// runPack writes the archive and prints its digest. The output must be outside the package.
func runPack(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, []string{"-o"}, nil)
	if err != nil || len(a.positional) != 1 || a.values["-o"] == "" {
		return usageError(stderr, errText(err))
	}
	dir, out := a.positional[0], a.values["-o"]
	if inside(dir, out) {
		return failure(stderr, exitUsage, fmt.Errorf("output %s must be outside the package directory", out))
	}
	var buf bytes.Buffer
	d, err := pack.Pack(dir, &buf)
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	if err := os.WriteFile(out, buf.Bytes(), 0o644); err != nil {
		return failure(stderr, exitUsage, err)
	}
	fmt.Fprintln(stdout, d)
	return exitOK
}

func runUnpack(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, []string{"--expect-digest"}, nil)
	if err != nil || len(a.positional) != 2 {
		return usageError(stderr, errText(err))
	}
	f, err := os.Open(a.positional[0])
	if err != nil {
		return failure(stderr, exitUsage, err)
	}
	defer f.Close()
	d, err := pack.Unpack(f, a.positional[1], a.values["--expect-digest"])
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	fmt.Fprintln(stdout, d)
	return exitOK
}

// inside reports whether path is dir or below it.
func inside(dir, path string) bool {
	absDir, err1 := filepath.Abs(dir)
	absPath, err2 := filepath.Abs(path)
	if err1 != nil || err2 != nil {
		return false
	}
	rel, err := filepath.Rel(absDir, absPath)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
