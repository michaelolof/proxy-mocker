import type { MockProxy, MethodDefinition, RequestPayload } from "../mocker";
import { extractFuncy } from "../utils";
import { inferSchema, mergeSchemas, JSONSchema } from "./schema-infer";
import type { GenerateOpenAPIOptions, OpenAPIDocument } from "./types";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

export function generateOpenAPI(proxy: MockProxy, options: GenerateOpenAPIOptions = {}): OpenAPIDocument {
    const invokeResponders = options.invokeResponders ?? true;
    const routes = proxy.routes() as Record<string, Record<string, MethodDefinition<any>[]>>;
    const paths: OpenAPIDocument["paths"] = {};

    for (const pattern of Object.keys(routes)) {
        const { openapiPath, pathParams } = normalizePattern(pattern);
        const methods = routes[pattern] ?? {};
        const pathItem: Record<string, unknown> = paths[openapiPath] ?? {};

        for (const method of Object.keys(methods)) {
            const normalizedMethod = method.toLowerCase();
            if (!HTTP_METHODS.includes(normalizedMethod)) continue;

            const defs = methods[method] ?? [];
            pathItem[normalizedMethod] = buildOperation(defs, pathParams, invokeResponders);
        }

        paths[openapiPath] = pathItem;
    }

    return {
        openapi: options.openapi ?? "3.1.0",
        info: {
            title: options.info?.title ?? "Mocked API",
            version: options.info?.version ?? "0.0.0",
            ...(options.info?.description ? { description: options.info.description } : {}),
        },
        ...(options.servers ? { servers: options.servers } : {}),
        paths,
    };
}

function normalizePattern(pattern: string): { openapiPath: string; pathParams: string[] } {
    const pathParams: string[] = [];
    const openapiPath = pattern
        .split("/")
        .map((segment) => {
            if (segment.startsWith(":")) {
                const param = segment.slice(1);
                pathParams.push(param);
                return `{${param}}`;
            }

            if (segment.startsWith("{") && segment.endsWith("}")) {
                pathParams.push(segment.slice(1, -1));
                return segment;
            }

            return segment;
        })
        .join("/");

    return { openapiPath, pathParams };
}

function buildOperation(defs: MethodDefinition<any>[], pathParams: string[], invokeResponders: boolean): Record<string, any> {
    const operation: Record<string, any> = {};
    const titled = defs.find((def) => def.title);
    const described = defs.find((def) => def.description);

    if (titled?.title) operation.summary = titled.title;
    if (described?.description) operation.description = described.description;

    const parameters: any[] = [];
    for (const name of pathParams) {
        parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
    }

    for (const name of collectParamKeys(defs, "query")) {
        parameters.push({ name, in: "query", required: false, schema: { type: "string" } });
    }

    for (const name of collectParamKeys(defs, "header")) {
        parameters.push({ name, in: "header", required: false, schema: { type: "string" } });
    }

    if (parameters.length > 0) operation.parameters = parameters;

    const bodyExample = firstStaticBody(defs);
    if (bodyExample !== undefined) {
        operation.requestBody = {
            content: {
                "application/json": {
                    schema: inferSchema(bodyExample),
                    example: bodyExample,
                },
            },
        };
    }

    operation.responses = buildResponses(defs, pathParams, invokeResponders);
    return operation;
}

function collectParamKeys(defs: MethodDefinition<any>[], kind: "query" | "header"): string[] {
    const keys = new Set<string>();

    for (const def of defs) {
        const value = def.request?.[kind];
        if (value && typeof value === "object") {
            for (const key of Object.keys(value)) keys.add(key);
        }
    }

    return [...keys];
}

function firstStaticBody(defs: MethodDefinition<any>[]): unknown {
    for (const def of defs) {
        const body = def.request?.body;
        if (body !== undefined && typeof body !== "function") return body;
    }

    return undefined;
}

function buildResponses(
    defs: MethodDefinition<any>[],
    pathParams: string[],
    invokeResponders: boolean
): Record<string, any> {
    const byStatus = new Map<string, { schema: JSONSchema; examples: unknown[] }>();

    for (const def of defs) {
        const status = String(extractFuncy(def.response?.statusCode) ?? (def.response?.error ? 400 : 200));
        const example = harvestExample(def, pathParams, invokeResponders);

        if (example === undefined) {
            ensureStatus(byStatus, status);
            continue;
        }

        const schema = inferSchema(example);
        const slot = byStatus.get(status);
        if (slot) {
            slot.schema = mergeSchemas(slot.schema, schema);
            slot.examples.push(example);
        } else {
            byStatus.set(status, { schema, examples: [example] });
        }
    }

    const responses: Record<string, any> = {};
    for (const [status, { schema, examples }] of byStatus) {
        const content = examples.length === 0
            ? undefined
            : { "application/json": { schema, ...exampleField(examples) } };

        responses[status] = {
            description: descriptionForStatus(status),
            ...(content ? { content } : {}),
        };
    }

    if (Object.keys(responses).length === 0) responses["200"] = { description: "OK" };
    return responses;
}

function harvestExample(def: MethodDefinition<any>, pathParams: string[], invokeResponders: boolean): unknown {
    const response = def.response;
    if (!response) return undefined;

    const responder = response.success ?? response.error;
    if (responder === undefined) return undefined;
    if (typeof responder !== "function") return responder;
    if (!invokeResponders) return undefined;

    try {
        return (responder as (req?: RequestPayload<any>) => unknown)(synthesizeRequest(def, pathParams));
    } catch {
        return undefined;
    }
}

function synthesizeRequest(def: MethodDefinition<any>, pathParams: string[]): RequestPayload<any> {
    const staticObjectOrEmpty = (value: unknown) => value && typeof value === "object" ? value : {};
    const path: Record<string, string> = {};

    for (const param of pathParams) path[param] = "1";
    Object.assign(path, staticObjectOrEmpty(def.request?.path));

    return {
        query: staticObjectOrEmpty(def.request?.query) as any,
        path: path as any,
        header: staticObjectOrEmpty(def.request?.header) as any,
        body: (def.request?.body && typeof def.request.body !== "function" ? def.request.body : {}) as any,
    };
}

function exampleField(examples: unknown[]): Record<string, unknown> {
    if (examples.length === 1) return { example: examples[0] };

    const named: Record<string, { value: unknown }> = {};
    examples.forEach((value, index) => {
        named[`example${index + 1}`] = { value };
    });

    return { examples: named };
}

function ensureStatus(byStatus: Map<string, { schema: JSONSchema; examples: unknown[] }>, status: string): void {
    if (!byStatus.has(status)) byStatus.set(status, { schema: {}, examples: [] });
}

function descriptionForStatus(status: string): string {
    const numericStatus = Number(status);
    if (numericStatus >= 200 && numericStatus < 300) return "Successful response";
    if (numericStatus >= 400 && numericStatus < 500) return "Client error";
    if (numericStatus >= 500) return "Server error";
    return "Response";
}
