export declare function getUrlPath(input: string): string;
export declare function JSONDecoder(input?: Uint8Array[]): any;
export declare function normalizeHeaders(headers?: Record<string, string>): Record<string, string>;
export declare function extractURLPathParams(urlPattern: string, urlPath: string): Record<string, string>;
export declare function deepEqual(obj1: any, obj2: any): boolean;
export declare function matchURL(pattern: string, urlPath: string): MatchResult;
export declare function normalizePath(url: string): string;
export declare function joinURL(...segments: string[]): string;
export declare function checkHeaderValue(header: any | undefined, name: string, value: string): boolean;
interface MatchResult {
    found: boolean;
    pathParams: Record<string, string> | undefined;
}
export {};
//# sourceMappingURL=utils.d.ts.map