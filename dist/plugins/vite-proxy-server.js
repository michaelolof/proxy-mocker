"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViteProxyConfigurePlugin = void 0;
const utils_1 = require("../utils");
const ViteProxyConfigurePlugin = (opts) => (proxy) => {
    proxy.on('error', (err, req, res) => {
        // @ts-expect-error "suppress error"
        if (req.mocked) {
            // We destroyed the request significantly, so we expect this error
            return;
        }
        if ("code" in err && err.code === "ECONNREFUSED") {
            console.warn("MockService Error: Proxy upstream error connection failed at", req.url);
            return;
        }
        if (res.headersSent) {
            console.warn('Upstream error occurred AFTER mock response was sent. Error ignored.');
            return;
        }
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('502 Bad Gateway: The upstream server is currently unavailable.');
    });
    proxy.on("proxyReq", (proxyReq, req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const requestPromise = new Promise((resolve, reject) => {
            const fullUrl = req.url || "";
            const [urlPath, queryString] = fullUrl.split("?");
            const queryParams = (0, utils_1.searchParamsToRecord)(new URLSearchParams(queryString));
            const requestHeaders = (0, utils_1.anyObjectToRecord)(req.headers);
            const body = [];
            req.on("data", (chunk) => body.push(chunk));
            req.on("end", () => {
                const payload = {
                    urlPath: urlPath,
                    query: queryParams,
                    headers: requestHeaders,
                    body: body,
                    method: req.method || "GET",
                };
                resolve(payload);
            });
            req.on("error", (err) => {
                reject(err);
            });
        });
        const request = yield requestPromise.catch((err) => {
            console.error("Error reading incoming client request:", err);
            if (!res.headersSent) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Bad Request: Client Request Error.');
            }
            return undefined; // Stop processing if payload reading failed
        });
        if (!request) {
            return;
        }
        const match = opts.proxy.matchIncomingRequest(request);
        if (match) {
            // @ts-expect-error "suppress error"
            req.mocked = true;
            proxyReq.destroy();
            // This is a MAIN THREAD blocking wait function implementation. 
            // Only trigger this if we're in a local envrionment and the delay is significant
            const delay = (0, utils_1.extractFuncy)((_a = match.mock.response) === null || _a === void 0 ? void 0 : _a.delay) || 0;
            if (process.env.NODE_ENV === "development" && delay > 1200) {
                (0, utils_1.waitBlock)(delay);
            }
            res.writeHead((0, utils_1.extractFuncy)((_b = match.mock.response) === null || _b === void 0 ? void 0 : _b.statusCode) || 200, Object.assign({ "content-type": "application/json; charset utf-8" }, (_c = match.mock.response) === null || _c === void 0 ? void 0 : _c.header));
            return res.end(opts.proxy.encodeResponse(match.mock.response));
        }
        return;
    }));
};
exports.ViteProxyConfigurePlugin = ViteProxyConfigurePlugin;
