export type JSONSchema = Record<string, any>;

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sniffStringFormat(value: string): string | undefined {
    if (ISO_DATETIME.test(value)) return "date-time";
    if (ISO_DATE.test(value)) return "date";
    if (EMAIL.test(value)) return "email";
    if (UUID.test(value)) return "uuid";
    return undefined;
}

export function inferSchema(value: unknown): JSONSchema {
    if (value === null) return { nullable: true };

    switch (typeof value) {
        case "boolean":
            return { type: "boolean" };
        case "number":
            return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
        case "string": {
            const format = sniffStringFormat(value);
            return format ? { type: "string", format } : { type: "string" };
        }
        case "object":
            if (Array.isArray(value)) return inferArray(value);
            return inferObject(value as Record<string, unknown>);
        default:
            return {};
    }
}

function inferArray(value: unknown[]): JSONSchema {
    if (value.length === 0) return { type: "array", items: {} };

    let items = inferSchema(value[0]);
    for (let index = 1; index < value.length; index++) {
        items = mergeSchemas(items, inferSchema(value[index]));
    }

    return { type: "array", items };
}

function inferObject(value: Record<string, unknown>): JSONSchema {
    const properties: Record<string, JSONSchema> = {};
    const required: string[] = [];

    for (const key of Object.keys(value)) {
        properties[key] = inferSchema(value[key]);
        required.push(key);
    }

    const schema: JSONSchema = { type: "object", properties };
    if (required.length > 0) schema.required = required;
    return schema;
}

export function mergeSchemas(a: JSONSchema, b: JSONSchema): JSONSchema {
    if (Object.keys(a).length === 0) return b;
    if (Object.keys(b).length === 0) return a;
    if (a.type !== b.type) return { oneOf: dedupeOneOf([a, b]) };

    if (a.type === "object") {
        const properties: Record<string, JSONSchema> = { ...(a.properties ?? {}) };
        for (const [key, value] of Object.entries<JSONSchema>(b.properties ?? {})) {
            properties[key] = properties[key] ? mergeSchemas(properties[key], value) : value;
        }

        const aRequired: string[] = a.required ?? [];
        const bRequired: string[] = b.required ?? [];
        const required = aRequired.filter((key) => bRequired.includes(key));
        const schema: JSONSchema = { type: "object", properties };
        if (required.length > 0) schema.required = required;
        return schema;
    }

    if (a.type === "array") {
        return { type: "array", items: mergeSchemas(a.items ?? {}, b.items ?? {}) };
    }

    return a;
}

function dedupeOneOf(schemas: JSONSchema[]): JSONSchema[] {
    const seen = new Set<string>();
    const deduped: JSONSchema[] = [];

    for (const schema of schemas) {
        const candidates = Array.isArray(schema.oneOf) ? schema.oneOf : [schema];
        for (const candidate of candidates) {
            const key = JSON.stringify(candidate);
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(candidate);
            }
        }
    }

    return deduped;
}
