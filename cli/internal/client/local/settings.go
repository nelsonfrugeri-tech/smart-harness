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

// CheckSettings reports an error when settings.json exists but is not a JSON object with an object
// env block, so a command can refuse before it changes anything else.
func CheckSettings(path string) error {
	_, err := SettingsEnv(path)
	return err
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

// GatewayEnv is the persistent MCP configuration. Model routing belongs only to the
// child environment created by harness vendor=claude.
func GatewayEnv(token, gatewayURL string) map[string]string {
	return map[string]string{EnvToken: token, EnvGatewayURL: gatewayURL}
}

// removeOwnedProviderOverrides migrates the exact legacy Harness provider tuple.
// Partial or custom provider settings remain untouched. Check before updating the
// MCP values, so token rotation and gateway changes retain proof of ownership.
func removeOwnedProviderOverrides(env map[string]json.RawMessage) {
	value := func(key string) (string, bool) {
		var text string
		raw, exists := env[key]
		if !exists || json.Unmarshal(raw, &text) != nil {
			return "", false
		}
		return text, true
	}
	token, _ := value(EnvToken)
	gateway, _ := value(EnvGatewayURL)
	auth, _ := value(EnvAnthropicAuth)
	base, _ := value(EnvAnthropicBaseURL)
	key, hasKey := value(EnvAnthropicAPIKey)
	if token == "" || gateway == "" || auth != token || base != gateway || !hasKey || key != "" {
		return
	}
	delete(env, EnvAnthropicAuth)
	delete(env, EnvAnthropicBaseURL)
	delete(env, EnvAnthropicAPIKey)
}

// WriteSettingsEnv sets values in the env block of settings.json and keeps every other key.
// When the content changes, the previous file is first copied to settings.json.harness-backup-<UTC
// time> (mode 0600); the new file is written atomically with mode 0600. It returns the backup
// path, "" when there was no previous file, and changed=false when nothing had to change.
//
// The file is rewritten with its keys in alphabetical order and two-space indentation; values,
// numbers and strings (including &, < and >) stay as written. A symlink (for example to a dotfiles
// repository) stays a symlink: the write goes to its target.
func WriteSettingsEnv(path string, values map[string]string, now time.Time) (changed bool, backup string, err error) {
	target, err := resolveSymlink(path)
	if err != nil {
		return false, "", err
	}
	top, old, err := readSettings(path)
	if err != nil {
		return false, "", err
	}
	env, err := readEnv(path, top)
	if err != nil {
		return false, "", err
	}
	if _, token := values[EnvToken]; token {
		if _, gateway := values[EnvGatewayURL]; gateway {
			removeOwnedProviderOverrides(env)
		}
	}
	for k, v := range values {
		encoded, err := marshal(v, false)
		if err != nil {
			return false, "", err
		}
		env[k] = encoded
	}
	encodedEnv, err := marshal(env, false)
	if err != nil {
		return false, "", err
	}
	top["env"] = encodedEnv
	data, err := marshal(top, true)
	if err != nil {
		return false, "", err
	}
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
	if err := writeFileAtomic(target, data); err != nil {
		return false, backup, err
	}
	return true, backup, nil
}

// resolveSymlink returns the file a symlink points to, or path itself when it is not a symlink or
// does not exist. A symlink to a missing file is an error rather than being replaced by a file.
func resolveSymlink(path string) (string, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) || (err == nil && info.Mode()&fs.ModeSymlink == 0) {
		return path, nil
	}
	if err != nil {
		return "", err
	}
	target, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", fmt.Errorf("%s is a symlink that cannot be followed (%v); fix or remove it and run again", path, err)
	}
	return target, nil
}

// marshal encodes v without escaping &, < and >, which are common in shell commands of the
// settings. The result has no trailing newline unless indent is set.
func marshal(v any, indent bool) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if indent {
		enc.SetIndent("", "  ")
	}
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	if indent {
		return buf.Bytes(), nil
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}
