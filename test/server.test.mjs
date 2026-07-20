import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { MockRouter, MockProxy, createMockServer } from "../dist/index.js";

function buildProxy() {
    const router = new MockRouter();
    router.url("/users", {
        get: [{ response: { success: [{ id: 1, name: "Ada" }] } }],
    });
    const proxy = new MockProxy();
    proxy.register(router);
    return proxy;
}

describe("createMockServer", () => {
    it("throws eagerly when fallback defaults to passthrough without a target", () => {
        assert.throws(() => createMockServer(buildProxy(), {}), /target/);
    });

    describe("fallback: notFound", () => {
        let handle, base;

        before(async () => {
            handle = createMockServer(buildProxy(), { port: 0, fallback: "notFound" });
            await new Promise((resolve) => handle.listen(resolve));
            base = `http://127.0.0.1:${handle.port}`;
        });

        after(async () => {
            await new Promise((resolve) => handle.close(resolve));
        });

        it("still serves a matched mock", async () => {
            const res = await fetch(`${base}/users`);
            const body = await res.json();
            assert.equal(res.status, 200);
            assert.equal(body[0].name, "Ada");
        });

        it("returns 404 JSON for an unmatched request", async () => {
            const res = await fetch(`${base}/nope`);
            const body = await res.json();
            assert.equal(res.status, 404);
            assert.ok(body.error);
        });
    });

    describe("fallback: passthrough", () => {
        let upstream, upstreamPort, handle, base;

        before(async () => {
            upstream = http.createServer((req, res) => {
                const chunks = [];
                req.on("data", (c) => chunks.push(c));
                req.on("end", () => {
                    res.writeHead(200, { "content-type": "application/json" });
                    res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString() }));
                });
            });
            await new Promise((resolve) => upstream.listen(0, resolve));
            upstreamPort = upstream.address().port;

            handle = createMockServer(buildProxy(), {
                port: 0,
                fallback: "passthrough",
                target: `http://127.0.0.1:${upstreamPort}`,
            });
            await new Promise((resolve) => handle.listen(resolve));
            base = `http://127.0.0.1:${handle.port}`;
        });

        after(async () => {
            await new Promise((resolve) => handle.close(resolve));
            await new Promise((resolve) => upstream.close(resolve));
        });

        it("still serves a matched mock", async () => {
            const res = await fetch(`${base}/users`);
            const body = await res.json();
            assert.equal(res.status, 200);
            assert.equal(body[0].name, "Ada");
        });

        it("forwards an unmatched request to the target with the body intact", async () => {
            const res = await fetch(`${base}/orders`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ total: 42 }),
            });
            const body = await res.json();
            assert.equal(body.method, "POST");
            assert.equal(body.body, JSON.stringify({ total: 42 }));
        });
    });

    describe("fallback: custom function", () => {
        let handle, base, capturedMethod;

        before(async () => {
            handle = createMockServer(buildProxy(), {
                port: 0,
                fallback: (req, res, parsed) => {
                    capturedMethod = parsed.method;
                    res.writeHead(418);
                    res.end("teapot");
                },
            });
            await new Promise((resolve) => handle.listen(resolve));
            base = `http://127.0.0.1:${handle.port}`;
        });

        after(async () => {
            await new Promise((resolve) => handle.close(resolve));
        });

        it("is invoked with the parsed request for unmatched requests", async () => {
            const res = await fetch(`${base}/whatever`);
            const text = await res.text();
            assert.equal(res.status, 418);
            assert.equal(text, "teapot");
            assert.equal(capturedMethod, "GET");
        });
    });
});
