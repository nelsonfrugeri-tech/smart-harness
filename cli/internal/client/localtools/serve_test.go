package localtools

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeForwardsProtocolWithoutBanner(t *testing.T) {
	tool, _ := Find("deja-vu")
	config := t.TempDir()
	fixtureTool(t, tool, config, tool.Version, true)
	script := "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'deja 0.16.8'; exit; fi\nif [ \"$1\" != mcp ]; then exit 2; fi\n/bin/cat\n"
	if err := os.WriteFile(tool.Path(config), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	request := "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\"}\n"
	var stdout, stderr bytes.Buffer
	if err := tool.Serve(config, strings.NewReader(request), &stdout, &stderr); err != nil {
		t.Fatal(err)
	}
	if stdout.String() != request || stderr.Len() != 0 {
		t.Fatalf("stdio polluted: %q / %q", stdout.String(), stderr.String())
	}
}

func TestGraphPathRequiresCheckoutGraph(t *testing.T) {
	t.Chdir(t.TempDir())
	if _, err := graphPath(); err == nil || !strings.Contains(err.Error(), "update ./src") {
		t.Fatal(err)
	}
	expected := filepath.Join("src", "graphify-out", "graph.json")
	if err := os.MkdirAll(filepath.Dir(expected), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(expected, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := graphPath()
	if err != nil || !filepath.IsAbs(got) || !strings.HasSuffix(got, expected) {
		t.Fatal(got, err)
	}
}
