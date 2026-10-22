package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/localtools"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/reconcile"
)

func runLogin(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, []string{"--api-url"}, nil)
	if err != nil || len(a.positional) != 0 || a.values["--api-url"] == "" {
		return usageError(stderr, "login requires --api-url <url>")
	}
	parsed, err := api.ParseBaseURL(a.values["--api-url"])
	if err != nil {
		return failure(stderr, exitUsage, err)
	}
	s, release, err := openLockedSession()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	defer release()
	if s.cfg.APIURL != "" && s.cfg.APIURL != parsed.String() && (len(s.cfg.Projects) > 0 || len(s.cfg.Plugins) > 0) {
		return failure(stderr, exitFailure, fmt.Errorf("configured packages use another API; use a separate HARNESS_CONFIG_DIR and HARNESS_CLAUDE_DIR"))
	}
	if err := local.CheckSettings(s.paths.SettingsFile()); err != nil {
		return failure(stderr, exitFailure, err)
	}
	token, err := promptToken(stderr)
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	if !api.ValidToken(token) {
		return failure(stderr, exitUsage, fmt.Errorf("token must be shg_ followed by 43 base64url characters"))
	}
	stdout, stderr = redact(stdout, token), redact(stderr, token)
	client, err := api.New(parsed.String(), token)
	if err != nil {
		return failure(stderr, exitUsage, err)
	}
	if _, err := client.Me(); err != nil {
		return failure(stderr, exitFailure, explain(err))
	}
	plan, err := client.PersonalPlan("")
	if err != nil {
		return failure(stderr, exitFailure, explain(err))
	}
	if len(s.cfg.Projects) > 0 && s.cfg.GatewayURL != "" && s.cfg.GatewayURL != plan.Gateway.URL {
		return failure(stderr, exitFailure, fmt.Errorf("personal gateway differs from the configured projects; nothing was changed"))
	}
	items, err := loginCatalog(client, plan)
	if err != nil {
		return failure(stderr, exitFailure, explain(err))
	}
	reportGateway(stdout, s.cfg.GatewayURL, plan.Gateway.URL)
	if err := writeSettings(s, stdout, local.GatewayEnv(token, plan.Gateway.URL)); err != nil {
		return failure(stderr, exitFailure, err)
	}
	s.cfg.APIURL, s.cfg.GatewayURL = parsed.String(), plan.Gateway.URL
	if s.cfg.PersonalPlugins == nil {
		s.cfg.PersonalPlugins = []string{}
	}
	if err := s.save(); err != nil {
		return failure(stderr, exitFailure, err)
	}
	return configureCatalog(s, client, token, items, stdout, stderr)
}

func runInstall(args []string, stdout, stderr io.Writer) int {
	return runCategoryInstall(args, "", stdout, stderr)
}

func runCategoryInstall(args []string, requestedCategory string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		return usageError(stderr, "install requires at least one package name")
	}
	for _, name := range args {
		if !api.ValidPluginName(name) {
			return usageError(stderr, fmt.Sprintf("invalid plugin name %q", name))
		}
	}
	s, release, err := openLockedSession()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	defer release()
	if s.cfg.APIURL == "" {
		return failure(stderr, exitFailure, fmt.Errorf("run harness login --api-url <url> first"))
	}
	token, _, err := s.token()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	stdout, stderr = redact(stdout, token), redact(stderr, token)
	client, err := s.client(token)
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	if err := local.CheckSettings(s.paths.SettingsFile()); err != nil {
		return failure(stderr, exitFailure, err)
	}
	return installSelection(s, client, token, args, requestedCategory, true, stdout, stderr)
}

func installSelection(s *session, client *api.Client, token string, args []string, requestedCategory string, prepareRuntimes bool, stdout, stderr io.Writer) int {
	selected := slices.Clone(s.cfg.PersonalPlugins)
	for _, name := range args {
		if !slices.Contains(selected, name) {
			selected = append(selected, name)
		}
	}
	candidate := s.cfg
	candidate.PersonalPlugins = selected
	desired, err := reconcile.ResolveConfigured(client, candidate)
	if err != nil {
		return failure(stderr, exitFailure, explain(err))
	}
	if requestedCategory != "" {
		if err := validateCategory(args, requestedCategory, desired); err != nil {
			return failure(stderr, exitFailure, err)
		}
	}
	if err := s.store.Recover(); err != nil {
		return failure(stderr, exitFailure, err)
	}
	actions, err := reconcile.Diff(desired, s.cfg, s.store)
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	if prepareRuntimes {
		if err := installRequestedRuntimes(args, s.paths.ConfigDir, desired, stdout, stderr); err != nil {
			return failure(stderr, exitFailure, err)
		}
	}
	if err := checkLocalTools(s.paths.ConfigDir, desired); err != nil {
		return failure(stderr, exitFailure, err)
	}
	s.cfg.PersonalPlugins, s.cfg.GatewayURL = selected, desired.GatewayURL
	if err := reconcile.Apply(actions, &s.cfg, s.store, client, s.save, stdout); err != nil {
		return failure(stderr, exitFailure, err)
	}
	if err := writeSettings(s, stdout, local.GatewayEnv(token, desired.GatewayURL)); err != nil {
		return failure(stderr, exitFailure, err)
	}
	return exitOK
}

// runtimeSettings pins the executable and managed directories for native MCP processes.
func runtimeSettings(paths local.Paths) (map[string]string, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	values := map[string]string{"HARNESS_CLI_BIN": executable, "HARNESS_CONFIG_DIR": paths.ConfigDir, "HARNESS_CLAUDE_DIR": paths.ClaudeDir}
	for key, value := range values {
		absolute, err := filepath.Abs(value)
		if err != nil {
			return nil, err
		}
		values[key] = absolute
	}
	return values, nil
}

// loginCatalog checks all pages before changing local state. Login installs only
// Tools and Skills; Agents remain outside the supported automatic journey.
func loginCatalog(client *api.Client, first api.SetupPlan) ([]api.PluginItem, error) {
	items := append([]api.PluginItem(nil), first.Optional.Items...)
	seen := map[string]bool{"": true}
	page := first
	for pages := 1; page.Optional.NextCursor != nil; pages++ {
		cursor := *page.Optional.NextCursor
		if pages >= 100 || seen[cursor] {
			return nil, fmt.Errorf("personal catalog pagination is invalid or exceeds 100 pages")
		}
		seen[cursor] = true
		var err error
		page, err = client.PersonalPlan(cursor)
		if err != nil {
			return nil, err
		}
		if page.Gateway.URL != first.Gateway.URL {
			return nil, fmt.Errorf("personal catalog changed gateways between pages")
		}
		items = append(items, page.Optional.Items...)
	}
	return items, nil
}

func configureCatalog(s *session, client *api.Client, token string, items []api.PluginItem, stdout, stderr io.Writer) int {
	names := []string{}
	pending := false
	for _, item := range items {
		kind := category(item.Components)
		if kind != "tools" && kind != "skills" {
			continue
		}
		name := item.Plugin.Name
		if slices.Contains(names, name) {
			continue
		}
		if tool, err := localtools.Find(name); err == nil && kind == "tools" {
			if err := installLocalRuntime(tool, s.paths.ConfigDir, stdout, stderr); err != nil {
				fmt.Fprintf(stderr, "pending %s: %v; complete with: harness tools install %s\n", name, err, name)
				pending = true
				continue
			}
		}
		names = append(names, name)
	}
	if len(names) > 0 {
		if code := installSelection(s, client, token, names, "", false, stdout, stderr); code != exitOK {
			fmt.Fprintln(stderr, "login saved; package configuration is incomplete; fix the error and run harness login again")
			return code
		}
	}
	if pending {
		fmt.Fprintln(stderr, "login saved; available packages configured; some Tools are pending")
		return exitFailure
	}
	if len(names) == 0 {
		fmt.Fprintln(stdout, "logged in; no Tools or Skills are available in the catalog")
	} else {
		fmt.Fprintln(stdout, "logged in; authorized Tools and Skills configured")
	}
	return exitOK
}
