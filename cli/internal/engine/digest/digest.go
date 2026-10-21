// Package digest formats the package digest: "sha256:" + hex(sha256(archive bytes)).
//
// The archive is the reproducible tar.gz written by package pack, so the digest of a directory
// is the digest of the archive that `harness pack` would write (pack.DirDigest).
package digest

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
)

// Prefix starts every digest.
const Prefix = "sha256:"

var formatRe = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

// Of returns the digest of the given bytes.
func Of(data []byte) string {
	sum := sha256.Sum256(data)
	return Prefix + hex.EncodeToString(sum[:])
}

// Valid reports whether s is "sha256:" followed by 64 lowercase hex digits.
func Valid(s string) bool {
	return formatRe.MatchString(s)
}
