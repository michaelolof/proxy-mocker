import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { MockRouter, MockProxy, createMockServer } from "../dist/index.js";

const require = createRequire(import.meta.url);
const openapiEntry = require.resolve("../dist/openapi/index.js");

function buildProxy() {
    const router = new MockRouter();
    router.url("/users", {
        get: [{ response: { success: [{ id: 1, name: "Ada" }] } }],
    });
    const proxy = new MockProxy();
    proxy.register(router);
    return proxy;
}

function buildDocsProxy(onDynamicResponse) {
    const router = new MockRouter();
    router.url("/users", {
        get: [{ response: { success: [{ id: 1, name: "Ada" }] } }],
    });
    router.url("/users/{id}", {
        get: [{
            response: {
                success: (req) => {
                    onDynamicResponse?.();
                    return { id: req?.path?.id, name: "Mock User" };
                },
            },
        }],
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

    describe("docs integration", () => {
        let handle, base, dynamicCalls;

        before(async () => {
            dynamicCalls = 0;
            handle = createMockServer(buildDocsProxy(() => dynamicCalls++), {
                port: 0,
                fallback: "notFound",
                docs: {
                    info: { title: "Mock Docs", version: "1.0.0" },
                    title: "Mock Docs",
                },
            });
            await new Promise((resolve) => handle.listen(resolve));
            base = `http://127.0.0.1:${handle.port}`;
        });

        after(async () => {
            await new Promise((resolve) => handle.close(resolve));
        });

        it("serves a memoized OpenAPI document", async () => {
            const first = await fetch(`${base}/docs/q/openapi.json`);
            const firstBody = await first.json();
            const second = await fetch(`${base}/docs/q/openapi.json`);
            const secondBody = await second.json();

            assert.equal(first.status, 200);
            assert.equal(first.headers.get("content-type"), "application/json; charset=utf-8");
            assert.equal(firstBody.info.title, "Mock Docs");
            assert.equal(firstBody.info.version, "1.0.0");
            assert.ok(firstBody.paths["/users"]);
            assert.ok(firstBody.paths["/users/{id}"]);
            assert.deepEqual(secondBody, firstBody);
            assert.equal(dynamicCalls, 1);
        });

        it("serves Stoplight docs UI by default", async () => {
            const res = await fetch(`${base}/docs`);
            const html = await res.text();

            assert.equal(res.status, 200);
            assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
            assert.match(html, /@stoplight\/elements@9\.0\.21/);
            assert.match(html, /apiDescriptionUrl="\/docs\/q\/openapi\.json"/);
            assert.match(html, /<title>Mock Docs<\/title>/);
            assert.doesNotMatch(html, /swagger-ui-dist/);
        });
    });

    describe("docs integration with custom paths and provider", () => {
        let handle, base;

        before(async () => {
            handle = createMockServer(buildProxy(), {
                port: 0,
                fallback: "notFound",
                docs: {
                    specPath: "/spec.json",
                    uiPath: "/reference",
                    uiProvider: "swagger",
                    swaggerUIVersion: "5.18.0",
                },
            });
            await new Promise((resolve) => handle.listen(resolve));
            base = `http://127.0.0.1:${handle.port}`;
        });

        after(async () => {
            await new Promise((resolve) => handle.close(resolve));
        });

        it("honors custom docs paths", async () => {
            const defaultSpec = await fetch(`${base}/openapi.json`);
            const customSpec = await fetch(`${base}/spec.json`);

            assert.equal(defaultSpec.status, 404);
            assert.equal(customSpec.status, 200);
            assert.equal((await customSpec.json()).openapi, "3.1.0");
        });

        it("can serve Swagger UI instead of Stoplight", async () => {
            const res = await fetch(`${base}/reference`);
            const html = await res.text();

            assert.equal(res.status, 200);
            assert.match(html, /swagger-ui-dist@5\.18\.0/);
            assert.match(html, /url: "\/spec\.json"/);
            assert.doesNotMatch(html, /@stoplight\/elements/);
        });
    });

    describe("docs integration with string shorthand", () => {
        let handle, base;

        before(async () => {
            handle = createMockServer(buildProxy(), {
                port: 0,
                fallback: "notFound",
                docs: "reference",
            });
            await new Promise((resolve) => handle.listen(resolve));
            base = `http://127.0.0.1:${handle.port}`;
        });

        after(async () => {
            await new Promise((resolve) => handle.close(resolve));
        });

        it("treats the string as the UI path and infers the spec path below it", async () => {
            const ui = await fetch(`${base}/reference`);
            const html = await ui.text();
            const spec = await fetch(`${base}/reference/q/openapi.json`);
            const missingDefault = await fetch(`${base}/docs`);

            assert.equal(ui.status, 200);
            assert.match(html, /apiDescriptionUrl="\/reference\/q\/openapi\.json"/);
            assert.equal(spec.status, 200);
            assert.equal((await spec.json()).openapi, "3.1.0");
            assert.equal(missingDefault.status, 404);
        });
    });

    describe("docs integration with slash-normalized string shorthand", () => {
        let handle, base;

        before(async () => {
            handle = createMockServer(buildProxy(), {
                port: 0,
                fallback: "notFound",
                docs: "/reference/",
            });
            await new Promise((resolve) => handle.listen(resolve));
            base = `http://127.0.0.1:${handle.port}`;
        });

        after(async () => {
            await new Promise((resolve) => handle.close(resolve));
        });

        it("normalizes leading and trailing slashes", async () => {
            const ui = await fetch(`${base}/reference`);
            const spec = await fetch(`${base}/reference/q/openapi.json`);

            assert.equal(ui.status, 200);
            assert.equal(spec.status, 200);
        });
    });

    describe("docs integration disabled", () => {
        let handle, base;

        before(async () => {
            handle = createMockServer(buildProxy(), { port: 0, fallback: "notFound" });
            await new Promise((resolve) => handle.listen(resolve));
            base = `http://127.0.0.1:${handle.port}`;
        });

        after(async () => {
            await new Promise((resolve) => handle.close(resolve));
        });

        it("does not treat docs paths specially", async () => {
            delete require.cache[openapiEntry];

            const spec = await fetch(`${base}/docs/q/openapi.json`);
            const docs = await fetch(`${base}/docs`);

            assert.equal(spec.status, 404);
            assert.equal(docs.status, 404);
            assert.equal(require.cache[openapiEntry], undefined);
        });
    });
});
