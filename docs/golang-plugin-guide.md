# Using `proxy-mocker` with a Go proxy — User Guide

> **Status: implemented.** `MockRouter`/`MockProxy`, `startMockSidecar` (§3.1), and the
> **`proxymocker` Go package** (§3.2, §6 — `NewUnixClient`/`NewTCPClient`, `Match`, `WaitReady`,
> `Middleware`, `NewReverseProxyMiddleware`) are all real, shipped, and tested — Phases 0-4 of
> `plans/golang-plugin.md` are done, including a committed cross-language integration test
> (`adapters/go/client_test.go`) that boots a real sidecar and drives it with the real Go client.
> Only Phase 5 (this doc pass, README, changelog) remains.
>
> This guide shows how a team running a **Go reverse proxy** reuses `proxy-mocker`'s typed mock
> definitions during local development. See `plans/golang-plugin.md` for the design/rationale.
>
> **Mental model:** you author mocks in TypeScript (fully typed from your OpenAPI schema), run them
> as a tiny **Node sidecar**, and your Go proxy asks the sidecar — per request — "should I mock
> this?" If yes, the Go proxy returns the mock and never dials the real upstream. If no, the request
> flows through to the real backend, untouched.

---

## Table of contents
1. [How it fits together](#1-how-it-fits-together)
2. [Prerequisites & install](#2-prerequisites--install)
3. [Quickstart (end to end)](#3-quickstart-end-to-end)
4. [Authoring mocks (the TypeScript side)](#4-authoring-mocks-the-typescript-side)
5. [Recipes](#5-recipes)
6. [The Go side in depth](#6-the-go-side-in-depth)
7. [Dev workflow](#7-dev-workflow)
8. [Configuration reference](#8-configuration-reference)
9. [Behavior & guarantees](#9-behavior--guarantees)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. How it fits together

```
  browser / client
        │
        ▼
  ┌───────────────────────────┐        POST /__match          ┌──────────────────────────┐
  │ Go reverse proxy          │ ───────────────────────────▶  │ Node sidecar (proxy-mocker)│
  │  proxymocker.Middleware   │ ◀───────────────────────────  │  startMockSidecar(proxy)   │
  │                           │   { matched, status, body }   │  your typed mock file      │
  └───────────────────────────┘                               └──────────────────────────┘
        │  (no match → pass through)
        ▼
  real upstream API
```

Three pieces you touch:
1. **`mocks.ts`** — your typed mock definitions + `startMockSidecar(...)`. (Node process.)
2. **Your Go proxy** — add one line: wrap your handler with `proxymocker.Middleware(client, next)`.
3. **A socket path** both sides agree on (e.g. `/tmp/proxy-mocker.sock`).

> **An alternative if you'd rather not add a Go dependency:** a `passthrough` **dedicated mock
> server** (`docs/mock-server-guide.md`) is a language-agnostic option — run the mock server, point
> your Go proxy at it as an upstream, and it serves mocks or forwards to the real API itself, with
> no `proxymocker` Go package required at all. You still run a Node process alongside your Go proxy
> (that's unavoidable — mocks are live JS), but you skip the per-request RPC client and its import.
> Trade-off: the mock server owns the upstream dial instead of your Go proxy. Use the RPC client
> (this guide) when the Go proxy must keep its own routing/upstream logic; use the passthrough
> server when it doesn't.

---

## 2. Prerequisites & install

- Node 18+ and Go 1.21+.
- Your OpenAPI types generated with [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript):
  ```bash
  npx openapi-typescript ./openapi.yaml -o ./src/api.ts
  ```

Install the TS library (sidecar side):
```bash
npm i -D proxy-mocker
```

Add the Go client (proxy side):
```bash
go get github.com/michaelolof/proxy-mocker/adapters/go
```

---

## 3. Quickstart (end to end)

### 3.1 `mocks.ts` — author mocks and start the sidecar

```ts
import { MockRouter, MockProxy, startMockSidecar } from "proxy-mocker";
import type { paths } from "./api"; // openapi-typescript output

const router = new MockRouter<paths>();

// Mock GET /users → 200 with a typed array
router.url("/users", {
  get: [{
    response: {
      success: [
        { id: 1, name: "Ada Lovelace" },
        { id: 2, name: "Grace Hopper" },
      ],
    },
  }],
});

// Mock GET /users/{id} → 200, response derived from the path param
router.url("/users/{id}", {
  get: [{
    response: {
      success: (req) => ({ id: Number(req?.path?.id), name: "Mock User" }),
    },
  }],
});

const proxy = new MockProxy();
proxy.register(router);

startMockSidecar(proxy, {
  socketPath: "/tmp/proxy-mocker.sock",
  onListen: (addr) => console.log(`proxy-mocker sidecar listening on ${addr}`),
});
```

Run it:
```bash
npx tsx mocks.ts          # or: node --loader tsx mocks.ts
```

### 3.2 `main.go` — wire the sidecar into your Go proxy

```go
package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"

	proxymocker "github.com/michaelolof/proxy-mocker/adapters/go"
)

func main() {
	// Your real upstream.
	upstream, _ := url.Parse("https://api.example.com")
	rp := httputil.NewSingleHostReverseProxy(upstream)

	// Connect to the sidecar over the shared socket.
	client := proxymocker.NewUnixClient("/tmp/proxy-mocker.sock")

	// Mock-or-passthrough: if the sidecar has a mock, it's served;
	// otherwise the request goes to the real upstream.
	handler := proxymocker.Middleware(client, rp)

	log.Println("proxy on :4000")
	log.Fatal(http.ListenAndServe(":4000", handler))
}
```

### 3.3 Try it
```bash
curl localhost:4000/users            # → mocked JSON array
curl localhost:4000/users/42         # → {"id":42,"name":"Mock User"}
curl localhost:4000/health           # → not mocked → real upstream
```

That's the whole loop. Everything below is detail.

---

## 4. Authoring mocks (the TypeScript side)

Authoring is identical to using `proxy-mocker` with Vite/http-proxy — the sidecar just changes
*where the matcher runs*. A mock file has three moving parts.

### 4.1 The `paths` type

`openapi-typescript` emits an interface describing every route. `MockRouter<paths>` uses it so that
`url(...)`, request matchers, and response bodies are all type-checked:

```ts
// src/api.ts (generated — shown for reference)
export interface paths {
  "/users": {
    get: {
      parameters: { query?: { active?: boolean } };
      responses: {
        200: { content: { "application/json": { id: number; name: string }[] } };
        "4XX": { content: { "application/json": { error: string } } };
      };
    };
    post: {
      requestBody: { content: { "application/json": { name: string } } };
      responses: {
        201: { content: { "application/json": { id: number; name: string } } };
      };
    };
  };
  "/users/{id}": {
    get: {
      parameters: { path: { id: number } };
      responses: {
        200: { content: { "application/json": { id: number; name: string } } };
        404: { content: { "application/json": { error: string } } };
      };
    };
  };
}
```

### 4.2 A mock definition

Each `url(path, methods)` maps a route to methods, and each method to an **array** of definitions
(the first whose request-constraints match wins):

```ts
router.url("/users", {
  post: [{
    title: "create user (happy path)",     // optional, for readability
    response: {
      statusCode: 201,
      success: (req) => ({ id: 99, name: req?.body?.name ?? "unknown" }),
    },
  }],
});
```

`req` is `{ query, path, header, body }`, each typed from your schema. `success`/`error`/
`statusCode`/`delay`/`header` can each be a **static value or a function** — functions are evaluated
per request in the sidecar (so any JS logic works: random data, counters, reading the body, etc.).

---

## 5. Recipes

### 5.1 Mock some routes, pass the rest through
Just don't register a route and it falls through to the real upstream. Registration is opt-in per
route — the Go `Middleware` only short-circuits on a match.

### 5.2 Simulate an error response
```ts
router.url("/users/{id}", {
  get: [{
    response: {
      statusCode: 404,
      error: { error: "user not found" },   // typed against the 404 schema
    },
  }],
});
```

### 5.3 Return different responses based on the request
Definitions are tried in order; the first with matching `request` constraints wins:

```ts
router.url("/users", {
  get: [
    {
      // only when ?active=true
      request: { query: { active: "true" } },
      response: { success: [{ id: 1, name: "Ada (active)" }] },
    },
    {
      // fallback (no constraints) — matches anything
      response: { success: [] },
    },
  ],
});
```

You can match on `query`, `path`, `header`, or `body` — and now (post-fix) **all specified
constraints must hold together**, not just the first one. Each can be an object (shallow/deep
equality) or a predicate function returning `boolean`:

```ts
router.url("/orders", {
  post: [{
    request: {
      header: (h) => h?.["x-tenant"] === "acme",
      body:   (b) => b?.total > 100,
    },
    response: { statusCode: 201, success: { id: "ord_1" } },
  }],
});
```

### 5.4 Simulate latency
```ts
router.url("/slow", {
  get: [{
    response: {
      delay: 800,                 // ms; or a function: () => 500 + Math.random() * 500
      success: { ok: true },
    },
  }],
});
```
On the Go side this is a **non-blocking** `time.Sleep` in the request's goroutine — other requests
are unaffected. (This is cleaner than the JS/Vite plugin, which busy-waits and only for delays
> 1200ms in dev.)

### 5.5 Custom headers
```ts
response: {
  header: { "x-mock": "true", "cache-control": "no-store" },
  success: { ok: true },
}
```
`content-type: application/json; charset=utf-8` is set by default; your headers merge over it.

### 5.6 Focus mode with `.only()`
While debugging, `only(...)` registers a route that suppresses all others in that router — like
`.only` in a test runner:

```ts
router.only("/users/{id}", {
  get: [{ response: { success: { id: 7, name: "just this one" } } }],
});
```
(It logs a warning; intended for local use.)

### 5.7 Base path prefixing
If your proxy exposes everything under `/api`, register routes bare and let `MockProxy` prefix them:

```ts
const proxy = new MockProxy({ baseURL: "/api" });
proxy.register(router);   // "/users" becomes "/api/users"
```

### 5.8 Non-JSON payloads
Provide codecs for bodies/responses that aren't JSON:

```ts
const proxy = new MockProxy({
  codec: {
    bodyDecoder: (chunks) => decodeProtobuf(Buffer.concat(chunks ?? [])),
    responseEncoder: (payload) => encodeProtobuf(payload),
  },
});
```
Per-definition `request.bodyDecoder` / `response.encoder` override the proxy-level codec.

---

## 6. The Go side in depth

### 6.1 Constructing a client
```go
// Unix socket (recommended)
client := proxymocker.NewUnixClient("/tmp/proxy-mocker.sock")

// TCP fallback (Windows, or when a socket path is awkward). Loopback only.
client := proxymocker.NewTCPClient("127.0.0.1:8787")
```

### 6.2 Waiting for the sidecar to be ready
Avoid a race on startup — block until the sidecar answers `/__health`:
```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()
if err := client.WaitReady(ctx); err != nil {
    log.Printf("mock sidecar not ready, serving live upstream only: %v", err)
}
```

### 6.3 The middleware
```go
handler := proxymocker.Middleware(client, rp) // rp = your ReverseProxy or any http.Handler
```
For the common single-upstream case, `NewReverseProxyMiddleware` builds the `ReverseProxy` for you:
```go
handler := proxymocker.NewReverseProxyMiddleware(client, targetURL) // targetURL: *url.URL
```
Equivalent explicit form if you need custom control:
```go
handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    if resp, ok, err := client.Match(r); err == nil && ok {
        resp.WriteTo(w) // sleeps DelayMs, writes status+headers+body; upstream never dialed
        return
    }
    rp.ServeHTTP(w, r) // real upstream
})
```

### 6.4 Using it with a multi-target gateway
Chain the middleware in front of whatever routing you already have — mocking is decided first, and
anything unmatched hits your existing routing logic unchanged:
```go
gateway := buildYourExistingGateway()      // your current router/proxy
handler := proxymocker.Middleware(client, gateway)
```

---

## 7. Dev workflow

Typical `package.json` scripts:
```jsonc
{
  "scripts": {
    "mocks": "tsx watch mocks.ts"   // reloads the sidecar when mocks change
  }
}
```

Two terminals (or a process runner like `concurrently` / `foreman` / a Makefile):
```bash
# terminal 1 — the mocks
npm run mocks

# terminal 2 — the Go proxy
go run ./cmd/proxy
```

Because the Go client **fails open** (see §9), you can start/stop/edit the sidecar freely without
taking your proxy down — unmatched or unavailable → real upstream.

---

## 8. Configuration reference

### 8.1 `SidecarOptions` (TS — `startMockSidecar(proxy, opts)`)
| Option | Type | Default | Notes |
|---|---|---|---|
| `socketPath` | `string` | — | Unix socket path. Preferred. |
| `port` | `number` | — | TCP fallback (used if no `socketPath`). |
| `host` | `string` | `"127.0.0.1"` | Loopback only; non-loopback is rejected. |
| `matchPath` | `string` | `"/__match"` | Match endpoint. |
| `onListen` | `(addr) => void` | — | Called once listening. |

### 8.2 `MockProxyOptions` (TS — `new MockProxy(opts)`)
| Option | Type | Notes |
|---|---|---|
| `baseURL` | `string` | Prefix applied to every registered route. |
| `codec.bodyDecoder` | `(chunks) => any` | Decode non-JSON request bodies. |
| `codec.responseEncoder` | `(payload) => string` | Encode non-JSON responses. |

### 8.3 Go client options
| Constructor / option | Notes |
|---|---|
| `NewUnixClient(path, ...opts)` | Dial a Unix socket. |
| `NewTCPClient(addr, ...opts)` | Loopback TCP. |
| `WaitReady(ctx)` | Block until `/__health` responds. |
| `Match(r) (*MockResponse, bool, error)` | Low-level check; `ok=false` → pass through. |

---

## 9. Behavior & guarantees

- **Fail-open.** If the sidecar is down, unreachable, or returns an error/`matched:false`, the Go
  middleware passes the request to the real upstream. Your proxy never hard-fails because mocks are
  unavailable.
- **Parity.** A request that would be mocked by the JS/Vite plugin yields a byte-identical
  status/headers/body through the Go path (same `MockProxy` runs in both).
- **No upstream dial on a match.** Mocking means the middleware simply doesn't call `next`, so the
  real backend is never contacted (no `destroyRequestWhenMatched` hack needed).
- **Non-blocking delays.** `delay` is applied via `time.Sleep` in the request goroutine.
- **Local trust boundary.** Unix socket / loopback only, no auth. **Development use only — do not
  run the sidecar in production or expose it on a network.**
- **Body buffering.** The Go client buffers the request body to forward it to the sidecar and to
  restore it for pass-through. Not suited to huge/streaming uploads (fine for dev).

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Everything hits the real upstream | Sidecar not running, or wrong `socketPath` on one side. Check `onListen` log; confirm both use the same path. |
| `connection refused` in Go logs (once) | Sidecar not started yet — use `WaitReady`, or just start the mocks process. Requests still pass through. |
| A route isn't mocked | Path mismatch (`/users/{id}` vs `/users/:id` both work, but the string must match after any `baseURL` prefixing); or an earlier definition's `request` constraints didn't match. Add a no-constraint fallback definition to confirm. |
| Wrong variant returned | Definitions are tried in order — put the most specific `request` constraints first, the fallback last. |
| Response body is empty | You set `error` but a 2xx `statusCode` (or vice versa). `encodeResponse` serializes `success ?? error`; make sure the intended field is populated. |
| Binary/non-JSON garbled | Set `codec.responseEncoder` / `codec.bodyDecoder` (§5.8). |
| Stale mocks after editing | Restart the sidecar, or run it under `tsx watch`. |
