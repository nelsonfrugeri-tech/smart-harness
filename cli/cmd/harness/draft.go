package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/install"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
)

// runDraft dispatches the draft subcommands.
func runDraft(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "pull" {
		return usageError(stderr, "")
	}
	return runDraftPull(args[1:], stdout, stderr)
}

// runDraftPull downloads GET /v1/drafts/{id}/archive and extracts it for `claude --plugin-dir`.
//
// The default directory is <config dir>/drafts/<id>; --dir picks another one. The directory must be
// missing, empty or a draft pulled there before: a pull of the same digest changes nothing, a new
// digest replaces the copy with the same swap as a plugin install, so a failure keeps the
// previous copy.
func runDraftPull(args []string, stdout, stderr io.Writer) int {
	a, err := parseArgs(args, []string{"--dir"}, nil)
	if err != nil || len(a.positional) != 1 {
		return usageError(stderr, errText(err))
	}
	id := a.positional[0]
	if !api.ValidDraftID(id) {
		return usageError(stderr, fmt.Sprintf("invalid draft id %q", id))
	}
	s, release, err := openLockedSession()
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	defer release()
	dest := a.values["--dir"]
	if dest == "" {
		dest = filepath.Join(s.paths.DraftsDir(), id)
	}
	if dest, err = filepath.Abs(dest); err != nil {
		return failure(stderr, exitUsage, err)
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
	store := draftStore(s.paths, dest)
	if err := store.Recover(); err != nil {
		return failure(stderr, exitFailure, err)
	}
	prev, pulledHere := s.cfg.Drafts[id]
	pulledHere = pulledHere && prev.Dir == dest
	if err := checkDraftDest(dest, pulledHere); err != nil {
		return failure(stderr, exitFailure, err)
	}
	archive, got, err := client.DraftArchive(id)
	if err != nil {
		return failure(stderr, exitFailure, explain(err))
	}
	exists, err := store.Exists(filepath.Base(dest))
	if err != nil {
		return failure(stderr, exitFailure, err)
	}
	if pulledHere && prev.Digest == got && exists {
		fmt.Fprintf(stdout, "unchanged %s (%s)\n", dest, got)
	} else {
		if err := replaceDraft(store, filepath.Base(dest), archive, got); err != nil {
			return failure(stderr, exitFailure, err)
		}
		s.cfg.Drafts[id] = local.Draft{Dir: dest, Digest: got}
		if err := s.save(); err != nil {
			return failure(stderr, exitFailure, err)
		}
		fmt.Fprintf(stdout, "pulled %s (%s)\n", dest, got)
	}
	fmt.Fprintf(stdout, "test it with:\n  claude --plugin-dir %s\n", dest)
	return exitOK
}

// checkDraftDest accepts a missing or empty directory, or one this command pulled before.
func checkDraftDest(dest string, pulledHere bool) error {
	entries, err := os.ReadDir(dest)
	if errors.Is(err, fs.ErrNotExist) || (err == nil && len(entries) == 0) || (err == nil && pulledHere) {
		return nil
	}
	if err != nil {
		return err
	}
	return fmt.Errorf("%s is not empty and was not pulled by harness draft pull; choose another --dir", dest)
}

// draftStore swaps dest through a staging directory owned by the harness, one per destination
// path, so nothing next to dest is ever touched and a crash is recovered on the next pull to the
// same place. The rename needs dest and the config directory on the same file system.
func draftStore(paths local.Paths, dest string) install.Store {
	sum := sha256.Sum256([]byte(dest))
	return install.Store{
		SkillsDir:  filepath.Dir(dest),
		StagingDir: filepath.Join(paths.DraftStagingDir(), hex.EncodeToString(sum[:8])),
	}
}

// replaceDraft stages the archive and swaps it in as store.Dir(name), keeping the old copy on
// failure.
func replaceDraft(store install.Store, name string, archive []byte, want string) error {
	staged, _, err := store.Stage(name, archive, want)
	if err != nil {
		return err
	}
	if err := store.Swap(name, staged); err != nil {
		store.Discard(staged)
		return err
	}
	return nil
}
