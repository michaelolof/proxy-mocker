import { Methods, MockRoutes, MockProxyOptions, RequestOptions, MethodDefinition } from "./types";
export declare class MockRouter<T> {
    #private;
    url<U extends keyof T>(url: U, methods: Methods<T, U>): void;
    only<U extends keyof T>(url: U, methods: Methods<T, U>): void;
    routes(): MockRoutes<T>;
}
export declare class MockProxy {
    #private;
    constructor(opts?: MockProxyOptions);
    register(mocker: MockRouter<any>): void;
    routes(): MockRoutes<any>;
    encodeResponse(resp: MethodDefinition<any>["response"]): string;
    matchIncomingRequest(req: RequestOptions): MatchedRequest<any> | undefined;
}
type MatchedRequest<O> = {
    pattern: string;
    url: string;
    method: string;
    mock: MethodDefinition<O>;
};
export {};
//# sourceMappingURL=mocker.d.ts.map