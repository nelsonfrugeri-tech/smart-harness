package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/install"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/digest"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pack"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

// testToken is the canary: no command may print it.
const testToken = "shg_CANARYcanaryCANARYcanaryCANARYcanary1234567"

// TestMain points every directory the CLI writes at a temporary one, so no test can reach the
// real home, even one that forgets to call newEnv.
func TestMain(m *testing.M) {
	root, err := os.MkdirTemp("", "harness-test-home-")
	if err != nil {
		panic(err)
	}
	for k, v := range map[string]string{
		"HOME":                root,
		"HARNESS_CLAUDE_DIR":  filepath.Join(root, ".claude"),
		"HARNESS_CONFIG_DIR":  filepath.Join(root, ".config", "smart-harness"),
		"CLAUDE_CONFIG_DIR":   "",
		"SMART_HARNESS_TOKEN": "",
	} {
		os.Setenv(k, v)
	}
	code := m.Run()
	os.RemoveAll(root)
	os.Exit(code)
}

// version is one published plugin version in the fake API.
type published struct {
	componentKind string
	name, version string
	archive       []byte
	agent         string
}

func newVersion(t *testing.T, name, ver string, extra ...string) published {
	t.Helper()
	files := map[string]string{
		"plugin.json":                fmt.Sprintf(`{"name":%q,"version":%q}`, name, ver),
		".claude-plugin/plugin.json": fmt.Sprintf(`{"name":%q,"version":%q}`, name, ver),
		"skills/s/SKILL.md":          "---\nname: s\ndescription: " + name + " " + ver + "\n---\nbody\n",
	}
	for i := 0; i+1 < len(extra); i += 2 {
		files[extra[i]] = extra[i+1]
	}
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	var list []pkg.File
	for _, p := range paths {
		list = append(list, pkg.File{Path: p, Data: []byte(files[p])})
	}
	var buf bytes.Buffer
	if err := pack.Write(list, &buf); err != nil {
		t.Fatal(err)
	}
	return published{name: name, version: ver, archive: buf.Bytes()}
}

func (v published) digest() string { return digest.Of(v.archive) }

// fakeAPI serves the control plane routes the CLI uses, plus a gateway /healthz.
type fakeAPI struct {
	t        *testing.T
	api      *httptest.Server
	gateway  *httptest.Server
	mu       sync.Mutex
	plans    map[string][]published // project -> baseline
	optional map[string][]published // project -> optionals, served one per page
	drafts   map[string][]byte
	gets     map[string]int // archive path -> downloads
	badAuth  int
	gateways map[string]string // project -> gateway URL served instead of the fake gateway
	bodies   map[string][]byte // archive path -> body served instead of the published archive
}

func newFakeAPI(t *testing.T) *fakeAPI {
	f := &fakeAPI{t: t, plans: map[string][]published{}, optional: map[string][]published{}, drafts: map[string][]byte{}, gets: map[string]int{}, gateways: map[string]string{}, bodies: map[string][]byte{}}
	f.gateway = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			fmt.Fprint(w, `{"status":"ok"}`)
			return
		}
		http.NotFound(w, r)
	}))
	f.api = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(func() { f.api.Close(); f.gateway.Close() })
	return f
}

func (f *fakeAPI) setPlan(project string, vs ...published) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.plans[project] = vs
}

func (f *fakeAPI) downloads(v published) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.gets[archivePath(v)]
}

func archivePath(v published) string {
	return "/v1/plugins/" + v.name + "/versions/" + v.version + "/archive"
}

func item(v published) map[string]any {
	components := []map[string]any{{"kind": "skill", "name": "s", "description": ""}}
	if v.componentKind != "" {
		components = []map[string]any{{"kind": v.componentKind, "name": v.name}}
	}
	if v.agent != "" {
		components = append(components, map[string]any{"kind": "agent", "name": v.agent, "description": ""})
	}
	return map[string]any{
		"plugin":     map[string]any{"name": v.name, "description": "", "tenant": map[string]any{"slug": "t", "name": "T"}},
		"version":    map[string]any{"version": v.version, "visibility": "squad", "description": "", "digest": v.digest(), "size_bytes": len(v.archive), "published_at": "2026-10-21T00:00:00Z", "archive_url": archivePath(v)},
		"components": components,
	}
}

func (f *fakeAPI) problem(w http.ResponseWriter, status int, code, detail string) {
	w.Header().Set("content-type", "application/problem+json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"type": "about:blank", "title": code, "status": status, "code": code, "detail": detail, "correlation_id": "c"})
}

func (f *fakeAPI) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.URL.Path == "/healthz" {
		fmt.Fprint(w, `{"status":"ok"}`)
		return
	}
	if auth := r.Header.Get("Authorization"); auth != "Bearer "+testToken {
		f.badAuth++
		// A careless server that echoes the credential: the CLI must still not print it.
		f.problem(w, 401, "invalid_token", "token "+strings.TrimPrefix(auth, "Bearer ")+" is not valid")
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	switch {
	case r.URL.Path == "/v1/me/setup-plan":
		var n int
		fmt.Sscan(r.URL.Query().Get("cursor"), &n)
		json.NewEncoder(w).Encode(map[string]any{"gateway": map[string]any{"url": f.gateway.URL}, "optional": f.optionalPage("personal", n)})
	case r.URL.Path == "/v1/me":
		json.NewEncoder(w).Encode(map[string]any{"user": map[string]any{"id": "u", "email": "dev@example.test", "name": "Dev"}, "memberships": []any{}})
	case len(parts) == 4 && parts[1] == "projects" && parts[3] == "setup-plan":
		vs, ok := f.plans[parts[2]]
		if !ok {
			f.problem(w, 404, "not_found", "")
			return
		}
		baseline := []any{}
		for _, v := range vs {
			baseline = append(baseline, item(v))
		}
		gateway := f.gateway.URL
		if g, ok := f.gateways[parts[2]]; ok {
			gateway = g
		}
		json.NewEncoder(w).Encode(map[string]any{
			"project":  map[string]any{"slug": parts[2], "name": parts[2], "description": "", "tenant": map[string]any{"slug": "t", "name": "T"}},
			"gateway":  map[string]any{"url": gateway},
			"baseline": baseline,
			"optional": f.optionalPage(parts[2], 0),
		})
	case r.URL.Path == "/v1/marketplace":
		var n int
		fmt.Sscan(r.URL.Query().Get("cursor"), &n)
		json.NewEncoder(w).Encode(f.optionalPage(r.URL.Query().Get("project"), n))
	case len(parts) == 6 && parts[1] == "plugins" && parts[5] == "archive":
		for _, vs := range append(mapsValues(f.plans), mapsValues(f.optional)...) {
			for _, v := range vs {
				if archivePath(v) == r.URL.Path {
					f.gets[r.URL.Path]++
					body := v.archive
					if b, ok := f.bodies[r.URL.Path]; ok {
						body = b
					}
					w.Header().Set("x-package-digest", digest.Of(body))
					w.Header().Set("content-type", "application/gzip")
					w.Write(body)
					return
				}
			}
		}
		f.problem(w, 404, "not_found", "")
	case len(parts) == 4 && parts[1] == "drafts" && parts[3] == "archive":
		data, ok := f.drafts[parts[2]]
		if !ok {
			f.problem(w, 404, "not_found", "")
			return
		}
		w.Header().Set("x-package-digest", digest.Of(data))
		w.Header().Set("content-type", "application/gzip")
		w.Write(data)
	default:
		f.problem(w, 404, "not_found", "")
	}
}

// optionalPage serves one optional per page, so finding the second one needs the cursor.
func (f *fakeAPI) optionalPage(project string, n int) map[string]any {
	vs := f.optional[project]
	page := map[string]any{"items": []any{}, "next_cursor": nil}
	if n < len(vs) {
		page["items"] = []any{item(vs[n])}
	}
	if n+1 < len(vs) {
		page["next_cursor"] = fmt.Sprint(n + 1)
	}
	return page
}

func mapsValues(m map[string][]published) [][]published {
	out := make([][]published, 0, len(m))
	for _, v := range m {
		out = append(out, v)
	}
	return out
}

// env is one isolated machine: its own home, Claude dir and harness config dir.
type env struct {
	t         *testing.T
	claudeDir string
	configDir string
}

func newEnv(t *testing.T) env {
	t.Helper()
	home := t.TempDir()
	e := env{t: t, claudeDir: filepath.Join(home, ".claude"), configDir: filepath.Join(home, ".config", "smart-harness")}
	t.Setenv("HOME", home)
	t.Setenv("HARNESS_CLAUDE_DIR", e.claudeDir)
	t.Setenv("HARNESS_CONFIG_DIR", e.configDir)
	t.Setenv("SMART_HARNESS_TOKEN", "")
	return e
}

// runIn runs the CLI with the given stdin and asserts the canary never appears.
func (e env) run(input string, args ...string) (int, string, string) {
	e.t.Helper()
	old := stdin
	stdin = strings.NewReader(input)
	defer func() { stdin = old }()
	code, out, errOut := harness(args...)
	if strings.Contains(out, testToken) || strings.Contains(errOut, testToken) {
		e.t.Fatalf("harness %v printed the token:\nstdout: %s\nstderr: %s", args, out, errOut)
	}
	return code, out, errOut
}

func (e env) mustRun(input string, args ...string) string {
	e.t.Helper()
	code, out, errOut := e.run(input, args...)
	if code != 0 {
		e.t.Fatalf("harness %v: exit %d\nstdout: %s\nstderr: %s", args, code, out, errOut)
	}
	return out
}

func (e env) skill(name string) string {
	data, err := os.ReadFile(filepath.Join(e.claudeDir, "skills", name, "skills", "s", "SKILL.md"))
	if err != nil {
		return ""
	}
	return string(data)
}

type testConfig struct {
	APIURL     string `json:"api_url"`
	GatewayURL string `json:"gateway_url"`
	Plugins    map[string]struct {
		Version  string   `json:"version"`
		Digest   string   `json:"digest"`
		Projects []string `json:"projects"`
	} `json:"plugins"`
}

func (e env) config() testConfig {
	e.t.Helper()
	var c testConfig
	data, err := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	if err != nil {
		e.t.Fatal(err)
	}
	if err := json.Unmarshal(data, &c); err != nil {
		e.t.Fatal(err)
	}
	return c
}

func (e env) settings() map[string]any {
	e.t.Helper()
	var s map[string]any
	data, err := os.ReadFile(filepath.Join(e.claudeDir, "settings.json"))
	if err != nil {
		e.t.Fatal(err)
	}
	if err := json.Unmarshal(data, &s); err != nil {
		e.t.Fatal(err)
	}
	return s
}

func TestSetupInstallsBaselineAndWritesSettings(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	base := newVersion(t, "inv-base", "1.0.0")
	base.agent = "assistant"
	f.setPlan("inv", base)

	out := e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)

	if got := e.skill("inv-base"); !strings.Contains(got, "inv-base 1.0.0") {
		t.Fatalf("installed skill = %q", got)
	}
	if !strings.Contains(out, "claude --agent inv-base:assistant") {
		t.Fatalf("stdout does not say how to open the agent:\n%s", out)
	}
	envBlock := e.settings()["env"].(map[string]any)
	want := map[string]any{
		"SMART_HARNESS_TOKEN":       testToken,
		"ANTHROPIC_AUTH_TOKEN":      testToken,
		"ANTHROPIC_BASE_URL":        f.gateway.URL,
		"SMART_HARNESS_GATEWAY_URL": f.gateway.URL,
		"ANTHROPIC_API_KEY":         "",
	}
	for k, v := range want {
		if envBlock[k] != v {
			t.Errorf("env.%s = %v, want %v", k, envBlock[k], v)
		}
	}
	info, err := os.Stat(filepath.Join(e.claudeDir, "settings.json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("settings.json mode = %v, %v; want 0600", info.Mode().Perm(), err)
	}
	cfg := e.config()
	if cfg.APIURL != f.api.URL || cfg.GatewayURL != f.gateway.URL || cfg.Plugins["inv-base"].Digest != base.digest() {
		t.Fatalf("config = %+v", cfg)
	}
	data, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	if bytes.Contains(data, []byte(testToken)) {
		t.Fatal("config.json holds the token")
	}
}

func TestSetupSecondRunDoesNotDownload(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	base := newVersion(t, "inv-base", "1.0.0")
	f.setPlan("inv", base)
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	settingsBefore, _ := os.ReadFile(filepath.Join(e.claudeDir, "settings.json"))

	// No stdin: the token now comes from settings.json.
	out := e.mustRun("", "setup", "inv")

	if n := f.downloads(base); n != 1 {
		t.Fatalf("archive downloads = %d, want 1", n)
	}
	if !strings.Contains(out, "unchanged inv-base 1.0.0") || !strings.Contains(out, "unchanged "+filepath.Join(e.claudeDir, "settings.json")) {
		t.Fatalf("second setup output:\n%s", out)
	}
	settingsAfter, _ := os.ReadFile(filepath.Join(e.claudeDir, "settings.json"))
	if !bytes.Equal(settingsBefore, settingsAfter) {
		t.Fatal("settings.json changed on a second setup")
	}
	backups, _ := filepath.Glob(filepath.Join(e.claudeDir, "settings.json.harness-backup-*"))
	if len(backups) != 0 {
		t.Fatalf("backups = %v, want none when nothing changed", backups)
	}
}

func TestSetupPreservesOtherSettingsAndBacksUp(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	original := []byte(`{"model": "opus", "permissions": {"allow": ["Bash(ls)"]}, "env": {"FOO": "bar", "BIG": 1e3, "ANTHROPIC_API_KEY": "sk-old"}}` + "\n")
	if err := os.MkdirAll(e.claudeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(e.claudeDir, "settings.json"), original, 0o644); err != nil {
		t.Fatal(err)
	}

	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)

	raw, _ := os.ReadFile(filepath.Join(e.claudeDir, "settings.json"))
	s := e.settings()
	if s["model"] != "opus" || fmt.Sprint(s["permissions"]) != "map[allow:[Bash(ls)]]" {
		t.Fatalf("other keys lost: %s", raw)
	}
	envBlock := s["env"].(map[string]any)
	if envBlock["FOO"] != "bar" || envBlock["ANTHROPIC_API_KEY"] != "" {
		t.Fatalf("env = %v", envBlock)
	}
	if !bytes.Contains(raw, []byte(`"BIG": 1e3`)) {
		t.Fatalf("number rewritten: %s", raw)
	}
	backups, _ := filepath.Glob(filepath.Join(e.claudeDir, "settings.json.harness-backup-*"))
	if len(backups) != 1 {
		t.Fatalf("backups = %v, want 1", backups)
	}
	if got, _ := os.ReadFile(backups[0]); !bytes.Equal(got, original) {
		t.Fatalf("backup = %s, want the original", got)
	}
	if info, _ := os.Stat(backups[0]); info.Mode().Perm() != 0o600 {
		t.Fatalf("backup mode = %v", info.Mode().Perm())
	}
}

func TestSetupRefusesInvalidSettingsWithoutTouchingIt(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	os.MkdirAll(e.claudeDir, 0o755)
	broken := []byte(`{"env": [1]}`)
	os.WriteFile(filepath.Join(e.claudeDir, "settings.json"), broken, 0o644)

	code, _, errOut := e.run(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)

	if code != 1 || !strings.Contains(errOut, "env is not a JSON object") {
		t.Fatalf("exit %d, stderr %s", code, errOut)
	}
	if got, _ := os.ReadFile(filepath.Join(e.claudeDir, "settings.json")); !bytes.Equal(got, broken) {
		t.Fatalf("settings.json changed: %s", got)
	}
	if _, err := os.Stat(filepath.Join(e.claudeDir, "skills")); err == nil {
		t.Fatal("skills/ was written although settings.json is invalid")
	}
	if _, err := os.Stat(filepath.Join(e.configDir, "config.json")); err == nil {
		t.Fatal("config.json was written although settings.json is invalid")
	}
}

// An invalid settings.json found on a later run stops sync and setup before any plugin changes.
func TestInvalidSettingsStopsBeforeChangingPlugins(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	configBefore, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))
	broken := []byte(`{"env": []}`)
	os.WriteFile(filepath.Join(e.claudeDir, "settings.json"), broken, 0o600)
	t.Setenv("SMART_HARNESS_TOKEN", testToken)
	f.setPlan("inv", newVersion(t, "inv-base", "1.1.0"))

	for _, args := range [][]string{{"sync"}, {"setup", "inv"}} {
		code, _, errOut := e.run("", args...)
		if code != 1 || !strings.Contains(errOut, "env is not a JSON object") {
			t.Fatalf("%v: exit %d, stderr %s", args, code, errOut)
		}
	}
	if !strings.Contains(e.skill("inv-base"), "inv-base 1.0.0") {
		t.Fatalf("plugin changed: %q", e.skill("inv-base"))
	}
	if got, _ := os.ReadFile(filepath.Join(e.configDir, "config.json")); !bytes.Equal(got, configBefore) {
		t.Fatalf("config changed:\n%s", got)
	}
}

func TestSetupLeavesUnmanagedDirectoryAlone(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	mine := filepath.Join(e.claudeDir, "skills", "inv-base", "mine.txt")
	os.MkdirAll(filepath.Dir(mine), 0o755)
	os.WriteFile(mine, []byte("mine"), 0o644)

	code, _, errOut := e.run(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)

	if code != 1 || !strings.Contains(errOut, "was not installed by harness") {
		t.Fatalf("exit %d, stderr %s", code, errOut)
	}
	if got, err := os.ReadFile(mine); err != nil || string(got) != "mine" {
		t.Fatalf("unmanaged file = %q, %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(e.claudeDir, "settings.json")); err == nil {
		t.Fatal("settings.json written although setup failed")
	}
}

func TestSyncKeepsPluginSharedByTwoProjects(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	shared := newVersion(t, "shared", "1.0.0")
	onlyA := newVersion(t, "only-a", "1.0.0")
	f.setPlan("a", shared, onlyA)
	f.setPlan("b", shared)
	e.mustRun(testToken+"\n", "setup", "a", "--api-url", f.api.URL)
	e.mustRun("", "setup", "b")
	if got := e.config().Plugins["shared"].Projects; strings.Join(got, ",") != "a,b" {
		t.Fatalf("shared projects = %v", got)
	}

	f.setPlan("a")
	out := e.mustRun("", "sync")

	if e.skill("shared") == "" {
		t.Fatalf("shared was removed although b still uses it:\n%s", out)
	}
	if e.skill("only-a") != "" || !strings.Contains(out, "removed only-a") {
		t.Fatalf("only-a was not removed:\n%s", out)
	}
	if got := e.config().Plugins["shared"].Projects; strings.Join(got, ",") != "b" {
		t.Fatalf("shared projects = %v, want [b]", got)
	}

	f.setPlan("b")
	out = e.mustRun("", "sync")
	if e.skill("shared") != "" || !strings.Contains(out, "removed shared") {
		t.Fatalf("shared was not removed after leaving both projects:\n%s", out)
	}
}

func TestSyncRefusesDifferentDigestsBeforeChanging(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	v1 := newVersion(t, "shared", "1.0.0")
	f.setPlan("a", v1)
	e.mustRun(testToken+"\n", "setup", "a", "--api-url", f.api.URL)
	configBefore, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))

	f.setPlan("b", newVersion(t, "shared", "1.1.0"))
	code, _, errOut := e.run("", "setup", "b")

	if code != 1 || !strings.Contains(errOut, "one directory cannot hold both") {
		t.Fatalf("exit %d, stderr %s", code, errOut)
	}
	if !strings.Contains(e.skill("shared"), "shared 1.0.0") {
		t.Fatal("shared changed")
	}
	if got, _ := os.ReadFile(filepath.Join(e.configDir, "config.json")); !bytes.Equal(got, configBefore) {
		t.Fatalf("config changed:\n%s", got)
	}
}

func TestFailedSwapKeepsPreviousVersion(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	v1, v2 := newVersion(t, "inv-base", "1.0.0"), newVersion(t, "inv-base", "1.1.0")
	f.setPlan("inv", v1)
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)

	f.setPlan("inv", v2)
	realRename := install.Rename
	install.Rename = func(from, to string) error {
		if strings.Contains(filepath.Base(from), ".new-") { // moving the new version in
			return fmt.Errorf("injected failure")
		}
		return realRename(from, to)
	}
	code, _, errOut := e.run("", "sync")
	install.Rename = realRename

	if code != 1 || !strings.Contains(errOut, "injected failure") {
		t.Fatalf("exit %d, stderr %s", code, errOut)
	}
	if !strings.Contains(e.skill("inv-base"), "inv-base 1.0.0") {
		t.Fatalf("previous version not kept: %q", e.skill("inv-base"))
	}
	if got := e.config().Plugins["inv-base"].Version; got != "1.0.0" {
		t.Fatalf("config version = %s, want 1.0.0", got)
	}
	leftovers, _ := os.ReadDir(filepath.Join(e.claudeDir, "smart-harness-staging"))
	if len(leftovers) != 0 {
		t.Fatalf("staging leftovers: %v", leftovers)
	}

	e.mustRun("", "sync")
	if !strings.Contains(e.skill("inv-base"), "inv-base 1.1.0") {
		t.Fatal("update not applied after the failure")
	}
	f.setPlan("inv", v1) // rollback in the plan
	out := e.mustRun("", "sync")
	if !strings.Contains(e.skill("inv-base"), "inv-base 1.0.0") || !strings.Contains(out, "updated inv-base 1.1.0 -> 1.0.0") {
		t.Fatalf("rollback not applied:\n%s", out)
	}
}

func TestSetupIncludesOptionalFromLaterPage(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	f.optional["inv"] = []published{newVersion(t, "first", "1.0.0"), newVersion(t, "code-review", "1.0.0")}

	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL, "--include-optional", "code-review")

	if e.skill("code-review") == "" || e.skill("first") != "" {
		t.Fatalf("optional install: code-review=%q first=%q", e.skill("code-review"), e.skill("first"))
	}
	code, _, errOut := e.run("", "setup", "inv", "--include-optional", "nope")
	if code != 1 || !strings.Contains(errOut, "has no optional nope") {
		t.Fatalf("exit %d, stderr %s", code, errOut)
	}
}

func TestCommandsWorkWithTokenFromSettingsOnly(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	f.drafts["d1"] = newVersion(t, "draft", "0.1.0").archive
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	t.Setenv("HARNESS_CLAUDE_BIN", fakeClaude(t, "2.1.305 (Claude Code)"))

	e.mustRun("", "sync")
	e.mustRun("", "draft", "pull", "d1")
	out := e.mustRun("", "doctor")

	if !strings.Contains(out, "valid for dev@example.test (from "+filepath.Join(e.claudeDir, "settings.json")+")") {
		t.Fatalf("doctor:\n%s", out)
	}
	if f.badAuth != 0 {
		t.Fatalf("%d requests without the right token", f.badAuth)
	}
}

func TestTokenNeverPrinted(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	t.Setenv("HARNESS_CLAUDE_BIN", fakeClaude(t, "2.1.305 (Claude Code)"))

	// Success paths.
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	e.mustRun("", "sync")
	e.mustRun("", "doctor")

	// Failure paths: the fake API echoes a rejected token in its error detail.
	wrong := "shg_" + strings.Repeat("W", 43)
	t.Setenv("SMART_HARNESS_TOKEN", wrong)
	if code, _, errOut := e.run("", "sync"); code != 1 || !strings.Contains(errOut, "was rejected") || strings.Contains(errOut, wrong) {
		t.Fatalf("wrong token: exit %d, stderr %s", code, errOut)
	}
	if code, out, _ := e.run("", "doctor"); code != 1 || strings.Contains(out, wrong) {
		t.Fatalf("doctor with wrong token: exit %d, out %s", code, out)
	}
	t.Setenv("SMART_HARNESS_TOKEN", "")
	if code, _, _ := e.run("", "draft", "pull", "missing"); code != 1 {
		t.Fatalf("draft pull of a missing draft: exit %d", code)
	}
}

func TestDraftPullIsRepeatable(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	f.drafts["d1"] = newVersion(t, "draft", "0.1.0").archive
	dir := filepath.Join(e.configDir, "drafts", "d1")

	out := e.mustRun("", "draft", "pull", "d1")
	if !strings.Contains(out, "pulled "+dir) || !strings.Contains(out, "claude --plugin-dir "+dir) {
		t.Fatalf("first pull:\n%s", out)
	}
	if out := e.mustRun("", "draft", "pull", "d1"); !strings.Contains(out, "unchanged "+dir) {
		t.Fatalf("second pull:\n%s", out)
	}
	f.drafts["d1"] = newVersion(t, "draft", "0.2.0").archive
	e.mustRun("", "draft", "pull", "d1")
	if got, _ := os.ReadFile(filepath.Join(dir, "plugin.json")); !strings.Contains(string(got), "0.2.0") {
		t.Fatalf("draft not replaced: %s", got)
	}

	other := filepath.Join(t.TempDir(), "busy")
	os.MkdirAll(other, 0o755)
	os.WriteFile(filepath.Join(other, "x"), []byte("x"), 0o644)
	code, _, errOut := e.run("", "draft", "pull", "d1", "--dir", other)
	if code != 1 || !strings.Contains(errOut, "was not pulled by harness") {
		t.Fatalf("busy --dir: exit %d, stderr %s", code, errOut)
	}
	if _, err := os.Stat(filepath.Join(other, "x")); err != nil {
		t.Fatal("busy --dir was touched")
	}
}

func TestDoctorReportsFailuresWithFixes(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)

	t.Setenv("HARNESS_CLAUDE_BIN", fakeClaude(t, "2.1.305 (Claude Code)"))
	if out := e.mustRun("", "doctor"); strings.Contains(out, "FAIL") {
		t.Fatalf("healthy doctor:\n%s", out)
	}

	t.Setenv("HARNESS_CLAUDE_BIN", fakeClaude(t, "2.1.200 (Claude Code)"))
	os.WriteFile(filepath.Join(e.claudeDir, "skills", "inv-base", "skills", "s", "SKILL.md"), []byte("edited"), 0o644)
	f.setPlan("inv", newVersion(t, "inv-base", "1.1.0"))
	f.gateway.Close()

	code, out, _ := e.run("", "doctor")
	if code != 1 {
		t.Fatalf("exit %d", code)
	}
	for _, want := range []string{
		"FAIL  claude-code: version \"2.1.200 (Claude Code)\" is below the minimum 2.1.305",
		"FAIL  gateway:",
		"FAIL  plugin inv-base:",
		"FAIL  plan: pending: update inv-base",
		"fix: run harness sync",
		"ok    token:",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("doctor output lacks %q:\n%s", want, out)
		}
	}
}

// fakeClaude writes an executable that prints version and returns its path.
func fakeClaude(t *testing.T, version string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "claude")
	if err := os.WriteFile(path, []byte("#!/bin/sh\necho '"+version+"'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestVersionAtLeast(t *testing.T) {
	for got, want := range map[string]bool{
		"2.1.305 (Claude Code)": true, "2.1.306": true, "2.2.0": true, "3.0.0": true,
		"2.1.304": false, "2.0.999": false, "1.9.9": false, "garbage": false, "": false,
	} {
		if versionAtLeast(got, minClaudeVersion) != want {
			t.Errorf("versionAtLeast(%q) = %v, want %v", got, !want, want)
		}
	}
}

// The archive must be the one the plan names: another archive, even with a header that matches
// its own body, is refused before anything is installed.
func TestArchiveOtherThanThePlanIsRefused(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	v1, v2 := newVersion(t, "inv-base", "1.0.0"), newVersion(t, "inv-base", "1.1.0")
	f.setPlan("inv", v1)
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	configBefore, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))

	f.setPlan("inv", v2)
	f.bodies[archivePath(v2)] = newVersion(t, "inv-base", "6.6.6").archive
	code, _, errOut := e.run("", "sync")

	if code != 1 || !strings.Contains(errOut, "does not match the plan digest") {
		t.Fatalf("exit %d, stderr %s", code, errOut)
	}
	if got := e.skill("inv-base"); !strings.Contains(got, "inv-base 1.0.0") {
		t.Fatalf("installed skill = %q, want 1.0.0 kept", got)
	}
	if got, _ := os.ReadFile(filepath.Join(e.configDir, "config.json")); !bytes.Equal(got, configBefore) {
		t.Fatalf("config changed:\n%s", got)
	}

	// On a first setup nothing is installed and no config is written.
	e2 := newEnv(t)
	f.setPlan("other", v2)
	code, _, errOut = e2.run(testToken+"\n", "setup", "other", "--api-url", f.api.URL)
	if code != 1 || !strings.Contains(errOut, "does not match the plan digest") {
		t.Fatalf("first setup: exit %d, stderr %s", code, errOut)
	}
	if entries, _ := os.ReadDir(filepath.Join(e2.claudeDir, "skills")); len(entries) != 0 {
		t.Fatalf("skills/ = %v, want empty", entries)
	}
	if _, err := os.Stat(filepath.Join(e2.configDir, "config.json")); err == nil {
		t.Fatal("config.json written although the archive was refused")
	}
}

func TestDraftPullKeepsSiblingDirectories(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	work := t.TempDir()
	dest := filepath.Join(work, "mydraft")
	precious := filepath.Join(work, "mydraft.previous", "precious.txt")
	os.MkdirAll(filepath.Dir(precious), 0o755)
	os.WriteFile(precious, []byte("mine"), 0o644)

	f.drafts["d1"] = newVersion(t, "draft", "0.1.0").archive
	e.mustRun("", "draft", "pull", "d1", "--dir", dest)
	f.drafts["d1"] = newVersion(t, "draft", "0.2.0").archive
	e.mustRun("", "draft", "pull", "d1", "--dir", dest)

	if got, err := os.ReadFile(precious); err != nil || string(got) != "mine" {
		t.Fatalf("sibling file = %q, %v; want it untouched", got, err)
	}
	if got, _ := os.ReadFile(filepath.Join(dest, "plugin.json")); !strings.Contains(string(got), "0.2.0") {
		t.Fatalf("draft not replaced: %s", got)
	}
	entries, _ := os.ReadDir(work)
	var names []string
	for _, en := range entries {
		names = append(names, en.Name())
	}
	if strings.Join(names, ",") != "mydraft,mydraft.previous" {
		t.Fatalf("entries next to the draft = %v, want only mydraft and mydraft.previous", names)
	}
}

func TestSyncReinstallsPluginChangedByHand(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	skill := filepath.Join(e.claudeDir, "skills", "inv-base", "skills", "s", "SKILL.md")
	os.WriteFile(skill, []byte("edited"), 0o644)

	out := e.mustRun("", "sync")

	if !strings.Contains(out, "updated inv-base 1.0.0 -> 1.0.0") || !strings.Contains(e.skill("inv-base"), "inv-base 1.0.0") {
		t.Fatalf("hand-edited plugin not reinstalled (skill %q):\n%s", e.skill("inv-base"), out)
	}
}

func TestProjectsWithDifferentGatewaysAreRefused(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("a", newVersion(t, "only-a", "1.0.0"))
	f.setPlan("b", newVersion(t, "only-b", "1.0.0"))
	f.gateways["b"] = "http://127.0.0.1:1"
	e.mustRun(testToken+"\n", "setup", "a", "--api-url", f.api.URL)
	configBefore, _ := os.ReadFile(filepath.Join(e.configDir, "config.json"))

	code, _, errOut := e.run("", "setup", "b")

	if code != 1 || !strings.Contains(errOut, "uses gateway http://127.0.0.1:1, but another configured project uses") {
		t.Fatalf("exit %d, stderr %s", code, errOut)
	}
	if e.skill("only-b") != "" {
		t.Fatal("only-b installed although the gateways differ")
	}
	if got, _ := os.ReadFile(filepath.Join(e.configDir, "config.json")); !bytes.Equal(got, configBefore) {
		t.Fatalf("config changed:\n%s", got)
	}
}

func TestSyncMovesTheGatewayAndSaysSo(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	out := e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	if !strings.Contains(out, "gateway "+f.gateway.URL+"\n") {
		t.Fatalf("first setup does not show the gateway:\n%s", out)
	}

	moved := "https://gateway.example.test"
	f.gateways["inv"] = moved
	out = e.mustRun("", "sync")

	if !strings.Contains(out, "gateway "+f.gateway.URL+" -> "+moved) {
		t.Fatalf("sync does not show the gateway change:\n%s", out)
	}
	envBlock := e.settings()["env"].(map[string]any)
	if envBlock["ANTHROPIC_BASE_URL"] != moved || envBlock["SMART_HARNESS_GATEWAY_URL"] != moved {
		t.Fatalf("settings env = %v, want the new gateway", envBlock)
	}
	if out := e.mustRun("", "sync"); strings.Contains(out, "gateway ") {
		t.Fatalf("sync without a change mentions the gateway:\n%s", out)
	}
}

func TestPlainHTTPOutsideLoopbackIsRefused(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))

	code, _, errOut := e.run(testToken+"\n", "setup", "inv", "--api-url", "http://api.example.test")
	if code != 2 || !strings.Contains(errOut, "must use https") {
		t.Fatalf("http API: exit %d, stderr %s", code, errOut)
	}

	f.gateways["inv"] = "http://gateway.example.test"
	code, _, errOut = e.run(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	if code != 1 || !strings.Contains(errOut, "must use https") {
		t.Fatalf("http gateway: exit %d, stderr %s", code, errOut)
	}
	if _, err := os.Stat(filepath.Join(e.claudeDir, "settings.json")); err == nil {
		t.Fatal("settings.json written with an http gateway")
	}
}

func TestSyncRecreatesSettingsWithTheToken(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	os.Remove(filepath.Join(e.claudeDir, "settings.json"))
	t.Setenv("SMART_HARNESS_TOKEN", testToken)

	e.mustRun("", "sync")

	envBlock := e.settings()["env"].(map[string]any)
	for k, v := range map[string]any{
		"SMART_HARNESS_TOKEN":       testToken,
		"ANTHROPIC_AUTH_TOKEN":      testToken,
		"ANTHROPIC_BASE_URL":        f.gateway.URL,
		"SMART_HARNESS_GATEWAY_URL": f.gateway.URL,
		"ANTHROPIC_API_KEY":         "",
	} {
		if envBlock[k] != v {
			t.Errorf("env.%s = %v, want %v", k, envBlock[k], v)
		}
	}
}

func TestDoctorFailsWhenAnAPIKeyBypassesTheGateway(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	t.Setenv("HARNESS_CLAUDE_BIN", fakeClaude(t, "2.1.305 (Claude Code)"))
	s := e.settings()
	s["env"].(map[string]any)["ANTHROPIC_API_KEY"] = "sk-direct"
	data, _ := json.Marshal(s)
	os.WriteFile(filepath.Join(e.claudeDir, "settings.json"), data, 0o600)

	code, out, _ := e.run("", "doctor")

	if code != 1 || !strings.Contains(out, "FAIL  settings: ANTHROPIC_API_KEY is not empty") {
		t.Fatalf("exit %d:\n%s", code, out)
	}
}

func TestConcurrentCommandIsRefusedWhileTheLockIsHeld(t *testing.T) {
	e := newEnv(t)
	f := newFakeAPI(t)
	f.setPlan("inv", newVersion(t, "inv-base", "1.0.0"))
	e.mustRun(testToken+"\n", "setup", "inv", "--api-url", f.api.URL)
	lock := filepath.Join(e.configDir, "harness.lock")
	if _, err := os.Stat(lock); err == nil {
		t.Fatal("lock left behind after a successful setup")
	}
	os.WriteFile(lock, []byte("12345\n"), 0o600)

	for _, args := range [][]string{{"sync"}, {"setup", "inv"}, {"draft", "pull", "d1"}} {
		code, _, errOut := e.run("", args...)
		if code != 1 || !strings.Contains(errOut, "another harness command is running") || !strings.Contains(errOut, lock) {
			t.Fatalf("%v: exit %d, stderr %s", args, code, errOut)
		}
	}
	if got, _ := os.ReadFile(lock); string(got) != "12345\n" {
		t.Fatalf("lock of the other command was changed: %q", got)
	}
	os.Remove(lock)
	e.mustRun("", "sync")
	if _, err := os.Stat(lock); err == nil {
		t.Fatal("lock left behind after a successful sync")
	}
}
