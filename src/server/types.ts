import * as http from "http";
import type { AddressInfo } from "net";
import { RequestOptions } from "../mocker";
import type { DocsOptions } from "../openapi/types";

export type MockServerFallback =
    | "notFound"
    | "passthrough"
    | ((req: http.IncomingMessage, res: http.ServerResponse, parsed: RequestOptions) => void);

export type MockServerOptions = {
    port?: number;
    host?: string;
    fallback?: MockServerFallback;
    target?: string;
    notFoundBody?: unknown;
    docs?: boolean | string | DocsOptions;
};

export type MockServerHandle = {
    server: http.Server;
    listen(cb?: () => void): MockServerHandle;
    close(cb?: () => void): void;
    address(): AddressInfo | string | null;
    readonly port: number;
};
