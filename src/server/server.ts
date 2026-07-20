import http from "http"
import Server, { createProxyServer, type ServerOptions } from "http-proxy"
import url from "url"

export class ProxyServer {

    proxyServer: Server

    constructor(opts?: ServerOptions) {
        this.proxyServer = createProxyServer(opts)
        this.#setup()
    }

    #setup() {
        this.proxyServer.on("error", (err, req, res) => {
            // // Attempt to determine which target failed based on request headers if possible,
            // // otherwise use a generic message.
            // console.error(`[PROXY ERROR] Request failed: ${err.message}`);

            // if (!res.headersSent) {
            //     res.writeHead(503, { 'Content-Type': 'application/json' });
            //     res.end(JSON.stringify({
            //         error: 'Service Unavailable',
            //         message: 'One of the upstream services is unreachable.'
            //     }));
            // }
        })

        // Modify the response from ANY upstream server
        this.proxyServer.on('proxyRes', (proxyRes, req, res) => {
            proxyRes.headers['x-proxy-served-by'] = 'ProxyMocker';
        });
    }

    configure(config: ServerOptions[]): void {
        this.proxyServer.
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        let proxied = false;

        // Iterate through all configurations to find a matching prefix
        for (const config of PROXY_CONFIGS) {
            if (pathname && pathname.startsWith(config.prefix)) {
                proxied = true;

                // 1. Path Rewriting
                // Combine pathname replacement with the original query string
                const fullPath = pathname + url.format(parsedUrl.search);
                const newPath = config.rewrite(fullPath);

                // 2. Feature: Custom Request Header Addition
                req.headers['x-forwarded-service'] = config.name;
                req.headers['x-forwarded-path'] = newPath;
                req.headers['host'] = new URL(config.target).host; // Important for virtual hosting

                console.log(`[FORWARD ${config.name}] ${req.method} ${fullPath} -> ${config.target}${newPath}`);

                // 3. Final Proxy Call: Use the single proxy instance
                proxy.web(req, res, {
                    target: config.target,
                    path: newPath, // Use the modified path
                    changeOrigin: true,
                    secure: false
                });

                // Stop iteration once a match is found and proxied
                return;
            }
        }

        // --- Default (Non-proxied) Route ---
        if (!proxied) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
            <h1>Native Node.js HTTP Proxy Gateway Active</h1>
            <p>This single server routes to ${PROXY_CONFIGS.length} different services.</p>
            <p>Test Links:</p>
            <ul>
                <li><a href="/api/users/posts/1">/api/users/posts/1</a> (Target: ${PROXY_CONFIGS[0].target})</li>
                <li><a href="/api/auth/users?page=2">/api/auth/users?page=2</a> (Target: ${PROXY_CONFIGS[1].target})</li>
            </ul>
        `);
        }
    }
}

export const StartProxyServer = (opts: undefined) => {

    const server = http.createServer((req, res) => {

    })
}


// multi-target-proxy.js

const express = require('express');
const httpProxy = require('http-proxy');

const app = express();
const PORT = 4000;

// --- Define All Upstream Targets and Configuration ---
const PROXY_CONFIGS = [
    {
        prefix: '/api/users',
        target: 'https://jsonplaceholder.typicode.com', // e.g., User Service
        rewrite: (path) => path.replace('/api/users', ''),
        name: 'USER_SERVICE'
    },
    {
        prefix: '/api/auth',
        target: 'https://reqres.in/api', // e.g., Authentication Service
        rewrite: (path) => path.replace('/api/auth', ''),
        name: 'AUTH_SERVICE'
    },
    {
        prefix: '/api/files',
        target: 'http://localhost:8080', // e.g., Local File Storage Service
        rewrite: (path) => path.replace('/api/files', '/storage'),
        name: 'FILE_SERVICE'
    }
];

// 1. Initialize the SINGLE http-proxy instance
const proxy = httpProxy.createProxy();

// -------------------------------------------------------------------
// 2. Proxy Event Listeners (Global to all Targets)
// -------------------------------------------------------------------

// Handle errors during proxying (e.g., target server is down)
proxy.on('error', (err, req, res) => {
    // Attempt to determine which target failed based on request headers if possible,
    // otherwise use a generic message.
    console.error(`[PROXY ERROR] Request failed: ${err.message}`);

    if (!res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: 'Service Unavailable',
            message: 'One of the upstream services is unreachable.'
        }));
    }
});

// Modify the response from ANY upstream server
proxy.on('proxyRes', (proxyRes, req, res) => {
    // Feature: Add a custom response header for tracking
    proxyRes.headers['x-proxy-served-by'] = 'Multi-Target-Gateway';
});

// -------------------------------------------------------------------
// 3. Reusable Middleware Factory
// -------------------------------------------------------------------

/**
 * Creates a single Express middleware function for a specific target configuration.
 */
function createProxyMiddleware(config) {
    return (req, res, next) => {
        // 1. Check if the request URL matches this middleware's prefix
        if (!req.url.startsWith(config.prefix)) {
            return next(); // Pass to the next middleware (or next target check)
        }

        // 2. Path Rewriting
        const originalPath = req.url;
        const newPath = config.rewrite(originalPath);

        // 3. Feature: Custom Request Header Addition
        req.headers['x-forwarded-service'] = config.name;
        req.headers['x-forwarded-path'] = newPath;

        console.log(`[FORWARD ${config.name}] ${req.method} ${originalPath} -> ${config.target}${newPath}`);

        // 4. Final Proxy Call: Instruct the SINGLE proxy instance
        proxy.web(req, res, {
            target: config.target,
            path: newPath, // Use the modified path
            changeOrigin: true,
            secure: false
        });

        // Stop middleware chain execution
    };
}

// -------------------------------------------------------------------
// 4. Apply All Middleware and Start Server
// -------------------------------------------------------------------

// Loop through all configurations and apply a specific middleware for each
PROXY_CONFIGS.forEach(config => {
    // We use a general app.use() to catch all paths, and let the 
    // middleware function handle the prefix matching and call next() if no match.
    app.use(createProxyMiddleware(config));
});


// Default route (if none of the proxy prefixes matched)
app.get('/', (req, res) => {
    res.send(`
        <h1>Multi-Target Express Proxy Gateway Running</h1>
        <p>This single gateway proxies to ${PROXY_CONFIGS.length} different services.</p>
        <p>Test Links:</p>
        <ul>
            <li><a href="/api/users/posts/1">/api/users/posts/1</a> (Target: ${PROXY_CONFIGS[0].target})</li>
            <li><a href="/api/auth/users?page=2">/api/auth/users?page=2</a> (Target: ${PROXY_CONFIGS[1].target})</li>
        </ul>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Multi-Target Proxy Gateway active on http://localhost:${PORT}`);
});