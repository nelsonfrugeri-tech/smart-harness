package localtools

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func (t Tool) pythonPath(config string) string {
	return filepath.Join(t.directory(config), "uv", "graphifyy", "bin", "python")
}

func (t Tool) checkMCP(config string) error {
	if t.Name != "graphify" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, t.pythonPath(config), "-c", "import mcp.server.stdio")
	cmd.Env = externalEnvironment()
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("Graphify MCP dependencies are missing; run harness tools install graphify")
	}
	return nil
}

// Serve forwards native MCP stdio without a shell, banners or session deadline.
// Cancellation follows the parent process lifetime rather than a fixed timeout.
// claude-tap has no MCP server upstream: the CLI serves its read-only status itself.
func (t Tool) Serve(config string, stdin io.Reader, stdout, stderr io.Writer) error {
	if t.Name == TapName {
		return serveTapMCP(t, config, stdin, stdout)
	}
	if err := t.Check(config); err != nil {
		return err
	}
	binary, args := t.Path(config), []string{"mcp"}
	if t.Name == "graphify" {
		graph, err := graphPath()
		if err != nil {
			return err
		}
		binary, args = t.pythonPath(config), []string{"-m", "graphify.serve", graph}
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Env = t.environment(config)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = stdin, stdout, stderr
	return cmd.Run()
}

func graphPath() (string, error) {
	for _, candidate := range []string{"graphify-out/graph.json", "src/graphify-out/graph.json"} {
		info, err := os.Stat(candidate)
		if err == nil && !info.IsDir() {
			return filepath.Abs(candidate)
		}
		if err != nil && !os.IsNotExist(err) {
			return "", err
		}
	}
	return "", fmt.Errorf("Graphify graph is missing in the current checkout; run harness tools run graphify update ./src and reconnect the MCP")
}

// environment keeps each tool's state with this harness config unless the user chose a location.
func (t Tool) environment(config string) []string {
	env := externalEnvironment()
	defaults := map[string]string{}
	switch t.Name {
	case "deja-vu":
		defaults = map[string]string{"DEJA_INDEX_DIR": filepath.Join(config, "deja-index"), "DEJA_NOTES_FILE": filepath.Join(config, "deja-notes.jsonl")}
	case TapName:
		defaults = map[string]string{"CLOUDTAP_DB": filepath.Join(TracesDir(config), tapDatabase)}
	}
	for key, path := range defaults {
		if os.Getenv(key) == "" {
			env = append(env, key+"="+path)
		}
	}
	return env
}
