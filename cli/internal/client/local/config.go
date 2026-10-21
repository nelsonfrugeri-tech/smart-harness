package local

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// Config is ~/.config/smart-harness/config.json. It never holds the token.
type Config struct {
	APIURL     string               `json:"api_url"`
	GatewayURL string               `json:"gateway_url"`
	Projects   map[string]Project   `json:"projects"`
	Plugins    map[string]Installed `json:"plugins"`
	Drafts     map[string]Draft     `json:"drafts"`
}

// Project is a configured project and the optionals chosen for it.
type Project struct {
	IncludeOptional []string `json:"include_optional,omitempty"`
}

// Installed is a plugin directory managed by the harness. Only directories listed here are
// replaced or removed. Digest is the archive digest from the plan; ContentDigest is the digest
// of the installed directory right after the install, which doctor compares again later.
type Installed struct {
	Version       string   `json:"version"`
	Digest        string   `json:"digest"`
	ContentDigest string   `json:"content_digest"`
	Projects      []string `json:"projects"`
}

// Draft is a pulled draft directory and the digest of its archive.
type Draft struct {
	Dir    string `json:"dir"`
	Digest string `json:"digest"`
}

// LoadConfig reads the config. A missing file is an empty config.
func LoadConfig(path string) (Config, error) {
	cfg := Config{}
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return cfg, err
	}
	if err == nil {
		if err := json.Unmarshal(data, &cfg); err != nil {
			return cfg, fmt.Errorf("%s is not valid JSON: %w", path, err)
		}
	}
	if cfg.Projects == nil {
		cfg.Projects = map[string]Project{}
	}
	if cfg.Plugins == nil {
		cfg.Plugins = map[string]Installed{}
	}
	if cfg.Drafts == nil {
		cfg.Drafts = map[string]Draft{}
	}
	return cfg, nil
}

// SaveConfig writes the config atomically with mode 0600 in a 0700 directory.
func SaveConfig(path string, cfg Config) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return writeFileAtomic(path, append(data, '\n'))
}

// writeFileAtomic writes a sibling temporary file with mode 0600 and renames it over path.
func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Chmod(name, 0o600); err != nil { // CreateTemp already uses 0600; keep it explicit
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, path); err != nil {
		os.Remove(name)
		return err
	}
	return nil
}
