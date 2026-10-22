package main

import (
	"fmt"
	"io"
	"os"
	"slices"
	"strings"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/reconcile"
)

// runSetup adds a project to the config, applies the plans of all configured projects and points
// Claude Code at the gateway. Exit 0 on success, 1 when the API or the disk refuses, 2 on usage.
func runSetup(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, []string{"--api-url", "--include-optional"}, nil)
	if err != nil || len(a.positional) != 1 {
		return usageError(stderr, errText(err))
	}
	slug := a.positional[0]
	if !slugRe.MatchString(slug) {
		return usageError(stderr, fmt.Sprintf("invalid project %q", slug))
	}
	optionals := splitList(a.values["--include-optional"])
	for _, n := range optionals {
		if !api.ValidPluginName(n) {
			return usageError(stderr, fmt.Sprintf("invalid plugin name %q in --include-optional", n))
		}
	}
	s, release, err := openLockedSession()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	defer release()
	apiURL, err := setupAPIURL(s.cfg, slug, a.values["--api-url"])
	if err != nil {
		return failure(stderr, exitUsage, err)
	}
	if err := local.CheckSettings(s.paths.SettingsFile()); err != nil {
		return failure(stderr, exitFailure, err)
	}
	token, err := setupToken(s, stderr)
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	stdout, stderr = redact(stdout, token), redact(stderr, token)
	client, err := api.New(apiURL, token)
	if err != nil {
		return failure(stderr, exitUsage, err)
	}

	projects := map[string]local.Project{}
	for k, v := range s.cfg.Projects {
		projects[k] = v
	}
	project := projects[slug]
	if _, given := a.values["--include-optional"]; given {
		project.IncludeOptional = optionals
	}
	projects[slug] = project

	if err := s.store.Recover(); err != nil {
		return failure(stderr, exitFailure, err)
	}
	candidate := s.cfg
	candidate.Projects = projects
	desired, err := reconcile.ResolveConfigured(client, candidate)
	if err != nil {
		return failure(stderr, exitFailure, explain(err))
	}
	if missing := desired.Missing[slug]; len(missing) > 0 {
		return failure(stderr, exitFailure, fmt.Errorf("project %s has no optional %s; nothing was changed", slug, strings.Join(missing, ", ")))
	}
	warnMissing(stderr, desired, slug)
	actions, err := reconcile.Diff(desired, s.cfg, s.store)
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	if err := checkLocalTools(s.paths.ConfigDir, desired); err != nil {
		return failure(stderr, exitFailure, err)
	}
	reportGateway(stdout, s.cfg.GatewayURL, desired.GatewayURL)
	s.cfg.APIURL, s.cfg.GatewayURL, s.cfg.Projects = apiURL, desired.GatewayURL, projects
	if err := reconcile.Apply(actions, &s.cfg, s.store, client, s.save, stdout); err != nil {
		return failure(stderr, exitFailure, err)
	}
	if err := writeSettings(s, stdout, local.GatewayEnv(token, desired.GatewayURL)); err != nil {
		return failure(stderr, exitFailure, err)
	}
	fmt.Fprintf(stdout, "project %s is set up; open the agent with:\n  %s\n", slug, openCommand(desired.Agents[slug]))
	return exitOK
}

// setupAPIURL takes --api-url, or the configured API when the flag is absent. One config talks to
// one API: another URL is refused while other projects use the configured one.
func setupAPIURL(cfg local.Config, slug, flag string) (string, error) {
	if flag == "" {
		if cfg.APIURL == "" {
			return "", fmt.Errorf("--api-url is required on the first setup")
		}
		return cfg.APIURL, nil
	}
	u, err := api.ParseBaseURL(flag)
	if err != nil {
		return "", err
	}
	apiURL := u.String()
	if cfg.APIURL != "" && cfg.APIURL != apiURL {
		for other := range cfg.Projects {
			if other != slug {
				return "", fmt.Errorf("project %s already uses API %s; one harness config talks to one API", other, cfg.APIURL)
			}
		}
	}
	return apiURL, nil
}

// setupToken uses SMART_HARNESS_TOKEN, then the token saved by an earlier setup, then asks.
func setupToken(s *session, stderr io.Writer) (string, error) {
	token, _, err := s.token()
	if err == nil {
		return token, nil
	}
	if os.Getenv(local.EnvToken) != "" {
		return "", err
	}
	token, err = promptToken(stderr)
	if err != nil {
		return "", err
	}
	if !api.ValidToken(token) {
		return "", fmt.Errorf("the gateway token must be shg_ followed by 43 base64url characters")
	}
	return token, nil
}

// writeSettings writes env values in the Claude Code settings and reports the file and its backup.
func writeSettings(s *session, stdout io.Writer, values map[string]string) error {
	runtime, err := runtimeSettings(s.paths)
	if err != nil {
		return err
	}
	for key, value := range runtime {
		values[key] = value
	}
	changed, backup, err := local.WriteSettingsEnv(s.paths.SettingsFile(), values, now())
	if err != nil {
		return err
	}
	switch {
	case !changed:
		fmt.Fprintf(stdout, "unchanged %s\n", s.paths.SettingsFile())
	case backup != "":
		fmt.Fprintf(stdout, "updated %s (backup %s)\n", s.paths.SettingsFile(), backup)
	default:
		fmt.Fprintf(stdout, "created %s\n", s.paths.SettingsFile())
	}
	return nil
}

// reportGateway shows the gateway Claude Code will use when it is new or moves, since every
// prompt and the token go there.
func reportGateway(stdout io.Writer, old, desired string) {
	switch {
	case old == "":
		fmt.Fprintf(stdout, "gateway %s\n", desired)
	case old != desired:
		fmt.Fprintf(stdout, "gateway %s -> %s\n", old, desired)
	}
}

func warnMissing(stderr io.Writer, d reconcile.Desired, except string) {
	slugs := make([]string, 0, len(d.Missing))
	for slug := range d.Missing {
		if slug != except {
			slugs = append(slugs, slug)
		}
	}
	slices.Sort(slugs)
	for _, slug := range slugs {
		fmt.Fprintf(stderr, "harness: warning: project %s no longer offers optional %s; it is not installed for this project\n", slug, strings.Join(d.Missing[slug], ", "))
	}
}

// openCommand is the command that starts Claude Code with the project's agent, when it has one.
func openCommand(agents []string) string {
	if len(agents) == 0 {
		return "claude"
	}
	return "claude --agent " + agents[0]
}

// runSync applies the current plans of every configured project.
func runSync(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, nil, nil)
	if err != nil || len(a.positional) != 0 {
		return usageError(stderr, errText(err))
	}
	s, release, err := openLockedSession()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	defer release()
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
	if err := s.store.Recover(); err != nil {
		return failure(stderr, exitFailure, err)
	}
	desired, err := reconcile.ResolveConfigured(client, s.cfg)
	if err != nil {
		return failure(stderr, exitFailure, explain(err))
	}
	warnMissing(stderr, desired, "")
	actions, err := reconcile.Diff(desired, s.cfg, s.store)
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	if err := checkLocalTools(s.paths.ConfigDir, desired); err != nil {
		return failure(stderr, exitFailure, err)
	}
	reportGateway(stdout, s.cfg.GatewayURL, desired.GatewayURL)
	s.cfg.GatewayURL = desired.GatewayURL
	if err := reconcile.Apply(actions, &s.cfg, s.store, client, s.save, stdout); err != nil {
		return failure(stderr, exitFailure, err)
	}
	// The token sync just used against the API, so a deleted settings.json comes back complete.
	if err := writeSettings(s, stdout, local.GatewayEnv(token, desired.GatewayURL)); err != nil {
		return failure(stderr, exitFailure, err)
	}
	return exitOK
}
