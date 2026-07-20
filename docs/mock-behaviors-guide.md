# Mock Behaviors — User Guide

> **Client-triggered fault & timing injection for `createMockServer`.**
>
> Behaviors let you simulate slow, flaky, or broken API responses *on purpose* — so you can prove
> your app handles real-world failure gracefully. They're a **delivery modifier**: they change
> *what happens* to a matched response (delayed, dropped, retried), not *which* response is returned.

---

## Table of contents

1. [What are behaviors?](#1-what-are-behaviors)
2. [Quickstart](#2-quickstart)
3. [The control header](#3-the-control-header)
4. [Per-prefix configuration](#4-per-prefix-configuration)
5. [Behaviors reference](#5-behaviors-reference)
   - [delay](#51-delay)
   - [timeout](#52-timeout)
   - [reset](#53-reset)
   - [flaky](#54-flaky)
   - [retry](#55-retry)
6. [Customizing the synthetic failure](#6-customizing-the-synthetic-failure)
7. [Session keying for retry](#7-session-keying-for-retry)
8. [Testing recipes](#8-testing-recipes)
9. [Important caveats](#9-important-caveats)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. What are behaviors?

Behaviors are a **post-resolve delivery interceptor** on `createMockServer`. When a request matches
a registered mock *and* the client sends a special control header (`X-Mock-Behavior`), the server
can delay, drop, or fail the response instead of delivering it normally.

Key properties:

- **Behaviors don't pick responses.** Which mock matches is still determined by the existing
  `request.header`/`query`/`body` matchers. Behaviors only modify delivery.
- **Per-prefix scoping.** Different URL prefixes can have different behavior configs. A request to
  `/payments` might allow `retry` and `timeout`, while `/users` only allows `flaky`.
- **Opt-in, dev-only.** Off by default. A control header that can hang or reset any route is a
  potential DoS switch — only enable it in development and testing.

---

## 2. Quickstart

```ts
import { MockRouter, MockProxy, createMockServer } from "proxy-mocker";

const router = new MockRouter();
router.url("/payments", {
  post: [{ response: { success: { id: "pay_1", status: "ok" } } }],
});

const proxy = new MockProxy();
proxy.register(router);

const server = createMockServer(proxy, {
  port: 4000,
  fallback: "notFound",
  behaviors: {
    "/payments": { retry: { count: 2 } },
  },
});

server.listen(() => console.log("mock server on http://localhost:4000"));
```

Now send requests with the `X-Mock-Behavior` header:

```bash
# First two calls → 503 (synthetic failure)
curl -H "X-Mock-Behavior: retry" http://localhost:4000/payments
# → 503 {"error":"mock behavior: injected failure"}

curl -H "X-Mock-Behavior: retry" http://localhost:4000/payments
# → 503 {"error":"mock behavior: injected failure"}

# Third call → real mock
curl -H "X-Mock-Behavior: retry" http://localhost:4000/payments
# → 200 {"success":{"id":"pay_1","status":"ok"}}
```

---

## 3. The control header

The client triggers a behavior by sending a request header. The default header is `X-Mock-Behavior`.

```
X-Mock-Behavior: <name>[=<value>]
```

| Header | Meaning | Value |
|---|---|---|
| `X-Mock-Behavior: delay` | delay by the prefix's `defaultMs` (default 1000) | — |
| `X-Mock-Behavior: delay=2000` | delay by 2000ms (clamped to `maxMs` if set) | ms |
| `X-Mock-Behavior: timeout` | hang or close per prefix config | — |
| `X-Mock-Behavior: reset` | destroy the connection immediately | — |
| `X-Mock-Behavior: flaky` | fail at the prefix's configured rate (default 50%) | — |
| `X-Mock-Behavior: flaky=0.1` | fail with 10% probability | 0..1 |
| `X-Mock-Behavior: retry` | fail for the first N calls, then succeed | — |
| `X-Mock-Behavior: retry=3` | fail the first 3 calls, then succeed | integer |

**Custom header name:**

```ts
createMockServer(proxy, {
  behaviors: { "/api": { delay: {} } },
  behaviorHeader: "x-fault",  // use X-Fault instead
});
```

**Fail-open:** unknown behavior names, malformed values, or behaviors not enabled for the matched
prefix are silently ignored — the request proceeds normally.

---

## 4. Per-prefix configuration

The `behaviors` option is a map of **URL path prefix → behavior config**:

```ts
behaviors: {
  "/payments": {
    retry: { count: 2 },
    timeout: { mode: "hang" },
    flaky: { rate: 0.1 },
  },
  "/users": {
    delay: { defaultMs: 500 },
  },
  "/search": true,  // shorthand: enable all behaviors with defaults
}
```

**Prefix matching is segment-aware:**
- `/payments` matches `/payments`, `/payments/charge`, `/payments/v2/refund`
- `/payments` does NOT match `/payment-system` (partial segment)
- Longest prefix wins: `/payments/v2` beats `/payments` for `/payments/v2/charge`

**Catch-all:** use `"/"` as a prefix to apply behaviors to all paths.

**Enabled = present:** a behavior key present under the prefix enables it; omitted = disabled.
Passing `true` as the value enables all five behaviors with defaults.

---

## 5. Behaviors reference

### 5.1 delay

Delays delivery of the matched response by N milliseconds. The behavior delay **replaces** the
mock's static `response.delay` (no double-wait).

```ts
behaviors: { "/api": { delay: { defaultMs: 1000, maxMs: 5000 } } }
```

```bash
curl -H "X-Mock-Behavior: delay" http://localhost:4000/api/data     # ~1000ms
curl -H "X-Mock-Behavior: delay=3000" http://localhost:4000/api/data # ~3000ms
curl -H "X-Mock-Behavior: delay=9999" http://localhost:4000/api/data # ~5000ms (clamped)
```

### 5.2 timeout

Simulates a hung or dropped upstream. Two modes:

- **`hang`** (default): never responds. The socket stays open until the client's own timeout fires.
- **`close`**: destroys the socket after `afterMs` milliseconds.

```ts
behaviors: {
  "/api": {
    timeout: { mode: "close", afterMs: 5000 },
  },
}
```

```bash
curl -H "X-Mock-Behavior: timeout" http://localhost:4000/api/data
# hang mode: curl will hang until its own timeout
# close mode: connection drops after 5s
```

> **Note:** `hang` requires the *client* to have its own timeout. Prefer `close` + `afterMs` if
> the caller can't guarantee that.

### 5.3 reset

Destroys the connection immediately — the client sees a connection error (e.g. `ECONNRESET`), not
an HTTP status code.

```ts
behaviors: { "/api": { reset: {} } }
```

```bash
curl -H "X-Mock-Behavior: reset" http://localhost:4000/api/data
# curl: (56) Recv failure: Connection reset by peer
```

### 5.4 flaky

Randomly returns the synthetic failure instead of the real response, at a configured rate.

```ts
behaviors: { "/api": { flaky: { rate: 0.1 } } }  // ~10% fail
```

```bash
curl -H "X-Mock-Behavior: flaky" http://localhost:4000/api/data     # ~10% fail
curl -H "X-Mock-Behavior: flaky=0.5" http://localhost:4000/api/data # 50% fail (override)
curl -H "X-Mock-Behavior: flaky=0" http://localhost:4000/api/data   # never fail
```

### 5.5 retry

Returns the synthetic failure for the first N calls, then the real response. Deterministic and
stateful — counters are per-route (and per-session if `behaviorSessionHeader` is set).

```ts
behaviors: { "/api": { retry: { count: 2 } } }
```

```bash
curl -H "X-Mock-Behavior: retry" http://localhost:4000/api/data   # 503
curl -H "X-Mock-Behavior: retry" http://localhost:4000/api/data   # 503
curl -H "X-Mock-Behavior: retry" http://localhost:4000/api/data   # 200 (real mock)
curl -H "X-Mock-Behavior: retry" http://localhost:4000/api/data   # 503 (fresh sequence)
```

Override the count per-request:

```bash
curl -H "X-Mock-Behavior: retry=1" http://localhost:4000/api/data  # 503
curl -H "X-Mock-Behavior: retry=1" http://localhost:4000/api/data  # 200
```

**Reset counters in tests:**

```ts
const handle = createMockServer(proxy, { behaviors: { "/api": { retry: { count: 2 } } } });
// ... run some requests ...
handle.resetBehaviorState(); // clear all retry counters
```

---

## 6. Customizing the synthetic failure

`flaky` and `retry` return a synthetic failure when they trigger. The default is:

```json
{
  "statusCode": 503,
  "headers": { "content-type": "application/json; charset=utf-8" },
  "body": { "error": "mock behavior: injected failure" }
}
```

Override at three levels (each merges over the previous):

```ts
behaviors: {
  "/payments": {
    // 1. Prefix-level default (overrides the 503 default)
    failure: { statusCode: 502, body: { error: "payments upstream down" } },
    // 2. Behavior-level (overrides prefix-level)
    flaky: { rate: 0.1, failure: { statusCode: 500, body: { error: "flaky hit" } } },
    retry: { count: 2, failure: { statusCode: 504 } },
  },
}
```

Precedence: **behavior-level > prefix-level > built-in 503 default**.

---

## 7. Session keying for retry

By default, `retry` counters are keyed by `(method, urlPath)`. All clients sharing the same route
share the same counter.

To isolate counters per client (e.g. in parallel test runs), set `behaviorSessionHeader`:

```ts
createMockServer(proxy, {
  behaviors: { "/api": { retry: { count: 2 } } },
  behaviorSessionHeader: "x-session",
});
```

Now each unique `X-Session` header value gets its own retry counter:

```bash
# Session A: fails twice, then succeeds
curl -H "X-Mock-Behavior: retry" -H "X-Session: test-a" http://localhost:4000/api
curl -H "X-Mock-Behavior: retry" -H "X-Session: test-a" http://localhost:4000/api
curl -H "X-Mock-Behavior: retry" -H "X-Session: test-a" http://localhost:4000/api  # 200

# Session B: independent counter, fails twice too
curl -H "X-Mock-Behavior: retry" -H "X-Session: test-b" http://localhost:4000/api
curl -H "X-Mock-Behavior: retry" -H "X-Session: test-b" http://localhost:4000/api
curl -H "X-Mock-Behavior: retry" -H "X-Session: test-b" http://localhost:4000/api  # 200
```

---

## 8. Testing recipes

### Test retry logic end-to-end

```ts
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

describe("retry behavior", () => {
  let handle, port;

  before(async () => {
    handle = createMockServer(proxy, {
      port: 0,
      fallback: "notFound",
      behaviors: { "/api": { retry: { count: 2 } } },
    });
    await new Promise((r) => handle.listen(r));
    port = handle.port;
  });

  after(() => handle.close());

  it("fails twice then succeeds", async () => {
    const opts = { headers: { "x-mock-behavior": "retry" } };
    const r1 = await fetch(`http://127.0.0.1:${port}/api`, opts);
    assert.equal(r1.status, 503);
    const r2 = await fetch(`http://127.0.0.1:${port}/api`, opts);
    assert.equal(r2.status, 503);
    const r3 = await fetch(`http://127.0.0.1:${port}/api`, opts);
    assert.equal(r3.status, 200);
  });
});
```

### Test timeout handling

```ts
it("timeout hang never responds — client abort fires", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 200);
  await assert.rejects(
    () => fetch(`http://127.0.0.1:${port}/api`, {
      headers: { "x-mock-behavior": "timeout" },
      signal: ac.signal,
    }),
  );
});
```

### Test connection reset

```ts
it("reset destroys the socket", async () => {
  await assert.rejects(
    () => fetch(`http://127.0.0.1:${port}/api`, {
      headers: { "x-mock-behavior": "reset" },
    }),
  );
});
```

---

## 9. Important caveats

1. **Behaviors are delivery modifiers, not response selectors.** They never change *which* mock
   matched — that stays with the existing `request.*` matchers.

2. **Behaviors only run on matched mocks.** An unmatched request falls through to the fallback
   (notFound/passthrough/custom) with no behavior. Add a catch-all mock if you need to fault an
   otherwise-unmocked path.

3. **Dev-only.** A control header that can hang or reset any route is a DoS switch. Never enable
   behaviors in production. Off by default.

4. **`timeout hang` leaks a held-open socket** until the client gives up or the server closes.
   Callers without their own timeout should prefer `timeout: { mode: "close", afterMs }`.

5. **State is per-process, per-server.** Retry counters don't survive a restart or span multiple
   server instances. Fine for dev/test; not for shared environments.

6. **Connection faults are Node-only.** `timeout` and `reset` manipulate `res.socket` and cannot
   be expressed through the sidecar/Go path. Behaviors are mock-server-only in v1.

7. **`baseURL` vs behavior prefixes.** Behavior prefixes match the **incoming** request path (after
   any `MockProxy.baseURL` / router `rewritePath` is already applied). If your proxy uses
   `baseURL: "/api"`, your behavior prefix should be `"/api/payments"`, not `"/payments"`.

---

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Header has no effect | `behaviors` not configured | Add `behaviors` to `createMockServer` options |
| Header has no effect on a path | Path doesn't match any configured prefix | Add the prefix to `behaviors`, or use `"/"` catch-all |
| Header has no effect for a behavior | Behavior not enabled for the prefix | Add the behavior key to the prefix config |
| `retry` counter shared across tests | No session header set | Set `behaviorSessionHeader` and send unique values |
| `timeout hang` hangs the test | Client has no timeout | Use `timeout: { mode: "close", afterMs }` or `AbortController` |
| `delay` double-waits | Mock has static `response.delay` | Behavior delay replaces static delay; remove the static one |
| Prefix doesn't match | Partial segment match | `/user` does NOT match `/users`; use `/users` |
| Behaviors run on unmatched request | N/A — they don't | Behaviors only run when `proxy.resolve()` returns a match |
