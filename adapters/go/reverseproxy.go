package proxymocker

import (
	"net/http"
	"net/http/httputil"
	"net/url"
)

// NewReverseProxyMiddleware wraps a single-target httputil.ReverseProxy to
// target with Middleware, so requests are served from mocks when c reports a
// match and forwarded to target otherwise. It's a convenience for the common
// case; build your own http.Handler and call Middleware directly for
// anything more elaborate (multiple upstreams, custom routing, etc).
func NewReverseProxyMiddleware(c *Client, target *url.URL) http.Handler {
	rp := httputil.NewSingleHostReverseProxy(target)
	return Middleware(c, rp)
}
