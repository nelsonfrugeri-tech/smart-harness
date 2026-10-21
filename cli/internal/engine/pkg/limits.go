package pkg

import "fmt"

// Limits shared by load, pack and unpack, so a package accepted by pack is accepted by unpack.
const (
	MaxFiles      = 2000
	MaxFileBytes  = 5 << 20  // 5 MiB per file
	MaxTotalBytes = 50 << 20 // 50 MiB for all files
)

// Tally counts files against the limits. The zero value is ready to use.
type Tally struct {
	Files int
	Bytes int64
}

// Add accounts for one file and returns an error when it breaks a limit.
func (t *Tally) Add(path string, size int64) error {
	t.Files++
	t.Bytes += size
	switch {
	case t.Files > MaxFiles:
		return fmt.Errorf("package has more than %d files", MaxFiles)
	case size > MaxFileBytes:
		return fmt.Errorf("%s has %d bytes, above the limit of %d bytes per file", path, size, MaxFileBytes)
	case t.Bytes > MaxTotalBytes:
		return fmt.Errorf("package has more than %d bytes in total", MaxTotalBytes)
	}
	return nil
}
