// Package targets lists the adapters available to `harness generate --target`.
//
// Adding a harness: create converter/<harness>/ with an Adapter and add it to the list below.
package targets

import (
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/converter/claudecode"
)

// Adapters returns every built-in adapter.
func Adapters() []converter.Adapter {
	return []converter.Adapter{
		claudecode.Adapter{},
	}
}

// Registry returns a registry with every built-in adapter.
func Registry() *converter.Registry {
	r, err := converter.NewRegistry(Adapters()...)
	if err != nil {
		panic(err) // the list above is static; a duplicate is a programming error caught by tests
	}
	return r
}
