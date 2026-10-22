package main

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
)

func TestPersonalLoginBeforeClaudeOrPackages(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	if err := os.MkdirAll(e.claudeDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.claudeDir, "settings.json"), []byte(`{"permissions":{"allow":["Read"]},"env":{"EXISTING":"keep"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	e.mustRun(testToken+"\n", "login", "--api-url", f.api.URL)
	cfg, err := local.LoadConfig(filepath.Join(e.configDir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PersonalPlugins == nil || len(cfg.PersonalPlugins) != 0 || len(cfg.Projects) != 0 {
		t.Fatalf("not an empty personal login: %+v", cfg)
	}
	settings := e.settings()
	env := settings["env"].(map[string]any)
	if env["EXISTING"] != "keep" || env[local.EnvToken] != testToken || settings["permissions"] == nil {
		t.Fatal("existing settings not preserved")
	}
	for _, key := range []string{"HARNESS_CLI_BIN", "HARNESS_CONFIG_DIR", "HARNESS_CLAUDE_DIR"} {
		if value, ok := env[key].(string); !ok || !filepath.IsAbs(value) {
			t.Fatalf("invalid %s", key)
		}
	}
	info, err := os.Stat(filepath.Join(e.claudeDir, "settings.json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatal("credentials permissions", err)
	}
	data, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	if bytes.Contains(data, []byte(testToken)) {
		t.Fatal("token in public config")
	}
	e.mustRun("", "sync")
	s, err := openSession()
	if err != nil {
		t.Fatal(err)
	}
	if check := configCheck(s); !check.ok {
		t.Fatal(check)
	}
	if check := planCheck(s, testToken); !check.ok {
		t.Fatal(check)
	}
}

func TestPersonalInstallIsAdditivePaginatedAndPreservesLegacy(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	legacy := newVersion(t, "legacy", "1.0.0")
	first := newVersion(t, "github", "1.0.0")
	second := newVersion(t, "notion", "1.0.0")
	f.setPlan("legacy-project", legacy)
	f.optional["personal"] = []published{first, second}
	e.mustRun(testToken+"\n", "setup", "legacy-project", "--api-url", f.api.URL)
	e.mustRun(testToken+"\n", "login", "--api-url", f.api.URL)
	e.mustRun("", "install", "github")
	e.mustRun("", "install", "notion", "github")
	e.mustRun("", "sync")
	cfg, err := local.LoadConfig(filepath.Join(e.configDir, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cfg.PersonalPlugins, []string{"github", "notion"}) || len(cfg.Projects) != 1 || len(cfg.Plugins) != 3 {
		t.Fatalf("unexpected config %+v", cfg)
	}
	for _, v := range []published{legacy, first, second} {
		if f.downloads(v) != 1 || e.skill(v.name) == "" {
			t.Fatalf("%s downloads %d", v.name, f.downloads(v))
		}
	}
}

func TestPersonalInstallMissingNameDoesNotChangeSelections(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	first := newVersion(t, "github", "1.0.0")
	f.optional["personal"] = []published{first}
	e.mustRun(testToken+"\n", "login", "--api-url", f.api.URL)
	e.mustRun("", "install", "github")
	before, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	code, _, errOut := e.run("", "install", "absent")
	if code != 1 || !strings.Contains(errOut, "no plugin absent") {
		t.Fatalf("code=%d error=%s", code, errOut)
	}
	after, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("failed install changed selections")
	}
	// Losing catalog access must fail sync, not remove the installed package.
	f.mu.Lock()
	f.optional["personal"] = nil
	f.mu.Unlock()
	code, _, _ = e.run("", "sync")
	if code != 1 || e.skill("github") == "" {
		t.Fatal("sync removed unavailable personal package")
	}
}

func TestPersonalAndProjectVersionConflictStopsBeforeDownload(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	old := newVersion(t, "github", "1.0.0")
	newer := newVersion(t, "github", "2.0.0")
	f.setPlan("legacy", old)
	f.optional["personal"] = []published{newer}
	e.mustRun(testToken+"\n", "setup", "legacy", "--api-url", f.api.URL)
	code, _, errOut := e.run("", "install", "github")
	if code != 1 || !strings.Contains(errOut, "one directory cannot hold both") || f.downloads(newer) != 0 {
		t.Fatalf("code=%d error=%s", code, errOut)
	}
}

func TestRejectedPersonalLoginDoesNotPersistCredentials(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	wrong := "shg_" + strings.Repeat("x", 43)
	code, out, errOut := e.run(wrong+"\n", "login", "--api-url", f.api.URL)
	if code != 1 || strings.Contains(out+errOut, wrong) {
		t.Fatal("rejected credential leaked")
	}
	if _, err := os.Stat(filepath.Join(e.claudeDir, "settings.json")); !os.IsNotExist(err) {
		t.Fatal("rejected token persisted", err)
	}
}
