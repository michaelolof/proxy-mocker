import { ServerOptions } from "http-proxy"
import { type PluginOptions, type Server } from "./types";
import { RequestOptions } from "../mocker";
import { anyObjectToRecord, extractFuncy, searchParamsToRecord, waitBlock } from "../utils";


export const HttpProxyMiddlewarePlugin = (opts: PluginOptions) => (proxy: Server, options?: ServerOptions) => {

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

        const requestPromise = new Promise<RequestOptions>((resolve, reject) => {
            const fullUrl = req.url || "";
            const [urlPath, queryString] = fullUrl.split("?");
            const queryParams = searchParamsToRecord(new URLSearchParams(queryString));
            const requestHeaders = anyObjectToRecord(req.headers);
            const body: Uint8Array[] = [];

            req.on("data", (chunk) => body.push(chunk));

            req.on("end", () => {
                const payload: RequestOptions = {
                    urlPath: urlPath,
                    query: queryParams,
                    headers: requestHeaders,
                    body: body,
                    method: req.method || "GET",
                }

                resolve(payload);
            });

            req.on("error", (err) => {
                reject(err);
            });
        });

        const request = await requestPromise.catch((err) => {
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


        const match = opts.proxy.matchIncomingRequest(request);
        if (match) {
            // @ts-expect-error "suppress error"
            req.mocked = true;
            proxyReq.destroy();

            // This is a MAIN THREAD blocking wait function implementation. 
            // Only trigger this if we're in a local envrionment and the delay is significant
            const delay = extractFuncy(match.mock.response?.delay) || 0
            if (process.env.NODE_ENV === "development" && delay > 1200) {
                waitBlock(delay);
            }

            res.writeHead(
                extractFuncy(match.mock.response?.statusCode) || 200,
                {
                    "content-type": "application/json; charset utf-8",
                    ...match.mock.response?.header
                }
            );

            return res.end(opts.proxy.encodeResponse(match.mock.response));
        }

        return
    });

}
