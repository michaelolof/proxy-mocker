export type GetSuccessResp<Operation> = Operation extends {
    responses: {
        200: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        201: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : never;
export type GetErrResp<Operation> = Operation extends {
    responses: {
        "4XX": {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        "5XX": {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        400: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        401: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        402: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        403: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        404: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        429: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        500: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        501: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        502: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        503: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : Operation extends {
    responses: {
        504: {
            content: {
                "application/json": infer R;
            };
        };
    };
} ? R : never;
export type GetQueryParams<O> = O extends {
    parameters: {
        query: infer R;
    };
} ? R : never;
export type GetPathParams<O> = O extends {
    parameters: {
        path: infer R;
    };
} ? R : never;
export type GetReqHeaders<O> = O extends {
    parameters: {
        header: infer R;
    };
} ? R : never;
export type GetBody<O> = O extends {
    requestBody: {
        content: {
            "application/json": infer R;
        };
    };
} ? R : never;
export type RequestPayload<Operation> = {
    query?: GetQueryParams<Operation>;
    path?: GetPathParams<Operation>;
    header?: GetReqHeaders<Operation>;
    body?: GetBody<Operation>;
};
export type MethodDefinition<Operation> = {
    title?: string;
    description?: string;
    request?: {
        query?: ((payload?: GetQueryParams<Operation>) => boolean) | GetQueryParams<Operation>;
        path?: ((payload?: GetPathParams<Operation>) => boolean) | GetPathParams<Operation>;
        header?: ((payload?: GetReqHeaders<Operation>) => boolean) | GetReqHeaders<Operation>;
        body?: ((payload?: GetBody<Operation>) => boolean) | GetBody<Operation>;
        bodyDecoder?: (payload?: Uint8Array[]) => any;
    };
    response?: {
        encoder?: (payload?: any) => string;
        delay?: (() => number) | number;
        statusCode?: (() => number) | number;
        header?: ((req?: RequestPayload<Operation>) => Record<string, string>) | Record<string, string>;
        success?: ((req?: RequestPayload<Operation>) => GetSuccessResp<Operation>) | GetSuccessResp<Operation>;
        error?: ((req?: RequestPayload<Operation>) => GetErrResp<Operation>) | GetErrResp<Operation>;
    };
};
export type Methods<T, U extends keyof T> = {
    [K in keyof T[U]]?: MethodDefinition<T[U][K]>[];
};
export type MockRoutes<T> = {
    [K in keyof T]?: Methods<T, K>;
};
export type Mocker<T> = {
    url<U extends keyof T>(url: U, methods: Methods<T, U>): void;
    records(): MockRoutes<T>;
    register(mocker: Mocker<T>): void;
};
export type MockProxyOptions = {
    baseURL?: string;
    codec?: {
        bodyDecoder?: (payload?: Uint8Array[]) => any;
        responseEncoder?: (payload?: any) => string;
    };
};
export type RequestOptions = {
    urlPath: string;
    method: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    cookies?: Record<string, string>;
    body?: Uint8Array[];
};
//# sourceMappingURL=types.d.ts.map