package main

import (
	"bytes"
	"testing"
)

func TestVersionPrintsVersionAndCommit(t *testing.T) {
	version, commit = "1.2.3", "abc1234"
	var stdout, stderr bytes.Buffer

	code := run([]string{"version"}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if got, want := stdout.String(), "harness 1.2.3 (commit abc1234)\n"; got != want {
		t.Fatalf("stdout = %q, want %q", got, want)
	}
	if stderr.Len() != 0 {
		t.Fatalf("unexpected stderr: %q", stderr.String())
	}
}

func TestUnknownOrMissingCommandPrintsUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"nope"}, {"version", "extra"}} {
		var stdout, stderr bytes.Buffer

		code := run(args, &stdout, &stderr)

		if code != 2 {
			t.Errorf("args %q: exit code = %d, want 2", args, code)
		}
		if got, want := stderr.String(), usage+"\n"; got != want {
			t.Errorf("args %q: stderr = %q, want %q", args, got, want)
		}
		if stdout.Len() != 0 {
			t.Errorf("args %q: unexpected stdout: %q", args, stdout.String())
		}
	}
}
