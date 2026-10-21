package digest

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

// Expected values computed outside Go, with shasum (see cli/README.md):
//
//	printf 'a.txt\0%s\nb/c.txt\0%s\n' "$(printf a | shasum -a 256 | cut -d' ' -f1)" "$(printf c | shasum -a 256 | cut -d' ' -f1)" | shasum -a 256
const vectorDigest = "sha256:5cda975e9b1fd182da45469f652abea35df6cb0b03b11802a3868e1655fe3b3e"

// Digest of testdata/packages/example, computed with find, sort and shasum. CI runs this test on
// Linux and developers on macOS, so it pins the same digest on both.
const exampleDigest = "sha256:15f92f61880d0c15661def95428f3003ff92b767aec17a1f1afcb2553b2405ab"

func TestFixedVector(t *testing.T) {
	got := Files([]pkg.File{{Path: "b/c.txt", Data: []byte("c")}, {Path: "a.txt", Data: []byte("a")}})

	if got != vectorDigest {
		t.Fatalf("digest = %s, want %s", got, vectorDigest)
	}
}

func TestExamplePackageDigest(t *testing.T) {
	got, err := Dir(filepath.Join("..", "testdata", "packages", "example"))
	if err != nil {
		t.Fatal(err)
	}
	if got != exampleDigest {
		t.Fatalf("digest = %s, want %s", got, exampleDigest)
	}
}

func TestModeAndEmptyDirectoriesDoNotChangeTheDigest(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "a.txt"), "a")
	write(t, filepath.Join(dir, "b", "c.txt"), "c")
	if err := os.Chmod(filepath.Join(dir, "a.txt"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := Dir(dir)

	if err != nil {
		t.Fatal(err)
	}
	if got != vectorDigest {
		t.Fatalf("digest = %s, want %s", got, vectorDigest)
	}
}

func TestContentChangeChangesTheDigest(t *testing.T) {
	got := Files([]pkg.File{{Path: "a.txt", Data: []byte("b")}, {Path: "b/c.txt", Data: []byte("c")}})
	if got == vectorDigest {
		t.Fatal("different content gave the same digest")
	}
}

func TestSymlinkIsAnError(t *testing.T) {
	dir := t.TempDir()
	write(t, filepath.Join(dir, "a.txt"), "a")
	if err := os.Symlink("a.txt", filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	if _, err := Dir(dir); err == nil {
		t.Fatal("symlink was accepted")
	}
}

func write(t *testing.T, path, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}
