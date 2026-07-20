package proxymocker

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultMatchPath  = "/__match"
	defaultHealthPath = "/__health"
	defaultTimeout    = 2 * time.Second
)

var loopbackHosts = map[string]bool{
	"127.0.0.1": true,
	"localhost": true,
	"::1":       true,
}

// Client talks to a proxy-mocker Node sidecar (src/sidecar) over a Unix domain
// socket or loopback TCP. It is a thin HTTP client, not a proxy itself — pair
// it with Middleware or NewReverseProxyMiddleware to actually serve traffic.
type Client struct {
	httpClient *http.Client
	baseURL    string
	matchPath  string
	healthPath string
}

// Option configures a Client returned by NewUnixClient or NewTCPClient.
type Option func(*Client)

// WithMatchPath overrides the sidecar's match endpoint (default "/__match").
// Must agree with the matchPath the sidecar was started with.
func WithMatchPath(path string) Option {
	return func(c *Client) { c.matchPath = path }
}

// WithHealthPath overrides the sidecar's health endpoint (default "/__health").
func WithHealthPath(path string) Option {
	return func(c *Client) { c.healthPath = path }
}

// WithTimeout sets the per-request timeout for Match and health checks
// (default 2s). A dead/unresponsive sidecar should fail open quickly rather
// than hang the request it's supposed to be mocking.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) { c.httpClient.Timeout = d }
}

func newClient(transport http.RoundTripper, baseURL string, opts []Option) *Client {
	c := &Client{
		httpClient: &http.Client{Transport: transport, Timeout: defaultTimeout},
		baseURL:    baseURL,
		matchPath:  defaultMatchPath,
		healthPath: defaultHealthPath,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// NewUnixClient connects to a sidecar listening on a Unix domain socket at
// socketPath (as started by startMockSidecar({ socketPath }) on the Node side).
func NewUnixClient(socketPath string, opts ...Option) *Client {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", socketPath)
		},
	}
	// The host in this URL is never resolved — DialContext above ignores it and
	// always dials socketPath — it only needs to be syntactically valid.
	return newClient(transport, "http://unix", opts)
}

// NewTCPClient connects to a sidecar listening on loopback TCP, e.g.
// "127.0.0.1:8787". proxy-mocker's sidecar is a local dev tool, so addr must
// resolve to a loopback host; NewTCPClient panics otherwise rather than
// silently talking to a non-local address.
func NewTCPClient(addr string, opts ...Option) *Client {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		host = addr
	}
	if !loopbackHosts[strings.ToLower(host)] {
		panic(fmt.Sprintf(
			"proxymocker: NewTCPClient requires a loopback host (127.0.0.1/localhost/::1), got %q",
			host,
		))
	}
	return newClient(http.DefaultTransport, "http://"+addr, opts)
}

// Match asks the sidecar whether r should be mocked.
//
// It reads and restores r.Body (via io.NopCloser over a buffered copy) so the
// caller can still forward the request upstream when ok is false — exactly
// the "passthrough body gotcha" documented in plans/mock-server.md §4, which
// applies here too.
//
// err is only set for a transport-level failure: the sidecar is unreachable,
// or its response couldn't be parsed. Callers should treat a non-nil err
// exactly like ok == false — fail open and pass the request through — never
// hard-fail because the mock sidecar is down. err is never set merely because
// there was no matching mock; that case is ok == false, err == nil.
func (c *Client) Match(r *http.Request) (resp *MockResponse, ok bool, err error) {
	var bodyBytes []byte
	if r.Body != nil {
		bodyBytes, err = io.ReadAll(r.Body)
		r.Body.Close()
		if err != nil {
			r.Body = http.NoBody
			return nil, false, err
		}
	}
	r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	wireReq := wireRequest{
		URLPath: r.URL.Path,
		Method:  r.Method,
		Headers: flattenHeader(r.Header),
		Query:   flattenValues(r.URL.Query()),
		Cookies: flattenCookies(r.Cookies()),
	}
	if len(bodyBytes) > 0 {
		wireReq.BodyB64 = base64.StdEncoding.EncodeToString(bodyBytes)
	}

	payload, err := json.Marshal(wireReq)
	if err != nil {
		return nil, false, err
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, c.baseURL+c.matchPath, bytes.NewReader(payload))
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("content-type", "application/json")

	httpResp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		// A malformed envelope on our side (400) or any other non-2xx from the
		// sidecar: treat as no match rather than a hard error (plan §4.5).
		return nil, false, nil
	}

	var wireResp wireResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&wireResp); err != nil {
		return nil, false, err
	}

	if !wireResp.Matched {
		return nil, false, nil
	}

	body, err := base64.StdEncoding.DecodeString(wireResp.BodyB64)
	if err != nil {
		return nil, false, err
	}

	headers := make(http.Header, len(wireResp.Headers))
	for k, v := range wireResp.Headers {
		headers.Set(k, v)
	}

	return &MockResponse{
		Status:  wireResp.StatusCode,
		Headers: headers,
		Body:    body,
		DelayMs: wireResp.DelayMs,
	}, true, nil
}

// WaitReady blocks until the sidecar's health endpoint responds, or ctx is
// done. Use it once at startup to avoid a race between the Go proxy and a
// Node sidecar that hasn't finished booting yet.
func (c *Client) WaitReady(ctx context.Context) error {
	check := func() bool {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+c.healthPath, nil)
		if err != nil {
			return false
		}
		resp, err := c.httpClient.Do(req)
		if err != nil {
			return false
		}
		defer resp.Body.Close()
		return resp.StatusCode == http.StatusOK
	}

	if check() {
		return nil
	}

	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if check() {
				return nil
			}
		}
	}
}

func flattenHeader(h http.Header) map[string]string {
	if len(h) == 0 {
		return nil
	}
	out := make(map[string]string, len(h))
	for k := range h {
		out[strings.ToLower(k)] = h.Get(k)
	}
	return out
}

func flattenValues(v url.Values) map[string]string {
	if len(v) == 0 {
		return nil
	}
	out := make(map[string]string, len(v))
	for k := range v {
		out[k] = v.Get(k)
	}
	return out
}

func flattenCookies(cookies []*http.Cookie) map[string]string {
	if len(cookies) == 0 {
		return nil
	}
	out := make(map[string]string, len(cookies))
	for _, ck := range cookies {
		out[ck.Name] = ck.Value
	}
	return out
}
