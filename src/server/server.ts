import * as http from "http";
import { Readable } from "stream";
import type { Server as HttpProxyServer } from "../plugins/types";
import { MockProxy, readRequestOptions } from "../mocker";
import { wait } from "../utils";
import { MockServerFallback, MockServerHandle, MockServerOptions } from "./types";

type NormalizedDocsOptions = {
    specPath: string;
    uiPath: string;
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

export function createMockServer(proxy: MockProxy, opts: MockServerOptions = {}): MockServerHandle {
    const fallback: MockServerFallback = opts.fallback ?? "passthrough";
    const host = opts.host ?? "127.0.0.1";
    const port = opts.port ?? 0;
    const docs = normalizeDocs(opts.docs);

    if (fallback === "passthrough" && !opts.target) {
        throw new Error(
            "MockService Error: `target` is required when `fallback` is \"passthrough\" (the default). " +
            "Pass a `target`, or set `fallback: \"notFound\"`."
        );
    }

    let httpProxyPromise: Promise<HttpProxyServer> | undefined;
    function getHttpProxy(): Promise<HttpProxyServer> {
        if (!httpProxyPromise) {
            httpProxyPromise = import("http-proxy").then((mod) => {
                const HttpProxy = (mod as any).default ?? mod;
                const instance: HttpProxyServer = HttpProxy.createProxyServer();
                instance.on("error", (err, _req, res) => {
                    console.warn("MockService Warning: passthrough upstream error:", err);
                    if (!res.headersSent) {
                        res.writeHead(502, { "content-type": "text/plain" });
                        res.end("502 Bad Gateway: The upstream server is currently unavailable.");
                    }
                });
                return instance;
            });
        }
        return httpProxyPromise;
    }

    warnIfDocsShadowMocks(proxy, docs);

    let openapiModPromise: Promise<typeof import("../openapi/index.js")> | undefined;
    function getOpenapiMod(): Promise<typeof import("../openapi/index.js")> {
        if (!openapiModPromise) {
            openapiModPromise = import("../openapi/index.js");
        }
        return openapiModPromise;
    }

    let docCache: string | undefined;

    const httpServer = http.createServer(async (req, res) => {
        const parsed = await readRequestOptions(req).catch((err) => {
            console.error("MockService Error: failed reading incoming request:", err);
            if (!res.headersSent) {
                res.writeHead(400, { "content-type": "text/plain" });
                res.end("Bad Request: Client Request Error.");
            }
            return undefined;
        });

        if (!parsed) {
            return;
        }

        if (docs && parsed.method.toUpperCase() === "GET") {
            if (parsed.urlPath === docs.specPath) {
                const openapi = await getOpenapiMod();
                docCache ??= JSON.stringify(
                    openapi.generateOpenAPI(proxy, {
                        info: docs.info,
                        invokeResponders: docs.invokeResponders,
                    })
                );
                res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
                res.end(docCache);
                return;
            }

            if (parsed.urlPath === docs.uiPath) {
                const openapi = await getOpenapiMod();
                const html = openapi.docsUIHtml(docs.specPath, {
                    provider: docs.uiProvider,
                    title: docs.title,
                    stoplightVersion: docs.stoplightElementsVersion,
                    swaggerVersion: docs.swaggerUIVersion,
                });
                res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                res.end(html);
                return;
            }
        }

        const resolved = proxy.resolve(parsed);
        if (resolved) {
            if (resolved.delayMs > 0) {
                await wait(resolved.delayMs);
            }
            res.writeHead(resolved.statusCode, resolved.headers);
            res.end(resolved.body);
            return;
        }

        if (typeof fallback === "function") {
            fallback(req, res, parsed);
            return;
        }

        if (fallback === "notFound") {
            const body = JSON.stringify(opts.notFoundBody ?? { error: "no mock matched this request" });
            res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
            res.end(body);
            return;
        }

        // fallback === "passthrough"
        const httpProxy = await getHttpProxy();
        const bodyStream = Readable.from(Buffer.concat(parsed.body ?? []));
        httpProxy.web(req, res, { target: opts.target, changeOrigin: true, buffer: bodyStream });
    });

    const handle: MockServerHandle = {
        server: httpServer,
        listen(cb) {
            httpServer.listen(port, host, cb);
            return handle;
        },
        close(cb) {
            httpServer.close(cb);
            httpProxyPromise?.then((instance) => instance.close());
        },
        address() {
            return httpServer.address();
        },
        get port() {
            const addr = httpServer.address();
            return typeof addr === "object" && addr ? addr.port : port;
        },
        resetBehaviorState() {
            // Wired up in WS5; no-op placeholder for WS0 type-check.
        },
    };

    return handle;
}

function normalizeDocs(docs: MockServerOptions["docs"]): NormalizedDocsOptions | undefined {
    if (!docs) return undefined;

    const options = docs === true ? {} : typeof docs === "string" ? { uiPath: docs } : docs;
    const uiPath = normalizePath(options.uiPath ?? "docs");
    return {
        specPath: options.specPath ? normalizePath(options.specPath) : joinPath(uiPath, "q/openapi.json"),
        uiPath,
        uiProvider: options.uiProvider,
        title: options.title,
        info: options.info,
        invokeResponders: options.invokeResponders,
        stoplightElementsVersion: options.stoplightElementsVersion,
        swaggerUIVersion: options.swaggerUIVersion,
    };
}

function normalizePath(path: string): string {
    const normalized = path.trim();
    if (!normalized) return "/";
    const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return withLeadingSlash === "/" ? withLeadingSlash : withLeadingSlash.replace(/\/+$/, "");
}

function joinPath(base: string, suffix: string): string {
    return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function warnIfDocsShadowMocks(proxy: MockProxy, docs: NormalizedDocsOptions | undefined): void {
    if (!docs) return;

    const routes = proxy.routes() as Record<string, unknown>;
    const shadowedPaths = [docs.specPath, docs.uiPath].filter((path) => routes[path]);
    if (shadowedPaths.length === 0) return;

    console.warn(
        "MockService Warning: docs routes are served before mocks and will shadow registered mock(s): " +
        shadowedPaths.join(", ") +
        ". Configure docs.specPath or docs.uiPath to avoid the clash."
    );
}
