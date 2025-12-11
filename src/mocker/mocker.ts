import { getUrlPath, JSONDecoder, normalizeHeaders, deepEqual, matchURL, joinURL, checkHeaderValue } from "./utils";
import {
    Methods,
    MockRoutes,
    MockProxyOptions,
    RequestOptions,
    MethodDefinition
} from "./types";
import { extractFuncy } from "../utils";

type RouterOptions = {
    rewritePath?: (path: string) => string;
}

export class MockRouter<T> {
    #onlyRoutes: MockRoutes<T> = {};
    #routes: MockRoutes<T> = {};
    #opts: RouterOptions = {};

    constructor(opts?: RouterOptions) {
        if (opts) {
            this.#opts = opts;
        }
    }

    url<U extends keyof T>(url: U, methods: Methods<T, U>): void {
        if (this.#opts.rewritePath) {
            url = this.#opts.rewritePath(url as string) as U;
        }
        this.#routes[url] = methods;
    }

    only<U extends keyof T>(url: U, methods: Methods<T, U>): void {
        console.warn("MockService Warning: `only(url, methods)` function should be called only in local development/testing");
        if (this.#opts.rewritePath) {
            url = this.#opts.rewritePath(url as string) as U;
        }

        this.#onlyRoutes[url] = methods;
    }

    routes() {
        if (Object.entries(this.#onlyRoutes).length > 0) {
            return this.#onlyRoutes;
        }
        return this.#routes;
    }
}

export class MockProxy {

    #opts: MockProxyOptions = {};
    #routes: MockRoutes<any> = {};

    constructor(opts?: MockProxyOptions) {
        if (opts) {
            this.#opts = opts;
        }
    }

    register(mocker: MockRouter<any>): void {
        if (!this.#opts.baseURL) {
            this.#routes = { ...this.#routes, ...mocker.routes() };
            return
        }

        const mroutes = mocker.routes()
        for (const url in mroutes) {
            this.#routes[joinURL("/", this.#opts.baseURL, url)] = mroutes[url];
        }
    }

    routes() {
        return this.#routes;
    }

    encodeResponse(resp: MethodDefinition<any>["response"]): string {
        if (!resp) {
            return ""
        }

        const isJSONResp = checkHeaderValue(extractFuncy(resp.header), "content-type", "application/json");
        const responseEncoder = resp.encoder || this.#opts.codec?.responseEncoder;
        return responseEncoder ? responseEncoder(resp.success || resp.error) : JSON.stringify(resp.success || resp.error)
    }

    matchIncomingRequest(req: RequestOptions): MatchedRequest<any> | undefined {
        const rurl = getUrlPath(req.urlPath);
        const rmethod = (req.method || "").toLowerCase();
        const rheaders = normalizeHeaders(req.headers);
        const rquery = req.query || {};
        let rbody: string = "";

        if (req.body && req.body.length > 0) {
            const isJSONReq = rheaders["content-type"] === "application/json";
            const bodyDecoder = this.#opts.codec?.bodyDecoder;
            rbody = bodyDecoder ? bodyDecoder(req.body) : isJSONReq ? JSONDecoder(req.body) : (() => {
                console.warn("MockService Warning: `bodyDecoder` option is not set and request header is not 'application/json', defaulting to string");
                return Buffer.concat(req.body || []).toString();
            })();
        }

        for (const mockURLPattern in this.#routes) {
            const match = matchURL(mockURLPattern, rurl)
            if (!match.found) {
                continue
            }

            const rpath = match.pathParams || {}
            const mockDefinitions = this.#routes[mockURLPattern]?.[rmethod]
            if (!mockDefinitions) {
                continue;
            }

            for (const mock of mockDefinitions) {
                let queryMatches = true,
                    pathMatches = true,
                    headerMatches = true,
                    bodyMatches = true;

                if (mock.request?.query) {
                    if (typeof mock.request.query === "function") {
                        queryMatches = mock.request.query(rquery) === true;
                    } else {
                        queryMatches = Object.entries(mock.request.query).every(([key, value]) => rquery[key] === value);
                    }
                } else if (mock.request?.path) {
                    if (typeof mock.request.path === "function") {
                        pathMatches = mock.request.path(rpath) === true;
                    } else {
                        pathMatches = Object.entries(mock.request.path).every(([key, value]) => rpath[key] === value);
                    }
                } else if (mock.request?.header) {
                    if (typeof mock.request.header === "function") {
                        headerMatches = mock.request.header(rheaders) === true;
                    } else {
                        headerMatches = Object.entries(mock.request.header).every(([key, value]) => rheaders[key] === value);
                    }
                } else if (mock.request?.body) {
                    if (typeof mock.request.body === "function") {
                        bodyMatches = mock.request.body(rbody) === true;
                    } else {
                        bodyMatches = deepEqual(mock.request.body, rbody);
                    }
                }

                const matched = queryMatches && pathMatches && headerMatches && bodyMatches;
                if (matched) {
                    return {
                        pattern: mockURLPattern,
                        url: rurl,
                        method: rmethod,
                        mock: mock,
                    };
                }

            }

        }

        return undefined;
    }

}

type MatchedRequest<O> = {
    pattern: string;
    url: string;
    method: string;
    mock: MethodDefinition<O>
}