package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/reconcile"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pack"
)

// minClaudeVersion is the version tested in spike H1; older ones were not tested.
const minClaudeVersion = "2.1.305"

// envClaudeBin overrides the Claude Code executable (default "claude" on PATH).
const envClaudeBin = "HARNESS_CLAUDE_BIN"

var versionPrefixRe = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)`)

// check is one doctor line: ok with a detail, or a failure with what to do.
type check struct {
	name, detail, fix string
	ok                bool
}

// runDoctor prints one line per check. Exit 0 when every check passes, 1 otherwise.
func runDoctor(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, nil, nil)
	if err != nil || len(a.positional) != 0 {
		return usageError(stderr, errText(err))
	}
	s, err := openSession()
	if err != nil {
		return failure(stderr, exitUsage, err)
	}
	token, source, tokenErr := s.token()
	stdout = redact(stdout, token)
	checks := []check{claudeCheck()}
	checks = append(checks, configCheck(s))
	checks = append(checks, healthCheck("api", s.cfg.APIURL, "start the API or fix api_url in "+s.paths.ConfigFile()))
	checks = append(checks, tokenCheck(s, token, source, tokenErr))
	checks = append(checks, healthCheck("gateway", s.cfg.GatewayURL, "start the gateway, then run harness sync to refresh its URL"))
	checks = append(checks, settingsCheck(s))
	checks = append(checks, pluginChecks(s)...)
	if tokenErr == nil {
		checks = append(checks, planCheck(s, token))
	}
	failed := 0
	for _, c := range checks {
		if c.ok {
			fmt.Fprintf(stdout, "ok    %s: %s\n", c.name, c.detail)
			continue
		}
		failed++
		fmt.Fprintf(stdout, "FAIL  %s: %s\n      fix: %s\n", c.name, c.detail, c.fix)
	}
	if failed > 0 {
		fmt.Fprintf(stdout, "%d check(s) failed\n", failed)
		return exitFailure
	}
	return exitOK
}

func claudeCheck() check {
	c := check{name: "claude-code", fix: "install or update Claude Code to " + minClaudeVersion + " or later (claude update)"}
	bin := os.Getenv(envClaudeBin)
	if bin == "" {
		bin = "claude"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, "--version").Output()
	if err != nil {
		c.detail = fmt.Sprintf("cannot run %s --version: %v", bin, err)
		return c
	}
	got := strings.TrimSpace(string(out))
	if !versionAtLeast(got, minClaudeVersion) {
		c.detail = fmt.Sprintf("version %q is below the minimum %s", got, minClaudeVersion)
		return c
	}
	c.ok, c.detail = true, got
	return c
}

// versionAtLeast compares the leading x.y.z of got with min. An unparsable version fails.
func versionAtLeast(got, min string) bool {
	g, m := versionPrefixRe.FindStringSubmatch(got), versionPrefixRe.FindStringSubmatch(min)
	if g == nil || m == nil {
		return false
	}
	for i := 1; i <= 3; i++ {
		gi, _ := strconv.Atoi(g[i])
		mi, _ := strconv.Atoi(m[i])
		if gi != mi {
			return gi > mi
		}
	}
	return true
}

func configCheck(s *session) check {
	c := check{name: "config", fix: "run harness setup <project> --api-url <url>"}
	if s.cfg.APIURL == "" || len(s.cfg.Projects) == 0 {
		c.detail = "no project configured in " + s.paths.ConfigFile()
		return c
	}
	slugs := make([]string, 0, len(s.cfg.Projects))
	for slug := range s.cfg.Projects {
		slugs = append(slugs, slug)
	}
	sort.Strings(slugs)
	c.ok, c.detail = true, "projects "+strings.Join(slugs, ", ")
	return c
}

func healthCheck(name, url, fix string) check {
	c := check{name: name, fix: fix}
	if url == "" {
		c.detail, c.fix = "no URL configured", "run harness setup <project> --api-url <url>"
		return c
	}
	if err := api.Healthy(url); err != nil {
		c.detail = fmt.Sprintf("%s is not reachable: %v", url, err)
		return c
	}
	c.ok, c.detail = true, url+" answers /healthz"
	return c
}

func tokenCheck(s *session, token, source string, tokenErr error) check {
	c := check{name: "token", fix: "create a token with POST /v1/me/gateway-tokens and run harness setup again"}
	if tokenErr != nil {
		c.detail = tokenErr.Error()
		return c
	}
	client, err := s.client(token)
	if err != nil {
		c.detail = err.Error()
		return c
	}
	me, err := client.Me()
	if err != nil {
		c.detail = "rejected by the API: " + err.Error()
		return c
	}
	c.ok, c.detail = true, fmt.Sprintf("valid for %s (from %s)", me.User.Email, source)
	return c
}

// settingsCheck confirms that Claude Code reaches the gateway with the token, and never shows values
// other than URLs.
func settingsCheck(s *session) check {
	path := s.paths.SettingsFile()
	c := check{name: "settings", fix: "run harness setup <project> to rewrite the env block of " + path}
	env, err := local.SettingsEnv(path)
	if err != nil {
		c.detail = err.Error()
		return c
	}
	var problems []string
	for _, k := range []string{local.EnvAnthropicBaseURL, local.EnvGatewayURL} {
		if s.cfg.GatewayURL == "" || env[k] != s.cfg.GatewayURL {
			problems = append(problems, k+" is not the gateway URL")
		}
	}
	if env[local.EnvToken] == "" {
		problems = append(problems, local.EnvToken+" is missing")
	}
	if env[local.EnvAnthropicAuth] != env[local.EnvToken] {
		problems = append(problems, local.EnvAnthropicAuth+" differs from "+local.EnvToken)
	}
	if v, ok := env[local.EnvAnthropicAPIKey]; !ok || v != "" {
		problems = append(problems, local.EnvAnthropicAPIKey+" is not empty")
	}
	if len(problems) > 0 {
		c.detail = strings.Join(problems, "; ")
		return c
	}
	c.ok, c.detail = true, path+" points Claude Code at "+s.cfg.GatewayURL
	return c
}

// pluginChecks compares each installed directory with the content recorded at install time.
func pluginChecks(s *session) []check {
	names := make([]string, 0, len(s.cfg.Plugins))
	for name := range s.cfg.Plugins {
		names = append(names, name)
	}
	sort.Strings(names)
	var out []check
	for _, name := range names {
		rec := s.cfg.Plugins[name]
		c := check{name: "plugin " + name, fix: "run harness sync to reinstall it"}
		got, err := pack.DirDigest(s.store.Dir(name))
		switch {
		case err != nil:
			c.detail = fmt.Sprintf("%s cannot be read: %v", s.store.Dir(name), err)
		case got != rec.ContentDigest:
			c.detail = fmt.Sprintf("%s was changed after the install of %s", s.store.Dir(name), rec.Version)
		default:
			c.ok, c.detail = true, fmt.Sprintf("%s %s", rec.Version, rec.Digest)
		}
		out = append(out, c)
	}
	return out
}

// planCheck reports changes in the plans that sync has not applied yet.
func planCheck(s *session, token string) check {
	c := check{name: "plan", fix: "run harness sync"}
	client, err := s.client(token)
	if err != nil {
		c.detail = err.Error()
		return c
	}
	desired, err := reconcile.Resolve(client, s.cfg.Projects)
	if err != nil {
		c.detail = err.Error()
		return c
	}
	actions, err := reconcile.Diff(desired, s.cfg, s.store)
	if err != nil {
		c.detail, c.fix = err.Error(), "move the directory away, then run harness sync"
		return c
	}
	var pending []string
	for _, a := range actions {
		if a.Kind != reconcile.Keep {
			pending = append(pending, string(a.Kind)+" "+a.Name)
		}
	}
	if desired.GatewayURL != s.cfg.GatewayURL {
		pending = append(pending, "gateway "+desired.GatewayURL)
	}
	if len(pending) > 0 {
		c.detail = "pending: " + strings.Join(pending, ", ")
		return c
	}
	c.ok, c.detail = true, "installed plugins match the setup-plan"
	return c
}
