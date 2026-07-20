import * as http from "http";
import * as fs from "fs";
import { MockProxy, RequestOptions } from "../mocker";
import { SidecarOptions, WireRequest, WireResponse } from "./types";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const HEALTH_PATH = "/__health";

function readJSONBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            try {
                const raw = Buffer.concat(chunks).toString("utf8");
                resolve(raw ? JSON.parse(raw) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on("error", reject);
    });
}

export function startMockSidecar(proxy: MockProxy, opts: SidecarOptions = {}): http.Server {
    const matchPath = opts.matchPath ?? "/__match";

    if (!opts.socketPath) {
        const host = opts.host ?? "127.0.0.1";
        if (!LOOPBACK_HOSTS.has(host.toLowerCase())) {
            throw new Error(
                `MockService Error: sidecar TCP host must be loopback (127.0.0.1/localhost/::1), got "${host}". ` +
                "Refusing to bind to a non-loopback address."
            );
        }
    }

    const httpServer = http.createServer(async (req, res) => {
        const { pathname } = new URL(req.url ?? "/", "http://sidecar");

        if (req.method === "GET" && pathname === HEALTH_PATH) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        if (req.method === "POST" && pathname === matchPath) {
            const wireReq: WireRequest | undefined = await readJSONBody(req).catch((err) => {
                console.error("MockService Error: sidecar failed to parse request envelope:", err);
                if (!res.headersSent) {
                    res.writeHead(400, { "content-type": "application/json" });
                    res.end(JSON.stringify({ error: "invalid request envelope" }));
                }
                return undefined;
            });

            if (!wireReq) {
                return;
            }

            const requestOptions: RequestOptions = {
                urlPath: wireReq.urlPath,
                method: wireReq.method,
                headers: wireReq.headers,
                query: wireReq.query,
                cookies: wireReq.cookies,
                body: wireReq.bodyB64 ? [Buffer.from(wireReq.bodyB64, "base64")] : undefined,
            };

            const resolved = proxy.resolve(requestOptions);
            const wireResp: WireResponse = resolved
                ? {
                    matched: true,
                    statusCode: resolved.statusCode,
                    headers: resolved.headers,
                    delayMs: resolved.delayMs,
                    bodyB64: Buffer.from(resolved.body, "utf8").toString("base64"),
                }
                : { matched: false };

            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(wireResp));
            return;
        }

        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
    });

    if (opts.socketPath) {
        // A prior unclean shutdown can leave the socket file behind, which makes
        // listen() fail with EADDRINUSE even though nothing is using it.
        try {
            fs.unlinkSync(opts.socketPath);
        } catch {
            // ignore — most commonly ENOENT (nothing to clean up)
        }

        httpServer.listen(opts.socketPath, () => {
            opts.onListen?.(opts.socketPath!);
        });
    } else {
        const host = opts.host ?? "127.0.0.1";
        const port = opts.port ?? 0;
        httpServer.listen(port, host, () => {
            const addr = httpServer.address();
            const resolvedAddr = typeof addr === "object" && addr ? `${addr.address}:${addr.port}` : `${host}:${port}`;
            opts.onListen?.(resolvedAddr);
        });
    }

    return httpServer;
}
