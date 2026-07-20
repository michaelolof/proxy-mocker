export type OpenAPIDocument = {
    openapi: string;
    info: {
        title: string;
        version: string;
        description?: string;
    };
    servers?: Array<{ url: string; description?: string }>;
    paths: Record<string, Record<string, unknown>>;
    components?: {
        schemas?: Record<string, unknown>;
    };
};

export type GenerateOpenAPIOptions = {
    info?: {
        title?: string;
        version?: string;
        description?: string;
    };
    openapi?: string;
    invokeResponders?: boolean;
    servers?: Array<{ url: string; description?: string }>;
};

export type DocsOptions = {
    specPath?: string;
    uiPath?: string;
    uiProvider?: "stoplight" | "swagger";
    title?: string;
    info?: GenerateOpenAPIOptions["info"];
    invokeResponders?: boolean;
    stoplightElementsVersion?: string;
    swaggerUIVersion?: string;
};
