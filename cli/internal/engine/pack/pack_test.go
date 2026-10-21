package pack

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/digest"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

const exampleDir = "../testdata/packages/example"

var timeZero = time.Unix(1, 0)

func TestPackUnpackKeepsTheDigest(t *testing.T) {
	want, err := DirDigest(exampleDir)
	if err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	packed, err := Pack(exampleDir, &archive)
	if err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "out")

	unpacked, err := Unpack(bytes.NewReader(archive.Bytes()), dest, want)

	if err != nil {
		t.Fatal(err)
	}
	onDisk, err := DirDigest(dest)
	if err != nil {
		t.Fatal(err)
	}
	if packed != want || unpacked != want || onDisk != want {
		t.Fatalf("digests: source %s, pack %s, unpack %s, on disk %s", want, packed, unpacked, onDisk)
	}
}

// exampleArchiveDigest is `sha256sum` of the archive of testdata/packages/example, measured on
// macOS arm64 and Linux arm64 with Go 1.27.3. CI runs this test on Linux amd64. A Go upgrade that
// changes compress/flate output changes this value and every package digest.
const exampleArchiveDigest = "sha256:77a54500fb3decbf4acb0cd9c364a621d668b8cd088984d56d8542db6cf41690"

func TestExampleArchiveDigest(t *testing.T) {
	var archive bytes.Buffer
	got, err := Pack(exampleDir, &archive)
	if err != nil {
		t.Fatal(err)
	}
	if got != digest.Of(archive.Bytes()) {
		t.Fatalf("Pack returned %s, but the archive bytes hash to %s", got, digest.Of(archive.Bytes()))
	}
	if got != exampleArchiveDigest {
		t.Fatalf("digest = %s, want %s", got, exampleArchiveDigest)
	}
}

func TestUnpackChecksTheDigestBeforeExtracting(t *testing.T) {
	var archive bytes.Buffer
	if _, err := Pack(exampleDir, &archive); err != nil {
		t.Fatal(err)
	}
	dest := t.TempDir()
	write(t, dest, "keep.txt", "mine", 0o644) // a non-empty destination would also be an error

	_, err := Unpack(&archive, dest, "sha256:"+strings.Repeat("0", 64))

	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("err = %v, want the digest error first", err)
	}
}

func TestPackIsReproducible(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "b.txt", "b", 0o600)
	write(t, dir, "a/z.txt", "z", 0o644)
	var first, second bytes.Buffer
	if _, err := Pack(dir, &first); err != nil {
		t.Fatal(err)
	}
	// Same content, other modes and times.
	if err := os.Chmod(filepath.Join(dir, "b.txt"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(dir, "a/z.txt"), timeZero, timeZero); err != nil {
		t.Fatal(err)
	}
	if _, err := Pack(dir, &second); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(first.Bytes(), second.Bytes()) {
		t.Fatal("same content gave different archives")
	}
	entries := readEntries(t, first.Bytes())
	if want := []string{"a/z.txt 420 0 0", "b.txt 420 0 0"}; strings.Join(entries, ",") != strings.Join(want, ",") {
		t.Fatalf("entries = %v, want %v", entries, want)
	}
}

// Every package accepted by pack is accepted by unpack, including at the limits.
func TestLimitsAreTheSameInPackAndUnpack(t *testing.T) {
	cases := []struct {
		name  string
		files []pkg.File
		ok    bool
	}{
		{"2000 files", manyFiles(pkg.MaxFiles, 0), true},
		{"2001 files", manyFiles(pkg.MaxFiles+1, 0), false},
		{"one file of 5 MiB", manyFiles(1, pkg.MaxFileBytes), true},
		{"one file of 5 MiB + 1 byte", manyFiles(1, pkg.MaxFileBytes+1), false},
		{"50 MiB in total", manyFiles(pkg.MaxTotalBytes/pkg.MaxFileBytes, pkg.MaxFileBytes), true},
		{"50 MiB + 1 byte in total", append(manyFiles(pkg.MaxTotalBytes/pkg.MaxFileBytes, pkg.MaxFileBytes), pkg.File{Path: "z", Data: []byte("1")}), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var packed bytes.Buffer
			packErr := Write(tc.files, &packed)
			raw := rawArchive(t, tc.files) // bypasses the pack limits
			dest := filepath.Join(t.TempDir(), "out")
			_, unpackErr := Unpack(bytes.NewReader(raw), dest, "")

			if (packErr == nil) != tc.ok || (unpackErr == nil) != tc.ok {
				t.Fatalf("pack err = %v, unpack err = %v, want ok = %v", packErr, unpackErr, tc.ok)
			}
			if tc.ok {
				if _, err := Unpack(bytes.NewReader(packed.Bytes()), filepath.Join(t.TempDir(), "again"), digest.Of(packed.Bytes())); err != nil {
					t.Fatalf("unpack of the packed archive: %v", err)
				}
			}
		})
	}
}

func TestUnpackRejectsDangerousArchives(t *testing.T) {
	reg := func(name string) entry {
		return entry{hdr: tar.Header{Typeflag: tar.TypeReg, Name: name, Size: 1, Mode: 0o644}, data: "x"}
	}
	cases := []struct {
		name    string
		entries []entry
	}{
		{"absolute path", []entry{reg("/etc/passwd")}},
		{"parent directory", []entry{reg("../escape")}},
		{"nested parent directory", []entry{reg("a/../../escape")}},
		{"dot segment", []entry{reg("./a")}},
		{"backslash", []entry{reg(`a\..\b`)}},
		{"empty segment", []entry{reg("a//b")}},
		{"symlink", []entry{{hdr: tar.Header{Typeflag: tar.TypeSymlink, Name: "link", Linkname: "/etc/passwd"}}}},
		{"hard link", []entry{reg("a"), {hdr: tar.Header{Typeflag: tar.TypeLink, Name: "b", Linkname: "a"}}}},
		{"directory entry", []entry{{hdr: tar.Header{Typeflag: tar.TypeDir, Name: "d/", Mode: 0o755}}}},
		{"character device", []entry{{hdr: tar.Header{Typeflag: tar.TypeChar, Name: "dev"}}}},
		{"repeated path", []entry{reg("a"), reg("a")}},
		{"file below a file", []entry{reg("a"), reg("a/b")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parent := t.TempDir()
			dest := filepath.Join(parent, "out")

			_, err := Unpack(bytes.NewReader(archiveOf(t, tc.entries)), dest, "")

			if err == nil {
				t.Fatal("archive was accepted")
			}
			assertNothingLeft(t, parent)
		})
	}
}

func TestUnpackRejectsNonGzip(t *testing.T) {
	parent := t.TempDir()
	if _, err := Unpack(strings.NewReader("not an archive"), filepath.Join(parent, "out"), ""); err == nil {
		t.Fatal("garbage was accepted")
	}
	assertNothingLeft(t, parent)
}

func TestUnpackRejectsADigestMismatch(t *testing.T) {
	var archive bytes.Buffer
	if _, err := Pack(exampleDir, &archive); err != nil {
		t.Fatal(err)
	}
	parent := t.TempDir()

	_, err := Unpack(&archive, filepath.Join(parent, "out"), "sha256:"+strings.Repeat("0", 64))

	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("err = %v", err)
	}
	assertNothingLeft(t, parent)
}

func TestUnpackRequiresAnEmptyDestination(t *testing.T) {
	var archive bytes.Buffer
	if _, err := Pack(exampleDir, &archive); err != nil {
		t.Fatal(err)
	}
	dest := t.TempDir()
	write(t, dest, "keep.txt", "mine", 0o644)

	if _, err := Unpack(bytes.NewReader(archive.Bytes()), dest, ""); err == nil {
		t.Fatal("non-empty destination was accepted")
	}
	if data, err := os.ReadFile(filepath.Join(dest, "keep.txt")); err != nil || string(data) != "mine" {
		t.Fatalf("existing file changed: %q %v", data, err)
	}
	empty := t.TempDir()
	if _, err := Unpack(bytes.NewReader(archive.Bytes()), empty, ""); err != nil {
		t.Fatalf("empty destination: %v", err)
	}
}

func TestPackRejectsSymlinks(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "a.txt", "a", 0o644)
	if err := os.Symlink("a.txt", filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	if _, err := Pack(dir, &bytes.Buffer{}); err == nil {
		t.Fatal("symlink was packed")
	}
}

type entry struct {
	hdr  tar.Header
	data string
}

func archiveOf(t *testing.T, entries []entry) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for _, e := range entries {
		hdr := e.hdr
		if err := tw.WriteHeader(&hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write([]byte(e.data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func rawArchive(t *testing.T, files []pkg.File) []byte {
	entries := make([]entry, len(files))
	for i, f := range files {
		entries[i] = entry{hdr: tar.Header{Typeflag: tar.TypeReg, Name: f.Path, Size: int64(len(f.Data)), Mode: 0o644}, data: string(f.Data)}
	}
	return archiveOf(t, entries)
}

func manyFiles(n, size int) []pkg.File {
	files := make([]pkg.File, n)
	data := make([]byte, size)
	for i := range files {
		files[i] = pkg.File{Path: fmt.Sprintf("f/%04d", i), Data: data}
	}
	return files
}

func readEntries(t *testing.T, archive []byte) []string {
	t.Helper()
	gz, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(gz)
	var out []string
	for {
		hdr, err := tr.Next()
		if err != nil {
			break
		}
		out = append(out, fmt.Sprintf("%s %d %d %d", hdr.Name, hdr.Mode, hdr.Uid, hdr.ModTime.Unix()))
	}
	return out
}

func TestUnpackRejectsABrokenGzipTrailer(t *testing.T) {
	var archive bytes.Buffer
	if _, err := Pack(exampleDir, &archive); err != nil {
		t.Fatal(err)
	}
	good := archive.Bytes()
	// The gzip trailer is CRC-32 (4 bytes) then the uncompressed size (4 bytes), RFC 1952 section 2.3.
	badCRC := bytes.Clone(good)
	badCRC[len(badCRC)-8] ^= 1
	cases := map[string][]byte{
		"inverted CRC bit":  badCRC,
		"truncated trailer": good[:len(good)-4],
	}
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			parent := t.TempDir()

			_, err := Unpack(bytes.NewReader(data), filepath.Join(parent, "out"), "")

			if err == nil {
				t.Fatal("archive was accepted")
			}
			assertNothingLeft(t, parent)
		})
	}
}

// assertNothingLeft checks that a rejected unpack left no destination and no temporary directory.
func assertNothingLeft(t *testing.T, parent string) {
	t.Helper()
	entries, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("left behind: %v", entries)
	}
}

func write(t *testing.T, dir, rel, data string, mode os.FileMode) {
	t.Helper()
	p := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(data), mode); err != nil {
		t.Fatal(err)
	}
}
