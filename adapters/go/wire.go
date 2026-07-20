package proxymocker

// wireRequest and wireResponse mirror the JSON envelope documented in
// plans/golang-plugin.md §4 and implemented by the Node sidecar in
// src/sidecar/types.ts. They are an internal transport detail, not part of
// this package's public API.

type wireRequest struct {
	URLPath string            `json:"urlPath"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers,omitempty"`
	Query   map[string]string `json:"query,omitempty"`
	Cookies map[string]string `json:"cookies,omitempty"`
	BodyB64 string            `json:"bodyB64,omitempty"`
}

type wireResponse struct {
	Matched    bool              `json:"matched"`
	StatusCode int               `json:"statusCode,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	DelayMs    int               `json:"delayMs,omitempty"`
	BodyB64    string            `json:"bodyB64,omitempty"`
}
