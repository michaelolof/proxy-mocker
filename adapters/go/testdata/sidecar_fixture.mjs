// Sidecar fixture for the Go client's integration test (client_test.go).
// Registers a small, fixed set of mocks and starts a sidecar on the socket
// path given as argv[2] — booted via exec.Command from TestMain.
import { MockRouter, MockProxy, startMockSidecar } from "../../../dist/index.js";

const socketPath = process.argv[2];
if (!socketPath) {
    console.error("sidecar_fixture: missing socket path argument");
    process.exit(1);
}

const router = new MockRouter();

router.url("/users/{id}", {
    get: [{
        response: {
            header: () => ({ "x-mock": "true" }),
            success: (req) => ({ id: req?.path?.id, name: "Mock User" }),
        },
    }],
});

router.url("/orders", {
    post: [{
        request: { query: { tier: "gold" }, body: { total: 500 } },
        response: { statusCode: 201, success: { ok: true } },
    }],
});

const proxy = new MockProxy();
proxy.register(router);

startMockSidecar(proxy, {
    socketPath,
    onListen: () => console.log(`sidecar_fixture: listening on ${socketPath}`),
});
