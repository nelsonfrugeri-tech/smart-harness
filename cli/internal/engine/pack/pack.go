// Package pack writes and reads the reproducible tar.gz of a package.
//
// The archive holds only regular files, sorted by path, with mode 0644, uid/gid 0, no owner
// names and mtime 0; the gzip header has no name and no time. The same directory always gives
// the same bytes with the same Go version. Pack and Unpack apply the same limits (pkg.Tally).
package pack

import (
	"archive/tar"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/digest"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

// Pack writes the package directory to w and returns its digest.
func Pack(dir string, w io.Writer) (string, error) {
	tree, findings, err := pkg.ReadTree(dir)
	if err != nil {
		return "", err
	}
	if len(findings) > 0 {
		return "", fmt.Errorf("%s: %s", findings[0].Path, findings[0].Message)
	}
	if err := Write(tree.Files, w); err != nil {
		return "", err
	}
	return digest.Files(tree.Files), nil
}

// Write writes files, already sorted by path, as a reproducible tar.gz.
func Write(files []pkg.File, w io.Writer) error {
	var tally pkg.Tally
	for _, f := range files {
		if err := checkPath(f.Path); err != nil {
			return err
		}
		if err := tally.Add(f.Path, int64(len(f.Data))); err != nil {
			return err
		}
	}
	gz, err := gzip.NewWriterLevel(w, gzip.BestCompression)
	if err != nil {
		return err
	}
	tw := tar.NewWriter(gz)
	for _, f := range files {
		hdr := &tar.Header{Typeflag: tar.TypeReg, Name: f.Path, Mode: 0o644, Size: int64(len(f.Data)), ModTime: time.Unix(0, 0)}
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if _, err := tw.Write(f.Data); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}

// Unpack extracts an archive into dest and returns its digest.
//
// dest must not exist or must be an empty directory. Files are extracted into a sibling
// temporary directory that replaces dest only after every check passes, so a rejected archive
// leaves nothing in dest. When expectDigest is not empty, a different digest is an error.
func Unpack(r io.Reader, dest, expectDigest string) (string, error) {
	if err := checkEmpty(dest); err != nil {
		return "", err
	}
	tmp, err := os.MkdirTemp(filepath.Dir(dest), "."+filepath.Base(dest)+".unpack-")
	if err != nil {
		return "", err
	}
	if err := os.Chmod(tmp, 0o755); err != nil { // MkdirTemp creates 0700
		_ = os.RemoveAll(tmp)
		return "", err
	}
	got, err := extract(r, tmp)
	if err == nil && expectDigest != "" && got != expectDigest {
		err = fmt.Errorf("digest %s does not match the expected %s", got, expectDigest)
	}
	if err == nil {
		err = replace(tmp, dest)
	}
	if err != nil {
		_ = os.RemoveAll(tmp)
		return "", err
	}
	return got, nil
}

func extract(r io.Reader, root string) (string, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return "", fmt.Errorf("archive is not gzip: %w", err)
	}
	tr := tar.NewReader(gz)
	var tally pkg.Tally
	var files []pkg.File
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", fmt.Errorf("archive is not a valid tar: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			return "", fmt.Errorf("%s: only regular files are allowed (symlinks, links, devices and directories are rejected)", hdr.Name)
		}
		if err := checkPath(hdr.Name); err != nil {
			return "", err
		}
		if err := tally.Add(hdr.Name, hdr.Size); err != nil {
			return "", err
		}
		// The tar reader stops at hdr.Size, so a lying header cannot exceed the limit.
		data, err := io.ReadAll(tr)
		if err != nil {
			return "", err
		}
		if err := writeNew(root, hdr.Name, data); err != nil {
			return "", err
		}
		files = append(files, pkg.File{Path: hdr.Name, Data: data})
	}
	return digest.Files(files), nil
}

// checkPath accepts only a clean relative slash path: no absolute path, "..", ".", empty part,
// backslash or colon.
func checkPath(p string) error {
	if !fs.ValidPath(p) || p == "." || strings.ContainsAny(p, `\:`) {
		return fmt.Errorf("unsafe path %q", p)
	}
	return nil
}

// writeNew creates a file that must not exist yet, so repeated paths (even differing only in
// case on a case-insensitive file system) are rejected.
func writeNew(root, name string, data []byte) error {
	target := filepath.Join(root, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func checkEmpty(dest string) error {
	entries, err := os.ReadDir(dest)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(entries) > 0 {
		return fmt.Errorf("destination %s is not empty", dest)
	}
	return nil
}

func replace(tmp, dest string) error {
	if err := os.Remove(dest); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return os.Rename(tmp, dest)
}
