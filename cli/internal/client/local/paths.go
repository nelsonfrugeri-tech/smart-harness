// Package local reads and writes the files the CLI owns on the developer's machine: the
// harness config and the env block of the Claude Code settings.
package local

import (
	"errors"
	"os"
	"path/filepath"
)

// Environment variables that move the directories, so tests never touch the real home.
const (
	EnvClaudeDir = "HARNESS_CLAUDE_DIR" // default: $CLAUDE_CONFIG_DIR, else ~/.claude
	EnvConfigDir = "HARNESS_CONFIG_DIR" // default: ~/.config/smart-harness
	EnvToken     = "SMART_HARNESS_TOKEN"
)

// Paths are the directories the CLI reads and writes.
type Paths struct {
	ClaudeDir string // Claude Code configuration directory
	ConfigDir string // harness configuration directory
}

// ResolvePaths applies the environment overrides and falls back to the home directory.
func ResolvePaths() (Paths, error) {
	p := Paths{ClaudeDir: os.Getenv(EnvClaudeDir), ConfigDir: os.Getenv(EnvConfigDir)}
	if p.ClaudeDir == "" {
		p.ClaudeDir = os.Getenv("CLAUDE_CONFIG_DIR")
	}
	if p.ClaudeDir == "" || p.ConfigDir == "" {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return p, errors.New("cannot find the home directory; set " + EnvClaudeDir + " and " + EnvConfigDir)
		}
		if p.ClaudeDir == "" {
			p.ClaudeDir = filepath.Join(home, ".claude")
		}
		if p.ConfigDir == "" {
			p.ConfigDir = filepath.Join(home, ".config", "smart-harness")
		}
	}
	return p, nil
}

// SkillsDir holds one directory per installed plugin; Claude Code loads each one.
func (p Paths) SkillsDir() string { return filepath.Join(p.ClaudeDir, "skills") }

// StagingDir holds new and previous plugin versions during a swap. It is outside SkillsDir, so
// Claude Code never loads a half-installed copy, and on the same file system, so rename works.
func (p Paths) StagingDir() string { return filepath.Join(p.ClaudeDir, "smart-harness-staging") }

// SettingsFile is the Claude Code user settings.
func (p Paths) SettingsFile() string { return filepath.Join(p.ClaudeDir, "settings.json") }

// ConfigFile is the harness config.
func (p Paths) ConfigFile() string { return filepath.Join(p.ConfigDir, "config.json") }

// DraftsDir is the default parent of pulled drafts.
func (p Paths) DraftsDir() string { return filepath.Join(p.ConfigDir, "drafts") }
