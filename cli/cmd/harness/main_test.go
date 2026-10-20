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
		t.Fatalf("código de saída = %d, esperado 0", code)
	}
	if got, want := stdout.String(), "harness 1.2.3 (commit abc1234)\n"; got != want {
		t.Fatalf("stdout = %q, esperado %q", got, want)
	}
	if stderr.Len() != 0 {
		t.Fatalf("stderr inesperado: %q", stderr.String())
	}
}

func TestUnknownOrMissingCommandPrintsUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"nope"}, {"version", "extra"}} {
		var stdout, stderr bytes.Buffer

		code := run(args, &stdout, &stderr)

		if code != 2 {
			t.Errorf("args %q: código de saída = %d, esperado 2", args, code)
		}
		if got, want := stderr.String(), usage+"\n"; got != want {
			t.Errorf("args %q: stderr = %q, esperado %q", args, got, want)
		}
		if stdout.Len() != 0 {
			t.Errorf("args %q: stdout inesperado: %q", args, stdout.String())
		}
	}
}
