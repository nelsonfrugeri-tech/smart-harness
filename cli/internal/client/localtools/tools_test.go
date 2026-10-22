package localtools

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixtureTool(t *testing.T, tool Tool, config, version string, ready bool) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(tool.Path(config)), 0o700); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nif [ \"$1\" = --version ]; then echo '" + tool.Binary + " " + version + "'; else printf '%s\\n' \"$DEJA_INDEX_DIR\" \"$@\"; fi\n"
	if err := os.WriteFile(tool.Path(config), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	if tool.Name == "graphify" {
		if err := os.MkdirAll(filepath.Dir(tool.pythonPath(config)), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(tool.pythonPath(config), []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if ready {
		if err := os.WriteFile(filepath.Join(tool.directory(config), "ready"), []byte(tool.installationID()), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestManagedInstallRequired(t *testing.T) {
	tool, _ := Find("graphify")
	for _, tc := range []struct {
		name, version string
		ready, ok     bool
	}{{"partial", tool.Version, false, false}, {"wrong version", "0.0.0", true, false}, {"ready", tool.Version, true, true}} {
		t.Run(tc.name, func(t *testing.T) {
			config := t.TempDir()
			fixtureTool(t, tool, config, tc.version, tc.ready)
			err := tool.Check(config)
			if (err == nil) != tc.ok {
				t.Fatalf("Check=%v", err)
			}
		})
	}
}

func TestInstallIdempotentWithoutPackageManager(t *testing.T) {
	tool, _ := Find("graphify")
	config := t.TempDir()
	fixtureTool(t, tool, config, tool.Version, true)
	t.Setenv("PATH", t.TempDir())
	var output bytes.Buffer
	if err := tool.Install(config, &output, &output); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "unchanged graphify 0.9.56") {
		t.Fatal(output.String())
	}
}

func TestMissingPrerequisiteActionable(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	for _, tool := range All() {
		var output bytes.Buffer
		err := tool.Install(t.TempDir(), &output, &output)
		if err == nil || !strings.Contains(err.Error(), "harness tools install "+tool.Name) {
			t.Fatalf("error=%v", err)
		}
	}
}

func TestPinnedInstallerCommands(t *testing.T) {
	graph, _ := Find("graphify")
	manager, args, env := graph.installCommand("/isolated")
	if manager != "uv" || strings.Join(args, " ") != "tool install --force graphifyy[mcp]==0.9.56" || !strings.Contains(strings.Join(env, " "), "UV_TOOL_BIN_DIR=/isolated/bin") {
		t.Fatal(manager, args, env)
	}
	deja, _ := Find("deja-vu")
	manager, args, env = deja.installCommand("/isolated")
	if manager != "go" || args[len(args)-1] != "github.com/vshulcz/deja-vu/cmd/deja@v0.16.8" || env[0] != "GOBIN=/isolated/bin" {
		t.Fatal(manager, args, env)
	}
}

func TestRunLiteralArgumentsAndIsolatedIndex(t *testing.T) {
	tool, _ := Find("deja-vu")
	config := t.TempDir()
	fixtureTool(t, tool, config, tool.Version, true)
	t.Setenv("DEJA_INDEX_DIR", "")
	var output bytes.Buffer
	if err := tool.Run(config, []string{"search", "$(touch malicious)"}, &output, io.Discard); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(config, "deja-index") + "\nsearch\n$(touch malicious)\n"
	if output.String() != want {
		t.Fatalf("got %q want %q", output.String(), want)
	}
	t.Setenv("DEJA_INDEX_DIR", "/chosen-index")
	output.Reset()
	if err := tool.Run(config, []string{"stats"}, &output, io.Discard); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(output.String(), "/chosen-index\n") {
		t.Fatal(output.String())
	}
}

func TestUnknownNameRejected(t *testing.T) {
	for _, name := range []string{"../graphify", "sh", "graphify;id", ""} {
		if _, err := Find(name); err == nil {
			t.Fatalf("accepted %q", name)
		}
	}
}

func TestInstallerExitZeroWithoutBinaryIsFailure(t *testing.T) {
	binDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(binDir, "uv"), []byte("#!/bin/sh\nexit 0\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)
	tool, _ := Find("graphify")
	config := t.TempDir()
	var output bytes.Buffer
	if err := tool.Install(config, &output, &output); err == nil {
		t.Fatal("reported success without installed binary")
	}
	if _, err := os.Stat(filepath.Join(tool.directory(config), "ready")); !os.IsNotExist(err) {
		t.Fatalf("ready marker: %v", err)
	}
}
