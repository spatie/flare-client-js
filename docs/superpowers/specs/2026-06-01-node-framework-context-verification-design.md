# Node framework per-request context: verify and correct the examples

Date: 2026-06-01
Status: Approved (design)
Package: `@flareapp/node`

## Problem

`packages/node/README.md` ships "Framework wiring" examples for Express, Fastify,
and Hono. Each wraps the request in `flare.runWithContext({ method, path, headers }, ...)`
and reports errors from the framework's global error handler
(`app.use((err, ...))`, `setErrorHandler`, `onError`).

The open question is whether the error reported from that global handler still
sees the per-request `NodeScope`. `AsyncLocalStorage` propagates the store across
`await`, so context survives **only if** the error handler runs as a continuation
of the async chain rooted inside `als.run(...)`. That is framework- and
version-dependent:

- **Hono** — the example `await`s `next()` inside `runWithContext`, so the whole
  downstream and `onError` stay in the chain. Expected correct.
- **Express 5** — wraps async route handlers and forwards rejections through a
  promise chain created inside `next()`, which inherits the store. Expected
  correct. **Express 4** does not catch async throws at all; they surface as
  `unhandledRejection` and never reach the error middleware.
- **Fastify** — `onRequest` hook calls `done()`, then `setErrorHandler` runs later
  in the lifecycle. Whether that continuation stays in-store is unverified.

The examples are currently asserted by reasoning, not by a test. "Better examples"
without verification risks shipping snippets that silently drop request context on
async errors (the common case).

## Goal

Make every README framework example **verified** to attach request attributes
(`http.request.method`, `url.path`) to a report produced by an **asynchronously**
thrown error. Correct any example that fails. No new shipped API surface on
`@flareapp/node`.

## Non-goals

- No first-party middleware/adapter helpers. (Considered and declined; this is a
  docs-plus-regression-guard effort, not new API.)
- No Node playground webshop (tracked separately as a follow-up in the SDK PR).
- No change to `runWithContext`, `mergeContext`, `report`, or scope internals.

## Approach

### 1. Verification harness, committed under `e2e/`

A new directory `e2e/node-frameworks/` holding one small harness per framework.
Each harness:

1. Boots the framework app on an ephemeral port, wired to point Flare's
   `ingestUrl` at the existing `e2e/fake-flare-server` (reuse, do not reinvent).
2. Registers a route whose handler throws **after an `await`** (the async path,
   which is where context loss would occur).
3. Issues a request to that route.
4. Reads the captured report from the fake server's `GET /__inspect/reports`
   inspection API and asserts the report attributes include
   `http.request.method` and `url.path` matching the request.

Frameworks covered: **Express 5, Fastify, Hono**. Express 4 is documented (async
throws never reach the error handler) but not exercised, since the example targets
Express 5.

Test framework: prefer a single Node test file driven by the existing e2e tooling
rather than a new Playwright project (these are server-to-server checks, no
browser). If Playwright project structure is the path of least friction given the
current `playwright.config.ts`, a dedicated `node-frameworks` project is
acceptable. Decide during planning; either way the harness lives under `e2e/`.

Framework deps (`express@5`, `fastify`, `hono`) are added as devDependencies at
the workspace root or in an `e2e` package as appropriate to the existing e2e
dependency layout.

### 2. Correct failing examples

For any framework whose harness fails the assertion, rewrite the README example to
report **inside** the active scope rather than from the global error handler. The
robust shape, where the framework supports awaiting downstream (Hono):

```ts
await flare.runWithContext({ method, path, headers }, async () => {
    try {
        await next();
    } catch (err) {
        flare.report(err);
        throw err; // let the framework's own error response still fire
    }
});
```

For frameworks that cannot await downstream from the request hook (Express
classic middleware), if and only if the harness shows context is lost, document
the in-handler reporting pattern or the version constraint explicitly rather than
relying on the global handler.

If a framework's existing example passes the harness unchanged, leave the code as
is and add a one-line note that it is verified for that framework/version.

### 3. README updates

- Replace/annotate the three examples with the verified versions.
- Add a short callout under "Framework wiring" explaining the async pitfall: a
  report fired from a framework's global error handler only carries request
  context when that handler runs within the request's async chain; when in doubt,
  report inside `runWithContext`.
- State the verified framework versions (Express 5, the Fastify major used, Hono
  major used) so readers know the snippets are pinned to tested behavior.

## Components and boundaries

- `e2e/node-frameworks/<framework>.*` — one harness per framework. Each is
  self-contained: boot app, hit route, assert captured report. Depends only on the
  fake-flare-server inspection API and the framework under test.
- `e2e/fake-flare-server` — reused unchanged.
- `packages/node/README.md` — corrected examples + pitfall callout.

## Testing

The harness **is** the test. Success criteria: for each covered framework, an
async-thrown route error produces a fake-server report whose attributes include
the request method and path. CI already runs the e2e suite; these checks ride
along.

## Risks

- Framework behavior changes across majors. Pinning devDeps and stating versions
  in the README bounds this; the committed harness catches regressions on upgrade.
- Express 4 vs 5 divergence. Documented, not papered over.
- Added e2e devDeps increase install weight. Acceptable for a permanent guard.
