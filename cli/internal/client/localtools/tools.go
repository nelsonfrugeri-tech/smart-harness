// Package localtools manages the two curated local tools used by the demo.
// Package archives never choose commands or supply executable installation scripts.
package localtools

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Tool pins the upstream executable separately from its Smart Harness skill.
type Tool struct{ Name, Binary, Version, Source, License string }

var supported = []Tool{
	{"graphify", "graphify", "0.9.56", "https://github.com/Graphify-Labs/graphify/tree/v0.9.56", "Apache-2.0; legacy portions MIT"},
	{"deja-vu", "deja", "0.16.8", "https://github.com/vshulcz/deja-vu/tree/v0.16.8", "MIT"},
}

// All returns the fixed allowlist, independent of package metadata.
func All() []Tool { return append([]Tool(nil), supported...) }

// Find refuses unknown tools; names never become executable paths.
func Find(name string) (Tool, error) {
	for _, t := range supported {
		if t.Name == name {
			return t, nil
		}
	}
	return Tool{}, fmt.Errorf("unknown local tool %q; supported: graphify, deja-vu", name)
}

func (t Tool) directory(config string) string {
	return filepath.Join(config, "tools", t.Name, t.Version)
}

// Path uses only the managed installation, never a same-named binary on PATH.
func (t Tool) Path(config string) string { return filepath.Join(t.directory(config), "bin", t.Binary) }

// Check requires both a completed installation and the pinned runtime version.
func (t Tool) Check(config string) error {
	marker, err := os.ReadFile(filepath.Join(t.directory(config), "ready"))
	if err != nil || string(marker) != t.installationID() {
		return fmt.Errorf("%s is not installed; run harness tools install %s", t.Name, t.Name)
	}
	if err := t.checkVersion(config); err != nil {
		return err
	}
	return t.checkMCP(config)
}

func (t Tool) checkVersion(config string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, t.Path(config), "--version").Output()
	expected := t.Binary + " " + t.Version
	if err != nil || strings.TrimSpace(string(output)) != expected {
		return fmt.Errorf("%s requires version %s; run harness tools install %s", t.Name, t.Version, t.Name)
	}
	return nil
}

// Install changes only a versioned tools directory and package-manager caches.
// The ready marker is written last. Interrupted/failed installs cannot pass Check.
func (t Tool) Install(config string, stdout, stderr io.Writer) error {
	if t.Check(config) == nil {
		fmt.Fprintf(stdout, "unchanged %s %s\n", t.Name, t.Version)
		return nil
	}
	dir, err := filepath.Abs(t.directory(config))
	if err != nil {
		return err
	}
	manager, args, env := t.installCommand(dir)
	binary, err := exec.LookPath(manager)
	if err != nil {
		return fmt.Errorf("%s requires %s on PATH; install %s, then run harness tools install %s", t.Name, manager, manager, t.Name)
	}
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o700); err != nil {
		return err
	}
	// A previous ready marker must not validate an interrupted repair.
	if err := os.Remove(filepath.Join(dir, "ready")); err != nil && !os.IsNotExist(err) {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Env = append(os.Environ(), env...)
	cmd.Stdout, cmd.Stderr = stdout, stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("install %s failed: %w; rerun harness tools install %s", t.Name, err, t.Name)
	}
	if err := t.checkVersion(config); err != nil {
		return err
	}
	if err := t.checkMCP(config); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "ready"), []byte(t.installationID()), 0o600); err != nil {
		return err
	}
	fmt.Fprintf(stdout, "installed %s %s (%s)\n", t.Name, t.Version, t.Source)
	return nil
}

func (t Tool) installCommand(dir string) (string, []string, []string) {
	bin := filepath.Join(dir, "bin")
	if t.Name == "graphify" {
		return "uv", []string{"tool", "install", "--force", "graphifyy[mcp]==" + t.Version}, []string{"UV_TOOL_DIR=" + filepath.Join(dir, "uv"), "UV_TOOL_BIN_DIR=" + bin}
	}
	return "go", []string{"install", "-ldflags=-X main.version=" + t.Version, "github.com/vshulcz/deja-vu/cmd/deja@v" + t.Version}, []string{"GOBIN=" + bin}
}

// Run forwards explicit user arguments without a shell. The local history index is
// kept with this harness config; upstream discovers session sources on this machine.
func (t Tool) Run(config string, args []string, stdout, stderr io.Writer) error {
	if err := t.Check(config); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, t.Path(config), args...)
	cmd.Env = t.environment(config)
	if t.Name == "deja-vu" {
		fmt.Fprintln(stderr, "deja-vu may index coding-session histories on this machine; use a dedicated demo profile to exclude personal sources. --project filters results, not source discovery.")
	}

	cmd.Stdout, cmd.Stderr = stdout, stderr
	return cmd.Run()
}

func (t Tool) installationID() string {
	if t.Name == "graphify" {
		return t.Version + "+mcp"
	}
	return t.Version
}
