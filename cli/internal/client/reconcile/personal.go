package reconcile

import (
	"fmt"
	"sort"
	"strings"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/api"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/client/local"
)

// PersonalSource pages the authenticated user's catalog without project scope.
type PersonalSource interface {
	PersonalPlan(cursor string) (api.SetupPlan, error)
}

// ResolveConfigured keeps legacy project plans and personal selections in one union.
// A disappeared personal selection is an error: sync must not silently remove it.
func ResolveConfigured(src Source, cfg local.Config) (Desired, error) {
	var d Desired
	var err error
	if len(cfg.Projects) > 0 {
		d, err = Resolve(src, cfg.Projects)
		if err != nil {
			return d, err
		}
	} else {
		d = Desired{Plugins: map[string]*Want{}, Agents: map[string][]string{}, Missing: map[string][]string{}}
	}
	if cfg.PersonalPlugins == nil && len(cfg.Projects) > 0 {
		return d, nil
	}
	personal, ok := src.(PersonalSource)
	if !ok {
		return d, fmt.Errorf("API client does not support personal installation")
	}
	pending := map[string]bool{}
	for _, name := range cfg.PersonalPlugins {
		if !api.ValidPluginName(name) {
			return d, fmt.Errorf("invalid personal plugin %q", name)
		}
		pending[name] = true
	}
	cursor := ""
	seen := map[string]bool{}
	for pages := 0; ; pages++ {
		if pages == maxOptionalPages {
			return d, fmt.Errorf("personal catalog has more than %d pages", maxOptionalPages)
		}
		if seen[cursor] {
			return d, fmt.Errorf("personal catalog repeated a cursor")
		}
		seen[cursor] = true
		plan, err := personal.PersonalPlan(cursor)
		if err != nil {
			return d, err
		}
		if d.GatewayURL != "" && d.GatewayURL != plan.Gateway.URL {
			return d, fmt.Errorf("personal catalog and configured projects use different gateways; nothing was changed")
		}
		d.GatewayURL = plan.Gateway.URL
		for _, it := range plan.Optional.Items {
			if pending[it.Plugin.Name] {
				if err := d.add("personal", it); err != nil {
					return d, err
				}
				delete(pending, it.Plugin.Name)
			}
		}
		if len(pending) == 0 {
			return d, nil
		}
		if plan.Optional.NextCursor == nil {
			break
		}
		cursor = *plan.Optional.NextCursor
	}
	missing := make([]string, 0, len(pending))
	for name := range pending {
		missing = append(missing, name)
	}
	sort.Strings(missing)
	return d, fmt.Errorf("personal catalog has no plugin %s; nothing was changed", strings.Join(missing, ", "))
}
