package localtools

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestClaudeTapPinnedUVInstall(t *testing.T) {
	tap, err := Find(TapName)
	if err != nil {
		t.Fatal(err)
	}
	manager, args, env := tap.installCommand("/isolated")
	joined := strings.Join(env, " ")
	if manager != "uv" || strings.Join(args, " ") != "tool install --force claude-tap==0.1.146" || !strings.Contains(joined, "UV_TOOL_DIR=/isolated/uv") || !strings.Contains(joined, "UV_TOOL_BIN_DIR=/isolated/bin") {
		t.Fatal(manager, args, env)
	}
	if tap.Path("/cfg") != "/cfg/tools/observability/0.1.146/bin/claude-tap" {
		t.Fatal(tap.Path("/cfg"))
	}
	config := t.TempDir()
	fixtureTool(t, tap, config, "0.1.146", true)
	if err := tap.Check(config); err != nil {
		t.Fatalf("pinned version rejected: %v", err)
	}
	fixtureTool(t, tap, config, "0.1.145", true)
	if err := tap.Check(config); err == nil {
		t.Fatal("wrong version accepted")
	}
}

func TestClaudeTapMCPOverPipe(t *testing.T) {
	config := t.TempDir()
	tap, _ := Find(TapName)
	dir := TracesDir(config)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 22; i++ {
		path := filepath.Join(dir, "trace-"+string(rune('a'+i))+".jsonl")
		if err := os.WriteFile(path, []byte(strings.Repeat("x", i)), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, base.Add(time.Duration(i)*time.Minute), base.Add(time.Duration(i)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	inReader, inWriter := io.Pipe()
	outReader, outWriter := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- tap.Serve(config, inReader, outWriter, io.Discard); outWriter.Close() }()
	lines := bufio.NewScanner(outReader)
	call := func(message string) map[string]any {
		t.Helper()
		if _, err := io.WriteString(inWriter, message+"\n"); err != nil {
			t.Fatal(err)
		}
		if !lines.Scan() {
			t.Fatal("no answer", lines.Err())
		}
		var response map[string]any
		if err := json.Unmarshal(lines.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response
	}
	init := call(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`)
	result := init["result"].(map[string]any)
	if result["protocolVersion"] != "2025-06-18" || result["serverInfo"].(map[string]any)["name"] != TapName {
		t.Fatal(init)
	}
	if _, err := io.WriteString(inWriter, `{"jsonrpc":"2.0","method":"notifications/initialized"}`+"\n"); err != nil {
		t.Fatal(err)
	}
	list := call(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	var names []string
	for _, tool := range list["result"].(map[string]any)["tools"].([]any) {
		names = append(names, tool.(map[string]any)["name"].(string))
	}
	if strings.Join(names, ",") != "claude_tap_status,claude_tap_list_traces" {
		t.Fatal(names)
	}
	status := call(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"claude_tap_status","arguments":{}}}`)
	content := status["result"].(map[string]any)["structuredContent"].(map[string]any)
	if content["installed"] != false || content["viewer_url"] != "http://127.0.0.1:8787" || content["traces_dir"] != dir {
		t.Fatal(content)
	}
	if _, ok := content["running"].(bool); !ok {
		t.Fatal(content)
	}
	traces := call(`{"jsonrpc":"2.0","id":"t","method":"tools/call","params":{"name":"claude_tap_list_traces"}}`)
	files := traces["result"].(map[string]any)["structuredContent"].(map[string]any)["files"].([]any)
	first := files[0].(map[string]any)
	if len(files) != 20 || first["name"] != "trace-v.jsonl" || first["bytes"].(float64) != 21 || first["mtime"] != "2026-10-01T12:21:00Z" {
		t.Fatal(len(files), first)
	}
	unknown := call(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"shell"}}`)
	if unknown["error"].(map[string]any)["code"].(float64) != -32602 {
		t.Fatal(unknown)
	}
	if ping := call(`{"jsonrpc":"2.0","id":6,"method":"ping"}`); ping["result"] == nil {
		t.Fatal(ping)
	}
	inWriter.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
