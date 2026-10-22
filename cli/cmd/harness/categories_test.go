package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/localtools"
)

func TestCategoryInstallRequiresLoginAndEmptyCheckIsExplicit(t *testing.T) {
	e := newEnv(t)
	for _, kind := range []string{"tools", "skills"} {
		code, _, errOut := e.run("", kind, "install", "github")
		if code != 1 || !strings.Contains(errOut, "harness login") {
			t.Fatalf("%s code=%d err=%s", kind, code, errOut)
		}
		output := e.mustRun("", kind, "check")
		if !strings.Contains(output, "empty "+kind+": no packages installed") || strings.Contains(output, "ok ") {
			t.Fatal(output)
		}
	}
}

func TestCategoryBatchTypeMismatchDoesNotMutate(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	tool := newVersion(t, "deja-vu", "2.0.0")
	tool.componentKind = "mcp"
	skill := newVersion(t, "md2poui", "2.0.0")
	e.mustRun(testToken+"\n", "login", "--api-url", f.api.URL)
	f.optional["personal"] = []published{tool, skill}
	originalInstaller := installLocalRuntime
	t.Cleanup(func() { installLocalRuntime = originalInstaller })
	calls := 0
	installLocalRuntime = func(localtools.Tool, string, io.Writer, io.Writer) error {
		calls++
		return fmt.Errorf("unexpected installer")
	}
	before, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	settingsBefore, _ := os.ReadFile(filepath.Join(e.claudeDir, "settings.json"))
	for _, args := range [][]string{{"tools", "install", "deja-vu", "md2poui"}, {"skills", "install", "md2poui", "deja-vu"}} {
		code, _, errOut := e.run("", args...)
		if code != 1 || !strings.Contains(errOut, "belongs to") {
			t.Fatalf("%v code=%d err=%s", args, code, errOut)
		}
	}
	after, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	settingsAfter, _ := os.ReadFile(filepath.Join(e.claudeDir, "settings.json"))
	if !bytes.Equal(before, after) || !bytes.Equal(settingsBefore, settingsAfter) || calls != 0 || f.downloads(tool) != 0 || f.downloads(skill) != 0 {
		t.Fatal("invalid batch performed a mutation")
	}
}

func TestCategoryInstallAndChecksAreScopedAndAdditive(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	github := newVersion(t, "github", "1.0.0")
	github.componentKind = "mcp"
	notion := newVersion(t, "notion", "1.0.0")
	notion.componentKind = "mcp"
	skill := newVersion(t, "md2poui", "2.0.0")
	e.mustRun(testToken+"\n", "login", "--api-url", f.api.URL)
	f.optional["personal"] = []published{github, notion, skill}
	e.mustRun("", "tools", "install", "github", "notion")
	e.mustRun("", "skills", "install", "md2poui")
	toolOutput := e.mustRun("", "tools", "check")
	skillOutput := e.mustRun("", "skills", "check")
	if !strings.Contains(toolOutput, "ok github") || !strings.Contains(toolOutput, "ok notion") || strings.Contains(toolOutput, "md2poui") || strings.Contains(toolOutput, "graphify") {
		t.Fatal(toolOutput)
	}
	if !strings.Contains(skillOutput, "ok md2poui") || strings.Contains(skillOutput, "github") {
		t.Fatal(skillOutput)
	}
	// Corrupting a skill must not make tools check inspect the other category.
	if err := os.WriteFile(filepath.Join(e.claudeDir, "skills", "md2poui", "skills", "s", "SKILL.md"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	e.mustRun("", "tools", "check")
	if code, _, _ := e.run("", "skills", "check"); code != 1 {
		t.Fatal("corrupt skill passed")
	}
	if len(e.config().Plugins) != 3 {
		t.Fatal("additive selection was lost")
	}
}

func TestToolsInstallAutomaticallyInstallsAssociatedRuntime(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	tool := newVersion(t, "deja-vu", "2.0.0")
	tool.componentKind = "mcp"
	e.mustRun(testToken+"\n", "login", "--api-url", f.api.URL)
	f.optional["personal"] = []published{tool}
	originalInstaller := installLocalRuntime
	t.Cleanup(func() { installLocalRuntime = originalInstaller })
	calls := 0
	installLocalRuntime = func(tool localtools.Tool, config string, _, _ io.Writer) error {
		calls++
		path := tool.Path(config)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte("#!/bin/sh\necho 'deja 0.16.8'\n"), 0o700); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(filepath.Dir(filepath.Dir(path)), "ready"), []byte(tool.Version), 0o600)
	}
	e.mustRun("", "tools", "install", "deja-vu")
	if calls != 1 || f.downloads(tool) != 1 {
		t.Fatalf("installer=%d downloads=%d", calls, f.downloads(tool))
	}
	e.mustRun("", "tools", "check")
	if err := os.Remove(filepath.Join(e.configDir, "tools", "deja-vu", "0.16.8", "ready")); err != nil {
		t.Fatal(err)
	}
	if code, _, errOut := e.run("", "tools", "check"); code != 1 || !strings.Contains(errOut, "harness tools install deja-vu") {
		t.Fatal(code, errOut)
	}
	e.mustRun("", "skills", "check")
}

func TestCategoryCheckReadsLegacyInstallationWithoutComponents(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	skill := newVersion(t, "md2poui", "2.0.0", "plugin.json", `{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json","name":"md2poui","version":"2.0.0"}`)
	e.mustRun(testToken+"\n", "login", "--api-url", f.api.URL)
	f.optional["personal"] = []published{skill}
	e.mustRun("", "install", "md2poui")
	path := filepath.Join(e.configDir, "config.json")
	cfg, err := local.LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	record := cfg.Plugins["md2poui"]
	record.Components = nil
	cfg.Plugins["md2poui"] = record
	if err := local.SaveConfig(path, cfg); err != nil {
		t.Fatal(err)
	}
	if output := e.mustRun("", "skills", "check"); !strings.Contains(output, "ok md2poui") {
		t.Fatal(output)
	}
	if output := e.mustRun("", "tools", "check"); !strings.Contains(output, "empty tools") {
		t.Fatal(output)
	}
}

func TestRuntimeInstallFailurePreservesPackageSelection(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	tool := newVersion(t, "deja-vu", "2.0.0")
	tool.componentKind = "mcp"
	e.mustRun(testToken+"\n", "login", "--api-url", f.api.URL)
	f.optional["personal"] = []published{tool}
	originalInstaller := installLocalRuntime
	t.Cleanup(func() { installLocalRuntime = originalInstaller })
	installLocalRuntime = func(localtools.Tool, string, io.Writer, io.Writer) error {
		return fmt.Errorf("Go prerequisite is missing")
	}
	before, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	code, _, errOut := e.run("", "tools", "install", "deja-vu")
	after, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	if code != 1 || !strings.Contains(errOut, "Go prerequisite") || f.downloads(tool) != 0 || !bytes.Equal(before, after) {
		t.Fatal(code, errOut)
	}
}
