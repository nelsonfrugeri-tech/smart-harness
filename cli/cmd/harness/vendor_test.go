package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVendorClaudeUsesChildEnvironmentAndPreservesSettings(t *testing.T) {
	e := newEnv(t)
	t.Setenv("SMART_HARNESS_TOKEN", testToken)
	t.Setenv("SMART_HARNESS_GATEWAY_URL", "http://127.0.0.1:8081")
	t.Setenv("ANTHROPIC_BASE_URL", "https://native.example.test")
	t.Setenv("ANTHROPIC_AUTH_TOKEN", "native-token")
	t.Setenv("ANTHROPIC_API_KEY", "native-key")
	if err := os.MkdirAll(e.claudeDir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(e.claudeDir, "settings.json")
	before := []byte(`{"model":"native-model","permissions":{"allow":["Read"]},"env":{"ANTHROPIC_BASE_URL":"https://custom.test","ANTHROPIC_AUTH_TOKEN":"custom-token","ANTHROPIC_API_KEY":"custom-key"}}`)
	copyPath := filepath.Join(t.TempDir(), "overlay.json")
	t.Setenv("HARNESS_TEST_OVERLAY_COPY", copyPath)
	t.Setenv("CLAUDE_CODE_USE_BEDROCK", "1")
	if err := os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	script := `#!/bin/sh
[ "$1" = '--settings' ] || exit 94
[ -f "$2" ] || exit 95
printf 'overlay=%s\n' "$2"
cp "$2" "$HARNESS_TEST_OVERLAY_COPY"
shift 2
[ "$ANTHROPIC_BASE_URL" = 'http://127.0.0.1:8081' ] || exit 91
[ "$ANTHROPIC_AUTH_TOKEN" = "$SMART_HARNESS_TOKEN" ] || exit 92
[ "$ANTHROPIC_API_KEY" = '' ] || exit 93
[ "$CLAUDE_CODE_USE_BEDROCK" = '' ] || exit 96
read -r input
printf 'input=%s\n' "$input"
printf 'arg=%s\n' "$@"
pwd
printf 'child-stderr\n' >&2
exit 37
`
	bin := filepath.Join(t.TempDir(), "claude")
	if err := os.WriteFile(bin, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv(envClaudeBin, bin)
	code, out, errOut := e.run("interactive input\n", "vendor=claude", "--print", "a prompt with spaces")
	if code != 37 || !strings.Contains(out, "arg=--model\narg=openrouter/free\narg=--print\narg=a prompt with spaces\n") || !strings.Contains(out, "input=interactive input") || !strings.Contains(errOut, "child-stderr") {
		t.Fatalf("exit=%d out=%s err=%s", code, out, errOut)
	}
	cwd, _ := os.Getwd()
	if !strings.Contains(out, cwd) {
		t.Fatal("working directory changed")
	}
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, "overlay=") {
			if _, err := os.Stat(strings.TrimPrefix(line, "overlay=")); !os.IsNotExist(err) {
				t.Fatal("session overlay leaked")
			}
		}
	}
	copyData, _ := os.ReadFile(copyPath)
	var overlay struct {
		Env map[string]string `json:"env"`
	}
	if err := json.Unmarshal(copyData, &overlay); err != nil {
		t.Fatal(err)
	}
	if overlay.Env["ANTHROPIC_AUTH_TOKEN"] != testToken || overlay.Env["ANTHROPIC_BASE_URL"] != "http://127.0.0.1:8081" || overlay.Env["ANTHROPIC_API_KEY"] != "" {
		t.Fatal("incorrect session routing")
	}
	if info, err := os.Stat(copyPath); err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("session settings are not private")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Fatal("settings modified")
	}
	if os.Getenv("ANTHROPIC_BASE_URL") != "https://native.example.test" || os.Getenv("ANTHROPIC_AUTH_TOKEN") != "native-token" || os.Getenv("ANTHROPIC_API_KEY") != "native-key" {
		t.Fatal("parent environment modified")
	}
	for _, args := range [][]string{{"--model", "openrouter/other"}, {"--model=openrouter/other"}} {
		code, out, _ = e.run("input\n", append([]string{"vendor=claude"}, args...)...)
		if code != 37 || strings.Contains(out, "openrouter/free") {
			t.Fatalf("explicit model replaced: %d %s", code, out)
		}
	}
}

func TestVendorClaudeRequiresConfigurationAndExecutable(t *testing.T) {
	e := newEnv(t)
	t.Setenv("SMART_HARNESS_GATEWAY_URL", "")
	t.Setenv(envClaudeBin, filepath.Join(t.TempDir(), "missing-claude"))
	code, _, errOut := e.run("", "vendor=claude")
	if code == 0 || !strings.Contains(errOut, "Claude Code") {
		t.Fatalf("missing executable: %d %s", code, errOut)
	}
	t.Setenv(envClaudeBin, fakeClaude(t, "2.1.305 (Claude Code)"))
	code, _, errOut = e.run("", "vendor=claude")
	if code == 0 || !strings.Contains(errOut, "login") {
		t.Fatalf("missing configuration: %d %s", code, errOut)
	}
	t.Setenv("SMART_HARNESS_TOKEN", testToken)
	t.Setenv("SMART_HARNESS_GATEWAY_URL", "http://gateway.example.test")
	code, _, errOut = e.run("", "vendor=claude")
	if code == 0 || !strings.Contains(errOut, "https") {
		t.Fatalf("insecure gateway: %d %s", code, errOut)
	}
	t.Setenv("SMART_HARNESS_GATEWAY_URL", "http://127.0.0.1:8081")
	code, _, errOut = e.run("", "vendor=claude", "--settings={}")
	if code != 2 || !strings.Contains(errOut, "--settings is reserved") {
		t.Fatalf("custom settings: %d %s", code, errOut)
	}
	code, _, _ = e.run("", "vendor=unknown")
	if code != 2 {
		t.Fatal("unsupported vendor accepted")
	}
}

func TestVendorClaudeReadsStoredCredentialsAndCleansUpAfterSignal(t *testing.T) {
	e := newEnv(t)
	t.Setenv("SMART_HARNESS_GATEWAY_URL", "")
	if err := os.MkdirAll(e.claudeDir, 0700); err != nil {
		t.Fatal(err)
	}
	settings := map[string]any{"env": map[string]string{"SMART_HARNESS_TOKEN": testToken, "SMART_HARNESS_GATEWAY_URL": "http://127.0.0.1:8081"}}
	data, _ := json.Marshal(settings)
	path := filepath.Join(e.claudeDir, "settings.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	bin := filepath.Join(t.TempDir(), "claude")
	script := `#!/bin/sh
[ "$ANTHROPIC_BASE_URL" = 'http://127.0.0.1:8081' ] || exit 91
[ "$ANTHROPIC_AUTH_TOKEN" = "$SMART_HARNESS_TOKEN" ] || exit 92
printf '%s\n' "$2"
kill -TERM $$
`
	if err := os.WriteFile(bin, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv(envClaudeBin, bin)
	code, out, errOut := e.run("", "vendor=claude")
	if code != 143 {
		t.Fatalf("signal exit=%d stderr=%s", code, errOut)
	}
	if _, err := os.Stat(strings.TrimSpace(out)); !os.IsNotExist(err) {
		t.Fatal("session settings leaked after child signal")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(data) {
		t.Fatal("stored credentials changed")
	}
}

func TestVendorClaudeFallsBackToGatewayWithoutClaudeTap(t *testing.T) {
	for _, tc := range []struct {
		observability, warning string
	}{{"", "observability off (observability is not installed"}, {"off", ""}} {
		e := newEnv(t)
		t.Setenv("SMART_HARNESS_TOKEN", testToken)
		t.Setenv("SMART_HARNESS_GATEWAY_URL", "http://127.0.0.1:8081")
		t.Setenv(envObservability, tc.observability)
		bin := filepath.Join(t.TempDir(), "claude")
		script := "#!/bin/sh\n[ \"$ANTHROPIC_BASE_URL\" = 'http://127.0.0.1:8081' ] || exit 91\nexit 0\n"
		if err := os.WriteFile(bin, []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
		t.Setenv(envClaudeBin, bin)
		code, _, errOut := e.run("", "vendor=claude")
		if code != 0 {
			t.Fatalf("observability=%q exit=%d stderr=%s", tc.observability, code, errOut)
		}
		if tc.warning == "" && strings.Contains(errOut, "observability") {
			t.Fatalf("opt-out still warned: %s", errOut)
		}
		if tc.warning != "" && (!strings.Contains(errOut, tc.warning) || strings.Count(strings.TrimSpace(errOut), "\n") != 0) {
			t.Fatalf("expected one warning line, got %q", errOut)
		}
	}
}
