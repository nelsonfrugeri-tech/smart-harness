// Package reconcile turns the setup-plans of every configured project into installs, updates and
// removals of plugin directories.
//
// Plugins are installed globally by name, so the desired set is the union over all projects. A
// plugin leaves only when no project needs it, and two projects that pin different digests of the
// same plugin are an error found before anything changes.
package reconcile

import (
	"errors"
	"fmt"
	"io"
	"slices"
	"sort"
	"strings"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/install"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pack"
)

// maxOptionalPages bounds the Marketplace pages read to find chosen optionals.
const maxOptionalPages = 100

// Source is the part of the API client that reconcile uses.
type Source interface {
	SetupPlan(slug string) (api.SetupPlan, error)
	Optionals(slug, cursor string) (api.Page, error)
	PluginArchive(it api.PluginItem) ([]byte, error)
}

// Want is one plugin version and the projects that need it.
type Want struct {
	Item     api.PluginItem
	Projects []string
}

// Desired is the union of the plans.
type Desired struct {
	GatewayURL string
	Plugins    map[string]*Want
	Agents     map[string][]string // project -> "<plugin>:<agent>" of its baseline
	Missing    map[string][]string // project -> chosen optionals the API no longer offers
}

// Resolve reads the plan of every project, sorted by slug, and merges them.
func Resolve(src Source, projects map[string]local.Project) (Desired, error) {
	d := Desired{Plugins: map[string]*Want{}, Agents: map[string][]string{}, Missing: map[string][]string{}}
	if len(projects) == 0 {
		return d, errors.New("no project is configured; run harness setup <project> --api-url <url>")
	}
	slugs := make([]string, 0, len(projects))
	for slug := range projects {
		slugs = append(slugs, slug)
	}
	sort.Strings(slugs)
	for _, slug := range slugs {
		plan, err := src.SetupPlan(slug)
		if err != nil {
			return d, fmt.Errorf("project %s: %w", slug, err)
		}
		if d.GatewayURL != "" && plan.Gateway.URL != d.GatewayURL {
			return d, fmt.Errorf("project %s uses gateway %s, but another configured project uses %s; nothing was changed", slug, plan.Gateway.URL, d.GatewayURL)
		}
		d.GatewayURL = plan.Gateway.URL
		optionals, missing, err := chooseOptionals(src, slug, plan, projects[slug].IncludeOptional)
		if err != nil {
			return d, fmt.Errorf("project %s: %w", slug, err)
		}
		if len(missing) > 0 {
			d.Missing[slug] = missing
		}
		for _, it := range plan.Baseline {
			for _, c := range it.Components {
				if c.Kind == "agent" {
					d.Agents[slug] = append(d.Agents[slug], it.Plugin.Name+":"+c.Name)
				}
			}
		}
		for _, it := range append(append([]api.PluginItem{}, plan.Baseline...), optionals...) {
			if err := d.add(slug, it); err != nil {
				return d, err
			}
		}
	}
	return d, nil
}

func (d *Desired) add(slug string, it api.PluginItem) error {
	name := it.Plugin.Name
	w, ok := d.Plugins[name]
	if !ok {
		d.Plugins[name] = &Want{Item: it, Projects: []string{slug}}
		return nil
	}
	if w.Item.Version.Digest != it.Version.Digest {
		return fmt.Errorf("plugin %s: project %s needs %s (%s) and project %s needs %s (%s); one directory cannot hold both, nothing was changed",
			name, strings.Join(w.Projects, ", "), w.Item.Version.Version, w.Item.Version.Digest, slug, it.Version.Version, it.Version.Digest)
	}
	if !slices.Contains(w.Projects, slug) {
		w.Projects = append(w.Projects, slug)
	}
	return nil
}

// chooseOptionals finds each chosen optional in the plan's first page and then in the following
// Marketplace pages. A name in the baseline is skipped; a name not found is returned as missing.
func chooseOptionals(src Source, slug string, plan api.SetupPlan, names []string) ([]api.PluginItem, []string, error) {
	if len(names) == 0 {
		return nil, nil, nil
	}
	pending := map[string]bool{}
	for _, n := range names {
		pending[n] = true
	}
	for _, it := range plan.Baseline {
		delete(pending, it.Plugin.Name)
	}
	var found []api.PluginItem
	take := func(items []api.PluginItem) {
		for _, it := range items {
			if pending[it.Plugin.Name] {
				found = append(found, it)
				delete(pending, it.Plugin.Name)
			}
		}
	}
	take(plan.Optional.Items)
	cursor := plan.Optional.NextCursor
	for pages := 0; len(pending) > 0 && cursor != nil; pages++ {
		if pages == maxOptionalPages {
			return nil, nil, fmt.Errorf("optionals have more than %d pages", maxOptionalPages)
		}
		page, err := src.Optionals(slug, *cursor)
		if err != nil {
			return nil, nil, err
		}
		take(page.Items)
		cursor = page.NextCursor
	}
	var missing []string
	for n := range pending {
		missing = append(missing, n)
	}
	sort.Strings(missing)
	return found, missing, nil
}

// Kind of change to one plugin directory.
type Kind string

const (
	Install Kind = "install"
	Update  Kind = "update"
	Keep    Kind = "keep"
	Remove  Kind = "remove"
)

// Action is the change to one plugin.
type Action struct {
	Kind Kind
	Name string
	Want *Want // nil for Remove
}

// Diff compares the desired set with the config and the skills directory. A directory in skills/
// that the config does not list belongs to someone else: every such conflict is reported and
// nothing is planned. Actions are sorted by name, with removals last.
func Diff(d Desired, cfg local.Config, store install.Store) ([]Action, error) {
	var actions []Action
	var unmanaged []string
	names := make([]string, 0, len(d.Plugins))
	for name := range d.Plugins {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		rec, managed := cfg.Plugins[name]
		exists, err := store.Exists(name)
		if err != nil {
			return nil, err
		}
		switch {
		case exists && !managed:
			unmanaged = append(unmanaged, store.Dir(name))
		case !exists:
			actions = append(actions, Action{Kind: Install, Name: name, Want: d.Plugins[name]})
		case rec.Digest == d.Plugins[name].Item.Version.Digest && intact(store.Dir(name), rec):
			actions = append(actions, Action{Kind: Keep, Name: name, Want: d.Plugins[name]})
		default:
			actions = append(actions, Action{Kind: Update, Name: name, Want: d.Plugins[name]})
		}
	}
	if len(unmanaged) > 0 {
		return nil, fmt.Errorf("%s already exists and was not installed by harness; move it away and run again (nothing was changed)", strings.Join(unmanaged, ", "))
	}
	var removed []string
	for name := range cfg.Plugins {
		if _, ok := d.Plugins[name]; !ok {
			removed = append(removed, name)
		}
	}
	sort.Strings(removed)
	for _, name := range removed {
		actions = append(actions, Action{Kind: Remove, Name: name})
	}
	return actions, nil
}

// Apply downloads and stages every new version first, then swaps them in one by one and removes
// what no project needs. The config is saved after each change, so it always matches the disk.
// A failure stops at that plugin: earlier changes stay, the failed plugin keeps its previous version.
func Apply(actions []Action, cfg *local.Config, store install.Store, src Source, save func() error, out io.Writer) error {
	staged := map[string]string{}
	contents := map[string]string{}
	discardAll := func() {
		for _, dir := range staged {
			store.Discard(dir)
		}
	}
	for _, a := range actions {
		if a.Kind != Install && a.Kind != Update {
			continue
		}
		archive, err := src.PluginArchive(a.Want.Item)
		if err != nil {
			discardAll()
			return fmt.Errorf("plugin %s: %w (nothing was changed)", a.Name, err)
		}
		dir, content, err := store.Stage(a.Name, archive, a.Want.Item.Version.Digest)
		if err != nil {
			discardAll()
			return fmt.Errorf("%w (nothing was changed)", err)
		}
		staged[a.Name], contents[a.Name] = dir, content
	}
	for _, a := range actions {
		switch a.Kind {
		case Install, Update:
			if err := store.Swap(a.Name, staged[a.Name]); err != nil {
				discardAll()
				return err
			}
			delete(staged, a.Name)
			before := cfg.Plugins[a.Name].Version
			cfg.Plugins[a.Name] = record(a.Want, contents[a.Name])
			if err := save(); err != nil {
				discardAll()
				return err
			}
			if a.Kind == Install {
				fmt.Fprintf(out, "installed %s %s (%s)\n", a.Name, a.Want.Item.Version.Version, a.Want.Item.Version.Digest)
			} else {
				fmt.Fprintf(out, "updated %s %s -> %s (%s)\n", a.Name, before, a.Want.Item.Version.Version, a.Want.Item.Version.Digest)
			}
		case Keep:
			rec := cfg.Plugins[a.Name]
			rec.Projects = sortedCopy(a.Want.Projects)
			rec.Components = slices.Clone(a.Want.Item.Components)
			cfg.Plugins[a.Name] = rec
			fmt.Fprintf(out, "unchanged %s %s\n", a.Name, rec.Version)
		case Remove:
			if err := store.Remove(a.Name); err != nil {
				return err
			}
			delete(cfg.Plugins, a.Name)
			if err := save(); err != nil {
				return err
			}
			fmt.Fprintf(out, "removed %s\n", a.Name)
		}
	}
	return save()
}

// intact reports whether the installed directory still has the content recorded at install time.
// A directory changed by hand is reinstalled.
func intact(dir string, rec local.Installed) bool {
	got, err := pack.DirDigest(dir)
	return err == nil && got == rec.ContentDigest
}

func record(w *Want, content string) local.Installed {
	return local.Installed{
		Version:       w.Item.Version.Version,
		Components:    slices.Clone(w.Item.Components),
		Digest:        w.Item.Version.Digest,
		ContentDigest: content,
		Projects:      sortedCopy(w.Projects),
	}
}

func sortedCopy(s []string) []string {
	out := slices.Clone(s)
	sort.Strings(out)
	return out
}
