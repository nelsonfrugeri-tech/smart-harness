package main

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
)

const contributionsDir = "../../../marketplace/contributions"

// TestExampleContributions runs the real validator over the example contributions:
// the valid one has no findings and each variant fails with exactly one expected code.
func TestExampleContributions(t *testing.T) {
	cases := []struct {
		dir       string
		wantCodes []string
	}{
		{"valid", []string{}},
		{"invalid-literal-secret", []string{"SH-SEC-001"}},
		{"invalid-external-mcp", []string{"SH-MCP-001"}},
		{"invalid-stdio", []string{"SH-MCP-002"}},
		{"invalid-name", []string{"SH-NAM-001"}},
	}
	for _, tc := range cases {
		t.Run(tc.dir, func(t *testing.T) {
			code, out, errOut := harness("validate", filepath.Join(contributionsDir, tc.dir), "--json")

			var report struct {
				Valid    bool `json:"valid"`
				Findings []struct {
					Code string `json:"code"`
				} `json:"findings"`
			}
			if err := json.Unmarshal([]byte(out), &report); err != nil {
				t.Fatalf("invalid report: %v\nstdout: %s\nstderr: %s", err, out, errOut)
			}
			got := []string{}
			for _, f := range report.Findings {
				got = append(got, f.Code)
			}
			wantExit := 0
			if len(tc.wantCodes) > 0 {
				wantExit = 1
			}
			if code != wantExit || report.Valid != (wantExit == 0) || !reflect.DeepEqual(got, tc.wantCodes) {
				t.Fatalf("exit %d valid %v codes %v; want exit %d codes %v\n%s", code, report.Valid, got, wantExit, tc.wantCodes, out)
			}
		})
	}
}
