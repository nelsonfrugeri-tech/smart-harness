package localtools

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Canary values are synthetic. The subprocess fails without printing any value.
func secretGuard(t *testing.T) string {
	t.Helper()
	keys := []string{"SMART_HARNESS_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "GH_TOKEN", "GITHUB_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "MONGODB_URI", "UV_INDEX_PASSWORD", "DEJA_HERMES_PG_DSN", "UNLISTED_SERVICE_SECRET"}
	guard := ""
	for _, key := range keys {
		t.Setenv(key, "FAKE_CANARY_ONLY")
		guard += "if [ \"${" + key + "+present}\" = present ]; then exit 87; fi\n"
	}
	return guard
}

func TestAllRuntimeSubprocessesExcludeAmbientCredentials(t *testing.T) {
	guard := secretGuard(t)
	t.Setenv("DEJA_INDEX_DIR", "")
	t.Setenv("DEJA_NOTES_FILE", "")
	t.Setenv("DEJA_EXCLUDE_PROJECTS", "restricted-fixture")
	t.Setenv("CLAUDE_CONFIG_DIR", t.TempDir())
	guard += "[ \"$DEJA_EXCLUDE_PROJECTS\" = restricted-fixture ] && [ -n \"$CLAUDE_CONFIG_DIR\" ] || exit 86\n"
	t.Chdir(t.TempDir())
	if err := os.MkdirAll("graphify-out", 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile("graphify-out/graph.json", []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, tool := range All() {
		t.Run(tool.Name, func(t *testing.T) {
			config := t.TempDir()
			fixtureTool(t, tool, config, tool.Version, true)
			script := "#!/bin/sh\n" + guard + "if [ \"$1\" = --version ]; then echo '" + tool.Binary + " " + tool.Version + "'; else echo runtime-ok; fi\n"
			if err := os.WriteFile(tool.Path(config), []byte(script), 0o700); err != nil {
				t.Fatal(err)
			}
			if tool.Name == "graphify" {
				script = "#!/bin/sh\n" + guard + "if [ \"$1\" = -c ]; then exit 0; fi\n[ \"$1\" = -m ] && [ \"$2\" = graphify.serve ] || exit 88\necho runtime-ok\n"
				if err := os.WriteFile(tool.pythonPath(config), []byte(script), 0o700); err != nil {
					t.Fatal(err)
				}
			}
			// Check executes the version probe, plus the Python import probe for Graphify.
			if err := tool.Check(config); err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			if err := tool.Run(config, []string{"status"}, &output, io.Discard); err != nil {
				t.Fatal(err)
			}
			if output.String() != "runtime-ok\n" {
				t.Fatal(output.String())
			}
			output.Reset()
			if err := tool.Serve(config, strings.NewReader(""), &output, io.Discard); err != nil {
				t.Fatal(err)
			}
			if output.String() != "runtime-ok\n" {
				t.Fatal(output.String())
			}
		})
	}
}

func TestInstallSubprocessExcludesCredentialsAndPreservesManagedPaths(t *testing.T) {
	guard := secretGuard(t)
	for _, tool := range All() {
		t.Run(tool.Name, func(t *testing.T) {
			config, bin := t.TempDir(), t.TempDir()
			t.Setenv("PATH", bin)
			t.Setenv("TMPDIR", config)
			t.Setenv("GOCACHE", filepath.Join(config, "go-cache"))
			t.Setenv("UV_CACHE_DIR", filepath.Join(config, "uv-cache"))
			// Caller values must never redirect a managed installation.
			t.Setenv("GOBIN", "/caller-bin")
			t.Setenv("UV_TOOL_DIR", "/caller-uv")
			t.Setenv("UV_TOOL_BIN_DIR", "/caller-uv-bin")
			manager, _, overrides := tool.installCommand(tool.directory(config))
			script := "#!/bin/sh\n" + guard + "[ -n \"$PATH\" ] && [ -n \"$TMPDIR\" ] && [ -n \"$GOCACHE\" ] && [ -n \"$UV_CACHE_DIR\" ] || exit 88\n"
			for _, override := range overrides {
				key, value, _ := strings.Cut(override, "=")
				script += "[ \"$" + key + "\" = '" + value + "' ] || exit 89\n"
			}
			script += "echo installer-ok\nexit 1\n"
			if err := os.WriteFile(filepath.Join(bin, manager), []byte(script), 0o700); err != nil {
				t.Fatal(err)
			}
			var output bytes.Buffer
			if err := tool.Install(config, &output, io.Discard); err == nil {
				t.Fatal("fixture must fail before installing a real runtime")
			}
			if output.String() != "installer-ok\n" {
				t.Fatalf("sanitized installer was not reached: %q", output.String())
			}
		})
	}
}
