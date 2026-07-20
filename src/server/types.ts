import * as http from "http";
import type { AddressInfo } from "net";
import { RequestOptions } from "../mocker";
import type { DocsOptions } from "../openapi/types";

// ── Behavior types (mock-server fault & timing injection) ──────────────────

export type BehaviorName = "delay" | "timeout" | "reset" | "flaky" | "retry";

/** Response emitted for an injected failure (flaky miss / retry's early attempts). */
export type SyntheticFailure = {
    statusCode?: number;                       // default 503
    headers?: Record<string, string>;          // merged over a default JSON content-type
    body?: unknown;                            // default { error: "mock behavior: injected failure" }
};

/** Per-prefix behavior config. Presence of a behavior key enables it for the prefix. */
export type PrefixBehaviors = {
    failure?: SyntheticFailure;                // prefix-level fallback fault shape
    delay?:   { defaultMs?: number; maxMs?: number };
    timeout?: { mode?: "hang" | "close"; afterMs?: number };
    reset?:   {};
    flaky?:   { rate?: number; failure?: SyntheticFailure };
    retry?:   { count?: number; failure?: SyntheticFailure };
};

/**
 * Behaviors scoped by URL path prefix. Key "/" is the catch-all. `true` = all behaviors, defaults.
 * Standalone by design so it can later be hoisted onto MockProxyOptions when behaviors go
 * cross-adapter (see plans/implementation.md §11).
 */
export type BehaviorsConfig = Record<string, PrefixBehaviors | true>;

// ── End behavior types ─────────────────────────────────────────────────────

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
    behaviors?: BehaviorsConfig;           // per-URL-prefix fault & timing injection
    behaviorHeader?: string;               // control header name; default "x-mock-behavior"
    behaviorSessionHeader?: string;        // scope retry counters per client
};

export type MockServerHandle = {
    server: http.Server;
    listen(cb?: () => void): MockServerHandle;
    close(cb?: () => void): void;
    address(): AddressInfo | string | null;
    readonly port: number;
    resetBehaviorState(): void;            // clear retry counters (test ergonomics)
};
