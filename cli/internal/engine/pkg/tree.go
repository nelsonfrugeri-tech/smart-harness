package pkg

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
)

// Tree is every regular file of a package directory, sorted by path.
type Tree struct {
	Files      []File
	Executable map[string]bool // paths whose mode has an execute bit
}

// File returns the file at path, or false when it does not exist.
func (t Tree) File(path string) (File, bool) {
	i := sort.Search(len(t.Files), func(i int) bool { return t.Files[i].Path >= path })
	if i < len(t.Files) && t.Files[i].Path == path {
		return t.Files[i], true
	}
	return File{}, false
}

// ReadTree reads a package directory without following symlinks.
// Symlinks, special files and broken limits become findings; error is only for I/O.
// Reading stops at the first broken limit, so a huge directory is never loaded in memory.
func ReadTree(dir string) (Tree, []Finding, error) {
	tree := Tree{Executable: map[string]bool{}}
	var findings []Finding
	var tally Tally
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p == dir {
			if !d.IsDir() {
				return &fs.PathError{Op: "read", Path: dir, Err: fs.ErrInvalid}
			}
			return nil
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		switch {
		case d.IsDir():
			return nil
		case d.Type()&fs.ModeSymlink != 0:
			findings = append(findings, Finding{Code: CodeLayout, Path: rel, Message: "symlinks are not allowed", Hint: "replace the symlink with the file it points to"})
			return nil
		case !d.Type().IsRegular():
			findings = append(findings, Finding{Code: CodeLayout, Path: rel, Message: "only regular files are allowed"})
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if err := tally.Add(rel, info.Size()); err != nil {
			findings = append(findings, Finding{Code: CodeLimits, Path: rel, Message: err.Error(),
				Hint: "keep the package within 2000 files, 5 MiB per file and 50 MiB in total"})
			return fs.SkipAll
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		tree.Files = append(tree.Files, File{Path: rel, Data: data})
		if info.Mode().Perm()&0o111 != 0 {
			tree.Executable[rel] = true
		}
		return nil
	})
	if err != nil {
		return Tree{}, nil, err
	}
	// WalkDir visits in lexical order of each directory, which is not byte order of full paths
	// ("a/b" vs "a.txt"); sort explicitly.
	sort.Slice(tree.Files, func(i, j int) bool { return tree.Files[i].Path < tree.Files[j].Path })
	return tree, findings, nil
}

// Load reads a package directory and builds its model.
// When reading stops at a limit, the model is not built and only the read findings return.
func Load(dir string) (Package, Tree, []Finding, error) {
	tree, findings, err := ReadTree(dir)
	if err != nil {
		return Package{}, Tree{}, nil, err
	}
	for _, f := range findings {
		if f.Code == CodeLimits {
			return Package{}, tree, findings, nil
		}
	}
	p, parsed := Parse(tree)
	findings = append(findings, parsed...)
	SortFindings(findings)
	return p, tree, findings, nil
}
