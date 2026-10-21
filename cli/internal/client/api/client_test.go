package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/digest"
)

// A body whose header matches it is still refused when it is not the archive the plan names.
func TestPluginArchiveRejectsDigestOtherThanThePlan(t *testing.T) {
	body := []byte("another archive")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(DigestHeader, digest.Of(body))
		w.Write(body)
	}))
	defer srv.Close()
	c, _ := New(srv.URL, "shg_x")
	it := PluginItem{}
	it.Version.ArchiveURL = "/v1/plugins/p/versions/1.0.0/archive"
	it.Version.Digest = digest.Of([]byte("the planned archive"))

	if _, err := c.PluginArchive(it); err == nil || !strings.Contains(err.Error(), "does not match the plan digest") {
		t.Fatalf("err = %v", err)
	}
}

func TestParseBaseURLRequiresHTTPSOutsideLoopback(t *testing.T) {
	for raw, ok := range map[string]bool{
		"https://api.example.test":      true,
		"http://127.0.0.1:8080":         true,
		"http://127.0.0.1":              true,
		"http://[::1]:8080":             true,
		"http://localhost:8080":         true,
		"http://api.example.test":       false,
		"http://10.0.0.5:8080":          false,
		"http://localhost.example.test": false,
		"ftp://127.0.0.1":               false,
		"https://user@api.example.test": false,
	} {
		_, err := ParseBaseURL(raw)
		if (err == nil) != ok {
			t.Errorf("ParseBaseURL(%q) err = %v, want ok=%v", raw, err, ok)
		}
	}
	if _, err := ParseBaseURL("http://api.example.test"); err == nil || !strings.Contains(err.Error(), "must use https") {
		t.Fatalf("err = %v", err)
	}
}

func TestCheckItemRejectsUnsafeValues(t *testing.T) {
	good := PluginItem{}
	good.Plugin.Name = "p"
	good.Version.Version = "1.0.0"
	good.Version.Digest = "sha256:" + strings.Repeat("a", 64)
	good.Version.ArchiveURL = "/v1/plugins/p/versions/1.0.0/archive"
	if err := checkItem(good); err != nil {
		t.Fatalf("valid item: %v", err)
	}
	for name, mutate := range map[string]func(*PluginItem){
		"path traversal name":   func(it *PluginItem) { it.Plugin.Name = "../x" },
		"absolute archive url":  func(it *PluginItem) { it.Version.ArchiveURL = "https://evil.example/a" },
		"protocol-relative url": func(it *PluginItem) { it.Version.ArchiveURL = "//evil.example/a" },
		"bad digest":            func(it *PluginItem) { it.Version.Digest = "sha256:XYZ" },
	} {
		it := good
		mutate(&it)
		if err := checkItem(it); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// The token must not follow a redirect to another origin.
func TestRedirectIsNotFollowed(t *testing.T) {
	var leaked bool
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leaked = r.Header.Get("Authorization") != ""
	}))
	defer other.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/v1/me", http.StatusFound)
	}))
	defer srv.Close()
	c, err := New(srv.URL, "shg_x")
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.Me()
	if !IsStatus(err, http.StatusFound) || leaked {
		t.Fatalf("err = %v, leaked = %v", err, leaked)
	}
}

func TestArchiveChecksHeaderAgainstBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set(DigestHeader, "sha256:"+strings.Repeat("0", 64))
		fmt.Fprint(w, "body")
	}))
	defer srv.Close()
	c, _ := New(srv.URL, "shg_x")
	if _, _, err := c.DraftArchive("d1"); err == nil || !strings.Contains(err.Error(), "does not match header") {
		t.Fatalf("err = %v", err)
	}
}
