import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockProxy, MockRouter } from "../dist/index.js";
import { docsUIHtml, generateOpenAPI, inferSchema, mergeSchemas, swaggerUIHtml } from "proxy-mocker/openapi";

describe("OpenAPI schema inference", () => {
    it("infers primitive schemas", () => {
        assert.deepEqual(inferSchema(42), { type: "integer" });
        assert.deepEqual(inferSchema(4.2), { type: "number" });
        assert.deepEqual(inferSchema("x"), { type: "string" });
        assert.deepEqual(inferSchema(true), { type: "boolean" });
        assert.deepEqual(inferSchema(null), { nullable: true });
        assert.deepEqual(inferSchema(undefined), {});
    });

    it("sniffs supported string formats", () => {
        assert.deepEqual(inferSchema("2020-01-01T00:00:00Z"), { type: "string", format: "date-time" });
        assert.deepEqual(inferSchema("2020-01-01"), { type: "string", format: "date" });
        assert.deepEqual(inferSchema("a@b.com"), { type: "string", format: "email" });
        assert.deepEqual(inferSchema("550e8400-e29b-41d4-a716-446655440000"), { type: "string", format: "uuid" });
    });

    it("infers object properties and required keys from a single example", () => {
        assert.deepEqual(inferSchema({ id: 1, name: "Ada" }), {
            type: "object",
            properties: {
                id: { type: "integer" },
                name: { type: "string" },
            },
            required: ["id", "name"],
        });
    });

    it("infers arrays by merging item schemas", () => {
        assert.deepEqual(inferSchema([{ id: 1, name: "Ada" }, { id: 2 }]), {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                },
                required: ["id"],
            },
        });
    });

    it("merges object schemas with required-key intersection", () => {
        assert.deepEqual(
            mergeSchemas(inferSchema({ id: 1, name: "Ada" }), inferSchema({ id: 2 })),
            {
                type: "object",
                properties: {
                    id: { type: "integer" },
                    name: { type: "string" },
                },
                required: ["id"],
            }
        );
    });

    it("uses oneOf for differing schema types", () => {
        assert.deepEqual(mergeSchemas(inferSchema(42), inferSchema("42")), {
            oneOf: [{ type: "integer" }, { type: "string" }],
        });

        assert.deepEqual(inferSchema([1, "x", 2]), {
            type: "array",
            items: {
                oneOf: [{ type: "integer" }, { type: "string" }],
            },
        });
    });

    it("deduplicates oneOf entries when conflicting schemas are identical", () => {
        assert.deepEqual(mergeSchemas({ oneOf: [{ type: "integer" }] }, { oneOf: [{ type: "integer" }] }), {
            oneOf: [{ type: "integer" }],
        });
    });
});

describe("OpenAPI document generation", () => {
    it("exposes the OpenAPI helpers from the package subpath only", async () => {
        const core = await import("proxy-mocker");
        const openapi = await import("proxy-mocker/openapi");

        assert.equal(typeof openapi.generateOpenAPI, "function");
        assert.equal(typeof openapi.inferSchema, "function");
        assert.equal(typeof openapi.mergeSchemas, "function");
        assert.equal(typeof openapi.docsUIHtml, "function");
        assert.equal(typeof openapi.stoplightUIHtml, "function");
        assert.equal(typeof openapi.swaggerUIHtml, "function");
        assert.equal("generateOpenAPI" in core, false);
        assert.equal("inferSchema" in core, false);
        assert.equal("mergeSchemas" in core, false);
        assert.equal("docsUIHtml" in core, false);
    });

    it("walks registered routes into an OpenAPI paths object", () => {
        const router = new MockRouter();
        router.url("/users", {
            get: [
                {
                    title: "List users",
                    description: "Returns mocked users",
                    request: {
                        query: { active: "true" },
                        header: { "x-client": "web" },
                    },
                    response: {
                        success: [{ id: 1, name: "Ada" }],
                    },
                },
            ],
        });
        router.url("/users/{id}", {
            get: [
                {
                    response: {
                        success: (req) => ({ id: req?.path?.id, name: "Mock User" }),
                    },
                },
            ],
        });

        const proxy = new MockProxy();
        proxy.register(router);

        const doc = generateOpenAPI(proxy, {
            info: { title: "Example API", version: "1.2.3", description: "Generated from mocks" },
            servers: [{ url: "http://127.0.0.1:4000" }],
        });

        assert.equal(doc.openapi, "3.1.0");
        assert.deepEqual(doc.info, {
            title: "Example API",
            version: "1.2.3",
            description: "Generated from mocks",
        });
        assert.deepEqual(doc.servers, [{ url: "http://127.0.0.1:4000" }]);
        assert.deepEqual(Object.keys(doc.paths).sort(), ["/users", "/users/{id}"]);

        assert.deepEqual(doc.paths["/users"].get, {
            summary: "List users",
            description: "Returns mocked users",
            parameters: [
                { name: "active", in: "query", required: false, schema: { type: "string" } },
                { name: "x-client", in: "header", required: false, schema: { type: "string" } },
            ],
            responses: {
                "200": {
                    description: "Successful response",
                    content: {
                        "application/json": {
                            schema: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "integer" },
                                        name: { type: "string" },
                                    },
                                    required: ["id", "name"],
                                },
                            },
                            example: [{ id: 1, name: "Ada" }],
                        },
                    },
                },
            },
        });

        assert.deepEqual(doc.paths["/users/{id}"].get, {
            parameters: [
                { name: "id", in: "path", required: true, schema: { type: "string" } },
            ],
            responses: {
                "200": {
                    description: "Successful response",
                    content: {
                        "application/json": {
                            schema: {
                                type: "object",
                                properties: {
                                    id: { type: "string" },
                                    name: { type: "string" },
                                },
                                required: ["id", "name"],
                            },
                            example: { id: "1", name: "Mock User" },
                        },
                    },
                },
            },
        });
    });

    it("normalizes colon path params, emits request bodies, and groups multiple examples by status", () => {
        const router = new MockRouter();
        router.url("/orders/:id", {
            post: [
                {
                    request: {
                        path: { id: "abc" },
                        body: { total: 42, currency: "USD" },
                    },
                    response: {
                        statusCode: 201,
                        success: { id: "abc", state: "created" },
                    },
                },
                {
                    response: {
                        statusCode: 201,
                        success: { id: "def", state: "queued", eta: "2020-01-01" },
                    },
                },
            ],
        });

        const proxy = new MockProxy();
        proxy.register(router);

        const operation = generateOpenAPI(proxy).paths["/orders/{id}"].post;

        assert.deepEqual(operation.parameters, [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
        ]);
        assert.deepEqual(operation.requestBody, {
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            total: { type: "integer" },
                            currency: { type: "string" },
                        },
                        required: ["total", "currency"],
                    },
                    example: { total: 42, currency: "USD" },
                },
            },
        });
        assert.deepEqual(operation.responses["201"], {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            state: { type: "string" },
                            eta: { type: "string", format: "date" },
                        },
                        required: ["id", "state"],
                    },
                    examples: {
                        example1: { value: { id: "abc", state: "created" } },
                        example2: { value: { id: "def", state: "queued", eta: "2020-01-01" } },
                    },
                },
            },
        });
    });

    it("keeps responses listed when function harvesting is disabled or a responder throws", () => {
        const router = new MockRouter();
        router.url("/dynamic", {
            get: [
                {
                    response: {
                        success: () => ({ ok: true }),
                    },
                },
            ],
        });
        router.url("/broken", {
            get: [
                {
                    response: {
                        success: () => {
                            throw new Error("synthetic request was not enough");
                        },
                    },
                },
            ],
        });
        router.url("/invalid", {
            post: [
                {
                    response: {
                        error: { message: "bad request" },
                    },
                },
            ],
        });

        const proxy = new MockProxy();
        proxy.register(router);

        const skipped = generateOpenAPI(proxy, { invokeResponders: false });
        assert.deepEqual(skipped.paths["/dynamic"].get.responses, {
            "200": { description: "Successful response" },
        });

        const harvested = generateOpenAPI(proxy);
        assert.deepEqual(harvested.paths["/dynamic"].get.responses["200"].content["application/json"].example, {
            ok: true,
        });
        assert.deepEqual(harvested.paths["/broken"].get.responses, {
            "200": { description: "Successful response" },
        });
        assert.deepEqual(harvested.paths["/invalid"].post.responses["400"].content["application/json"].example, {
            message: "bad request",
        });
    });
});

describe("OpenAPI docs UI HTML", () => {
    it("defaults to Stoplight Elements with a pinned CDN version", () => {
        const html = docsUIHtml("/openapi.json", { title: "Mock Docs" });

        assert.match(html, /<title>Mock Docs<\/title>/);
        assert.match(html, /@stoplight\/elements@9\.0\.21\/web-components\.min\.js/);
        assert.match(html, /@stoplight\/elements@9\.0\.21\/styles\.min\.css/);
        assert.match(html, /apiDescriptionUrl="\/openapi\.json"/);
        assert.match(html, /layout="sidebar"/);
        assert.doesNotMatch(html, /swagger-ui-dist/);
    });

    it("allows Stoplight version, layout, and router overrides", () => {
        const html = docsUIHtml("/custom.json", {
            version: "9.0.1",
            stoplightLayout: "stacked",
            stoplightRouter: "memory",
        });

        assert.match(html, /@stoplight\/elements@9\.0\.1\/web-components\.min\.js/);
        assert.match(html, /apiDescriptionUrl="\/custom\.json"/);
        assert.match(html, /layout="stacked"/);
        assert.match(html, /router="memory"/);
    });

    it("can switch to Swagger UI with its own pinned or overridden version", () => {
        const defaultSwagger = swaggerUIHtml("/openapi.json");
        const switched = docsUIHtml("/openapi.json", { provider: "swagger", version: "5.18.0" });

        assert.match(defaultSwagger, /swagger-ui-dist@5\.17\.14/);
        assert.match(defaultSwagger, /url: "\/openapi\.json"/);
        assert.match(switched, /swagger-ui-dist@5\.18\.0/);
        assert.match(switched, /url: "\/openapi\.json"/);
        assert.doesNotMatch(switched, /@stoplight\/elements/);
    });

    it("escapes document title and Stoplight spec URL attributes", () => {
        const html = docsUIHtml('/openapi.json?name="x"', { title: "<Docs>" });

        assert.match(html, /<title>&lt;Docs&gt;<\/title>/);
        assert.match(html, /apiDescriptionUrl="\/openapi\.json\?name=&quot;x&quot;"/);
    });
});
