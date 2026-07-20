import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
    normalizeBehaviors,
    normalizePrefix,
    resolveBehaviorPrefix,
    parseBehaviorHeader,
} from "../dist/server/behaviors.js";
import { MockRouter, MockProxy, createMockServer } from "../dist/index.js";

// ── normalizePrefix ────────────────────────────────────────────────────────

describe("normalizePrefix", () => {
    it("adds leading slash when missing", () => {
        assert.equal(normalizePrefix("payments"), "/payments");
    });

    it("keeps a single slash as-is", () => {
        assert.equal(normalizePrefix("/"), "/");
    });

    it("strips trailing slashes", () => {
        assert.equal(normalizePrefix("/payments/"), "/payments");
        assert.equal(normalizePrefix("/payments/v2/"), "/payments/v2");
    });

    it("preserves a well-formed prefix", () => {
        assert.equal(normalizePrefix("/users"), "/users");
    });
});

// ── normalizeBehaviors ─────────────────────────────────────────────────────

describe("normalizeBehaviors", () => {
    it("returns undefined for undefined config", () => {
        assert.equal(normalizeBehaviors(undefined), undefined);
    });

    it("returns undefined for empty config", () => {
        assert.equal(normalizeBehaviors({}), undefined);
    });

    it("applies defaults for a minimal config", () => {
        const result = normalizeBehaviors({ "/api": { delay: {} } });
        assert.ok(result);
        assert.equal(result.prefixes.length, 1);
        const cfg = result.prefixes[0].cfg;
        // delay defaults
        assert.equal(cfg.delay.defaultMs, 1000);
        assert.equal(cfg.delay.maxMs, undefined);
        // flaky/ retry defaults
        assert.equal(cfg.flaky.rate, 0.5);
        assert.equal(cfg.retry.count, 1);
        // failure defaults
        assert.equal(cfg.failure.statusCode, 503);
        assert.deepEqual(cfg.failure.body, { error: "mock behavior: injected failure" });
        assert.equal(cfg.failure.headers["content-type"], "application/json; charset=utf-8");
    });

    it("expands `true` shorthand to all behaviors enabled", () => {
        const result = normalizeBehaviors({ "/all": true });
        assert.ok(result);
        const cfg = result.prefixes[0].cfg;
        assert.deepEqual([...cfg.enabled].sort(), ["delay", "flaky", "reset", "retry", "timeout"]);
    });

    it("reflects only the keys present in a partial config", () => {
        const result = normalizeBehaviors({ "/partial": { delay: {}, flaky: {} } });
        assert.ok(result);
        const cfg = result.prefixes[0].cfg;
        assert.ok(cfg.enabled.has("delay"));
        assert.ok(cfg.enabled.has("flaky"));
        assert.ok(!cfg.enabled.has("timeout"));
        assert.ok(!cfg.enabled.has("reset"));
        assert.ok(!cfg.enabled.has("retry"));
    });

    it("preserves custom values over defaults", () => {
        const result = normalizeBehaviors({
            "/custom": {
                delay: { defaultMs: 500, maxMs: 5000 },
                flaky: { rate: 0.1 },
                retry: { count: 3 },
            },
        });
        assert.ok(result);
        const cfg = result.prefixes[0].cfg;
        assert.equal(cfg.delay.defaultMs, 500);
        assert.equal(cfg.delay.maxMs, 5000);
        assert.equal(cfg.flaky.rate, 0.1);
        assert.equal(cfg.retry.count, 3);
    });

    it("merges prefix-level failure over the 503 default", () => {
        const result = normalizeBehaviors({
            "/api": {
                failure: { statusCode: 502, body: { error: "upstream down" } },
                retry: {},
            },
        });
        assert.ok(result);
        const cfg = result.prefixes[0].cfg;
        assert.equal(cfg.failure.statusCode, 502);
        assert.deepEqual(cfg.failure.body, { error: "upstream down" });
        // headers from default still present
        assert.equal(cfg.failure.headers["content-type"], "application/json; charset=utf-8");
    });

    it("merges behavior-level failure over prefix-level failure", () => {
        const result = normalizeBehaviors({
            "/api": {
                failure: { statusCode: 502 },
                flaky: { failure: { statusCode: 500 } },
                retry: { failure: { statusCode: 504 } },
            },
        });
        assert.ok(result);
        const cfg = result.prefixes[0].cfg;
        assert.equal(cfg.flaky.failure.statusCode, 500);
        assert.equal(cfg.retry.failure.statusCode, 504);
        // prefix-level is 502
        assert.equal(cfg.failure.statusCode, 502);
    });

    it("sorts prefixes longest-first", () => {
        const result = normalizeBehaviors({
            "/a": { delay: {} },
            "/a/b/c": { delay: {} },
            "/a/b": { delay: {} },
        });
        assert.ok(result);
        assert.equal(result.prefixes[0].prefix, "/a/b/c");
        assert.equal(result.prefixes[1].prefix, "/a/b");
        assert.equal(result.prefixes[2].prefix, "/a");
    });

    it("normalizes the header name to lowercase", () => {
        const result = normalizeBehaviors({ "/x": { delay: {} } }, "X-Custom-Behavior");
        assert.ok(result);
        assert.equal(result.header, "x-custom-behavior");
    });

    it("defaults header to x-mock-behavior", () => {
        const result = normalizeBehaviors({ "/x": { delay: {} } });
        assert.ok(result);
        assert.equal(result.header, "x-mock-behavior");
    });

    it("normalizes sessionHeader to lowercase", () => {
        const result = normalizeBehaviors({ "/x": { delay: {} } }, undefined, "X-Session");
        assert.ok(result);
        assert.equal(result.sessionHeader, "x-session");
    });

    it("normalizes keys without leading slash", () => {
        const result = normalizeBehaviors({ payments: { delay: {} } });
        assert.ok(result);
        assert.equal(result.prefixes[0].prefix, "/payments");
    });
});

// ── resolveBehaviorPrefix ──────────────────────────────────────────────────

describe("resolveBehaviorPrefix", () => {
    const config = normalizeBehaviors({
        "/payments":    { delay: {} },
        "/payments/v2": { delay: {}, flaky: {} },
        "/users":       { flaky: {} },
        "/":            { retry: {} },
    });
    assert.ok(config);
    const prefixes = config.prefixes;

    it("matches an exact path", () => {
        const cfg = resolveBehaviorPrefix("/users", prefixes);
        assert.ok(cfg);
        assert.ok(cfg.enabled.has("flaky"));
    });

    it("matches a sub-path (segment-aware)", () => {
        const cfg = resolveBehaviorPrefix("/users/42", prefixes);
        assert.ok(cfg);
        assert.ok(cfg.enabled.has("flaky"));
    });

    it("does NOT match a prefix that is only a partial segment", () => {
        // "/user" should NOT match "/users" prefix
        const cfg = resolveBehaviorPrefix("/user", prefixes);
        // falls through to catch-all "/"
        assert.ok(cfg);
        assert.ok(cfg.enabled.has("retry"));
        assert.ok(!cfg.enabled.has("flaky"));
    });

    it("longest prefix wins", () => {
        const cfg = resolveBehaviorPrefix("/payments/v2/charge", prefixes);
        assert.ok(cfg);
        // /payments/v2 has both delay + flaky
        assert.ok(cfg.enabled.has("delay"));
        assert.ok(cfg.enabled.has("flaky"));
    });

    it("falls back to shorter prefix when longer doesn't match", () => {
        const cfg = resolveBehaviorPrefix("/payments/v1/charge", prefixes);
        assert.ok(cfg);
        // /payments only has delay
        assert.ok(cfg.enabled.has("delay"));
        assert.ok(!cfg.enabled.has("flaky"));
    });

    it("catch-all '/' matches anything", () => {
        const cfg = resolveBehaviorPrefix("/unknown/path", prefixes);
        assert.ok(cfg);
        assert.ok(cfg.enabled.has("retry"));
    });

    it("returns undefined when no prefixes configured", () => {
        const empty = normalizeBehaviors({ "/only-one": { delay: {} } });
        assert.ok(empty);
        // search for a path that doesn't match the only prefix
        const cfg = resolveBehaviorPrefix("/other", []);
        assert.equal(cfg, undefined);
    });

    it("segment boundary: /orders does not match /order prefix", () => {
        const single = normalizeBehaviors({ "/order": { delay: {} } });
        assert.ok(single);
        const cfg = resolveBehaviorPrefix("/orders/5", single.prefixes);
        // no catch-all, no match
        assert.equal(cfg, undefined);
    });

    it("exact match at root", () => {
        const cfg = resolveBehaviorPrefix("/", prefixes);
        assert.ok(cfg);
        assert.ok(cfg.enabled.has("retry"));
    });
});

// ── parseBehaviorHeader ────────────────────────────────────────────────────

describe("parseBehaviorHeader", () => {
    // Build a prefix config with delay, flaky, retry enabled; timeout + reset disabled.
    const config = normalizeBehaviors({
        "/api": { delay: { defaultMs: 500, maxMs: 3000 }, flaky: { rate: 0.3 }, retry: { count: 2 } },
    });
    assert.ok(config);
    const cfg = config.prefixes[0].cfg;

    // A second prefix with all behaviors for timeout/reset tests.
    const allConfig = normalizeBehaviors({ "/all": true });
    assert.ok(allConfig);
    const allCfg = allConfig.prefixes[0].cfg;

    it("returns undefined for absent header", () => {
        assert.equal(parseBehaviorHeader(undefined, cfg), undefined);
        assert.equal(parseBehaviorHeader("", cfg), undefined);
    });

    it("returns undefined for unknown behavior name", () => {
        assert.equal(parseBehaviorHeader("unknown", cfg), undefined);
    });

    it("returns undefined for a behavior not enabled on the prefix", () => {
        // timeout is not in /api config
        assert.equal(parseBehaviorHeader("timeout", cfg), undefined);
        assert.equal(parseBehaviorHeader("reset", cfg), undefined);
    });

    it("parses bare delay → defaultMs", () => {
        const d = parseBehaviorHeader("delay", cfg);
        assert.ok(d);
        assert.equal(d.name, "delay");
        assert.equal(d.ms, 500);
    });

    it("parses delay=2000 → 2000", () => {
        const d = parseBehaviorHeader("delay=2000", cfg);
        assert.ok(d);
        assert.equal(d.name, "delay");
        assert.equal(d.ms, 2000);
    });

    it("clamps delay value to maxMs", () => {
        const d = parseBehaviorHeader("delay=9999", cfg);
        assert.ok(d);
        assert.equal(d.ms, 3000);  // clamped
    });

    it("rejects negative delay", () => {
        assert.equal(parseBehaviorHeader("delay=-1", cfg), undefined);
    });

    it("rejects non-numeric delay", () => {
        assert.equal(parseBehaviorHeader("delay=abc", cfg), undefined);
    });

    it("parses bare flaky → configured rate", () => {
        const d = parseBehaviorHeader("flaky", cfg);
        assert.ok(d);
        assert.equal(d.name, "flaky");
        assert.equal(d.rate, 0.3);
    });

    it("parses flaky=0.8 → 0.8", () => {
        const d = parseBehaviorHeader("flaky=0.8", cfg);
        assert.ok(d);
        assert.equal(d.rate, 0.8);
    });

    it("rejects flaky rate > 1", () => {
        assert.equal(parseBehaviorHeader("flaky=1.5", cfg), undefined);
    });

    it("rejects flaky rate < 0", () => {
        assert.equal(parseBehaviorHeader("flaky=-0.1", cfg), undefined);
    });

    it("parses bare retry → configured count", () => {
        const d = parseBehaviorHeader("retry", cfg);
        assert.ok(d);
        assert.equal(d.name, "retry");
        assert.equal(d.count, 2);
    });

    it("parses retry=5 → 5", () => {
        const d = parseBehaviorHeader("retry=5", cfg);
        assert.ok(d);
        assert.equal(d.count, 5);
    });

    it("rejects non-integer retry", () => {
        assert.equal(parseBehaviorHeader("retry=2.5", cfg), undefined);
    });

    it("rejects negative retry", () => {
        assert.equal(parseBehaviorHeader("retry=-1", cfg), undefined);
    });

    it("parses timeout when enabled", () => {
        const d = parseBehaviorHeader("timeout", allCfg);
        assert.ok(d);
        assert.equal(d.name, "timeout");
    });

    it("parses reset when enabled", () => {
        const d = parseBehaviorHeader("reset", allCfg);
        assert.ok(d);
        assert.equal(d.name, "reset");
    });

    it("is case-insensitive on behavior name", () => {
        const d = parseBehaviorHeader("DELAY", cfg);
        assert.ok(d);
        assert.equal(d.name, "delay");
        assert.equal(d.ms, 500);
    });

    it("handles whitespace around name and value", () => {
        const d = parseBehaviorHeader(" delay = 1500 ", cfg);
        assert.ok(d);
        assert.equal(d.name, "delay");
        assert.equal(d.ms, 1500);
    });

    it("ignores value on timeout/reset (no value field)", () => {
        const d = parseBehaviorHeader("timeout=5000", allCfg);
        assert.ok(d);
        assert.equal(d.name, "timeout");
        // value is ignored — timeout has no value field
    });
});

// ── Integration: behavior execution via createMockServer ───────────────────

function buildBehaviorProxy() {
    const router = new MockRouter();
    router.url("/users", {
        get: [{ response: { success: [{ id: 1, name: "Ada" }] } }],
    });
    router.url("/payments", {
        post: [{ response: { success: { id: "pay_1", status: "ok" } } }],
    });
    const proxy = new MockProxy();
    proxy.register(router);
    return proxy;
}

function fetchJson(port, path, { headers = {}, signal } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
        });
        req.on("error", reject);
        if (signal) signal.addEventListener("abort", () => req.destroy(new Error("aborted")));
        req.end();
    });
}

function fetchRaw(port, path, { headers = {} } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => resolve({ status: res.statusCode, body: data }));
        });
        req.on("error", reject);
        req.end();
    });
}

describe("behavior execution: delay", () => {
    let handle, port;

    before(async () => {
        handle = createMockServer(buildBehaviorProxy(), {
            port: 0,
            fallback: "notFound",
            behaviors: { "/users": { delay: { defaultMs: 100 } } },
        });
        await new Promise((r) => handle.listen(r));
        port = handle.port;
    });

    after(() => handle.close());

    it("delays response by approximately the configured ms", async () => {
        const start = Date.now();
        const res = await fetchJson(port, "/users", { headers: { "x-mock-behavior": "delay" } });
        const elapsed = Date.now() - start;
        assert.equal(res.status, 200);
        assert.ok(elapsed >= 80, `expected >=80ms delay, got ${elapsed}ms`);
    });

    it("delays by overridden value when delay=N is sent", async () => {
        const start = Date.now();
        const res = await fetchJson(port, "/users", { headers: { "x-mock-behavior": "delay=50" } });
        const elapsed = Date.now() - start;
        assert.equal(res.status, 200);
        assert.ok(elapsed >= 30, `expected >=30ms delay, got ${elapsed}ms`);
        assert.ok(elapsed < 200, `expected <200ms, got ${elapsed}ms`);
    });

    it("delivers the real mock response after the delay", async () => {
        const res = await fetchJson(port, "/users", { headers: { "x-mock-behavior": "delay=10" } });
        assert.equal(res.status, 200);
        const parsed = JSON.parse(res.body);
        assert.deepEqual(parsed.success, [{ id: 1, name: "Ada" }]);
    });
});

describe("behavior execution: flaky", () => {
    let handle, port;

    before(async () => {
        handle = createMockServer(buildBehaviorProxy(), {
            port: 0,
            fallback: "notFound",
            behaviors: { "/users": { flaky: { rate: 0.5 } } },
        });
        await new Promise((r) => handle.listen(r));
        port = handle.port;
    });

    after(() => handle.close());

    it("returns synthetic failure at approximately the configured rate", async () => {
        let failures = 0;
        const n = 200;
        for (let i = 0; i < n; i++) {
            const res = await fetchJson(port, "/users", { headers: { "x-mock-behavior": "flaky" } });
            if (res.status === 503) failures++;
        }
        const rate = failures / n;
        // loose bounds: 0.3 – 0.7 for a 0.5 rate
        assert.ok(rate >= 0.3 && rate <= 0.7, `expected ~50% failures, got ${(rate * 100).toFixed(1)}%`);
    });

    it("uses overridden rate from flaky=0.1 header", async () => {
        let failures = 0;
        const n = 200;
        for (let i = 0; i < n; i++) {
            const res = await fetchJson(port, "/users", { headers: { "x-mock-behavior": "flaky=0.1" } });
            if (res.status === 503) failures++;
        }
        const rate = failures / n;
        assert.ok(rate >= 0.0 && rate <= 0.25, `expected ~10% failures, got ${(rate * 100).toFixed(1)}%`);
    });

    it("returns the real mock on non-flaky hit", async () => {
        // With rate=0 we should always get the real response
        const res = await fetchJson(port, "/users", { headers: { "x-mock-behavior": "flaky=0" } });
        assert.equal(res.status, 200);
        const parsed = JSON.parse(res.body);
        assert.deepEqual(parsed.success, [{ id: 1, name: "Ada" }]);
    });
});

describe("behavior execution: reset", () => {
    let handle, port;

    before(async () => {
        handle = createMockServer(buildBehaviorProxy(), {
            port: 0,
            fallback: "notFound",
            behaviors: { "/users": { reset: {} } },
        });
        await new Promise((r) => handle.listen(r));
        port = handle.port;
    });

    after(() => handle.close());

    it("destroys the socket — client sees a connection error", async () => {
        await assert.rejects(
            () => fetchJson(port, "/users", { headers: { "x-mock-behavior": "reset" } }),
            (err) => {
                assert.ok(err.code === "ECONNRESET" || err.message.includes("aborted") || err.message.includes("socket"),
                    `unexpected error: ${err.message}`);
                return true;
            },
        );
    });
});

describe("behavior execution: timeout", () => {
    describe("hang mode", () => {
        let handle, port;

        before(async () => {
            handle = createMockServer(buildBehaviorProxy(), {
                port: 0,
                fallback: "notFound",
                behaviors: { "/users": { timeout: { mode: "hang" } } },
            });
            await new Promise((r) => handle.listen(r));
            port = handle.port;
        });

        after(() => handle.close());

        it("never responds — client abort fires", async () => {
            const ac = new AbortController();
            setTimeout(() => ac.abort(), 150); // abort after 150ms
            await assert.rejects(
                () => fetchJson(port, "/users", { headers: { "x-mock-behavior": "timeout" }, signal: ac.signal }),
                () => true,
            );
        });
    });

    describe("close mode", () => {
        let handle, port;

        before(async () => {
            handle = createMockServer(buildBehaviorProxy(), {
                port: 0,
                fallback: "notFound",
                behaviors: { "/users": { timeout: { mode: "close", afterMs: 100 } } },
            });
            await new Promise((r) => handle.listen(r));
            port = handle.port;
        });

        after(() => handle.close());

        it("destroys the socket after afterMs", async () => {
            await assert.rejects(
                () => fetchJson(port, "/users", { headers: { "x-mock-behavior": "timeout" } }),
                (err) => {
                    assert.ok(err.code === "ECONNRESET" || err.message.includes("socket") || err.message.includes("aborted"),
                        `unexpected error: ${err.message}`);
                    return true;
                },
            );
        });
    });
});

describe("behavior execution: retry", () => {
    let handle, port;

    before(async () => {
        handle = createMockServer(buildBehaviorProxy(), {
            port: 0,
            fallback: "notFound",
            behaviors: { "/users": { retry: { count: 2 } } },
        });
        await new Promise((r) => handle.listen(r));
        port = handle.port;
    });

    after(() => handle.close());

    it("returns synthetic failure for the first N calls, then the real mock", async () => {
        const header = { "x-mock-behavior": "retry" };
        // calls 1 & 2 → 503
        const r1 = await fetchJson(port, "/users", { headers: header });
        assert.equal(r1.status, 503);
        const r2 = await fetchJson(port, "/users", { headers: header });
        assert.equal(r2.status, 503);
        // call 3 → real mock
        const r3 = await fetchJson(port, "/users", { headers: header });
        assert.equal(r3.status, 200);
        const parsed = JSON.parse(r3.body);
        assert.deepEqual(parsed.success, [{ id: 1, name: "Ada" }]);
    });

    it("starts a fresh sequence after success", async () => {
        const header = { "x-mock-behavior": "retry" };
        // Previous test consumed 3 calls (2 fail + 1 success), sequence reset.
        // New call 1 → 503 again
        const r1 = await fetchJson(port, "/users", { headers: header });
        assert.equal(r1.status, 503);
    });

    it("respects overridden count from retry=1 header", async () => {
        handle.resetBehaviorState();
        const header = { "x-mock-behavior": "retry=1" };
        const r1 = await fetchJson(port, "/users", { headers: header });
        assert.equal(r1.status, 503);
        const r2 = await fetchJson(port, "/users", { headers: header });
        assert.equal(r2.status, 200);
    });

    it("resetBehaviorState clears counters mid-sequence", async () => {
        const header = { "x-mock-behavior": "retry" };
        // fail once
        const r1 = await fetchJson(port, "/users", { headers: header });
        assert.equal(r1.status, 503);
        // reset
        handle.resetBehaviorState();
        // should fail again (counter reset), not succeed
        const r2 = await fetchJson(port, "/users", { headers: header });
        assert.equal(r2.status, 503);
    });
});

describe("behavior execution: prefix scoping", () => {
    let handle, port;

    before(async () => {
        handle = createMockServer(buildBehaviorProxy(), {
            port: 0,
            fallback: "notFound",
            behaviors: { "/users": { delay: { defaultMs: 50 } } },
        });
        await new Promise((r) => handle.listen(r));
        port = handle.port;
    });

    after(() => handle.close());

    it("applies behavior on a configured prefix", async () => {
        const start = Date.now();
        const res = await fetchJson(port, "/users", { headers: { "x-mock-behavior": "delay" } });
        const elapsed = Date.now() - start;
        assert.equal(res.status, 200);
        assert.ok(elapsed >= 30, `expected delay on configured prefix, got ${elapsed}ms`);
    });

    it("ignores behavior header on an unconfigured prefix", async () => {
        const res = await fetchJson(port, "/payments", { headers: { "x-mock-behavior": "delay" } });
        assert.equal(res.status, 200);
        // no delay — should be fast
    });
});

describe("behavior execution: opt-in", () => {
    let handle, port;

    before(async () => {
        handle = createMockServer(buildBehaviorProxy(), {
            port: 0,
            fallback: "notFound",
            // no behaviors option at all
        });
        await new Promise((r) => handle.listen(r));
        port = handle.port;
    });

    after(() => handle.close());

    it("ignores the behavior header when behaviors is not configured", async () => {
        const res = await fetchJson(port, "/users", { headers: { "x-mock-behavior": "delay" } });
        assert.equal(res.status, 200);
        const parsed = JSON.parse(res.body);
        assert.deepEqual(parsed.success, [{ id: 1, name: "Ada" }]);
    });
});
