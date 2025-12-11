
export function extractFuncy<T>(valOrFn?: (() => T) | T): T | undefined {
    if (valOrFn === undefined) {
        return undefined;
    } else if (typeof valOrFn === "function") {
        //@ts-expect-error "You don't know what you're saying" 
        return valOrFn();
    } else {
        return valOrFn;
    }
}

export function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitBlock(ms: number): void {
    const start = performance.now();
    const end = start + ms;

    while (performance.now() < end) {
    }
}

export function searchParamsToRecord(params: URLSearchParams): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
        if (!(key in result)) {
            result[key] = value;
        }
    }
    return result;
}

export function anyObjectToRecord(obj: object): Record<string, string> {
    const result: Record<string, string> = {}
    for (const key in obj) {
        if (key in obj && obj.hasOwnProperty(key)) {
            //@ts-expect-error "You don't know what you're saying"
            result[key] = obj[key]
        }
    }
    return result
}