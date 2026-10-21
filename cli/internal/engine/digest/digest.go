// Package digest computes the content hash of a package, equal on any machine.
//
// Algorithm: sort regular files by path (bytes, slash-separated); for each file write
// path + "\x00" + hex(sha256(content)) + "\n"; the digest is "sha256:" + hex(sha256(that text)).
// File modes, timestamps, owners and empty directories are not part of it.
package digest

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

// Prefix starts every digest.
const Prefix = "sha256:"

// Files returns the digest of a set of files. The input order does not matter.
func Files(files []pkg.File) string {
	sorted := make([]pkg.File, len(files))
	copy(sorted, files)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Path < sorted[j].Path })
	h := sha256.New()
	for _, f := range sorted {
		sum := sha256.Sum256(f.Data)
		h.Write([]byte(f.Path))
		h.Write([]byte{0})
		h.Write([]byte(hex.EncodeToString(sum[:])))
		h.Write([]byte{'\n'})
	}
	return Prefix + hex.EncodeToString(h.Sum(nil))
}

// Dir returns the digest of a package directory. A symlink, a special file or a broken limit
// is an error, because pack refuses the same directory.
func Dir(dir string) (string, error) {
	tree, findings, err := pkg.ReadTree(dir)
	if err != nil {
		return "", err
	}
	if len(findings) > 0 {
		return "", fmt.Errorf("%s: %s", findings[0].Path, findings[0].Message)
	}
	return Files(tree.Files), nil
}
