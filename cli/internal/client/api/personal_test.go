package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPersonalPlanChecksItemsAndEncodesCursor(t *testing.T) {
	requestedCursor := "next&project=private"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/me/setup-plan" || r.URL.Query().Get("cursor") != requestedCursor || r.URL.Query().Get("project") != "" {
			t.Errorf("unexpected URL %s", r.URL)
		}
		item := PluginItem{}
		item.Plugin.Name = "github"
		item.Version.Version = "1.0.0"
		item.Version.Digest = "sha256:" + strings.Repeat("a", 64)
		item.Version.ArchiveURL = "https://untrusted.example.test/archive"
		plan := SetupPlan{}
		plan.Gateway.URL = "https://gateway.example.test"
		plan.Optional.Items = []PluginItem{item}
		json.NewEncoder(w).Encode(plan)
	}))
	defer srv.Close()
	client, _ := New(srv.URL, "test-token")
	if _, err := client.PersonalPlan(requestedCursor); err == nil || !strings.Contains(err.Error(), "outside the API") {
		t.Fatalf("err=%v", err)
	}
}
