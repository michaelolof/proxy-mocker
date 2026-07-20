package proxymocker

import "net/http"

// Middleware returns an http.Handler that asks c whether each request should
// be mocked before calling next.
//
// On a match, it writes the mock response directly and next is never called
// — the real upstream is never dialed, so there's no equivalent of the
// http-proxy-middleware plugin's destroyRequestWhenMatched (that hack exists
// there specifically to cancel an in-flight upstream dial; here, we simply
// never start one). On no match — including any Client error, which fails
// open by design — next is called with the request untouched (its body has
// already been restored by Match).
func Middleware(c *Client, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if resp, ok, err := c.Match(r); err == nil && ok {
			resp.WriteTo(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}
