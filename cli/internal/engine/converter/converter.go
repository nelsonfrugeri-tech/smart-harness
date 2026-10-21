// Package converter is the port between the canonical package and each coding agent harness.
//
// An adapter lives in converter/<harness>/ and turns a pkg.Package into the files that harness
// reads. Conversion is pure: no I/O, the same package always gives the same files. The command
// that calls the adapter writes the files to disk.
package converter

import (
	"fmt"
	"sort"
	"strings"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pkg"
)

// File is one generated file, with a slash-separated path relative to the package root.
type File = pkg.File

// Adapter converts the canonical package for one harness.
//
// Convert must return every component converted or an error: a capability the harness cannot
// express is an *UnsupportedError, never a silent omission. Files must be sorted by path.
type Adapter interface {
	Name() string
	Convert(pkg.Package) ([]File, error)
}

// UnsupportedError reports a component that the target harness cannot express.
type UnsupportedError struct {
	Target    string // adapter name
	Component string // for example "agent reviewer"
	Reason    string
}

func (e *UnsupportedError) Error() string {
	return fmt.Sprintf("target %s does not support %s: %s", e.Target, e.Component, e.Reason)
}

// Registry finds adapters by name.
type Registry struct {
	adapters map[string]Adapter
}

// NewRegistry registers adapters by Name. An empty or repeated name is an error.
func NewRegistry(adapters ...Adapter) (*Registry, error) {
	r := &Registry{adapters: map[string]Adapter{}}
	for _, a := range adapters {
		name := a.Name()
		if name == "" {
			return nil, fmt.Errorf("adapter with empty name")
		}
		if _, dup := r.adapters[name]; dup {
			return nil, fmt.Errorf("adapter %q registered twice", name)
		}
		r.adapters[name] = a
	}
	return r, nil
}

// Names returns the registered names in sorted order.
func (r *Registry) Names() []string {
	names := make([]string, 0, len(r.adapters))
	for name := range r.adapters {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// Lookup returns the adapter for target or an error that lists the available targets.
func (r *Registry) Lookup(target string) (Adapter, error) {
	if a, ok := r.adapters[target]; ok {
		return a, nil
	}
	return nil, fmt.Errorf("unknown target %q; available targets: %s", target, strings.Join(r.Names(), ", "))
}

// Adapters returns the registered adapters sorted by name.
func (r *Registry) Adapters() []Adapter {
	out := make([]Adapter, 0, len(r.adapters))
	for _, name := range r.Names() {
		out = append(out, r.adapters[name])
	}
	return out
}
