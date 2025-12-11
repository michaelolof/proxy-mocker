"use strict";
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var _MockRouter_onlyRoutes, _MockRouter_routes, _MockProxy_opts, _MockProxy_routes;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockProxy = exports.MockRouter = void 0;
const utils_1 = require("./utils");
const utils_2 = require("../utils");
class MockRouter {
    constructor() {
        _MockRouter_onlyRoutes.set(this, {});
        _MockRouter_routes.set(this, {});
    }
    url(url, methods) {
        __classPrivateFieldGet(this, _MockRouter_routes, "f")[url] = methods;
    }
    only(url, methods) {
        console.warn("MockService Warning: `only(url, methods)` function should be called only in local development/testing");
        __classPrivateFieldGet(this, _MockRouter_onlyRoutes, "f")[url] = methods;
    }
    routes() {
        if (Object.entries(__classPrivateFieldGet(this, _MockRouter_onlyRoutes, "f")).length > 0) {
            return __classPrivateFieldGet(this, _MockRouter_onlyRoutes, "f");
        }
        return __classPrivateFieldGet(this, _MockRouter_routes, "f");
    }
}
exports.MockRouter = MockRouter;
_MockRouter_onlyRoutes = new WeakMap(), _MockRouter_routes = new WeakMap();
class MockProxy {
    constructor(opts) {
        _MockProxy_opts.set(this, {});
        _MockProxy_routes.set(this, {});
        if (opts) {
            __classPrivateFieldSet(this, _MockProxy_opts, opts, "f");
        }
    }
    register(mocker) {
        if (!__classPrivateFieldGet(this, _MockProxy_opts, "f").baseURL) {
            __classPrivateFieldSet(this, _MockProxy_routes, Object.assign(Object.assign({}, __classPrivateFieldGet(this, _MockProxy_routes, "f")), mocker.routes()), "f");
            return;
        }
        const mroutes = mocker.routes();
        for (const url in mroutes) {
            __classPrivateFieldGet(this, _MockProxy_routes, "f")[(0, utils_1.joinURL)("/", __classPrivateFieldGet(this, _MockProxy_opts, "f").baseURL, url)] = mroutes[url];
        }
    }
    routes() {
        return __classPrivateFieldGet(this, _MockProxy_routes, "f");
    }
    encodeResponse(resp) {
        var _a;
        if (!resp) {
            return "";
        }
        const isJSONResp = (0, utils_1.checkHeaderValue)((0, utils_2.extractFuncy)(resp.header), "content-type", "application/json");
        const responseEncoder = resp.encoder || ((_a = __classPrivateFieldGet(this, _MockProxy_opts, "f").codec) === null || _a === void 0 ? void 0 : _a.responseEncoder);
        return responseEncoder ? responseEncoder(resp.success || resp.error) : JSON.stringify(resp.success || resp.error);
    }
    matchIncomingRequest(req) {
        var _a, _b, _c, _d, _e, _f;
        const rurl = (0, utils_1.getUrlPath)(req.urlPath);
        const rmethod = (req.method || "").toLowerCase();
        const rheaders = (0, utils_1.normalizeHeaders)(req.headers);
        const rquery = req.query || {};
        let rbody = "";
        if (req.body && req.body.length > 0) {
            const isJSONReq = rheaders["content-type"] === "application/json";
            const bodyDecoder = (_a = __classPrivateFieldGet(this, _MockProxy_opts, "f").codec) === null || _a === void 0 ? void 0 : _a.bodyDecoder;
            rbody = bodyDecoder ? bodyDecoder(req.body) : isJSONReq ? (0, utils_1.JSONDecoder)(req.body) : (() => {
                console.warn("MockService Warning: `bodyDecoder` option is not set and request header is not 'application/json', defaulting to string");
                return Buffer.concat(req.body || []).toString();
            })();
        }
        for (const mockURLPattern in __classPrivateFieldGet(this, _MockProxy_routes, "f")) {
            const match = (0, utils_1.matchURL)(mockURLPattern, rurl);
            if (!match.found) {
                continue;
            }
            const rpath = match.pathParams || {};
            const mockDefinitions = (_b = __classPrivateFieldGet(this, _MockProxy_routes, "f")[mockURLPattern]) === null || _b === void 0 ? void 0 : _b[rmethod];
            if (!mockDefinitions) {
                continue;
            }
            for (const mock of mockDefinitions) {
                let queryMatches = true, pathMatches = true, headerMatches = true, bodyMatches = true;
                if ((_c = mock.request) === null || _c === void 0 ? void 0 : _c.query) {
                    if (typeof mock.request.query === "function") {
                        queryMatches = mock.request.query(rquery) === true;
                    }
                    else {
                        queryMatches = Object.entries(mock.request.query).every(([key, value]) => rquery[key] === value);
                    }
                }
                else if ((_d = mock.request) === null || _d === void 0 ? void 0 : _d.path) {
                    if (typeof mock.request.path === "function") {
                        pathMatches = mock.request.path(rpath) === true;
                    }
                    else {
                        pathMatches = Object.entries(mock.request.path).every(([key, value]) => rpath[key] === value);
                    }
                }
                else if ((_e = mock.request) === null || _e === void 0 ? void 0 : _e.header) {
                    if (typeof mock.request.header === "function") {
                        headerMatches = mock.request.header(rheaders) === true;
                    }
                    else {
                        headerMatches = Object.entries(mock.request.header).every(([key, value]) => rheaders[key] === value);
                    }
                }
                else if ((_f = mock.request) === null || _f === void 0 ? void 0 : _f.body) {
                    if (typeof mock.request.body === "function") {
                        bodyMatches = mock.request.body(rbody) === true;
                    }
                    else {
                        bodyMatches = (0, utils_1.deepEqual)(mock.request.body, rbody);
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
exports.MockProxy = MockProxy;
_MockProxy_opts = new WeakMap(), _MockProxy_routes = new WeakMap();
