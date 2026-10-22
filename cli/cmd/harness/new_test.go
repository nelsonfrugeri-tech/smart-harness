package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/validate"
)

func TestNewScaffoldsValidateGenerateAndPack(t *testing.T) {
	for _, kind := range []string{"tool", "skill", "agent"} {
		t.Run(kind, func(t *testing.T) {
			parent := t.TempDir()
			dest := filepath.Join(parent, "new-package")
			invoke := func(args ...string) string {
				t.Helper()
				var out, stderr bytes.Buffer
				if code := run(args, &out, &stderr); code != exitOK {
					t.Fatalf("%v: exit=%d stderr=%s stdout=%s", args, code, stderr.String(), out.String())
				}
				return out.String()
			}
			invoke("new", kind, "example-project", "--directory", dest)
			packageDir := filepath.Join(dest, "package")
			var report validate.Report
			if err := json.Unmarshal([]byte(invoke("validate", packageDir, "--json")), &report); err != nil {
				t.Fatal(err)
			}
			wantKind := kind
			if kind == "tool" {
				wantKind = "mcp"
			}
			if !report.Valid || report.Plugin != "example-project" || len(report.Components) != 1 || report.Components[0].Kind != wantKind {
				t.Fatalf("unexpected report: %+v", report)
			}
			invoke("generate", packageDir, "--target", "claude-code")
			invoke("validate", packageDir)
			archive := filepath.Join(parent, "package.tar.gz")
			digest := strings.TrimSpace(invoke("pack", packageDir, "-o", archive))
			unpacked := filepath.Join(parent, "unpacked")
			invoke("unpack", archive, unpacked, "--expect-digest", digest)
			invoke("validate", unpacked)
			if _, err := os.Stat(filepath.Join(dest, ".github", "workflows", "release.yml")); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestNewRejectsInvalidNamesAndPreservesExistingDestination(t *testing.T) {
	for _, name := range []string{"../escape", "@scope/package", "a/b", "a\\b", "a..b", "a--b", "-flag", "1agent", "claude-example", "", strings.Repeat("a", 65)} {
		dest := filepath.Join(t.TempDir(), "destination")
		var out, stderr bytes.Buffer
		if code := run([]string{"new", "agent", name, "--directory", dest}, &out, &stderr); code == exitOK {
			t.Fatalf("accepted %q", name)
		}
		if _, err := os.Lstat(dest); !os.IsNotExist(err) {
			t.Fatalf("invalid name created destination: %q", name)
		}
	}
	for _, kind := range []string{"mcp", "connector", "unknown"} {
		dest := filepath.Join(t.TempDir(), "destination")
		if code := run([]string{"new", kind, "example", "--directory", dest}, &bytes.Buffer{}, &bytes.Buffer{}); code != exitUsage {
			t.Fatalf("kind %s: %d", kind, code)
		}
	}
	dest := t.TempDir()
	keep := filepath.Join(dest, "keep.txt")
	if err := os.WriteFile(keep, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	if code := run([]string{"new", "skill", "example", "--directory", dest}, &bytes.Buffer{}, &bytes.Buffer{}); code != exitFailure {
		t.Fatalf("existing destination: %d", code)
	}
	data, _ := os.ReadFile(keep)
	entries, _ := os.ReadDir(dest)
	if string(data) != "untouched" || len(entries) != 1 {
		t.Fatal("changed nonempty destination")
	}
}

func TestNewSupportsEmptyDirectoryAndRejectsSymlink(t *testing.T) {
	dest := t.TempDir()
	var stderr bytes.Buffer
	if code := run([]string{"new", "skill", "example", "--directory", dest}, &bytes.Buffer{}, &stderr); code != exitOK {
		t.Fatal(code, stderr.String())
	}
	target := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if code := run([]string{"new", "agent", "example", "--directory", link}, &bytes.Buffer{}, &bytes.Buffer{}); code != exitFailure {
		t.Fatalf("symlink: %d", code)
	}
	if entries, _ := os.ReadDir(target); len(entries) != 0 {
		t.Fatal("wrote through symlink")
	}
}
