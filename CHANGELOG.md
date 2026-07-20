# Changelog

All notable changes to this project are documented in this file.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## 0.1.0

### Added
- `createMockServer` — a standalone `http.Server` adapter with three fallback modes for unmatched
  requests: `notFound` (pure mock, no backend), `passthrough` (default; forwards to a real `target`),
  and a custom `(req, res, parsed) => void` handler. See `docs/mock-server-guide.md`.
- `startMockSidecar` — a Node sidecar exposing `MockProxy` over a JSON/Unix-socket (or loopback TCP)
  protocol (`POST /__match`, `GET /__health`), so a non-Node reverse proxy can query mocks per
  request.
- `adapters/go` — a Go client package (`proxymocker`) for `startMockSidecar`: `NewUnixClient`,
  `NewTCPClient` (loopback-only), `Match`, `WaitReady`, `Middleware`, and a
  `NewReverseProxyMiddleware` convenience wrapper. See `docs/golang-plugin-guide.md`.
- `MockProxy.resolve()` — a single shared "match a request, build the response" entry point now
  used by the existing `http-proxy-middleware` plugin, the mock server, and the sidecar, so all
  three adapters share one implementation instead of duplicating response-building logic.
- Committed test suites: `test/server.test.mjs` and `test/sidecar.test.mjs` (Node's built-in
  `node:test`, no new dependency), and `adapters/go/client_test.go` (a cross-language integration
  test that boots a real Node sidecar and drives it with the real Go client). `npm test` now
  actually builds and runs tests instead of the placeholder `"no test specified"` script.

### Fixed
- Request matching (`query`/`path`/`header`/`body` constraints on a mock definition) previously
  only checked the *first* constraint present, via an `if`/`else if` chain — a mock with both a
  `query` and a `body` matcher would silently ignore the `body` one. All specified constraints are
  now combined with AND.
- Function-based `response.success` / `response.error` were never invoked — `resp.success ||
  resp.error` picked the function object itself, and `JSON.stringify(fn)` silently produced
  `undefined`. Response bodies built from a function are now correctly resolved.
- Functions typed to receive the request (`response.header`, `response.success`,
  `response.error`) were never actually passed one — they always ran with no arguments. They now
  receive the matched request's `{ query, path, header, body }`.
- A malformed `content-type` header check (`checkHeaderValue`) let a `null` header value slip past
  its guard and then threw on property access.
- A `"application/json; charset utf-8"` response header was missing its `=` after `charset`.

### Changed
- `package.json` now declares `"types"` and `"files"`, and `@types/http-proxy` is an explicit
  devDependency (previously relied on implicitly, via whatever the lockfile happened to resolve —
  a clean install without it fails to typecheck).
- `dist/` is no longer committed to git (previously tracked and had drifted from `src/`).
- `Mocker<T>`'s exported type now matches what `MockRouter` actually implements (`url`/`only`/
  `routes`); it previously described a `records()`/`register()` shape that didn't exist on the
  class.

### Removed
- `url-pattern` dependency — declared but never imported; matching is hand-rolled in
  `src/mocker/utils.ts`.
- `extractURLPathParams` — dead code, superseded by `matchURL`, including a broken regex branch.
- The broken, half-written `src/server/server.ts` prototype (an abandoned multi-target Express/
  `http-proxy` sketch pasted in as scratch work) — replaced by the real `createMockServer`.

## 0.0.3 and earlier

Initial `MockRouter`/`MockProxy` core, OpenAPI3-typed mock definitions, and the
`HttpProxyMiddlewarePlugin` / `ViteProxyConfigurePlugin` adapter for `http-proxy`-based dev proxies.
