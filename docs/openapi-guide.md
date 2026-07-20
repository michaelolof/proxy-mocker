# Visualizing Mocks with OpenAPI

`proxy-mocker` can generate an OpenAPI 3.1 document from the mocks registered on a `MockProxy`.
Use it to see what your mock server currently knows how to answer, share a browsable reference with
teammates, or write a quick `openapi.json` artifact for another tool.

This is derived documentation, not an authoritative API contract. The generator looks at example
mock values and makes a best-effort schema from them. If an example is `{ id: 1, name: "Ada" }`, the
generated schema can infer an integer `id` and string `name`; it cannot know every production rule
your real API may enforce.

---

## Quickstart: Serve Docs from the Mock Server

The easiest path is the standalone mock server:

```ts
import { MockProxy, MockRouter, createMockServer } from "proxy-mocker";

const router = new MockRouter();
router.url("/users/{id}", {
  get: [{
    response: {
      success: (req) => ({ id: req?.path?.id, name: "Mock User" }),
    },
  }],
});

const proxy = new MockProxy();
proxy.register(router);

const server = createMockServer(proxy, {
  port: 4000,
  fallback: "notFound",
  docs: true,
});

server.listen(() => {
  console.log("docs at http://localhost:4000/docs");
});
```

With `docs: true`, the server adds two GET endpoints before normal mock matching:

| Path | Response |
|---|---|
| `/docs` | A Stoplight Elements docs page. |
| `/docs/q/openapi.json` | The generated OpenAPI 3.1 document used by the docs page. |

The docs routes take precedence over mocks. If you have a mock registered at `/docs` or
`/docs/q/openapi.json`, configure a custom docs path to avoid the clash.

```ts
createMockServer(proxy, {
  fallback: "notFound",
  docs: "reference",
});
```

That serves the UI at `/reference` and infers the spec path as `/reference/q/openapi.json`.

---

## Choosing the Docs UI

The default UI is Stoplight Elements, loaded from the unpkg CDN:

```ts
createMockServer(proxy, {
  fallback: "notFound",
  docs: true,
});
```

To serve Swagger UI instead:

```ts
createMockServer(proxy, {
  fallback: "notFound",
  docs: {
    uiProvider: "swagger",
  },
});
```

Both UI providers are CDN-based. The JSON at `/docs/q/openapi.json` is self-contained and works
offline, but `/docs` needs network access to load Stoplight or Swagger assets unless you build your
own offline page around the generated document.

---

## Generate a Spec File

For scripts, import from the OpenAPI subpath:

```ts
import { writeFileSync } from "node:fs";
import { generateOpenAPI } from "proxy-mocker/openapi";
import { proxy } from "./mocks";

const document = generateOpenAPI(proxy, {
  info: {
    title: "Mock API",
    version: "0.0.0",
    description: "Generated from proxy-mocker examples",
  },
});

writeFileSync("openapi.json", JSON.stringify(document, null, 2));
```

The core `proxy-mocker` import path does not export OpenAPI helpers. Use `proxy-mocker/openapi` when
you want generation or docs UI helpers.

---

## What Gets Inferred

The generator walks `proxy.routes()` and emits one OpenAPI operation per path and method.

| Mock signal | OpenAPI output |
|---|---|
| Route pattern `/users/:id` or `/users/{id}` | Path `/users/{id}` with a required string path parameter. |
| Static `request.query` or `request.header` keys | Optional query/header parameters. |
| Static `request.body` | JSON request body schema and example. |
| Static `response.success` or `response.error` | Response example plus an inferred JSON schema. |
| Function `success` or `error` | Invoked with a synthesized request by default, then inferred from the returned example. |
| Multiple definitions with the same status | One response with multiple named examples and a merged schema. |

Function responders are wrapped in `try/catch` during generation. If a responder throws, the status
is still listed but the example/schema are skipped.

---

## Fidelity Caveats

Generated schemas are intentionally best-effort:

- They are inferred from example values, not TypeScript types or your original OpenAPI source.
- Required fields mean "present in every example seen for this slot," not "required by the real API."
- Strings get only simple format sniffing for date-time, date, email, and UUID.
- Request-condition branching is collapsed into one operation per path and method.
- Function responders may behave differently with synthetic request data than with real requests.

Use this feature to visualize and share what has been mocked. Keep your real OpenAPI contract, if you
have one, as the source of truth.

---

## Configuration Reference

### `createMockServer(proxy, { docs })`

```ts
type DocsOptions = boolean | string | {
  specPath?: string;
  uiPath?: string;
  uiProvider?: "stoplight" | "swagger";
  title?: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  invokeResponders?: boolean;
  stoplightElementsVersion?: string;
  swaggerUIVersion?: string;
};
```

| Option | Default | Notes |
|---|---|---|
| `docs: true` | — | Serves UI at `/docs` and JSON at `/docs/q/openapi.json`. |
| `docs: string` | — | String is the UI path; JSON is inferred as `{uiPath}/q/openapi.json`. |
| `specPath` | `{uiPath}/q/openapi.json` | JSON document endpoint. Override only when you need a different location. |
| `uiPath` | `"/docs"` | HTML docs endpoint. Leading slash is optional. |
| `uiProvider` | `"stoplight"` | Set to `"swagger"` to serve Swagger UI. |
| `title` | `"API Docs"` | HTML document title. |
| `info` | `{ title: "Mocked API", version: "0.0.0" }` | Passed to `generateOpenAPI`. |
| `invokeResponders` | `true` | Set `false` to skip function-response harvesting. |
| `stoplightElementsVersion` | pinned package version | CDN version for Stoplight Elements. |
| `swaggerUIVersion` | pinned package version | CDN version for Swagger UI. |

### `generateOpenAPI(proxy, options)`

```ts
type GenerateOpenAPIOptions = {
  info?: { title?: string; version?: string; description?: string };
  openapi?: string;
  invokeResponders?: boolean;
  servers?: { url: string; description?: string }[];
};
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `createMockServer(...)` throws immediately | The default fallback is `"passthrough"`, which requires `target`. Use `fallback: "notFound"` for a pure mock/docs server. |
| `/docs` returns your mock instead of docs | Docs are disabled. Pass `docs: true`, `docs: "docs"`, or `docs: { ... }`. |
| A mock at `/docs` is not reachable | Docs routes are served before mocks. Change `docs.uiPath`. |
| `/docs` is blank but `/docs/q/openapi.json` works | The UI assets load from a CDN. Check network access or use the JSON endpoint directly. |
| A function response is missing an example | The responder threw during synthetic harvesting, or `invokeResponders` is `false`. |
| The schema is less precise than expected | The schema is inferred from examples. Add representative examples or keep a separate authoritative contract. |
