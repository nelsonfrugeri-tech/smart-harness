package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const exampleDir = "../../internal/engine/testdata/packages/example"

// harness runs the CLI in process and returns the exit code, stdout and stderr.
func harness(args ...string) (int, string, string) {
	var stdout, stderr bytes.Buffer
	code := run(args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func copyExample(t *testing.T) string {
	t.Helper()
	dst := t.TempDir()
	err := filepath.WalkDir(exampleDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(exampleDir, p)
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

func TestValidateExitCodes(t *testing.T) {
	code, out, _ := harness("validate", exampleDir, "--json")
	var report struct {
		Valid bool `json:"valid"`
	}
	if code != 0 || json.Unmarshal([]byte(out), &report) != nil || !report.Valid {
		t.Fatalf("valid package: code %d, out %s", code, out)
	}

	dir := copyExample(t)
	secret := "AKIA" + strings.Repeat("Z", 16)
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("key "+secret+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	code, out, _ = harness("validate", "--json", dir)
	if code != 1 || !strings.Contains(out, `"code": "SH-SEC-002"`) || strings.Contains(out, secret) {
		t.Fatalf("package with secret: code %d, out %s", code, out)
	}

	if code, _, _ := harness("validate", filepath.Join(dir, "missing"), "--json"); code != 2 {
		t.Fatalf("missing directory: code %d, want 2", code)
	}
}

func TestGenerateUnknownTargetListsTheTargets(t *testing.T) {
	code, out, errOut := harness("generate", exampleDir, "--target", "codex")

	if code != 2 || out != "" {
		t.Fatalf("code %d, stdout %q", code, out)
	}
	if want := "harness: unknown target \"codex\"; available targets: claude-code\n"; errOut != want {
		t.Fatalf("stderr = %q, want %q", errOut, want)
	}
}

func TestGenerateWritesALayerThatValidates(t *testing.T) {
	dir := copyExample(t)

	code, out, errOut := harness("generate", dir, "--target", "claude-code")
	if code != 0 {
		t.Fatalf("generate: code %d, %s", code, errOut)
	}
	if want := ".claude-plugin/plugin.json\n.mcp.json\nagents/reviewer.md\nskills/code-review/SKILL.md\n"; out != want {
		t.Fatalf("stdout = %q", out)
	}
	if code, out, _ := harness("validate", dir); code != 0 {
		t.Fatalf("validate after generate: code %d, %s", code, out)
	}
	_, before, _ := harness("digest", dir)
	if code, _, _ := harness("generate", dir, "--target=claude-code"); code != 0 {
		t.Fatal("second generate failed")
	}
	if _, after, _ := harness("digest", dir); after != before {
		t.Fatalf("generate is not idempotent: %s then %s", before, after)
	}
}

func TestGenerateRewritesAStaleLayerButRefusesAnInvalidPackage(t *testing.T) {
	dir := copyExample(t)
	if code, _, _ := harness("generate", dir, "--target", "claude-code"); code != 0 {
		t.Fatal("generate failed")
	}
	if err := os.WriteFile(filepath.Join(dir, ".mcp.json"), []byte("{}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if code, _, _ := harness("generate", dir, "--target", "claude-code"); code != 0 {
		t.Fatal("stale layer blocked generate")
	}
	if code, _, _ := harness("validate", dir); code != 0 {
		t.Fatal("stale layer was not rewritten")
	}

	if err := os.WriteFile(filepath.Join(dir, "mcp.json"), []byte(`{"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json", "mcpServers": {"docs": {"type": "stdio", "command": "node"}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	code, _, errOut := harness("generate", dir, "--target", "claude-code")
	if code != 1 || !strings.Contains(errOut, "SH-MCP-002") || !strings.Contains(errOut, "nothing was generated") {
		t.Fatalf("invalid package: code %d, stderr %s", code, errOut)
	}
}

func TestPackUnpackDigestRoundTrip(t *testing.T) {
	work := t.TempDir()
	archive := filepath.Join(work, "example.tar.gz")

	code, packed, errOut := harness("pack", exampleDir, "-o", archive)
	if code != 0 {
		t.Fatalf("pack: %d %s", code, errOut)
	}
	dest := filepath.Join(work, "out")
	code, unpacked, errOut := harness("unpack", archive, dest, "--expect-digest", strings.TrimSpace(packed))
	if code != 0 {
		t.Fatalf("unpack: %d %s", code, errOut)
	}
	if data, err := os.ReadFile(archive); err != nil || "sha256:"+sha256Hex(data)+"\n" != packed {
		t.Fatalf("pack printed %q, not the sha256 of the archive bytes", packed)
	}
	_, source, _ := harness("digest", exampleDir)
	_, result, _ := harness("digest", dest)
	if packed != source || unpacked != source || result != source {
		t.Fatalf("digests: source %q, pack %q, unpack %q, result %q", source, packed, unpacked, result)
	}

	if code, _, _ := harness("unpack", archive, dest); code != 1 {
		t.Fatalf("unpack into a non-empty destination: code %d, want 1", code)
	}
	if code, _, _ := harness("unpack", archive, filepath.Join(work, "x"), "--expect-digest", "abc"); code != 2 {
		t.Fatalf("malformed --expect-digest: code %d, want 2", code)
	}
	if code, _, _ := harness("pack", exampleDir, "-o", filepath.Join(exampleDir, "x.tar.gz")); code != 2 {
		t.Fatalf("pack into the package: code %d, want 2", code)
	}
}

func TestCommandsRejectBadArguments(t *testing.T) {
	for _, args := range [][]string{
		{"validate"}, {"validate", "a", "b"}, {"validate", "a", "--nope"},
		{"generate", "a"}, {"generate", "a", "--target"},
		{"digest"}, {"pack", "a"}, {"unpack", "a"},
	} {
		if code, _, errOut := harness(args...); code != 2 || !strings.Contains(errOut, "usage:") {
			t.Errorf("args %q: code %d, stderr %q", args, code, errOut)
		}
	}
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
