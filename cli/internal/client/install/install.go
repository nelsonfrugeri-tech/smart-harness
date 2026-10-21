// Package install places plugin directories in the Claude Code skills directory.
//
// A version is first extracted to a staging directory outside skills/, so Claude Code never loads a
// half-written copy. The swap then moves the current version aside and the new one in. os.Rename
// does not replace an existing directory, so the swap is two renames; if the second fails, the
// first is undone and the previous version stays in place.
package install

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pack"
)

// Rename is os.Rename. Tests replace it to fail in the middle of a swap.
var Rename = os.Rename

const (
	previousSuffix = ".previous" // staging/<name>.previous: the version being replaced
	newInfix       = ".new-"     // staging/<name>.new-<random>: a version being installed
	removedInfix   = ".removed-" // staging/<name>.removed-<random>: a version being deleted
)

// Store is the skills directory and its staging directory, on the same file system.
type Store struct {
	SkillsDir  string
	StagingDir string
}

// Dir is the installed directory of a plugin.
func (s Store) Dir(name string) string { return filepath.Join(s.SkillsDir, name) }

// Exists reports whether skills/<name> exists, as a directory, file or symlink.
func (s Store) Exists(name string) (bool, error) {
	_, err := os.Lstat(s.Dir(name))
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return err == nil, err
}

// Recover finishes a swap interrupted by a crash. A previous version whose plugin directory is
// missing goes back into skills/; every other leftover in staging is deleted.
func (s Store) Recover() error {
	entries, err := os.ReadDir(s.StagingDir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, e := range entries {
		path := filepath.Join(s.StagingDir, e.Name())
		if name, ok := strings.CutSuffix(e.Name(), previousSuffix); ok {
			exists, err := s.Exists(name)
			if err != nil {
				return err
			}
			if !exists {
				if err := os.MkdirAll(s.SkillsDir, 0o755); err != nil {
					return err
				}
				if err := Rename(path, s.Dir(name)); err != nil {
					return fmt.Errorf("restore %s from %s: %w", name, path, err)
				}
				continue
			}
		}
		if err := os.RemoveAll(path); err != nil {
			return err
		}
	}
	return nil
}

// Stage extracts archive into a new staging directory after checking its digest (want), and
// returns that directory and the digest of its content as `harness digest` computes it.
func (s Store) Stage(name string, archive []byte, want string) (dir, contentDigest string, err error) {
	if err := os.MkdirAll(s.StagingDir, 0o700); err != nil {
		return "", "", err
	}
	dir, err = os.MkdirTemp(s.StagingDir, name+newInfix)
	if err != nil {
		return "", "", err
	}
	if _, err := pack.Unpack(bytes.NewReader(archive), dir, want); err != nil {
		_ = os.RemoveAll(dir)
		return "", "", fmt.Errorf("plugin %s: %w", name, err)
	}
	contentDigest, err = pack.DirDigest(dir)
	if err != nil {
		_ = os.RemoveAll(dir)
		return "", "", fmt.Errorf("plugin %s: %w", name, err)
	}
	return dir, contentDigest, nil
}

// Discard deletes a staged directory that will not be installed.
func (s Store) Discard(staged string) { _ = os.RemoveAll(staged) }

// Swap makes staged the plugin directory skills/<name>. An existing version is moved to
// staging/<name>.previous first; if moving staged in fails, it is moved back.
func (s Store) Swap(name, staged string) error {
	dest := s.Dir(name)
	prev := filepath.Join(s.StagingDir, name+previousSuffix)
	if err := os.RemoveAll(prev); err != nil {
		return err
	}
	if err := os.MkdirAll(s.SkillsDir, 0o755); err != nil {
		return err
	}
	exists, err := s.Exists(name)
	if err != nil {
		return err
	}
	if exists {
		if err := Rename(dest, prev); err != nil {
			return fmt.Errorf("move %s aside: %w", dest, err)
		}
	}
	if err := Rename(staged, dest); err != nil {
		if exists {
			if rerr := Rename(prev, dest); rerr != nil {
				return fmt.Errorf("install %s: %w; restoring the previous version also failed (%v), it is in %s and the next harness command puts it back", dest, err, rerr, prev)
			}
		}
		return fmt.Errorf("install %s: %w (the previous version was kept)", dest, err)
	}
	if exists {
		_ = os.RemoveAll(prev) // a leftover is removed by the next Recover
	}
	return nil
}

// Remove deletes skills/<name>: one rename takes it out of Claude Code's view, then it is deleted.
func (s Store) Remove(name string) error {
	if err := os.MkdirAll(s.StagingDir, 0o700); err != nil {
		return err
	}
	tmp, err := os.MkdirTemp(s.StagingDir, name+removedInfix)
	if err != nil {
		return err
	}
	target := filepath.Join(tmp, name)
	if err := Rename(s.Dir(name), target); err != nil {
		_ = os.RemoveAll(tmp)
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("remove %s: %w", s.Dir(name), err)
	}
	return os.RemoveAll(tmp)
}
