package proxymocker

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// testClient talks to a Node sidecar booted once for the whole package's test
// run (see TestMain) from testdata/sidecar_fixture.mjs, which registers a
// small, fixed set of mocks. Requires `npm run build` to have been run in the
// repo root first, since the fixture imports the built dist/index.js — there
// is no TypeScript toolchain available from `go test`.
var testClient *Client

func TestMain(m *testing.M) {
	repoRoot, err := filepath.Abs("../..")
	if err != nil {
		fmt.Fprintln(os.Stderr, "resolve repo root:", err)
		os.Exit(1)
	}

	distIndex := filepath.Join(repoRoot, "dist", "index.js")
	if _, err := os.Stat(distIndex); err != nil {
		fmt.Fprintln(os.Stderr, "dist/index.js not found — run `npm run build` in the repo root before `go test`:", err)
		os.Exit(1)
	}

	socketPath := filepath.Join(os.TempDir(), fmt.Sprintf("pm-go-itest-%d.sock", os.Getpid()))
	os.Remove(socketPath)

	cmd := exec.Command("node", filepath.Join("testdata", "sidecar_fixture.mjs"), socketPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "start sidecar fixture:", err)
		os.Exit(1)
	}

	testClient = NewUnixClient(socketPath)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	readyErr := testClient.WaitReady(ctx)
	cancel()
	if readyErr != nil {
		fmt.Fprintln(os.Stderr, "sidecar fixture never became ready:", readyErr)
		cmd.Process.Kill()
		cmd.Wait()
		os.Exit(1)
	}

	code := m.Run()

	cmd.Process.Kill()
	cmd.Wait()
	os.Remove(socketPath)

	os.Exit(code)
}

// 4.1: a matching request resolves to the expected status/headers/body.
func TestMatch_HitsKnownMock(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/users/42", nil)

	resp, ok, err := testClient.Match(req)
	if err != nil {
		t.Fatalf("Match returned error: %v", err)
	}
	if !ok {
		t.Fatal("expected a match, got none")
	}
	if resp.Status != 200 {
		t.Errorf("status = %d, want 200", resp.Status)
	}
	if got := resp.Headers.Get("x-mock"); got != "true" {
		t.Errorf(`x-mock header = %q, want "true"`, got)
	}
	const wantBody = `{"id":"42","name":"Mock User"}`
	if string(resp.Body) != wantBody {
		t.Errorf("body = %q, want %q", resp.Body, wantBody)
	}
}

// 4.1: a non-matching request reports ok == false, no error.
func TestMatch_NoMatch(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/nope", nil)

	resp, ok, err := testClient.Match(req)
	if err != nil {
		t.Fatalf("Match returned error: %v", err)
	}
	if ok {
		t.Fatalf("expected no match, got %+v", resp)
	}
}

// Regression: matchIncomingRequest used to only check the FIRST request
// constraint present (query/path/header/body) instead of ANDing all of them.
// This drives the fix across the real wire — Go client -> Unix socket ->
// Node sidecar -> MockProxy.resolve() -> back — not just in-process on the JS
// side, where it was originally caught and fixed.
func TestMatch_CombinedQueryAndBodyConstraints(t *testing.T) {
	t.Run("matching query and body", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/orders?tier=gold", bytes.NewBufferString(`{"total":500}`))
		req.Header.Set("content-type", "application/json")

		resp, ok, err := testClient.Match(req)
		if err != nil {
			t.Fatalf("Match returned error: %v", err)
		}
		if !ok {
			t.Fatal("expected a match when both query and body constraints are satisfied")
		}
		if resp.Status != 201 {
			t.Errorf("status = %d, want 201", resp.Status)
		}
		if want := `{"ok":true}`; string(resp.Body) != want {
			t.Errorf("body = %q, want %q", resp.Body, want)
		}
	})

	t.Run("matching query but wrong body", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/orders?tier=gold", bytes.NewBufferString(`{"total":1}`))
		req.Header.Set("content-type", "application/json")

		_, ok, err := testClient.Match(req)
		if err != nil {
			t.Fatalf("Match returned error: %v", err)
		}
		if ok {
			t.Fatal("expected no match when the body constraint fails, even though the query matches")
		}
	})
}

// 4.2: pins the exact bytes MockProxy.resolve() produces for a fixed,
// deterministic mock (no randomness, no timestamps). The JS plugin and this
// Go client both consume resolve()'s output unmodified (see
// src/mocker/mocker.ts and src/plugins/http-proxy-middleware-plugin.ts), so
// this golden value is what "Go bytes == JS-plugin bytes" reduces to for a
// fixture like this one, without needing to run the JS plugin in the same
// test process.
func TestMatch_GoldenBytes(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/users/42", nil)

	resp, ok, err := testClient.Match(req)
	if err != nil || !ok {
		t.Fatalf("Match failed: ok=%v err=%v", ok, err)
	}

	const wantBody = `{"id":"42","name":"Mock User"}`
	const wantContentType = "application/json; charset=utf-8"

	if string(resp.Body) != wantBody {
		t.Errorf("body = %q, want golden %q", resp.Body, wantBody)
	}
	if got := resp.Headers.Get("content-type"); got != wantContentType {
		t.Errorf("content-type = %q, want golden %q", got, wantContentType)
	}
	if resp.Status != 200 {
		t.Errorf("status = %d, want golden 200", resp.Status)
	}
	if resp.DelayMs != 0 {
		t.Errorf("delayMs = %d, want golden 0", resp.DelayMs)
	}
}

// 4.3: a dead socket must fail open, never panic — both at the Match level
// and, end-to-end, through Middleware falling through to the real upstream.
func TestClient_FailOpen(t *testing.T) {
	deadSocket := filepath.Join(os.TempDir(), fmt.Sprintf("pm-go-itest-dead-%d.sock", os.Getpid()))
	os.Remove(deadSocket) // ensure nothing is listening here
	dead := NewUnixClient(deadSocket)

	req := httptest.NewRequest(http.MethodGet, "/whatever", nil)
	resp, ok, err := dead.Match(req)
	if ok {
		t.Fatalf("expected no match against a dead socket, got %+v", resp)
	}
	if err == nil {
		t.Fatal("expected a transport error against a dead socket")
	}

	upstreamHit := false
	upstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamHit = true
		w.WriteHeader(http.StatusOK)
	})

	handler := Middleware(dead, upstream)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/whatever", nil))

	if !upstreamHit {
		t.Fatal("expected Middleware to fail open to the upstream handler when the sidecar is unreachable")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 (from upstream)", rr.Code)
	}
}
