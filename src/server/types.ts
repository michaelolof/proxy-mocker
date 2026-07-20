import * as http from "http";
import type { AddressInfo } from "net";
import { RequestOptions } from "../mocker";

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
};

export type MockServerHandle = {
    server: http.Server;
    listen(cb?: () => void): MockServerHandle;
    close(cb?: () => void): void;
    address(): AddressInfo | string | null;
    readonly port: number;
};
