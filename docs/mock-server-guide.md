# Dedicated Mock Server — User Guide

> `createMockServer` runs `proxy-mocker` as a **standalone HTTP server** instead of an interceptor
> inside someone else's proxy. Point your app, test suite, or another proxy's upstream at it and it
> answers from your typed mocks — with a configurable fallback for anything unmatched.
> See `plans/mock-server.md` for the design/rationale.

---

## Table of contents
1. [How it fits together](#1-how-it-fits-together)
2. [Prerequisites & install](#2-prerequisites--install)
3. [Quickstart](#3-quickstart)
4. [Choosing a fallback mode](#4-choosing-a-fallback-mode)
5. [Recipes](#5-recipes)
6. [Testing with it](#6-testing-with-it)
7. [Configuration reference](#7-configuration-reference)
8. [Behavior & guarantees](#8-behavior--guarantees)
9. [Using it as an upstream for another proxy (any language)](#9-using-it-as-an-upstream-for-another-proxy-any-language)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. How it fits together

```
  client / app / test
        │  real HTTP request
        ▼
  ┌──────────────────────────────────────┐
  │ createMockServer(proxy, opts)          │
  │                                        │
  │  1. read + buffer the request          │
  │  2. proxy.resolve(request)              │
  │       ├─ match    → write mock response │
  │       └─ no match → fallback:            │
  │            • "notFound"    → 404          │
  │            • "passthrough" → forward to   │──▶ real upstream (target)
  │                              `target`      │
  │            • fn(req,res,parsed) → custom   │
  └──────────────────────────────────────┘
```

Unlike the Vite/http-proxy plugin (which hooks into *someone else's* proxy process), this is a real
`http.Server` you start yourself. No host proxy setup required.

---

## 2. Prerequisites & install

```bash
npm i -D proxy-mocker
```

`http-proxy` (already a peer dependency) is only required at runtime if you use `fallback:
"passthrough"` — it's imported lazily, so `notFound`/custom-fallback usage works without it.

---

## 3. Quickstart

### 3.1 Pure mock — no backend at all
```ts
import { MockRouter, MockProxy, createMockServer } from "proxy-mocker";
import type { paths } from "./api"; // openapi-typescript output

const router = new MockRouter<paths>();
router.url("/users", {
  get: [{ response: { success: [{ id: 1, name: "Ada Lovelace" }] } }],
});

const proxy = new MockProxy();
proxy.register(router);

const server = createMockServer(proxy, { port: 4000, fallback: "notFound" });
server.listen(() => console.log("mock server on http://localhost:4000"));
```
```bash
curl localhost:4000/users   # → mocked JSON array
curl localhost:4000/orders  # → 404 { "error": "no mock matched this request" }
```

### 3.2 Mock some routes, real API for the rest
```ts
const server = createMockServer(proxy, {
  port: 4000,
  fallback: "passthrough",           // this is also the default — target becomes required
  target: "https://api.example.com",
});
server.listen();
```
Requests to `/users` are mocked; everything else is forwarded to `https://api.example.com` with
headers and body intact.

### 3.3 Custom handling of unmatched requests
```ts
const server = createMockServer(proxy, {
  port: 4000,
  fallback: (req, res, parsed) => {
    // parsed: { urlPath, method, headers, query, body } — the request has
    // already been read, so use `parsed` rather than re-reading `req`.
    res.writeHead(501, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `no mock for ${parsed.method} ${parsed.urlPath}` }));
  },
});
```

---

## 4. Choosing a fallback mode

| `fallback` | Unmatched request → | Use it when… | Needs `http-proxy`? |
|---|---|---|---|
| `"notFound"` | `404` JSON | you want a **pure mock** — no real backend, ever (frontend dev, CI, offline demos) | no |
| `"passthrough"` (default) | forwarded to `target` | you're mocking a handful of routes and want everything else to hit the real API | yes (peer dep, lazy) |
| `(req, res, parsed) => void` | you decide | record/replay, dynamic upstream selection, custom error shapes | no |

Because `"passthrough"` is the default, **`target` is required unless you explicitly set
`fallback: "notFound"` or provide a function** — omitting it throws immediately when you call
`createMockServer(...)`, not on the first unmatched request.

---

## 5. Recipes

### 5.1 Ephemeral port (good for tests/CI)
```ts
const server = createMockServer(proxy, { port: 0, fallback: "notFound" });
server.listen(() => console.log(`listening on ${server.port}`));
```

### 5.2 Custom 404 body
```ts
createMockServer(proxy, {
  fallback: "notFound",
  notFoundBody: { code: "NOT_MOCKED", message: "add a mock for this route" },
});
```

### 5.3 Mixing with `baseURL`
Same as any other adapter — prefix once on the `MockProxy`, author routes bare:
```ts
const proxy = new MockProxy({ baseURL: "/api" });
proxy.register(router); // "/users" → "/api/users"
```

### 5.4 Simulating latency
Delays are applied with a non-blocking `await wait(ms)` — no busy-waiting, so other in-flight
requests are unaffected:
```ts
router.url("/slow", {
  get: [{ response: { delay: 800, success: { ok: true } } }],
});
```

### 5.5 Everything else (matching, dynamic responses, headers, codecs)
Mock authoring is identical to the Vite/http-proxy plugin and the Go sidecar — see
`docs/golang-plugin-guide.md` §4-5 for the full set of recipes (typed request matchers, function-based
`success`/`error`/`header`, `.only()` focus mode, non-JSON codecs). None of that changes based on
which adapter serves the mocks.

---

## 6. Testing with it

`createMockServer` returns a handle designed for test setup/teardown — `listen`/`close` take a
callback, and `port: 0` picks an OS-assigned port so parallel test files never collide.

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockRouter, MockProxy, createMockServer } from "proxy-mocker";

describe("users API", () => {
  let handle, base;

  before(async () => {
    const router = new MockRouter();
    router.url("/users", { get: [{ response: { success: [{ id: 1, name: "Ada" }] } }] });
    const proxy = new MockProxy();
    proxy.register(router);

    handle = createMockServer(proxy, { port: 0, fallback: "notFound" });
    await new Promise((resolve) => handle.listen(resolve));
    base = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    await new Promise((resolve) => handle.close(resolve));
  });

  it("returns the mocked user list", async () => {
    const res = await fetch(`${base}/users`);
    assert.equal(res.status, 200);
  });
});
```
This is the same pattern used in this repo's own `test/server.test.mjs`.

---

## 7. Configuration reference

### `MockServerOptions`
| Option | Type | Default | Notes |
|---|---|---|---|
| `port` | `number` | `0` (ephemeral) | Pick a fixed port for local dev; `0` for tests/CI. |
| `host` | `string` | `"127.0.0.1"` | |
| `fallback` | `"notFound" \| "passthrough" \| (req, res, parsed) => void` | `"passthrough"` | See §4. |
| `target` | `string` | — | Required when `fallback` is (or defaults to) `"passthrough"`. Validated eagerly. |
| `notFoundBody` | `unknown` | `{ error: "no mock matched this request" }` | Only used with `fallback: "notFound"`. |

### `MockServerHandle`
| Member | Notes |
|---|---|
| `server` | The underlying `http.Server`, for advanced use. |
| `listen(cb?)` | Starts listening; returns the handle (chainable). |
| `close(cb?)` | Stops listening; also closes the lazily-created `http-proxy` instance, if any. |
| `address()` | `http.Server#address()` passthrough. |
| `port` | Resolved port — reads the OS-assigned port after `listen()` when `port: 0` was used. |

---

## 8. Behavior & guarantees

- **Parity with the plugin.** Matched requests produce the same status/headers/body/delay as the
  Vite/http-proxy plugin — both go through the same `MockProxy.resolve()`.
- **Non-blocking delay.** Applied via `await wait(ms)`, never a busy-wait.
- **Passthrough preserves the request body.** The server reads the body once (to match against it),
  then re-buffers it for `http-proxy` via `Readable.from(...)` — a naive re-proxy of an
  already-drained stream would otherwise forward an empty body.
- **Lazy `http-proxy`.** Only imported when `fallback: "passthrough"` is actually used; `notFound`
  and custom-fallback setups don't need it installed.
- **Eager config validation.** A `passthrough` server with no `target` throws at `createMockServer(...)`
  call time, not on the first unmatched request.
- **Dev/test tool.** No TLS, no auth, no production hardening — same trust boundary as any local dev
  proxy.

---

## 9. Using it as an upstream for another proxy (any language)

A `passthrough` mock server is a transparent proxy, so **any** reverse proxy — Go, Rust, Caddy,
nginx, or another Node service — can point at it as an upstream target and get mock-or-forward
behavior for free, with no client library required:

```
Go / Rust / any proxy ──▶ localhost:4000 (this mock server) ──▶ real upstream (on no match)
```

This is the language-agnostic alternative to `proxy-mocker`'s planned Go RPC sidecar
(`docs/golang-plugin-guide.md`): instead of a per-request client call, the host proxy just treats
this server as its backend. Trade-off: this server owns the upstream dial, so the host proxy gives
up its own routing/target-selection logic for whatever traffic it sends here. Use the RPC sidecar
when the host proxy needs to keep that control; use this when it doesn't.

---

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `createMockServer(...)` throws immediately | Default `fallback` is `"passthrough"`, which requires `target`. Pass one, or set `fallback: "notFound"`. |
| Unmatched requests 502 | The `target` upstream is unreachable — check it's running and the URL is correct. |
| Passthrough forwards an empty body | Shouldn't happen — the server re-buffers the body specifically to avoid this. If you see it, check you're not also consuming `req` yourself in a custom fallback before calling `res.end`. |
| A route isn't mocked | Same as any adapter: check path pattern, method, and that all `request` constraints (query/path/header/body) actually match — they're now combined with AND, not first-wins. |
| `EADDRINUSE` on `listen()` | Another process holds that port — use `port: 0` for tests, or free the port. |
| Response body is empty for a `success`/`error` function | Fixed as of the `resolve()`/`encodeResponse` correctness fix — function-based `success`/`error`/`header` now receive the actual request (`query`/`path`/`header`/`body`) and are invoked correctly. Make sure you're on a build that includes it. |
