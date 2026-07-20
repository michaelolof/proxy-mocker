import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { MockRouter, MockProxy, startMockSidecar } from "../dist/index.js";

function requestOverSocket(socketPath, { method, reqPath, body }) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : undefined;
        const req = http.request(
            {
                socketPath,
                path: reqPath,
                method,
                headers: payload ? { "content-type": "application/json" } : undefined,
            },
            (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => {
                    const raw = Buffer.concat(chunks).toString("utf8");
                    resolve({ status: res.statusCode, json: raw ? JSON.parse(raw) : undefined });
                });
            }
        );
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function buildProxy() {
    const router = new MockRouter();
    router.url("/users/{id}", {
        get: [{
            response: {
                header: () => ({ "x-mock": "true" }),
                success: (req) => ({ id: req?.path?.id, name: "Mock User" }),
            },
        }],
    });
    router.url("/orders", {
        post: [{
            request: { query: { tier: "gold" }, body: { total: 500 } },
            response: { statusCode: 201, success: { ok: true } },
        }],
    });
    const proxy = new MockProxy();
    proxy.register(router);
    return proxy;
}

describe("startMockSidecar", () => {
    let socketPath, server;

    before(async () => {
        socketPath = path.join(os.tmpdir(), `pm-sidecar-${process.pid}-${Date.now()}.sock`);
        await new Promise((resolve) => {
            server = startMockSidecar(buildProxy(), { socketPath, onListen: () => resolve() });
        });
    });

    after(async () => {
        await new Promise((resolve) => server.close(resolve));
        fs.rmSync(socketPath, { force: true });
    });

    it("answers /__health", async () => {
        const res = await requestOverSocket(socketPath, { method: "GET", reqPath: "/__health" });
        assert.equal(res.status, 200);
        assert.deepEqual(res.json, { ok: true });
    });

    it("matches a request with a path param and function-based success/header", async () => {
        const res = await requestOverSocket(socketPath, {
            method: "POST",
            reqPath: "/__match",
            body: { urlPath: "/users/42", method: "GET" },
        });
        assert.equal(res.json.matched, true);
        assert.equal(res.json.statusCode, 200);
        assert.equal(res.json.headers["x-mock"], "true");
        const decoded = JSON.parse(Buffer.from(res.json.bodyB64, "base64").toString("utf8"));
        assert.deepEqual(decoded, { id: "42", name: "Mock User" });
    });

    it("matches combined query+body constraints via base64-encoded body", async () => {
        const bodyB64 = Buffer.from(JSON.stringify({ total: 500 })).toString("base64");
        const res = await requestOverSocket(socketPath, {
            method: "POST",
            reqPath: "/__match",
            body: {
                urlPath: "/orders",
                method: "POST",
                headers: { "content-type": "application/json" },
                query: { tier: "gold" },
                bodyB64,
            },
        });
        assert.equal(res.json.matched, true);
        assert.equal(res.json.statusCode, 201);
    });

    it("does not match when only one of query/body constraints is satisfied (regression)", async () => {
        const wrongBodyB64 = Buffer.from(JSON.stringify({ total: 1 })).toString("base64");
        const res = await requestOverSocket(socketPath, {
            method: "POST",
            reqPath: "/__match",
            body: {
                urlPath: "/orders",
                method: "POST",
                headers: { "content-type": "application/json" },
                query: { tier: "gold" },
                bodyB64: wrongBodyB64,
            },
        });
        assert.equal(res.json.matched, false);
    });

    it("reports matched: false for an unmatched route", async () => {
        const res = await requestOverSocket(socketPath, {
            method: "POST",
            reqPath: "/__match",
            body: { urlPath: "/nope", method: "GET" },
        });
        assert.deepEqual(res.json, { matched: false });
    });

    it("returns 400 for a malformed envelope", async () => {
        const status = await new Promise((resolve, reject) => {
            const req = http.request(
                { socketPath, path: "/__match", method: "POST", headers: { "content-type": "application/json" } },
                (res) => {
                    const chunks = [];
                    res.on("data", (c) => chunks.push(c));
                    res.on("end", () => resolve(res.statusCode));
                }
            );
            req.on("error", reject);
            req.write("not json");
            req.end();
        });
        assert.equal(status, 400);
    });
});

describe("startMockSidecar TCP loopback guard", () => {
    it("refuses a non-loopback host", () => {
        assert.throws(() => startMockSidecar(buildProxy(), { host: "0.0.0.0" }), /loopback/);
    });
});
