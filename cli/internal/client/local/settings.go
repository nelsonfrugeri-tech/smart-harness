package local

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// Keys the CLI writes in the env block of the Claude Code settings.
const (
	EnvGatewayURL        = "SMART_HARNESS_GATEWAY_URL"
	EnvAnthropicBaseURL  = "ANTHROPIC_BASE_URL"
	EnvAnthropicAuth     = "ANTHROPIC_AUTH_TOKEN"
	EnvAnthropicAPIKey   = "ANTHROPIC_API_KEY"
	settingsBackupSuffix = ".harness-backup-"
)

// readSettings returns the top-level object of settings.json and its raw bytes. A missing file
// is an empty object with nil bytes. Anything other than a JSON object is an error.
func readSettings(path string) (map[string]json.RawMessage, []byte, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]json.RawMessage{}, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil || top == nil {
		return nil, nil, fmt.Errorf("%s is not a JSON object; fix or move it and run again", path)
	}
	return top, raw, nil
}

// readEnv returns the env block with its values as written. An absent env is empty; a non-object
// env is an error.
func readEnv(path string, top map[string]json.RawMessage) (map[string]json.RawMessage, error) {
	env := map[string]json.RawMessage{}
	raw, ok := top["env"]
	if !ok {
		return env, nil
	}
	if err := json.Unmarshal(raw, &env); err != nil || env == nil {
		return nil, fmt.Errorf("%s: env is not a JSON object; fix it and run again", path)
	}
	return env, nil
}

// TokenFromSettings returns env.SMART_HARNESS_TOKEN of settings.json, or "" when it is absent.
func TokenFromSettings(path string) (string, error) {
	top, _, err := readSettings(path)
	if err != nil {
		return "", err
	}
	env, err := readEnv(path, top)
	if err != nil {
		return "", err
	}
	var token string
	if raw, ok := env[EnvToken]; ok && json.Unmarshal(raw, &token) != nil {
		return "", fmt.Errorf("%s: env.%s is not a string", path, EnvToken)
	}
	return token, nil
}

// SettingsEnv returns the string values of the env block (non-strings are skipped).
func SettingsEnv(path string) (map[string]string, error) {
	top, _, err := readSettings(path)
	if err != nil {
		return nil, err
	}
	env, err := readEnv(path, top)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	for k, raw := range env {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			out[k] = s
		}
	}
	return out, nil
}

// GatewayEnv is what the coding agent needs: the token for MCPs (SMART_HARNESS_TOKEN) and for the
// model (ANTHROPIC_AUTH_TOKEN), the gateway for both, and an empty ANTHROPIC_API_KEY so a key in
// the shell does not bypass the gateway.
func GatewayEnv(token, gatewayURL string) map[string]string {
	return map[string]string{
		EnvToken:            token,
		EnvAnthropicAuth:    token,
		EnvAnthropicBaseURL: gatewayURL,
		EnvGatewayURL:       gatewayURL,
		EnvAnthropicAPIKey:  "",
	}
}

// WriteSettingsEnv sets values in the env block of settings.json and keeps every other key.
// When the content changes, the previous file is first copied to settings.json.harness-backup-<UTC
// time> (mode 0600); the new file is written atomically with mode 0600. It returns the backup
// path, "" when there was no previous file, and changed=false when nothing had to change.
func WriteSettingsEnv(path string, values map[string]string, now time.Time) (changed bool, backup string, err error) {
	top, old, err := readSettings(path)
	if err != nil {
		return false, "", err
	}
	env, err := readEnv(path, top)
	if err != nil {
		return false, "", err
	}
	for k, v := range values {
		encoded, err := json.Marshal(v)
		if err != nil {
			return false, "", err
		}
		env[k] = encoded
	}
	encodedEnv, err := json.Marshal(env)
	if err != nil {
		return false, "", err
	}
	top["env"] = encodedEnv
	data, err := json.MarshalIndent(top, "", "  ")
	if err != nil {
		return false, "", err
	}
	data = append(data, '\n')
	if old != nil && bytes.Equal(old, data) {
		return false, "", nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return false, "", err
	}
	if old != nil {
		backup = path + settingsBackupSuffix + now.UTC().Format("20060102T150405.000000000Z")
		if err := os.WriteFile(backup, old, 0o600); err != nil {
			return false, "", fmt.Errorf("backup of %s: %w", path, err)
		}
	}
	if err := writeFileAtomic(path, data); err != nil {
		return false, backup, err
	}
	return true, backup, nil
}
