package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/install"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
)

// Replaced by tests.
var (
	stdin io.Reader = os.Stdin
	now             = time.Now
)

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,99}$`)

// session is what setup, sync, doctor and draft pull share: directories, config and token.
type session struct {
	paths local.Paths
	cfg   local.Config
	store install.Store
}

// openSession reads the config without the lock, for doctor, which changes nothing.
func openSession() (*session, error) {
	paths, err := local.ResolvePaths()
	if err != nil {
		return nil, err
	}
	return loadSession(paths)
}

// openLockedSession takes the lock before reading the config, for the commands that change
// plugins or the config. release removes the lock; Ctrl-C removes it too.
func openLockedSession() (s *session, release func(), err error) {
	paths, err := local.ResolvePaths()
	if err != nil {
		return nil, nil, err
	}
	unlock, err := local.Lock(paths.LockFile())
	if err != nil {
		return nil, nil, err
	}
	forget := atInterrupt(unlock)
	release = func() { forget(); unlock() }
	if s, err = loadSession(paths); err != nil {
		release()
		return nil, nil, err
	}
	return s, release, nil
}

func loadSession(paths local.Paths) (*session, error) {
	cfg, err := local.LoadConfig(paths.ConfigFile())
	if err != nil {
		return nil, err
	}
	return &session{paths: paths, cfg: cfg, store: install.Store{SkillsDir: paths.SkillsDir(), StagingDir: paths.StagingDir()}}, nil
}

func (s *session) save() error { return local.SaveConfig(s.paths.ConfigFile(), s.cfg) }

// token returns SMART_HARNESS_TOKEN or, when it is not set, env.SMART_HARNESS_TOKEN of the Claude
// Code settings written by setup. source names where it came from, never the value.
func (s *session) token() (token, source string, err error) {
	if t := os.Getenv(local.EnvToken); t != "" {
		token, source = t, local.EnvToken
	} else {
		t, err := local.TokenFromSettings(s.paths.SettingsFile())
		if err != nil {
			return "", "", err
		}
		token, source = t, s.paths.SettingsFile()
	}
	if token == "" {
		return "", "", fmt.Errorf("no gateway token: set %s or run harness setup <project> --api-url <url>", local.EnvToken)
	}
	if !api.ValidToken(token) {
		return "", "", fmt.Errorf("the gateway token from %s is not shg_ followed by 43 base64url characters", source)
	}
	return token, source, nil
}

// client builds the API client of the configured API.
func (s *session) client(token string) (*api.Client, error) {
	if s.cfg.APIURL == "" {
		return nil, errors.New("no API configured; run harness setup <project> --api-url <url>")
	}
	return api.New(s.cfg.APIURL, token)
}

// explain adds what to do to a rejected token.
func explain(err error) error {
	var he *api.HTTPError
	if errors.As(err, &he) && he.Code == "gateway_token_not_allowed" {
		return fmt.Errorf("%w; this API does not accept the gateway token on this route", err)
	}
	if api.IsStatus(err, http.StatusUnauthorized) {
		return fmt.Errorf("%w; the gateway token was rejected (revoked, expired or wrong): create a new one with POST /v1/me/gateway-tokens and run harness setup again", err)
	}
	return err
}

// promptToken opens the controlling terminal when stdin is a bootstrap pipe.
// Echo is disabled while typing and restored when the prompt ends, also on Ctrl-C.
func promptToken(stderr io.Writer) (string, error) {
	fmt.Fprint(stderr, "Gateway token (shg_..., input hidden): ")
	input := stdin
	f, isFile := input.(*os.File)
	if isFile {
		if fi, err := f.Stat(); err == nil && fi.Mode()&os.ModeCharDevice == 0 {
			tty, err := os.Open("/dev/tty")
			if err != nil {
				return "", fmt.Errorf("an interactive terminal is required to enter the token")
			}
			defer tty.Close()
			input, f = tty, tty
		}
	}
	terminal := false
	if isFile {
		if fi, err := f.Stat(); err == nil && fi.Mode()&os.ModeCharDevice != 0 {
			terminal = true
		}
	}
	if terminal {
		if err := stty(f, "-echo"); err != nil {
			return "", fmt.Errorf("cannot hide token input (%v); run login in an interactive terminal", err)
		}
		restore := func() { _ = stty(f, "echo") }
		forget := atInterrupt(func() { restore(); fmt.Fprintln(stderr) })
		defer func() { forget(); restore() }()
	}
	defer fmt.Fprintln(stderr)
	line, err := bufio.NewReader(input).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	return strings.TrimSpace(line), nil
}

func stty(tty *os.File, mode string) error {
	cmd := exec.Command("stty", mode)
	cmd.Stdin = tty
	cmd.Env = []string{"PATH=" + os.Getenv("PATH")}
	return cmd.Run()
}

// redactWriter replaces the token in everything written, as a last line of defense.
type redactWriter struct {
	w      io.Writer
	secret string
}

func (r redactWriter) Write(p []byte) (int, error) {
	if r.secret == "" || !strings.Contains(string(p), r.secret) {
		return r.w.Write(p)
	}
	if _, err := io.WriteString(r.w, strings.ReplaceAll(string(p), r.secret, "shg_***")); err != nil {
		return 0, err
	}
	return len(p), nil
}

func redact(w io.Writer, secret string) io.Writer { return redactWriter{w: w, secret: secret} }

// splitList splits a comma-separated flag value, dropping empty items.
func splitList(v string) []string {
	var out []string
	for _, s := range strings.Split(v, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}
