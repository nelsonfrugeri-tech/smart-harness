// Package api is the HTTP client of the control plane routes used by the CLI.
//
// Every call makes one attempt with a timeout and no retry. The token travels only in the
// Authorization header of requests to the configured API origin; error messages never contain it.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/digest"
	"github.com/nelsonfrugeri-tech/smart-harness/cli/internal/engine/pack"
)

// Timeouts of one request. Archives are at most pack.MaxArchiveBytes.
const (
	jsonTimeout    = 15 * time.Second
	archiveTimeout = 2 * time.Minute
	maxJSONBytes   = 4 << 20
)

// DigestHeader carries the sha256 of an archive body.
const DigestHeader = "x-package-digest"

var (
	pluginNameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
	versionRe    = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$`)
	tokenRe      = regexp.MustCompile(`^shg_[A-Za-z0-9_-]{43}$`)
	draftIDRe    = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)
)

// ValidPluginName reports whether name is a plugin name of the API, safe as a directory name.
func ValidPluginName(name string) bool { return pluginNameRe.MatchString(name) }

// ValidToken reports whether token has the gateway token format shg_ + 43 base64url characters.
func ValidToken(token string) bool { return tokenRe.MatchString(token) }

// ValidDraftID reports whether id is safe in a URL path and as a directory name.
func ValidDraftID(id string) bool { return draftIDRe.MatchString(id) }

// Client calls one API origin with one gateway token.
type Client struct {
	base  *url.URL
	token string
	http  *http.Client
}

// New checks the API URL: absolute http or https, no user info, query or fragment.
func New(apiURL, token string) (*Client, error) {
	base, err := ParseBaseURL(apiURL)
	if err != nil {
		return nil, err
	}
	// Redirects are not followed: the token must not travel to another location.
	hc := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &Client{base: base, token: token, http: hc}, nil
}

// ParseBaseURL accepts an absolute http or https URL without user info, query or fragment, and
// returns it without a trailing slash.
func ParseBaseURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("URL %q must be absolute http or https, without user info, query or fragment", raw)
	}
	u.Path = strings.TrimRight(u.Path, "/")
	return u, nil
}

// HTTPError is a non-2xx answer. Code is the problem+json code when the body has one.
type HTTPError struct {
	Status int
	Code   string
	Detail string
}

func (e *HTTPError) Error() string {
	msg := fmt.Sprintf("API answered %d", e.Status)
	if e.Code != "" {
		msg += " " + e.Code
	}
	if e.Detail != "" {
		msg += ": " + e.Detail
	}
	return msg
}

// IsStatus reports whether err is an HTTPError with the given status.
func IsStatus(err error, status int) bool {
	var he *HTTPError
	return errors.As(err, &he) && he.Status == status
}

// Me is the part of GET /v1/me the CLI uses.
type Me struct {
	User struct {
		Email string `json:"email"`
	} `json:"user"`
}

// Component is one agent, skill or MCP of a plugin version.
type Component struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

// PluginItem is a plugin with one version, as in the setup-plan and the Marketplace.
type PluginItem struct {
	Plugin struct {
		Name string `json:"name"`
	} `json:"plugin"`
	Version struct {
		Version    string `json:"version"`
		Digest     string `json:"digest"`
		ArchiveURL string `json:"archive_url"`
	} `json:"version"`
	Components []Component `json:"components"`
}

// Page is one page of plugins.
type Page struct {
	Items      []PluginItem `json:"items"`
	NextCursor *string      `json:"next_cursor"`
}

// SetupPlan is GET /v1/projects/{slug}/setup-plan.
type SetupPlan struct {
	Project struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
	} `json:"project"`
	Gateway struct {
		URL string `json:"url"`
	} `json:"gateway"`
	Baseline []PluginItem `json:"baseline"`
	Optional Page         `json:"optional"`
}

// Me returns the caller of the token. A rejected token answers an HTTPError with status 401.
func (c *Client) Me() (Me, error) {
	var me Me
	err := c.getJSON("/v1/me", &me)
	return me, err
}

// SetupPlan returns the plan of a project, with every plugin item checked.
func (c *Client) SetupPlan(slug string) (SetupPlan, error) {
	var plan SetupPlan
	if err := c.getJSON("/v1/projects/"+url.PathEscape(slug)+"/setup-plan", &plan); err != nil {
		return plan, err
	}
	if _, err := ParseBaseURL(plan.Gateway.URL); err != nil {
		return plan, fmt.Errorf("setup-plan gateway: %w", err)
	}
	for _, it := range append(append([]PluginItem{}, plan.Baseline...), plan.Optional.Items...) {
		if err := checkItem(it); err != nil {
			return plan, err
		}
	}
	return plan, nil
}

// Optionals returns the project's optionals page that follows cursor.
func (c *Client) Optionals(slug, cursor string) (Page, error) {
	var page Page
	q := url.Values{"project": {slug}, "limit": {"100"}}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	if err := c.getJSON("/v1/marketplace?"+q.Encode(), &page); err != nil {
		return page, err
	}
	for _, it := range page.Items {
		if err := checkItem(it); err != nil {
			return page, err
		}
	}
	return page, nil
}

// checkItem rejects a name unsafe as a directory, a bad digest and an archive URL that would
// send the token outside the API origin.
func checkItem(it PluginItem) error {
	name := it.Plugin.Name
	if !ValidPluginName(name) {
		return fmt.Errorf("plan has an invalid plugin name %q", name)
	}
	if !versionRe.MatchString(it.Version.Version) || !digest.Valid(it.Version.Digest) {
		return fmt.Errorf("plan has an invalid version or digest for plugin %s", name)
	}
	if !strings.HasPrefix(it.Version.ArchiveURL, "/v1/") {
		return fmt.Errorf("plan has an archive URL outside the API for plugin %s", name)
	}
	return nil
}

// PluginArchive downloads the archive of a plan item and checks it against the item's digest.
func (c *Client) PluginArchive(it PluginItem) ([]byte, error) {
	data, _, err := c.archive(it.Version.ArchiveURL, it.Version.Digest)
	return data, err
}

// DraftArchive downloads GET /v1/drafts/{id}/archive and returns the body and its digest, taken
// from the x-package-digest header and checked against the body.
func (c *Client) DraftArchive(id string) ([]byte, string, error) {
	if !ValidDraftID(id) {
		return nil, "", fmt.Errorf("invalid draft id %q", id)
	}
	return c.archive("/v1/drafts/"+id+"/archive", "")
}

// archive downloads a gzip body. The x-package-digest header must be a valid digest, equal to
// the sha256 of the body and, when want is not empty, equal to want.
func (c *Client) archive(path, want string) ([]byte, string, error) {
	resp, err := c.do(path, archiveTimeout)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, pack.MaxArchiveBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("download %s: %w", path, err)
	}
	if len(data) > pack.MaxArchiveBytes {
		return nil, "", fmt.Errorf("download %s: archive is larger than %d bytes", path, pack.MaxArchiveBytes)
	}
	header := resp.Header.Get(DigestHeader)
	if !digest.Valid(header) {
		return nil, "", fmt.Errorf("download %s: missing or invalid %s header", path, DigestHeader)
	}
	if got := digest.Of(data); got != header {
		return nil, "", fmt.Errorf("download %s: body digest %s does not match header %s", path, got, header)
	}
	if want != "" && header != want {
		return nil, "", fmt.Errorf("download %s: digest %s does not match the plan digest %s", path, header, want)
	}
	return data, header, nil
}

func (c *Client) getJSON(path string, out any) error {
	resp, err := c.do(path, jsonTimeout)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxJSONBytes))
	if err != nil {
		return fmt.Errorf("GET %s: %w", path, err)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("GET %s: invalid JSON answer: %w", path, err)
	}
	return nil
}

// do sends an authenticated GET and turns a non-2xx answer into an HTTPError.
func (c *Client) do(path string, timeout time.Duration) (*http.Response, error) {
	ref, err := url.Parse(path)
	if err != nil {
		return nil, err
	}
	target := *c.base
	target.Path = c.base.Path + ref.Path
	target.RawQuery = ref.RawQuery
	req, err := http.NewRequest(http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	hc := *c.http
	hc.Timeout = timeout
	resp, err := hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("GET %s: %w", target.Redacted(), unwrapURLError(err))
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		defer resp.Body.Close()
		return nil, problem(resp)
	}
	return resp, nil
}

// unwrapURLError drops the *url.Error wrapper, which repeats the URL already in the message.
func unwrapURLError(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err
	}
	return err
}

func problem(resp *http.Response) error {
	he := &HTTPError{Status: resp.StatusCode}
	var p struct {
		Code   string `json:"code"`
		Detail string `json:"detail"`
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if json.Unmarshal(body, &p) == nil {
		he.Code, he.Detail = p.Code, p.Detail
	}
	return he
}

// Healthy sends an unauthenticated GET <baseURL>/healthz and returns an error unless it answers 2xx.
// It is used for the API and for the gateway, which share the route.
func Healthy(baseURL string) error {
	base, err := ParseBaseURL(baseURL)
	if err != nil {
		return err
	}
	hc := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := hc.Get(base.String() + "/healthz")
	if err != nil {
		return unwrapURLError(err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("/healthz answered %d", resp.StatusCode)
	}
	return nil
}
