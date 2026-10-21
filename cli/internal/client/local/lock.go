package local

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// Lock creates the lock file, which fails when it already exists, so two commands that change
// plugins or the config never run at the same time. The file holds the process id, for the
// developer only. unlock removes it.
func Lock(path string) (unlock func(), err error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, fs.ErrExist) {
		return nil, fmt.Errorf("another harness command is running (lock %s); if none is, delete that file and run again", path)
	}
	if err != nil {
		return nil, err
	}
	_, werr := fmt.Fprintf(f, "%d\n", os.Getpid())
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		os.Remove(path)
		return nil, werr
	}
	return func() { os.Remove(path) }, nil
}
