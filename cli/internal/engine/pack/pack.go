// Package pack writes and reads the reproducible tar.gz of a package.
//
// The archive holds only regular files, sorted by path, with mode 0644, uid/gid 0, no owner
// names and mtime 0; the gzip header has no name, no time and a fixed compression level. The
// digest of a package is the sha256 of these archive bytes (package digest), so the same
// directory gives the same digest with the same Go version. Pack and Unpack apply the same limits.
package pack

import (
	"archive/tar"
	"bytes"
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

// MaxArchiveBytes bounds the archive read by Unpack. It is above the largest archive Pack can
// write: content limit, plus 1 KiB of tar header and padding per file, plus 1 MiB for gzip.
const MaxArchiveBytes = pkg.MaxTotalBytes + pkg.MaxFiles*1024 + 1<<20

// Archive reads the package directory and returns its tar.gz bytes.
// A symlink, a special file, an unsafe path or a broken limit is an error.
func Archive(dir string) ([]byte, error) {
	tree, findings, err := pkg.ReadTree(dir)
	if err != nil {
		return nil, err
	}
	if len(findings) > 0 {
		return nil, fmt.Errorf("%s: %s", findings[0].Path, findings[0].Message)
	}
	var buf bytes.Buffer
	if err := Write(tree.Files, &buf); err != nil {
		return nil, err
	}
	if buf.Len() > MaxArchiveBytes { // cannot happen within the limits; keeps Pack and Unpack aligned
		return nil, fmt.Errorf("archive is larger than %d bytes", MaxArchiveBytes)
	}
	return buf.Bytes(), nil
}

// DirDigest returns the digest of the archive that Pack writes for dir.
func DirDigest(dir string) (string, error) {
	archive, err := Archive(dir)
	if err != nil {
		return "", err
	}
	return digest.Of(archive), nil
}

// FilesDigest returns the digest of the archive of files, already sorted by path.
func FilesDigest(files []pkg.File) (string, error) {
	var buf bytes.Buffer
	if err := Write(files, &buf); err != nil {
		return "", err
	}
	return digest.Of(buf.Bytes()), nil
}

// Pack writes the archive of dir to w and returns its digest.
func Pack(dir string, w io.Writer) (string, error) {
	archive, err := Archive(dir)
	if err != nil {
		return "", err
	}
	if _, err := w.Write(archive); err != nil {
		return "", err
	}
	return digest.Of(archive), nil
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

// Unpack checks and extracts an archive into dest and returns its digest.
//
// The archive is read whole (at most MaxArchiveBytes) and, when expectDigest is not empty, its
// sha256 is compared before anything is extracted. dest must not exist or must be an empty
// directory. Files go to a sibling temporary directory that replaces dest only after every
// check passes, so a rejected archive leaves nothing behind.
func Unpack(r io.Reader, dest, expectDigest string) (string, error) {
	archive, err := io.ReadAll(io.LimitReader(r, MaxArchiveBytes+1))
	if err != nil {
		return "", err
	}
	if len(archive) > MaxArchiveBytes {
		return "", fmt.Errorf("archive is larger than %d bytes", MaxArchiveBytes)
	}
	got := digest.Of(archive)
	if expectDigest != "" && got != expectDigest {
		return "", fmt.Errorf("digest %s does not match the expected %s", got, expectDigest)
	}
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
	err = extract(bytes.NewReader(archive), tmp)
	if err == nil {
		err = replace(tmp, dest)
	}
	if err != nil {
		_ = os.RemoveAll(tmp)
		return "", err
	}
	return got, nil
}

func extract(r io.Reader, root string) error {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("archive is not gzip: %w", err)
	}
	tr := tar.NewReader(gz)
	var tally pkg.Tally
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("archive is not a valid tar: %w", err)
		}
		if hdr.Typeflag != tar.TypeReg {
			return fmt.Errorf("%s: only regular files are allowed (symlinks, links, devices and directories are rejected)", hdr.Name)
		}
		if err := checkPath(hdr.Name); err != nil {
			return err
		}
		if err := tally.Add(hdr.Name, hdr.Size); err != nil {
			return err
		}
		// The tar reader stops at hdr.Size, so a lying header cannot exceed the limit.
		data, err := io.ReadAll(tr)
		if err != nil {
			return err
		}
		if err := writeNew(root, hdr.Name, data); err != nil {
			return err
		}
	}
	return checkGzipEnd(gz)
}

// maxTrailingBytes bounds what may follow the end of the tar inside the gzip stream. Pack writes
// none; other tar writers pad the last record to 10 KiB.
const maxTrailingBytes = 1 << 20

// checkGzipEnd reads the gzip stream to its end, so the reader checks the CRC-32 and size trailer.
func checkGzipEnd(gz *gzip.Reader) error {
	n, err := io.Copy(io.Discard, io.LimitReader(gz, maxTrailingBytes+1))
	if err != nil {
		return fmt.Errorf("archive is not a valid gzip: %w", err)
	}
	if n > maxTrailingBytes {
		return fmt.Errorf("archive has more than %d bytes after the end of the tar", maxTrailingBytes)
	}
	return nil
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
