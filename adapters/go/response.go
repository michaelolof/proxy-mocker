package proxymocker

import (
	"net/http"
	"time"
)

// MockResponse is a resolved mock response, ready to be written to an
// http.ResponseWriter.
type MockResponse struct {
	Status  int
	Headers http.Header
	Body    []byte
	DelayMs int
}

// WriteTo applies DelayMs (if any) and writes the mock's status, headers, and
// body to w.
//
// The delay is a plain time.Sleep in the calling goroutine — since net/http
// serves each request on its own goroutine, this blocks only the request
// being mocked, not the rest of the server. This is deliberately different
// from the Vite/http-proxy-middleware plugin's dev-only waitBlock, which
// busy-waits the whole event loop (see src/utils.ts).
func (m *MockResponse) WriteTo(w http.ResponseWriter) {
	if m.DelayMs > 0 {
		time.Sleep(time.Duration(m.DelayMs) * time.Millisecond)
	}

	dst := w.Header()
	for k, v := range m.Headers {
		dst[k] = v
	}
	w.WriteHeader(m.Status)
	w.Write(m.Body)
}
