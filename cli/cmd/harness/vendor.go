package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
)

// runVendorClaude routes only the launched process through the Harness gateway.
// Native Claude settings, credentials and the parent environment are never written.
func runVendorClaude(args []string, stdout, stderr io.Writer) int {
	binary := os.Getenv(envClaudeBin)
	if binary == "" {
		binary = "claude"
	}
	executable, err := exec.LookPath(binary)
	if err != nil {
		return failure(stderr, exitFailure, errors.New("Claude Code is not installed; install it and run harness vendor=claude again"))
	}
	s, err := openSession()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	token, _, err := s.token()
	if err != nil {
		return failure(stderr, exitFailure, errors.New("no valid Harness token; run harness login --api-url <url>"))
	}
	settings, err := local.SettingsEnv(s.paths.SettingsFile())
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	gateway := os.Getenv(local.EnvGatewayURL)
	if gateway == "" {
		gateway = settings[local.EnvGatewayURL]
	}
	if gateway == "" {
		gateway = s.cfg.GatewayURL
	}
	if gateway == "" {
		return failure(stderr, exitFailure, errors.New("no Harness gateway configured; run harness login --api-url <url>"))
	}
	if _, err := api.ParseBaseURL(gateway); err != nil {
		return failure(stderr, exitFailure, errors.New("invalid Harness gateway: use an absolute https URL without user info, query or fragment; plain http is allowed only on loopback"))
	}
	// Claude settings.env overrides the shell environment. A private session
	// overlay takes precedence without modifying any native settings file.
	for _, arg := range args {
		if arg == "--" {
			break
		}
		if arg == "--settings" || strings.HasPrefix(arg, "--settings=") {
			return failure(stderr, exitUsage, errors.New("--settings is reserved by harness vendor=claude for isolated model routing; use claude for custom settings"))
		}
	}
	hasModel := false
	for _, arg := range args {
		if arg == "--" {
			break
		}
		if arg == "--model" || strings.HasPrefix(arg, "--model=") {
			hasModel = true
			break
		}
	}
	if !hasModel {
		args = append([]string{"--model", "openrouter/free"}, args...)
	}
	cmd := exec.Command(executable, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = stdin, stdout, stderr
	overrides := map[string]string{
		local.EnvAnthropicBaseURL: gateway,
		local.EnvAnthropicAuth:    token,
		local.EnvAnthropicAPIKey:  "",
		local.EnvGatewayURL:       gateway,
		local.EnvToken:            token,
		"CLAUDE_CODE_USE_BEDROCK": "",
		"CLAUDE_CODE_USE_VERTEX":  "",
		"CLAUDE_CODE_USE_FOUNDRY": "",
	}
	overlay, err := os.CreateTemp("", "harness-claude-*.json")
	if err != nil {
		return failure(stderr, exitFailure, errors.New("could not create private Claude session settings"))
	}
	defer os.Remove(overlay.Name())
	if err := json.NewEncoder(overlay).Encode(map[string]any{"env": overrides}); err != nil {
		_ = overlay.Close()
		return failure(stderr, exitFailure, errors.New("could not write private Claude session settings"))
	}
	if err := overlay.Close(); err != nil {
		return failure(stderr, exitFailure, errors.New("could not close private Claude session settings"))
	}
	cmd.Args = append([]string{executable, "--settings", overlay.Name()}, args...)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if _, replaced := overrides[key]; !replaced {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	for key, value := range overrides {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	// Keep the child in the foreground terminal group. Both processes receive
	// terminal Ctrl-C; the wrapper must wait for Claude to restore its terminal.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	if err := cmd.Start(); err != nil {
		return failure(stderr, exitFailure, errors.New("could not start Claude Code"))
	}
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			select {
			case sig := <-signals:
				if sig == syscall.SIGTERM {
					_ = cmd.Process.Signal(sig)
				}
			case <-done:
				return
			}
		}
	}()
	if err := cmd.Wait(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			if status, ok := exitErr.Sys().(syscall.WaitStatus); ok && status.Signaled() {
				return 128 + int(status.Signal())
			}
			return exitErr.ExitCode()
		}
		return failure(stderr, exitFailure, errors.New("could not wait for Claude Code"))
	}
	return exitOK
}
