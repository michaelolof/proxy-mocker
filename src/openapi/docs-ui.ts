export type DocsUIProvider = "stoplight" | "swagger";

export type DocsUIHtmlOptions = {
    provider?: DocsUIProvider;
    title?: string;
    version?: string;
    stoplightVersion?: string;
    swaggerVersion?: string;
    stoplightLayout?: "sidebar" | "stacked";
    stoplightRouter?: "hash" | "history" | "memory";
};

const DEFAULT_STOPLIGHT_ELEMENTS_VERSION = "9.0.21";
const DEFAULT_SWAGGER_UI_VERSION = "5.17.14";

export function docsUIHtml(specUrl: string, opts: DocsUIHtmlOptions = {}): string {
    if (opts.provider === "swagger") {
        return swaggerUIHtml(specUrl, {
            title: opts.title,
            version: opts.swaggerVersion ?? opts.version,
        });
    }

    return stoplightUIHtml(specUrl, {
        title: opts.title,
        version: opts.stoplightVersion ?? opts.version,
        stoplightLayout: opts.stoplightLayout,
        stoplightRouter: opts.stoplightRouter,
    });
}

export function stoplightUIHtml(specUrl: string, opts: DocsUIHtmlOptions = {}): string {
    const version = opts.stoplightVersion ?? opts.version ?? DEFAULT_STOPLIGHT_ELEMENTS_VERSION;
    const base = `https://unpkg.com/@stoplight/elements@${version}`;
    const title = escapeHtml(opts.title ?? "API Docs");
    const layout = escapeAttribute(opts.stoplightLayout ?? "sidebar");
    const router = escapeAttribute(opts.stoplightRouter ?? "hash");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <script src="${base}/web-components.min.js"></script>
  <link rel="stylesheet" href="${base}/styles.min.css" />
  <style>
    body {
      margin: 0;
      min-height: 100vh;
    }
    elements-api {
      display: block;
      min-height: 100vh;
    }
  </style>
</head>
<body>
  <elements-api
    apiDescriptionUrl="${escapeAttribute(specUrl)}"
    router="${router}"
    layout="${layout}"
  ></elements-api>
</body>
</html>`;
}

export function swaggerUIHtml(specUrl: string, opts: { version?: string; title?: string } = {}): string {
    const version = opts.version ?? DEFAULT_SWAGGER_UI_VERSION;
    const base = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${version}`;
    const title = escapeHtml(opts.title ?? "API Docs");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="${base}/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${base}/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: ${JSON.stringify(specUrl)},
      dom_id: "#swagger-ui",
      deepLinking: true,
    });
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
    return escapeHtml(value)
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
