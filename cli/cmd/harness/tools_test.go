package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/reconcile"
)

func TestToolsCommandRefusesMissingManagedInstallation(t *testing.T) {
	t.Setenv("HARNESS_CONFIG_DIR", t.TempDir())
	t.Setenv("HARNESS_CLAUDE_DIR", t.TempDir())
	for _, args := range [][]string{{"tools", "check"}, {"tools", "run", "graphify", "--version"}} {
		var output bytes.Buffer
		if code := run(args, &output, &output); code != exitFailure {
			t.Fatalf("code=%d", code)
		}
		if !strings.Contains(output.String(), "harness tools install graphify") {
			t.Fatal(output.String())
		}
	}
}

func TestToolsCommandUsage(t *testing.T) {
	for _, args := range [][]string{{"tools"}, {"tools", "unknown"}, {"tools", "install"}, {"tools", "install", "bash"}, {"tools", "check", "graphify", "extra"}, {"tools", "run", "deja-vu"}} {
		var output bytes.Buffer
		if code := run(args, &output, &output); code != exitUsage {
			t.Fatalf("%v code=%d output=%s", args, code, output.String())
		}
	}
}

func TestSetupChecksOnlySelectedToolPrerequisites(t *testing.T) {
	config := t.TempDir()
	desired := reconcile.Desired{Plugins: map[string]*reconcile.Want{"existing-skill": {}}}
	if err := checkLocalTools(config, desired); err != nil {
		t.Fatal(err)
	}
	desired.Plugins["graphify"] = &reconcile.Want{}
	if err := checkLocalTools(config, desired); err == nil || !strings.Contains(err.Error(), "harness tools install graphify") {
		t.Fatalf("error=%v", err)
	}
}

func TestSetupMissingToolPreservesSettingsAndDoesNotDownload(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	base := newVersion(t, "graphify", "1.0.0")
	f.setPlan("md2poui", base)
	if err := os.MkdirAll(e.claudeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	settings := filepath.Join(e.claudeDir, "settings.json")
	original := []byte(`{"permissions":{"allow":["Read"]},"env":{"KEEP":"unchanged"}}`)
	if err := os.WriteFile(settings, original, 0o600); err != nil {
		t.Fatal(err)
	}
	code, _, errOut := e.run(testToken+"\n", "setup", "md2poui", "--api-url", f.api.URL)
	if code != exitFailure || !strings.Contains(errOut, "harness tools install graphify") {
		t.Fatalf("code=%d error=%s", code, errOut)
	}
	after, err := os.ReadFile(settings)
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("settings changed", err)
	}
	if f.downloads(base) != 0 {
		t.Fatal("downloaded package without prerequisite")
	}
	if _, err := os.Stat(filepath.Join(e.configDir, "config.json")); !os.IsNotExist(err) {
		t.Fatal("wrote config", err)
	}
}
