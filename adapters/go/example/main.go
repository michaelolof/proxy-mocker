// Command example is a runnable demo of proxymocker: it mocks a couple of
// routes and forwards everything else to a real upstream.
//
// Run the companion Node sidecar first (see docs/golang-plugin-guide.md §3.1
// for the mocks.ts this pairs with), then:
//
//	go run ./adapters/go/example
package main

import (
	"log"
	"net/http"
	"net/url"

	proxymocker "github.com/michaelolof/proxy-mocker/adapters/go"
)

func main() {
	target, err := url.Parse("https://api.example.com")
	if err != nil {
		log.Fatal(err)
	}

	// Connect to the sidecar started by the companion mocks.ts.
	client := proxymocker.NewUnixClient("/tmp/proxy-mocker.sock")

	// Mock-or-passthrough: a request the sidecar has a mock for is served
	// directly; anything else is forwarded to target untouched.
	handler := proxymocker.NewReverseProxyMiddleware(client, target)

	log.Println("proxy listening on :4000")
	log.Fatal(http.ListenAndServe(":4000", handler))
}
