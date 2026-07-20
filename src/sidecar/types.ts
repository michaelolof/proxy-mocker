export type WireRequest = {
    urlPath: string;
    method: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    cookies?: Record<string, string>;
    bodyB64?: string;
};

export type WireResponse =
    | {
        matched: true;
        statusCode: number;
        headers: Record<string, string>;
        delayMs: number;
        bodyB64: string;
    }
    | { matched: false };

export type SidecarOptions = {
    socketPath?: string;
    port?: number;
    host?: string;
    matchPath?: string;
    onListen?: (addr: string) => void;
};
