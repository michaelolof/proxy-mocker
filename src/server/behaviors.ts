import * as http from "http";
import { BehaviorName, BehaviorsConfig, PrefixBehaviors, SyntheticFailure } from "./types";
import { ResolvedMockResponse } from "../mocker";
import { wait } from "../utils";

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_HEADER = "x-mock-behavior";
const ALL_BEHAVIORS: BehaviorName[] = ["delay", "timeout", "reset", "flaky", "retry"];
const DEFAULT_FAILURE: Required<SyntheticFailure> = {
    statusCode: 503,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: { error: "mock behavior: injected failure" },
};

// ── Public types ───────────────────────────────────────────────────────────

export type BehaviorDirective =
    | { name: "delay"; ms: number }
    | { name: "timeout" }
    | { name: "reset" }
    | { name: "flaky"; rate: number }
    | { name: "retry"; count: number };

export type ResolvedPrefix = {
    enabled: Set<BehaviorName>;
    failure: Required<SyntheticFailure>;                 // prefix-level fallback
    delay: { defaultMs: number; maxMs?: number };
    timeout: { mode: "hang" | "close"; afterMs?: number };
    flaky: { rate: number; failure: Required<SyntheticFailure> };
    retry: { count: number; failure: Required<SyntheticFailure> };
};

export type NormalizedBehaviors = {
    header: string;
    sessionHeader?: string;
    prefixes: { prefix: string; cfg: ResolvedPrefix }[]; // sorted longest-first
};

// ── Internal helpers ───────────────────────────────────────────────────────

function mergeFailure(
    base: Required<SyntheticFailure>,
    over?: SyntheticFailure,
): Required<SyntheticFailure> {
    if (!over) return base;
    return {
        statusCode: over.statusCode ?? base.statusCode,
        headers: { ...base.headers, ...over.headers },
        body: over.body ?? base.body,
    };
}

function resolvePrefix(raw: PrefixBehaviors | true): ResolvedPrefix {
    const p: PrefixBehaviors = raw === true
        ? { delay: {}, timeout: {}, reset: {}, flaky: {}, retry: {} }
        : raw;
    const enabled = new Set<BehaviorName>(ALL_BEHAVIORS.filter((b) => p[b] !== undefined));
    const prefixFailure = mergeFailure(DEFAULT_FAILURE, p.failure);
    return {
        enabled,
        failure: prefixFailure,
        delay: { defaultMs: p.delay?.defaultMs ?? 1000, maxMs: p.delay?.maxMs },
        timeout: { mode: p.timeout?.mode ?? "hang", afterMs: p.timeout?.afterMs },
        flaky: { rate: p.flaky?.rate ?? 0.5, failure: mergeFailure(prefixFailure, p.flaky?.failure) },
        retry: { count: p.retry?.count ?? 1, failure: mergeFailure(prefixFailure, p.retry?.failure) },
    };
}

// ── Public API ─────────────────────────────────────────────────────────────

export function normalizePrefix(raw: string): string {
    const withSlash = raw.startsWith("/") ? raw : "/" + raw;
    return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
}

export function normalizeBehaviors(
    config?: BehaviorsConfig,
    header?: string,
    sessionHeader?: string,
): NormalizedBehaviors | undefined {
    if (!config || Object.keys(config).length === 0) return undefined;
    const prefixes = Object.keys(config)
        .map((raw) => ({ prefix: normalizePrefix(raw), cfg: resolvePrefix(config[raw]) }))
        .sort((a, b) => b.prefix.length - a.prefix.length);   // longest-first
    return {
        header: (header ?? DEFAULT_HEADER).toLowerCase(),
        sessionHeader: sessionHeader?.toLowerCase(),
        prefixes,
    };
}

/** Longest, segment-aware prefix match. "/user" must NOT match "/users/1". */
export function resolveBehaviorPrefix(
    urlPath: string,
    prefixes: NormalizedBehaviors["prefixes"],
): ResolvedPrefix | undefined {
    for (const { prefix, cfg } of prefixes) {         // already longest-first
        if (prefix === "/") return cfg;                 // catch-all
        if (urlPath === prefix || urlPath.startsWith(prefix + "/")) return cfg;
    }
    return undefined;
}

// ── Control-header parsing ─────────────────────────────────────────────────

/** Parse "delay=2000" / "retry" / "flaky=0.3" against a prefix's enabled+configured behaviors.
 *  Returns undefined for absent header, unknown/disabled behavior, or malformed value (fail-open). */
export function parseBehaviorHeader(
    raw: string | undefined,
    cfg: ResolvedPrefix,
): BehaviorDirective | undefined {
    if (!raw) return undefined;
    const [rawName, rawValue] = raw.split("=", 2).map((s) => s.trim());
    const name = rawName.toLowerCase() as BehaviorName;
    if (!cfg.enabled.has(name)) return undefined;

    switch (name) {
        case "delay": {
            const ms = rawValue !== undefined ? Number(rawValue) : cfg.delay.defaultMs;
            if (!Number.isFinite(ms) || ms < 0) return undefined;
            return { name, ms: cfg.delay.maxMs ? Math.min(ms, cfg.delay.maxMs) : ms };
        }
        case "flaky": {
            const rate = rawValue !== undefined ? Number(rawValue) : cfg.flaky.rate;
            if (!Number.isFinite(rate) || rate < 0 || rate > 1) return undefined;
            return { name, rate };
        }
        case "retry": {
            const count = rawValue !== undefined ? Number(rawValue) : cfg.retry.count;
            if (!Number.isInteger(count) || count < 0) return undefined;
            return { name, count };
        }
        case "timeout": return { name };
        case "reset":   return { name };
        default:        return undefined;
    }
}

// ── Behavior state (retry counters) ────────────────────────────────────────

export type BehaviorState = { retryCounts: Map<string, number> };

export function createBehaviorState(): BehaviorState {
    return { retryCounts: new Map() };
}

// ── Response writers ───────────────────────────────────────────────────────

function writeResponse(res: http.ServerResponse, statusCode: number, headers: Record<string, string>, body: string): void {
    res.writeHead(statusCode, headers);
    res.end(body);
}

function writeResolved(res: http.ServerResponse, r: ResolvedMockResponse): void {
    writeResponse(res, r.statusCode, r.headers, r.body);
}

function writeFailure(res: http.ServerResponse, f: Required<SyntheticFailure>): void {
    writeResponse(res, f.statusCode, f.headers, JSON.stringify(f.body));
}

// ── Retry keying ───────────────────────────────────────────────────────────

export function retryKey(
    method: string,
    urlPath: string,
    sessionHeader?: string,
    sessionValue?: string,
): string {
    const session = sessionHeader ? (sessionValue ?? "") : "";
    return `${session}|${method.toUpperCase()} ${urlPath}`;
}

// ── Behavior executor ──────────────────────────────────────────────────────

export type BehaviorContext = {
    urlPath: string;
    method: string;
    sessionHeader?: string;
    sessionValue?: string;
};

export async function applyBehavior(
    directive: BehaviorDirective,
    resolved: ResolvedMockResponse,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    cfg: ResolvedPrefix,
    state: BehaviorState,
    ctx: BehaviorContext,
): Promise<void> {
    switch (directive.name) {
        case "delay": {
            await wait(directive.ms);            // behavior delay replaces the mock's static delay
            writeResolved(res, resolved);
            return;
        }
        case "flaky": {
            if (Math.random() < directive.rate) {
                writeFailure(res, cfg.flaky.failure);
            } else {
                if (resolved.delayMs > 0) await wait(resolved.delayMs);
                writeResolved(res, resolved);
            }
            return;
        }
        case "reset": {
            res.socket?.destroy();               // simulate ECONNRESET; no HTTP response
            return;
        }
        case "timeout": {
            if (cfg.timeout.mode === "close") {
                const ms = cfg.timeout.afterMs ?? 30000;
                setTimeout(() => res.socket?.destroy(), ms);   // close after a while
            }
            // mode "hang": never respond — hold the socket open, let the client time out
            return;
        }
        case "retry": {
            const key = retryKey(ctx.method, ctx.urlPath, ctx.sessionHeader, ctx.sessionValue);
            const soFar = state.retryCounts.get(key) ?? 0;

            if (soFar < directive.count) {
                state.retryCounts.set(key, soFar + 1);
                writeFailure(res, cfg.retry.failure);
                return;
            }
            state.retryCounts.delete(key);                 // sequence complete; next run starts fresh
            if (resolved.delayMs > 0) await wait(resolved.delayMs);
            writeResolved(res, resolved);
            return;
        }
    }
}
