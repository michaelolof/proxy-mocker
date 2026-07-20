import * as http from "http";
import { Readable } from "stream";
import type { Server as HttpProxyServer } from "../plugins/types";
import { MockProxy, readRequestOptions } from "../mocker";
import { wait } from "../utils";
import { MockServerFallback, MockServerHandle, MockServerOptions } from "./types";

export function createMockServer(proxy: MockProxy, opts: MockServerOptions = {}): MockServerHandle {
    const fallback: MockServerFallback = opts.fallback ?? "passthrough";
    const host = opts.host ?? "127.0.0.1";
    const port = opts.port ?? 0;

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
    };

    return handle;
}
