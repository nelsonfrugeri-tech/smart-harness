package install

import (
	"os"
	"path/filepath"
	"testing"
)

func newStore(t *testing.T) Store {
	root := t.TempDir()
	return Store{SkillsDir: filepath.Join(root, "skills"), StagingDir: filepath.Join(root, "staging")}
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

func read(path string) string {
	data, _ := os.ReadFile(path)
	return string(data)
}

func TestSwapReplacesExistingDirectory(t *testing.T) {
	s := newStore(t)
	write(t, filepath.Join(s.Dir("p"), "v"), "old")
	staged := filepath.Join(s.StagingDir, "p.new-1")
	write(t, filepath.Join(staged, "v"), "new")

	if err := s.Swap("p", staged); err != nil {
		t.Fatal(err)
	}
	if got := read(filepath.Join(s.Dir("p"), "v")); got != "new" {
		t.Fatalf("installed = %q, want new", got)
	}
	if entries, _ := os.ReadDir(s.StagingDir); len(entries) != 0 {
		t.Fatalf("staging not empty: %v", entries)
	}
}

// A crash after the current version was moved aside and before the new one moved in leaves the
// plugin directory missing; Recover puts the previous version back.
func TestRecoverRestoresPreviousAfterCrash(t *testing.T) {
	s := newStore(t)
	write(t, filepath.Join(s.StagingDir, "p"+previousSuffix, "v"), "old")
	write(t, filepath.Join(s.StagingDir, "p.new-123", "v"), "new")
	write(t, filepath.Join(s.Dir("q"), "v"), "q")
	write(t, filepath.Join(s.StagingDir, "q"+previousSuffix, "v"), "stale")

	if err := s.Recover(); err != nil {
		t.Fatal(err)
	}
	if got := read(filepath.Join(s.Dir("p"), "v")); got != "old" {
		t.Fatalf("p = %q, want the previous version back", got)
	}
	if got := read(filepath.Join(s.Dir("q"), "v")); got != "q" {
		t.Fatalf("q = %q, want it untouched", got)
	}
	if entries, _ := os.ReadDir(s.StagingDir); len(entries) != 0 {
		t.Fatalf("staging leftovers: %v", entries)
	}
}

func TestRemoveDeletesDirectory(t *testing.T) {
	s := newStore(t)
	write(t, filepath.Join(s.Dir("p"), "v"), "x")
	if err := s.Remove("p"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.Exists("p"); ok {
		t.Fatal("p still exists")
	}
	if err := s.Remove("p"); err != nil {
		t.Fatalf("removing a missing plugin: %v", err)
	}
}
