package localtools

import "os"

// externalEnvironment forwards runtime paths and OS settings, never ambient service
// credentials. Keep this list explicit: prefix matches could admit future secrets.
// This is environment filtering, not a filesystem or network sandbox. HOME is
// inherited unchanged; upstream tools can still read their own configuration files.
func externalEnvironment() []string {
	keys := []string{
		"PATH", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "USER", "LOGNAME",
		"TMPDIR", "TMP", "TEMP", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
		"LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "NO_COLOR",
		"SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE",
		"GOPATH", "GOROOT", "GOCACHE", "GOMODCACHE", "GOTOOLCHAIN",
		"UV_CACHE_DIR", "UV_PYTHON_CACHE_DIR", "UV_PYTHON_INSTALL_DIR", "UV_PYTHON", "UV_NATIVE_TLS",
		"XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
		"CLAUDE_CONFIG_DIR", "CODEX_HOME", "CURSOR_CONFIG_DIR", "AIDER_CHAT_HISTORY_FILE",
		"DEJA_INDEX_DIR", "DEJA_NOTES_FILE", "DEJA_EXCLUDE_PROJECTS",
		"DEJA_CLAUDE_ROOT", "DEJA_CODEX_ROOT", "DEJA_CURSOR_ROOT", "DEJA_CURSOR_CLI_ROOT",
		"DEJA_AIDER_ROOTS", "DEJA_OPENCODE_DB", "DEJA_GEMINI_ROOT", "DEJA_COPILOT_ROOT",
		"DEJA_PI_ROOT", "DEJA_CLINE_ROOT", "DEJA_CLINE_ROOTS", "DEJA_ROO_ROOTS", "DEJA_ROO_CLI_ROOT",
		"DEJA_ANTIGRAVITY_ROOT", "DEJA_GOOSE_DB", "DEJA_GOOSE_ROOT", "DEJA_GROK_DB", "DEJA_GROK_ROOT",
		"DEJA_HERMES_DB", "DEJA_HERMES_HOME", "DEJA_HERMES_PROFILES_ROOT", "DEJA_KIMI_ROOT",
		"DEJA_OPENCLAW_ROOT", "DEJA_QWEN_ROOT", "DEJA_INCLUDE_SUBAGENTS",
		"DEJA_INDEX_COMMANDS", "DEJA_INDEX_EDITS", "DEJA_INDEX_PATHS", "DEJA_INDEX_TOOL_OUTPUT",
	}
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	return env
}
