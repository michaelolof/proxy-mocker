# proxy-mocker

**Mock API responses for your frontend or tests — with full TypeScript autocomplete generated
straight from your OpenAPI spec.**

No more guessing what shape a response should have, and no more hand-writing types for your mocks.
You describe your API once (via an OpenAPI schema), and `proxy-mocker` uses that description to
type-check every mock you write — the request you're matching against, and the response you're
returning — right in your editor.

```ts
router.url("/users/{id}", {
  get: [{
    response: {
      // TypeScript knows this must match your OpenAPI response schema for GET /users/{id}
      success: (req) => ({ id: req?.path?.id, name: "Ada Lovelace" }),
    },
  }],
});
```

---

## Table of contents

1. [What is this?](#what-is-this)
2. [How does it work?](#how-does-it-work)
3. [Installation](#installation)
4. [Getting started](#getting-started)
5. [Writing mocks: a cookbook](#writing-mocks-a-cookbook)
6. [Three ways to run your mocks](#three-ways-to-run-your-mocks)
7. [Using it in tests](#using-it-in-tests)
8. [Frequently asked questions](#frequently-asked-questions)
9. [Full guides & reference](#full-guides--reference)
10. [Development](#development)
11. [License](#license)

---

## What is this?

`proxy-mocker` lets you fake specific API responses while a real (or partially-real) backend
handles everything else. You define rules like *"when a `GET` request comes in for `/users/42`,
respond with this JSON"* — and the library takes care of matching incoming requests against those
rules and serving the right response.

It's useful when:

- **The backend doesn't exist yet**, but you want to start building the frontend against its
  eventual shape.
- **You want deterministic data in tests** — no flaky network calls, no shared staging database.
- **You need to simulate errors, slow responses, or edge cases** that are hard to trigger against a
  real server (a 500 error, a 3-second delay, a weird header).
- **You only want to mock a handful of endpoints** and let everything else hit the real API
  untouched.

What makes `proxy-mocker` different from most mocking tools is the **typing**: if you generate
TypeScript types from your OpenAPI schema (using the popular
[`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript) tool), `proxy-mocker` uses
those types to check your mocks for you. Get the URL wrong, return the wrong shape of JSON, or
typo a status code your schema doesn't declare, and TypeScript will tell you immediately — before
you ever run the code.

## How does it work?

There are two separate ideas in this library, and understanding the split makes everything else
click into place:

1. **Registering mocks** — you describe *what* should be mocked: which URL, which HTTP method,
   under what conditions (maybe only when a certain query parameter is present), and what to
   respond with. This part never changes no matter how you end up serving the mocks.

2. **Serving mocks** — you choose *how* incoming requests actually reach your mocks. This library
   ships three different ways to do that (covered in detail below), because different setups need
   different plumbing: a Vite dev server, a plain standalone server, or even a proxy written in a
   completely different language like Go.

Here's the shape of it, no matter which serving method you pick:

```
                    incoming request
                          │
                          ▼
              ┌────────────────────────┐
              │   Does it match a       │
              │   registered mock?      │
              └────────────────────────┘
                 │                  │
              yes│                  │no
                 ▼                  ▼
        respond with the       forward to the
        mocked response        real backend
        (never touches            (or return
         the real backend)         a 404 — your choice)
```

That's it. You register rules once, and every request either matches one of them (and gets a fake
response) or falls through to whatever you've configured for "no match" — usually your real API.

## Installation

```bash
npm install --save-dev proxy-mocker
```

That's all you need for the basics. Two optional peer dependencies are only needed if you use
specific features, and `proxy-mocker` will only try to load them when you actually use those
features:

- **`http-proxy`** — needed only if you plug into an existing dev proxy (`HttpProxyMiddlewarePlugin`)
  or use the standalone server's `passthrough` mode to forward unmatched requests to a real API.
- **A Go toolchain** — needed only if your reverse proxy is written in Go (see
  [§6.3](#3-drive-it-from-a-go-or-any-language-proxy)). Nothing else in this library requires Go.

If you want typed mocks (recommended, and the whole point of this library), you'll also want
[`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript) to generate types from
your API's OpenAPI schema:

```bash
npm install --save-dev openapi-typescript
npx openapi-typescript ./openapi.yaml -o ./src/api.ts
```

That command reads your OpenAPI YAML/JSON file and generates a `paths` TypeScript interface
describing every route, method, parameter, and response body. You'll pass that type into
`proxy-mocker` in the next section.

## Getting started

Let's build a complete, runnable example: mock a single endpoint and serve it from a standalone
server, no existing backend or proxy required.

### Step 1 — Register a mock

```ts
// mocks.ts
import { MockRouter, MockProxy } from "proxy-mocker";

const router = new MockRouter();

router.url("/users/42", {
  get: [{
    response: {
      success: { id: 42, name: "Ada Lovelace" },
    },
  }],
});

const proxy = new MockProxy();
proxy.register(router);
```

Read that as: *"for `GET /users/42`, respond with `{ id: 42, name: 'Ada Lovelace' }`."*

### Step 2 — Serve it

```ts
// mocks.ts (continued)
import { createMockServer } from "proxy-mocker";

const server = createMockServer(proxy, { port: 4000, fallback: "notFound" });
server.listen(() => console.log("Mock server running at http://localhost:4000"));
```

### Step 3 — Run it and try it

```bash
npx tsx mocks.ts
```

```bash
curl http://localhost:4000/users/42
# {"id":42,"name":"Ada Lovelace"}

curl -i http://localhost:4000/users/99
# HTTP/1.1 404 Not Found
# {"error":"no mock matched this request"}
```

That's the entire loop. Point your frontend's `API_BASE_URL` at `http://localhost:4000` while
you're developing against endpoints that don't exist yet, or use it as the base URL in your test
suite for fast, deterministic tests.

### Adding types from your OpenAPI schema

The example above works with zero setup, but skips the main feature. Once you've generated a
`paths` type (see [Installation](#installation)), pass it to `MockRouter` as a type parameter:

```ts
import { MockRouter, MockProxy } from "proxy-mocker";
import type { paths } from "./api"; // generated by openapi-typescript

const router = new MockRouter<paths>();

router.url("/users/{id}", {
  get: [{
    response: {
      // If your schema says GET /users/{id} returns { id: number; name: string },
      // TypeScript enforces that shape here — and autocompletes it for you.
      success: (req) => ({ id: Number(req?.path?.id), name: "Ada Lovelace" }),
    },
  }],
});
```

Now if your OpenAPI schema changes — a field gets renamed, a route gets removed — TypeScript will
immediately flag every mock that no longer matches reality.

## Writing mocks: a cookbook

Every mock is registered with `router.url(path, methods)`. `methods` is an object keyed by HTTP
method (`get`, `post`, `put`, `delete`, ...), and each method maps to an **array** of mock
definitions. The first definition in the array whose conditions match the incoming request wins.

Each example below is independent and uses a plain, untyped `router` for clarity — none of them
depend on the `paths` type shown earlier. Everything works identically on a typed
`MockRouter<paths>`; just make sure the URL and response shape match your own schema.

### A basic mock

```ts
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
```

### Path parameters

Use `{param}` or `:param` in the URL — both work — and read it back via `req.path`:

```ts
router.url("/users/{id}", {
  get: [{
    response: {
      success: (req) => ({ id: Number(req?.path?.id), name: "Mock User" }),
    },
  }],
});
```

### Matching on query parameters, headers, or the request body

Give a mock `request` conditions, and it only matches requests satisfying **all** of them:

```ts
router.url("/orders", {
  post: [
    {
      // Only matches when ?tier=gold is present AND the body has total >= 100
      request: {
        query: { tier: "gold" },
        body: (b) => b?.total >= 100,
      },
      response: { statusCode: 201, success: { id: "ord_1", discount: true } },
    },
    {
      // Falls back to this for every other POST /orders (no conditions = matches anything)
      response: { statusCode: 201, success: { id: "ord_2", discount: false } },
    },
  ],
});
```

Conditions can be a plain object (checked for equality) or a function returning `true`/`false` for
full control.

### Simulating error responses

Register the error case on its own URL (or add a `request` condition, as shown above, if you want
it to depend on the incoming request):

```ts
router.url("/users/9999", {
  get: [{
    response: {
      statusCode: 404,
      error: { error: "user not found" },
    },
  }],
});
```

### Simulating network delay

```ts
router.url("/slow-endpoint", {
  get: [{
    response: {
      delay: 1500, // milliseconds — or a function: () => 500 + Math.random() * 1000
      success: { ok: true },
    },
  }],
});
```

### Custom response headers

```ts
router.url("/users", {
  get: [{
    response: {
      header: { "x-mock": "true", "cache-control": "no-store" },
      success: { ok: true },
    },
  }],
});
```

### Grouping and reusing mocks

`MockRouter` instances can be composed — define mocks for a feature area in one place, and combine
them under a single `MockProxy`:

```ts
const usersRouter = new MockRouter<paths>();
usersRouter.url("/users", { /* ... */ });

const ordersRouter = new MockRouter<paths>();
ordersRouter.url("/orders", { /* ... */ });

const proxy = new MockProxy();
proxy.register(usersRouter);
proxy.register(ordersRouter);
```

You can also prefix every route in a proxy at once, useful if your real API lives under a base
path like `/api`:

```ts
const proxy = new MockProxy({ baseURL: "/api" });
proxy.register(usersRouter); // "/users" is served as "/api/users"
```

### Debugging with `.only()`

While working on one endpoint, `.only()` temporarily suppresses every other mock registered on
that router — handy for isolating a single case without deleting your other mocks:

```ts
router.only("/users/{id}", {
  get: [{ response: { success: { id: 1, name: "just this one" } } }],
});
```

## Three ways to run your mocks

Once your mocks are registered on a `MockProxy`, you need to decide how requests actually reach it.
Pick whichever matches your setup:

### 1. Standalone mock server — the simplest option

Start a real HTTP server that answers from your mocks directly. Best when you don't already have a
dev proxy, or you want something simple to point a test suite at.

```ts
import { createMockServer } from "proxy-mocker";

const server = createMockServer(proxy, {
  port: 4000,
  fallback: "passthrough",              // unmatched requests forward to a real API...
  target: "https://api.example.com",    // ...this one
});
server.listen();
```

Three fallback modes are available for anything that doesn't match a mock:

| `fallback` | What happens to unmatched requests |
|---|---|
| `"notFound"` | Returns a `404` — use this for a pure mock with no real backend at all. |
| `"passthrough"` (default) | Forwarded to a real `target` URL — mock a few routes, real API for the rest. |
| a function you provide | Full custom control. |

**Full guide, more examples, and a test-suite recipe:** [`docs/mock-server-guide.md`](docs/mock-server-guide.md).

### 2. Plug into an existing Vite / `http-proxy` dev server

If your project already proxies API requests through Vite (or any tool built on the `http-proxy`
package), attach `proxy-mocker` directly to that existing proxy instead of running a second server:

```ts
import { createProxyServer } from "http-proxy";
import { HttpProxyMiddlewarePlugin } from "proxy-mocker";

const proxyServer = createProxyServer();
HttpProxyMiddlewarePlugin({ proxy })(proxyServer);
```

Requests that match a mock are answered immediately; everything else continues through to whatever
your existing proxy was already going to do with it.

### 3. Drive it from a Go (or any language) proxy

If your reverse proxy isn't written in Node at all — say, it's a Go service — run your mocks as a
small Node **sidecar** process. Your Go proxy asks the sidecar, for each request, "do you have a
mock for this?" — if yes, it serves the mock and never touches the real backend; if no (or if the
sidecar isn't running), the request just flows through to the real backend as normal. A dev-time
mocking process being down should never break your proxy, so this fails open by design.

```ts
// mocks.ts — the Node side
import { startMockSidecar } from "proxy-mocker";

startMockSidecar(proxy, { socketPath: "/tmp/proxy-mocker.sock" });
```

```go
// main.go — the Go side
import proxymocker "github.com/michaelolof/proxy-mocker/adapters/go"

client := proxymocker.NewUnixClient("/tmp/proxy-mocker.sock")
handler := proxymocker.Middleware(client, realUpstreamHandler)
```

```bash
go get github.com/michaelolof/proxy-mocker/adapters/go
```

This is a **local development tool only** — the sidecar listens on a Unix socket or loopback TCP
with no authentication, and should never be exposed beyond your own machine.

**Full guide, the wire protocol, and Go API reference:** [`docs/golang-plugin-guide.md`](docs/golang-plugin-guide.md).

## Using it in tests

`createMockServer` returns a handle designed for test setup/teardown, including an ephemeral port
(`port: 0`) so parallel test files never collide:

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockRouter, MockProxy, createMockServer } from "proxy-mocker";

describe("users API", () => {
  let handle, baseUrl;

  before(async () => {
    const router = new MockRouter();
    router.url("/users", { get: [{ response: { success: [{ id: 1, name: "Ada" }] } }] });

    const proxy = new MockProxy();
    proxy.register(router);

    handle = createMockServer(proxy, { port: 0, fallback: "notFound" });
    await new Promise((resolve) => handle.listen(resolve));
    baseUrl = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    await new Promise((resolve) => handle.close(resolve));
  });

  it("returns the mocked user list", async () => {
    const res = await fetch(`${baseUrl}/users`);
    assert.equal(res.status, 200);
  });
});
```

This works with any test runner, not just `node:test` — the server is a plain `http.Server`
underneath.

## Frequently asked questions

**Do I need an OpenAPI schema to use this?**
No. `new MockRouter()` works with no type parameter at all — you just lose the autocomplete and
type-checking. Add `<paths>` (generated by `openapi-typescript`) whenever you're ready for it.

**What happens if two mocks could both match the same request?**
The first one in the array wins. Put your most specific conditions first, and a catch-all (no
`request` conditions) last.

**What if I only want to mock *some* endpoints and hit the real API for everything else?**
Every serving method supports this — it's the default behavior for `createMockServer`
(`fallback: "passthrough"`) and the *only* behavior for the Vite/`http-proxy` plugin and the Go
sidecar: anything that doesn't match one of your mocks is forwarded to the real backend untouched.

**Is this safe to use in production?**
No — this is a development and testing tool. None of the serving methods include authentication or
hardening, and the Go sidecar in particular is explicitly local-only.

## Full guides & reference

- [`docs/mock-server-guide.md`](docs/mock-server-guide.md) — the standalone server in depth: all
  three fallback modes, configuration reference, and testing recipes.
- [`docs/golang-plugin-guide.md`](docs/golang-plugin-guide.md) — using `proxy-mocker` from a Go
  proxy: the sidecar, the Go client API, and the wire protocol.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## Development

Contributing to `proxy-mocker` itself? Here's how to build and test it:

```bash
npm run build                     # compiles TypeScript to dist/
npm test                          # builds, then runs the Node test suite
cd adapters/go && go test ./...   # Go client + cross-language integration tests
```

## License

MIT
