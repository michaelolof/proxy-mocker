import { ServerOptions } from "http-proxy"
import { type PluginOptions, type Server } from "./types";
import { readRequestOptions } from "../mocker";
import { waitBlock } from "../utils";


export const httpProxyMiddlewarePlugin = (opts: PluginOptions) => (proxy: Server, options?: ServerOptions) => {

    proxy.on('error', (err, req, res) => {
        // @ts-expect-error "suppress error"
        if (req.mocked) {
            // We destroyed the request significantly, so we expect this error
            return
        }

        if ("code" in err && err.code === "ECONNREFUSED") {
            console.warn("MockService Error: Proxy upstream error connection failed at", req.url);
            return
        }

        if (res.headersSent) {
            console.warn('Upstream error occurred AFTER mock response was sent. Error ignored.');
            return;
        }

        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('502 Bad Gateway: The upstream server is currently unavailable.');
    });

    proxy.on("proxyReq", async (proxyReq, req, res) => {

        const request = await readRequestOptions(req).catch((err) => {
            console.error("Error reading incoming client request:", err);
            if (!res.headersSent) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Bad Request: Client Request Error.');
            }
            return undefined; // Stop processing if payload reading failed
        });

        if (!request) {
            return
        }

        const resolved = opts.proxy.resolve(request);
        if (resolved) {
            if (opts.destroyRequestWhenMatched) {
                // @ts-expect-error "suppress error"
                req.mocked = true;
                proxyReq.destroy();
            }

            // This is a MAIN THREAD blocking wait function implementation.
            // Only trigger this if we're in a local envrionment and the delay is significant
            if (process.env.NODE_ENV === "development" && resolved.delayMs > 1200) {
                waitBlock(resolved.delayMs);
            }

            res.writeHead(resolved.statusCode, resolved.headers);
            return res.end(resolved.body);
        }

        return
    });
}
