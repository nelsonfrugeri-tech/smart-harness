package reconcile

import (
	"fmt"
	"strings"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
)

type personalPages struct {
	calls  int
	repeat bool
}

func (*personalPages) SetupPlan(string) (api.SetupPlan, error)      { panic("unexpected legacy access") }
func (*personalPages) Optionals(string, string) (api.Page, error)   { panic("unexpected legacy access") }
func (*personalPages) PluginArchive(api.PluginItem) ([]byte, error) { panic("unexpected download") }
func (s *personalPages) PersonalPlan(string) (api.SetupPlan, error) {
	s.calls++
	cursor := fmt.Sprint(s.calls)
	if s.repeat {
		cursor = "same"
	}
	plan := api.SetupPlan{}
	plan.Gateway.URL = "https://gateway.example.test"
	plan.Optional.NextCursor = &cursor
	return plan, nil
}
func TestPersonalPaginationIsBounded(t *testing.T) {
	for _, tc := range []struct {
		repeat    bool
		wantCalls int
		message   string
	}{{true, 2, "repeated a cursor"}, {false, 100, "more than 100 pages"}} {
		source := &personalPages{repeat: tc.repeat}
		_, err := ResolveConfigured(source, local.Config{PersonalPlugins: []string{"missing"}})
		if err == nil || !strings.Contains(err.Error(), tc.message) || source.calls != tc.wantCalls {
			t.Fatalf("err=%v calls=%d", err, source.calls)
		}
	}
}
