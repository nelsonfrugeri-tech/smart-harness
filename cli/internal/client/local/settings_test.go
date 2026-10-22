package local

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

var at = time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)

// A settings.json kept in a dotfiles repository is a symlink: the write goes to its target and
// the link stays a link.
func TestWriteSettingsEnvFollowsSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "dotfiles", "settings.json")
	os.MkdirAll(filepath.Dir(target), 0o755)
	os.WriteFile(target, []byte(`{"model": "opus"}`), 0o644)
	link := filepath.Join(dir, "claude", "settings.json")
	os.MkdirAll(filepath.Dir(link), 0o755)
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}

	changed, _, err := WriteSettingsEnv(link, map[string]string{EnvGatewayURL: "http://127.0.0.1:8081"}, at)

	if err != nil || !changed {
		t.Fatalf("changed = %v, err = %v", changed, err)
	}
	info, err := os.Lstat(link)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("settings.json is no longer a symlink (mode %v, err %v)", info.Mode(), err)
	}
	data, _ := os.ReadFile(target)
	if !strings.Contains(string(data), `"SMART_HARNESS_GATEWAY_URL": "http://127.0.0.1:8081"`) || !strings.Contains(string(data), `"model": "opus"`) {
		t.Fatalf("symlink target = %s", data)
	}
}

func TestWriteSettingsEnvRefusesDanglingSymlink(t *testing.T) {
	dir := t.TempDir()
	link := filepath.Join(dir, "settings.json")
	if err := os.Symlink(filepath.Join(dir, "missing.json"), link); err != nil {
		t.Fatal(err)
	}

	if _, _, err := WriteSettingsEnv(link, map[string]string{EnvGatewayURL: "x"}, at); err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("err = %v", err)
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("dangling symlink was replaced")
	}
}

// Shell commands in settings.json keep &, < and > as written.
func TestWriteSettingsEnvDoesNotEscapeHTML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	os.WriteFile(path, []byte(`{"statusLine": {"command": "a && b < c > d"}}`), 0o600)

	if _, _, err := WriteSettingsEnv(path, map[string]string{"X": "<&>"}, at); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	if !bytes.Contains(data, []byte(`"a && b < c > d"`)) || !bytes.Contains(data, []byte(`"X": "<&>"`)) || bytes.Contains(data, []byte(`\u00`)) {
		t.Fatalf("settings.json = %s", data)
	}
}

func TestGatewaySettingsPreserveNativeClaudeAndMigrateOnlyOwnedOverrides(t *testing.T) {
	for _, tc := range []struct {
		name, provider string
		migrate        bool
	}{
		{"owned", `"ANTHROPIC_BASE_URL":"https://gateway.test","ANTHROPIC_AUTH_TOKEN":"old-token","ANTHROPIC_API_KEY":""`, true},
		{"custom-url", `"ANTHROPIC_BASE_URL":"https://custom.test","ANTHROPIC_AUTH_TOKEN":"old-token","ANTHROPIC_API_KEY":""`, false},
		{"custom-token", `"ANTHROPIC_BASE_URL":"https://gateway.test","ANTHROPIC_AUTH_TOKEN":"custom-token","ANTHROPIC_API_KEY":""`, false},
		{"custom-key", `"ANTHROPIC_BASE_URL":"https://gateway.test","ANTHROPIC_AUTH_TOKEN":"old-token","ANTHROPIC_API_KEY":"custom-key"`, false},
		{"incomplete", `"ANTHROPIC_BASE_URL":"https://gateway.test","ANTHROPIC_AUTH_TOKEN":"old-token"`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "settings.json")
			original := `{"model":"native-model","env":{"KEEP":"yes","SMART_HARNESS_TOKEN":"old-token","SMART_HARNESS_GATEWAY_URL":"https://gateway.test",` + tc.provider + `}}`
			if err := os.WriteFile(path, []byte(original), 0600); err != nil {
				t.Fatal(err)
			}
			_, _, err := WriteSettingsEnv(path, GatewayEnv("new-token", "https://new-gateway.test"), time.Now())
			if err != nil {
				t.Fatal(err)
			}
			env, err := SettingsEnv(path)
			if err != nil {
				t.Fatal(err)
			}
			for _, key := range []string{EnvAnthropicBaseURL, EnvAnthropicAuth, EnvAnthropicAPIKey} {
				_, exists := env[key]
				if tc.migrate && exists {
					t.Fatalf("owned override %s remains", key)
				}
			}
			if !tc.migrate {
				var before map[string]any
				_ = json.Unmarshal([]byte(original), &before)
				for key, value := range before["env"].(map[string]any) {
					if strings.HasPrefix(key, "ANTHROPIC_") && env[key] != value {
						t.Fatalf("custom %s changed", key)
					}
				}
			}
			data, _ := os.ReadFile(path)
			var after map[string]any
			_ = json.Unmarshal(data, &after)
			if after["model"] != "native-model" || env["KEEP"] != "yes" || env[EnvToken] != "new-token" {
				t.Fatal("unrelated configuration changed")
			}
		})
	}
}

func TestGatewayEnvContainsOnlyMCPConfiguration(t *testing.T) {
	values := GatewayEnv("test-token", "https://gateway.test")
	for key := range values {
		if strings.HasPrefix(key, "ANTHROPIC_") {
			t.Fatalf("global provider override: %s", key)
		}
	}
	if values[EnvToken] != "test-token" || values[EnvGatewayURL] != "https://gateway.test" {
		t.Fatal("missing MCP configuration")
	}
}
