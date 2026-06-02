# Node.js SDK Design

Date: 2026-05-28
Status: Approved for planning

## Goal

Add a first-class Node.js SDK (`@flareapp/node`) to the flare-client-js monorepo. Extract the environment-agnostic core of the existing `@flareapp/js` package into a new `@flareapp/core` package that both the browser SDK and the Node SDK depend on. Keep the existing `@flareapp/js` public API backwards-compatible.

## Non-goals (v1)

- Serverless / edge runtimes (Lambda, Vercel Functions, Cloudflare Workers).
- CLI / short-lived process scenarios.
- Express, Fastify, Hono, Koa middleware adapters. Examples in README only.
- Migration of `@flareapp/sveltekit` server-side code from `@flareapp/js` to `@flareapp/node`. Tracked as follow-up.
- HTTP request body capture by default. Opt-in only.
- Cookie parsing / header normalization beyond raw passthrough.

## Scope (v1)

Standalone Node servers. The SDK ships the primitives — singleton, process listeners, AsyncLocalStorage scope helper, flush — and is framework-agnostic. v1 does not include `express`/`fastify`/`koa`/`hono` middleware adapters; users wire `flare.runWithContext(...)` into their own middleware. README provides copy-paste snippets for each. "First-class framework support" is explicitly out of scope until adapter packages ship.

Captures: `uncaughtException`, `unhandledRejection`, and explicit `flare.report(err)` calls. Per-request context propagation via `node:async_hooks` (AsyncLocalStorage).

## Package topology

Three packages after the change:

```
packages/
  core/    @flareapp/core   (NEW, public, semver-independent)
  js/      @flareapp/js     (existing, browser-only consumer)
  node/    @flareapp/node   (NEW, public)
```

Dependency graph:

```
@flareapp/js   --depends--> @flareapp/core
@flareapp/node --depends--> @flareapp/core
```

`@flareapp/core` is published to npm as a public package (`publishConfig.access: "public"`). Initial version: `0.1.0`, marked unstable. The `0.x` line gives us room to iterate on the boundary while `@flareapp/js` and `@flareapp/node` are the only consumers. Bump to `1.0.0` when (a) an external integrator depends on it, OR (b) the API has settled across at least one minor migration of the framework packages (`sveltekit`, `nextjs`) off `@flareapp/js` on the server side. Until then, no stable-contract guarantees.

### Why not bundle core privately

Precedent exists in the repo: `@flareapp/flare-api` is `private: true` and gets bundled into `@flareapp/vite`/`webpack`/`nextjs` via `tsdown --noExternal`. That pattern is reasonable for build-time plumbing (sourcemap upload). It is the wrong shape for the runtime SDK base: bundling duplicates the core code in both `js` and `node` distributions, and it locks third-party plugin authors out of a clean isomorphic import target. Public `core` is the path that enables the SSR cleanup of the framework packages.

## Responsibilities per package

### `@flareapp/core`

Environment-agnostic. No `window`, no `process`, no auto-init.

```
packages/core/
  src/
    Flare.ts                    Moved from packages/js. Refactored to accept
                                pluggable contextCollector, FileReader, and Scope.
    Scope.ts                    NEW. Mutable per-request bag (glows, pendingAttributes,
                                entryPoint). Default = single global Scope. Browser
                                keeps default; Node injects ALS-backed Scope.
    api/Api.ts                  Unchanged. Uses global fetch (Node 22+ has it).
    stacktrace/
      createStackTrace.ts       Unchanged.
      fileReader.ts             Now an interface + readLinesFromFile() helper. The
                                env-specific reader (fetch vs disk) is injected by
                                the consumer. Module-level cache stays here.
      readLinesFromFile.ts      Pure string slicer; no env coupling.
    context/
      baseAttributes.ts         Cross-env attributes only (service.version, stage).
                                Replaces the current `collectAttributes` which
                                reaches into window.
    types.ts
    util/                       redactUrlQuery, resolveDenylist, glowsToEvents,
                                flatJsonStringify, etc.
  package.json                  publishConfig.access: "public", version 0.1.0
  .release-it.json
```

Exports:

```ts
// Class and constructor injection points
export { Flare } from './Flare';
export { Scope } from './Scope';
export { GlobalScopeProvider } from './scope/GlobalScopeProvider';
export { NullFileReader } from './stacktrace/NullFileReader';

// Stack trace helpers (consumers may want the cache + slicer directly)
export { getCodeSnippet, readLinesFromFile } from './stacktrace/fileReader';
export { createStackTrace } from './stacktrace/createStackTrace';

// Types and interfaces
export type {
    AttributeValue,
    Attributes,
    Config,
    EntryPointHandler,
    Framework,
    Glow,
    MessageLevel,
    OverriddenGrouping,
    Report,
    SdkInfo,
    SpanEvent,
    StackFrame,
} from './types';
export type { ContextCollector } from './Flare';
export type { FileReader } from './stacktrace/FileReader';
export type { ScopeProvider } from './Scope';

// Utilities
export { convertToError, DEFAULT_URL_DENYLIST, redactUrlQuery, resolveDenylist } from './util';
```

No singleton, no side effects on import. Core exports `redactUrlQuery` only. The old name `redactFullPath` is re-exported as a deprecated alias from `@flareapp/js` for backwards compatibility — see naming cleanup below.

The `Scope`, `ScopeProvider`, `FileReader`, and `ContextCollector` exports exist so that `@flareapp/node` and any third-party integrator can construct a custom `Flare` against the same contracts the shipped consumers use. Without these exports the "injectable" architecture would not actually be injectable from outside the monorepo.

**Naming cleanup.** The existing `redactFullPath` function is misleadingly named: it redacts sensitive query-string keys against the denylist and works on both absolute URLs and bare paths (it just looks for `?` and redacts query keys; no scheme/host parsing). Rename to `redactUrlQuery` in `@flareapp/core` to reflect actual behavior. `@flareapp/js` re-exports both names; `redactFullPath` is exported with a `@deprecated` JSDoc tag pointing at the new name. Internal call sites updated to the new name. No behavior change.

### `@flareapp/js` (browser, existing)

```
packages/js/
  src/
    index.ts                    Creates singleton, attaches window listeners,
                                registers browser contextCollector, re-exports
                                core's public surface.
    browser/
      catchWindowErrors.ts      Existing.
      context/
        request.ts              Moved from current context/. Reads window.
        cookie.ts               Moved.
        requestData.ts          Moved.
        collectBrowser.ts       Composes the three above into a contextCollector
                                conforming to the core interface.
```

Public API: unchanged. `import { flare, Flare, type Config, ... } from '@flareapp/js'` continues to work because `index.ts` re-exports the full core surface in addition to the singleton. No breaking change for existing users or for the existing framework packages (`@flareapp/react`, `vue`, `svelte`, `sveltekit`).

`@flareapp/js` depends on `@flareapp/core` as a regular dependency, not a peer.

### `@flareapp/node` (new)

```
packages/node/
  src/
    index.ts                    Creates singleton Flare with node contextCollector
                                attached. Re-exports core public surface. No
                                process listener attachment at import time.
    process/
      catchProcessErrors.ts     Attaches process.on('uncaughtException') and
                                process.on('unhandledRejection') on flare.light().
      flush.ts                  flare.flush(timeoutMs) implementation.
    context/
      collectNode.ts            Composes process attributes + ALS scope read.
      process.ts                Process-level attribute collection.
      request.ts                Reads RequestContext from ALS, projects to
                                OTel-style attributes.
    scope/
      asyncContext.ts           AsyncLocalStorage<NodeScope> singleton.
      api.ts                    runWithContext, setUser, mergeContext, addContext,
                                getContext.
    types.ts                    RequestContext, User, NodeScope, NodeOptions.
  package.json                  engines.node: ">=22"
  .release-it.json
```

`engines.node: ">=22"`. As of 2026-05-28: Node 18 has been EOL since April 2025. Node 20 reached End-of-Life on 2026-04-30. Node 22 is now Maintenance LTS (security fixes only, supported until ~April 2027). Node 24 is the current Active LTS. Node 26 is Current.

`>=22` is defensible because Node 22 is still in its supported Maintenance window and a non-trivial production install base will be on 22 for the next year. Re-evaluate moving to `>=24` once Node 22 reaches EOL (April 2027). AsyncLocalStorage `.run()`, global `fetch`, and the structured stack APIs the SDK depends on are all stable on 22.

`@flareapp/node` depends on `@flareapp/core` as a regular dependency.

## Core injection points

Core takes three pluggable dependencies, all injected at `Flare` construction. None are env-detected at runtime; the consumer wires what it needs.

```ts
// @flareapp/core/src/Flare.ts
type ContextCollector = (config: Config) => Attributes;

interface FileReader {
    read(url: string): Promise<string | null>;
}

interface ScopeProvider {
    active(): Scope; // returns current scope; default impl returns a single global Scope
}

export class Flare {
    constructor(
        public api: Api = new Api(),
        private contextCollector: ContextCollector = () => ({}),
        private fileReader: FileReader = new NullFileReader(),
        private scopeProvider: ScopeProvider = new GlobalScopeProvider(),
    ) {}
}
```

### ContextCollector

Replaces the current `collectAttributes(urlDenylist)` call inside `buildReport`. Browser collector reads `window.*`; Node collector reads process metadata + the active scope's request/user buckets. The `flare.entry_point.type` and `flare.entry_point.handler.*` attributes that today branch on `typeof window !== 'undefined'` inside `buildReport` move into the per-env collectors. Core's `baseAttributes` keeps only truly cross-env values (`telemetry.sdk.*`, `flare.language.name`, `service.stage`, `service.version`).

### FileReader

Replaces the `isNode()` branch inside `fileReader.ts`. Browser ships a `FetchFileReader` (current `readFileWithFetch` logic); Node ships a `DiskFileReader` (current `readFileFromDisk` logic). Core's `fileReader.ts` keeps the in-memory cache and the line-slicing logic (`readLinesFromFile`), but the actual I/O is delegated to the injected `FileReader`. `nativeImport.ts` moves to `@flareapp/node` because only the Node `DiskFileReader` needs to hide `node:` specifiers from bundlers. Core no longer has any runtime env detection.

**Plumbing.** `createStackTrace(error, debug)` today calls `getCodeSnippet(url, line, col)` directly. Injecting a `FileReader` into `Flare` is useless if `createStackTrace` doesn't see it. Two options:

- **A:** Pass the reader through. `createStackTrace(error, debug, fileReader)` -> `getCodeSnippet(url, line, col, fileReader)`. Simple plumbing, no abstraction churn.
- **B:** Introduce a `StackTraceBuilder` class held by `Flare` that wraps `createStackTrace` and binds the reader once. Cleaner if the call graph grows; overkill for v1.

Pick **A**. The single async hop is short; threading the parameter is half a dozen lines.

### ScopeProvider and Scope

This is the bigger refactor. Today the `Flare` class holds `_glows: Glow[]`, `pendingAttributes: Attributes`, and `entryPoint: EntryPointHandler | null` as instance fields. In a multi-request Node server those leak across requests. Move all mutable per-call state into a `Scope`:

```ts
// @flareapp/core/src/Scope.ts
export class Scope {
    glows: Glow[] = [];
    pendingAttributes: Attributes = {};
    entryPoint: EntryPointHandler | null = null;

    addGlow(glow: Glow, max: number): void {
        /* push + cap */
    }
    clearGlows(): void {
        /* ... */
    }
    setAttribute(key: string, value: AttributeValue): void {
        /* ... */
    }
    mergeAttributes(partial: Attributes): void {
        /* ... */
    }
}

export class GlobalScopeProvider implements ScopeProvider {
    private scope = new Scope();
    active() {
        return this.scope;
    }
}
```

Browser uses `GlobalScopeProvider` (single shared scope, matches today's behavior). Node uses an `AsyncLocalStorageScopeProvider` that stores `NodeScope` (defined in the Node Scope section below — it extends core `Scope` with `request` and `user` buckets):

```ts
// @flareapp/node/scope/asyncScopeProvider.ts
export class AsyncLocalStorageScopeProvider implements ScopeProvider {
    private als = new AsyncLocalStorage<NodeScope>();
    private fallback = new NodeScope(); // when called outside runWithContext

    active(): NodeScope {
        return this.als.getStore() ?? this.fallback;
    }

    runWithContext<T>(request: RequestContext, fn: () => T): T {
        const scope = new NodeScope();
        scope.request = request; // stored as-is; projection happens at report time
        return this.als.run(scope, fn);
    }
}
```

Note: `request` is stored on `scope.request` raw, not pre-merged into `pendingAttributes`. The projection to `http.request.*` / `url.*` attributes runs inside the Node context collector at report time. Pre-merging would freeze the values at scope creation; the live-store approach lets `mergeContext` patch the request shape (e.g., to attach the resolved user after auth runs) and have the patch appear in any subsequent report.

`Flare` reads/writes all mutable state through `this.scopeProvider.active()`:

- `flare.glow(...)` -> `active.addGlow(...)`
- `flare.clearGlows()` -> `active.clearGlows()`
- `flare.addContext(...)`, `flare.addContextGroup(...)` -> `active.setAttribute(...)` / `mergeAttributes(...)`
- `flare.setEntryPoint(...)` -> `active.entryPoint = ...`
- `buildReport(...)` reads `active.glows`, `active.pendingAttributes`, `active.entryPoint`

This closes the leak vectors flagged by review: `_glows`, `addContextGroup`, `setEntryPoint` are all now per-scope, not process-global.

User identity (`setUser`) is a Node-only addition layered on top — it's stored on the Scope as a typed `user: User | null` field too.

Breaking change risk: today `flare.glow(...)` and friends are sync and mutate instance state. After the refactor the same call sites work, but the underlying state lives on `Scope`. Behavior on the browser is identical (one global scope). On the Node server, behavior is correct for the first time.

## Node Scope and request context

The Node SDK extends core's `Scope` with two Node-specific buckets and provides them via `AsyncLocalStorageScopeProvider` (described above under "ScopeProvider and Scope"). The `Flare` instance is unchanged — it still reads/writes via `scopeProvider.active()` — but the Scope now carries Node-specific shapes.

```ts
type RequestContext = {
    method?: string;
    path?: string; // path + query, e.g. node:http req.url
    url?: string; // absolute URL, if known (e.g. after proxy header resolution)
    headers?: Record<string, string | string[] | undefined>;
    body?: unknown; // off by default; opt-in via NodeOptions.captureRequestBody
};

type User = {
    id?: string | number;
    email?: string;
    username?: string;
    ipAddress?: string;
};

// Extends core's Scope class with two extra typed buckets.
class NodeScope extends Scope {
    request: RequestContext = {};
    user: User | null = null;
}
```

Request, user, and the inherited `pendingAttributes` (which holds `addContext`/`addContextGroup` data) are three distinct buckets with distinct lifecycles. This mirrors Sentry's split between `setUser({ id, email, username, ip_address })` and `setContext(name, data)` and separates HTTP request data from authenticated user identity.

### API on the Node Flare singleton

```ts
flare.runWithContext(request: RequestContext, fn: () => T): T;   // sync or Promise<T>
flare.mergeContext(partial: Partial<RequestContext>): void;       // patches live scope
flare.setUser(user: User | null): void;                            // scoped if inside, global fallback otherwise
flare.addContext(name: string, value: AttributeValue): void;       // existing core API; Node override is ALS-aware
flare.getContext(): NodeScope | null;                              // returns the ALS request scope only; null outside runWithContext (the fallback scope is intentionally not exposed here)
```

### Inside vs outside scope

- Inside `runWithContext`, all setters mutate the per-request `NodeScope`. No cross-request leakage of glows, attributes, user, or entry point.
- Outside a scope (process startup, uncaught exception with no in-flight request, scheduled jobs), `AsyncLocalStorageScopeProvider.active()` returns its single `fallback` NodeScope. Reports built outside any request still carry process-level attributes; setters mutate the fallback. The fallback is the closest analog to the browser's single global scope.

Note on `getContext()`: it returns `null` outside a scope, NOT the fallback. The two reads (`active()` and `getContext()`) intentionally differ: `active()` is the internal read used by setters and the collector (it must always return _some_ scope to write to / read from), while `getContext()` is a public debug helper for asking "am I currently inside a request scope?" — for which the only useful answer outside is `null`.

### Behavior change for current core users

Today `Flare._glows`, `pendingAttributes`, and `entryPoint` are instance fields on the Flare class — process-global. Moving them onto `Scope` is a refactor of internals; the public API (`flare.glow(...)`, `flare.addContext(...)`, etc.) is unchanged. Behavior is identical in the browser (one global scope). In Node, behavior is correct for the first time: previously these would have leaked across concurrent requests; now they are scoped via ALS.

Any code that today reaches into `flare._glows` or `flare.pendingAttributes` directly (private fields, but TypeScript can't fully prevent it) will break. That is fine — those are not public.

The change is noted in the CHANGELOG.

### Async boundary coverage

`setTimeout`, `setImmediate`, `process.nextTick`, native promises, and `async`/`await` all propagate AsyncLocalStorage automatically. Edge cases not auto-handled in v1:

- `EventEmitter` listeners attached outside the scope (rare in request handling paths).
- Worker threads (they have their own ALS instance).

Both are documented in the README. Not patched.

### Attribute projection

Inside the node `collectNode` collector, the active `NodeScope`'s request and user buckets are projected into OTel-style attribute keys:

```
request.method      -> http.request.method
request.path        -> url.path + url.query (split on first '?', query passed through redactUrlQuery)
request.url         -> url.full (passed through redactUrlQuery using config.urlDenylist)
request.headers.*   -> http.request.header.<lowercase-name>
request.body        -> http.request.body (only if NodeOptions.captureRequestBody === true)
user.id             -> enduser.id
user.email          -> enduser.email
user.username       -> enduser.username
user.ipAddress      -> client.address
custom              -> context.custom
```

`path` and `url` are independent. Users on plain `node:http` pass `path: req.url`. Users behind a proxy or with framework-resolved absolute URLs pass `url` (and may pass both). No composition is performed by the collector. If neither is set, no URL attribute is emitted.

### Header capture policy

Headers in incoming requests routinely contain credentials and PII (`authorization`, `cookie`, `x-api-key`, session tokens). Emitting all headers as `http.request.header.*` is a security incident waiting to happen. Policy:

```ts
NodeOptions.headerDenylist?: RegExp;          // matched against lowercased header names; values redacted to "[redacted]"
NodeOptions.headerAllowlist?: RegExp;         // if set, ONLY allowlisted headers are emitted (denylist still applies)
```

Default denylist (always merged with user-supplied):

```
/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-csrf-token|x-xsrf-token|x-auth-token|forwarded|x-forwarded-(?:for|user))$/i
```

Same union semantics as `resolveDenylist`: user can extend or replace via `replaceDefaultHeaderDenylist: true`.

Implementation: for each header, lowercase the name. If allowlist is set and name doesn't match, skip entirely. If name matches denylist, emit the key with value `[redacted]`. Otherwise emit raw.

### Body capture policy

`captureRequestBody` defaults `false`. When `true`:

```ts
NodeOptions.captureRequestBody?: boolean;                  // default false
NodeOptions.bodyMaxBytes?: number;                          // default 16_384 (16 KB)
NodeOptions.bodyAllowedContentTypes?: RegExp;               // default /^application\/(json|x-www-form-urlencoded)\b/i
NodeOptions.bodyKeyDenylist?: RegExp;                       // default same as DEFAULT_URL_DENYLIST
```

**Content-type matching.** The default regex matches the bare type with optional parameters (`application/json; charset=utf-8`, `application/x-www-form-urlencoded; charset=utf-8`). Match against the lowercased `content-type` header, taking only the substring up to a parameter separator if present. `\b` after the type ensures we don't match `application/jsonp` or `application/x-www-form-urlencoded-foo`.

**Accepted body shapes.** Users pass `RequestContext.body` themselves (the SDK does not buffer streams). Accepted runtime shapes:

- `string` — used as-is; assumed already parsed/raw text per the declared content type.
- `Buffer` — decoded as UTF-8 string before further processing.
- `object` (plain object or array) — already parsed by middleware (e.g. Fastify `request.body`, Express `req.body` after `express.json()`). Treated as JSON regardless of declared content type, since the parsed object is the source of truth.
- `URLSearchParams` — converted to a flat `Record<string, string>`.

Anything else (streams, FormData, ArrayBuffer, class instances) is skipped with no warning. README documents the common middleware patterns and the type matrix.

**Pipeline:**

1. Resolve body to a normalized shape per the table above. Skip if not in the accepted set.
2. If the input is a string or Buffer, check `content-type` against `bodyAllowedContentTypes`. Parse JSON if `application/json`, parse URL-encoded if form. If parsing fails, skip.
3. If the input is already an object or `URLSearchParams`, skip the content-type check (the parsed shape is already known) and walk it directly.
4. Walk the parsed object, redact values for keys matching `bodyKeyDenylist` to `'[redacted]'`. Handle circular references via a seen-Set and emit `'[Circular]'` at repeat references.
5. Re-stringify with `JSON.stringify`, truncate to `bodyMaxBytes` with `'…[truncated]'` suffix if needed.
6. Emit as `http.request.body` (string).

## Process-level error handlers

### Attachment lifecycle

No process listeners attached on import. Listener state is **derived from current `NodeOptions`**, not a one-shot side effect of `light()`. Both `flare.light(key)` and `flare.configureNode(partial)` reconcile listeners with the effective mode:

- If the effective `uncaughtExceptionMode` is `'off'`: detach the handler if attached, no-op otherwise.
- If `'report'` or `'report-and-exit'`: attach the handler if not already attached.
- Same logic for `unhandledRejectionMode`.

This means the call order is free: a user can `configureNode({ uncaughtExceptionMode: 'off' })` either before or after `light(key)` and the right thing happens. Calling `configureNode({ uncaughtExceptionMode: 'off' })` after the listener is already attached **detaches it**, restoring Node's default crash behavior. Documented as a deliberate property of the API.

Detach API for tests and graceful shutdown:

```ts
flare.removeProcessListeners(): void;
```

### Handlers

```ts
process.on('uncaughtException', async (err, origin) => {
    // Await the full report pipeline (beforeEvaluate, stack/source resolution, beforeSubmit, api.report).
    // reportSilently() would be fire-and-forget and races process.exit; explicit await is required.
    try {
        await flare.report(err, { 'process.uncaught_exception.origin': origin });
    } catch {
        /* never throw from inside the handler */
    }
    // Belt-and-suspenders: drain any other in-flight reports that started before this handler fired.
    await flare.flush(nodeOptions.shutdownTimeoutMs);
    if (nodeOptions.uncaughtExceptionMode === 'report-and-exit') {
        process.exit(1);
    }
});

process.on('unhandledRejection', async (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    try {
        await flare.report(err);
    } catch {
        /* never throw */
    }
    if (nodeOptions.unhandledRejectionMode === 'report-and-exit') {
        await flare.flush(nodeOptions.shutdownTimeoutMs);
        process.exit(1);
    }
});
```

### Fatal report flushing

`reportSilently()` returns void and runs the report pipeline fire-and-forget. The pipeline is async well before `api.report()` is called (`beforeEvaluate` and `createReportFromError` both await), so a flush set that only tracks `api.report` promises will exit before the report is even built. Both handlers therefore `await flare.report(...)` directly and wrap the await in try/catch so a handler-side throw can't cascade.

`flare.flush(timeoutMs)` still exists — and the tracking Set still feeds it — but its job is to drain _other_ in-flight reports (e.g., a request handler that already called `flare.report(...)` when the uncaughtException fired). It is no longer the primary mechanism for the fatal report itself.

### Tri-state behavior modes

Adding any listener to `uncaughtException` or `unhandledRejection` changes Node's default crash behavior. Therefore every mode is an explicit choice; there is no implicit "report but Node still crashes" because Node will not crash once we attach a listener. Three modes for each:

```ts
type FatalMode = 'off' | 'report' | 'report-and-exit';

NodeOptions.uncaughtExceptionMode?: FatalMode;     // default 'report-and-exit'
NodeOptions.unhandledRejectionMode?: FatalMode;    // default 'report-and-exit'
NodeOptions.shutdownTimeoutMs?: number;            // default 2000
```

- `'off'`: do not attach a listener. Node default crash behavior preserved.
- `'report'`: attach listener, await report, do not exit. Node keeps running in undefined state. Risky; documented as such.
- `'report-and-exit'`: attach listener, await report, flush, then `process.exit(1)`. Default.

Default `'report-and-exit'` for both matches Node's own default (crash on these) plus we get the report out first. The unhandled-rejection default deliberately changed from "report but keep running" in the prior draft because per the Node docs, the default since v15 is to terminate; suppressing termination silently is a behavior change we shouldn't make for users.

### `flare.flush(timeoutMs)`

```ts
flare.flush(timeoutMs = 2000): Promise<void>;
```

Awaits in-flight `report()` promises with a hard timeout. The tracking Set must cover the **entire** `report()` pipeline, not only the `api.report()` tail. The pipeline is async from the first line of `report()`: `beforeEvaluate` may await, `createReportFromError` awaits (stack trace + source snippet reading), `beforeSubmit` may await, then `api.report()` awaits the HTTP round-trip. Tracking only the last step would miss reports still in earlier stages.

Implementation: at the entry of `Flare.report()`, `Flare.reportSilently()`, `Flare.reportMessage()`, and `Flare.reportUnhandledRejection()`, wrap the entire async body in a tracked promise and add it to an internal `Set<Promise<void>>`. Remove it on settle (success or failure). The same wrapping covers `reportSilently`'s outer Promise.resolve so its work is also drained by `flush()`. `flush()` does `Promise.race([Promise.allSettled([...inflight]), sleep(timeoutMs)])`. No retries.

The tracking Set lives on core's `Flare` class (small change to existing methods) but is only exercised via `flush()` in the Node SDK. Browser builds carry the Set with negligible overhead.

### Coexistence with user-attached listeners

We append a listener via `process.on(...)`, never `process.removeAllListeners(...)`. If the user's listener also calls `process.exit`, whichever calls first wins. We set `process.exitCode = 1` before awaiting flush so even if the user exits us, the exit code is correct.

## Configuration

Node-specific options live entirely in `@flareapp/node`, never round-tripped through `core`. Core stays typed against `Config`. The Node singleton owns its own typed options object — kept separate from the core `Flare`'s internal `_config`. Process listener wiring, header redaction, and body capture all read from the Node options directly; the core `contextCollector` only needs to see core's `Config` because it never inspects Node-only fields.

```ts
// @flareapp/node/types.ts
export type NodeOptions = {
    uncaughtExceptionMode?: 'off' | 'report' | 'report-and-exit'; // default 'report-and-exit'
    unhandledRejectionMode?: 'off' | 'report' | 'report-and-exit'; // default 'report-and-exit'
    shutdownTimeoutMs?: number; // default 2000
    headerDenylist?: RegExp; // unioned with default
    headerAllowlist?: RegExp; // optional
    replaceDefaultHeaderDenylist?: boolean; // default false
    captureRequestBody?: boolean; // default false
    bodyMaxBytes?: number; // default 16_384
    bodyAllowedContentTypes?: RegExp; // default JSON + form-urlencoded
    bodyKeyDenylist?: RegExp; // default same as DEFAULT_URL_DENYLIST
};
```

API on the Node singleton:

```ts
flare.light('key'); // core Config (key, version, stage, sampleRate, ...)
flare.configure({ stage: 'production' }); // core Config
flare.configureNode({ uncaughtExceptionMode: 'off' }); // Node-only options
```

No generic `Flare<TConfig>` in core. Cleaner types, no extra machinery in core, Node-only changes don't ripple into browser users.

## Stack traces and source snippets

`createStackTrace` moves to `@flareapp/core/stacktrace/`. Signature changes to accept the injected `FileReader`: `createStackTrace(error, debug, fileReader)`. The function passes `fileReader` through to `getCodeSnippet(url, line, col, fileReader)` for source snippet reading. The frame-parsing logic (via `error-stack-parser`) is otherwise unchanged.

`fileReader.ts` is split:

- **Core** keeps the public entry (`getCodeSnippet`), the module-level `cachedFiles` cache, URL scheme validation, and the pure `readLinesFromFile` slicer. The actual I/O is delegated to an injected `FileReader` (see "Core injection points" above). No env detection.
- **`@flareapp/js`** provides `FetchFileReader` (current `readFileWithFetch` logic).
- **`@flareapp/node`** provides `DiskFileReader` (current `readFileFromDisk` logic, plus `nativeImport.ts` for hiding `node:` specifiers from any bundler that touches the node package).

`nativeImport.ts` leaves core. Core no longer references `node:*` modules in any form. Browser bundlers building `@flareapp/core` directly will not see node specifiers.

Both consumers wire their reader once at startup. Local file URLs (`file://`, absolute paths) are validated by the core entry point; only the Node `DiskFileReader` is allowed to act on them in practice (the browser's `FetchFileReader` will not have a code path that recognizes those schemes).

## Public APIs

### `@flareapp/core` (NEW)

```ts
import { Flare, type Config, type Report, redactUrlQuery } from '@flareapp/core';

const flare = new Flare(api, contextCollector); // both optional
```

### `@flareapp/js` (unchanged)

```ts
import { flare, Flare, type Config } from '@flareapp/js';
flare.light('key');
// window listeners attached on import (existing behavior preserved)
```

### `@flareapp/node` (new)

```ts
import { flare, type RequestContext, type User } from '@flareapp/node';

flare.light('key'); // attaches process listeners
flare.configureNode({ uncaughtExceptionMode: 'report' }); // override default 'report-and-exit'

// In an HTTP server (node:http gives a path, not an absolute URL)
http.createServer((req, res) => {
    flare.runWithContext({ method: req.method, path: req.url, headers: req.headers }, () => handle(req, res));
}).listen(3000);

// In auth middleware
flare.setUser({ id: 'u_123', email: 'a@b.c' });

// In test teardown or graceful shutdown
flare.removeProcessListeners();
await flare.flush(2000);
```

## Testing

### Core (`packages/core/tests/`)

Move env-agnostic tests from `packages/js/tests/`: `configure.test.ts`, `glows.test.ts`, `glowsToEvents.test.ts`, `hooks.test.ts`, `light.test.ts`, `report.test.ts`, `sampleRate.test.ts`, `setSdkInfo.test.ts`, `setEntryPoint.test.ts`, `extractCode.test.ts`, `flatJsonStringify.test.ts`, `convertToError.test.ts`, `redactUrl.test.ts`, `api.test.ts`, `createStackTrace.test.ts`. Adapt to construct `Flare` explicitly (no singleton) and pass a stub `contextCollector`, `FileReader`, and `ScopeProvider` where the test needs predictable output. The `fileReader.test.ts` slicer assertions move to core; the Node-disk variant (`fileReaderNode.test.ts`) moves to `@flareapp/node` tests since `DiskFileReader` lives there.

Any test that today asserts on browser attributes (e.g. `url.full` from `window.location`) stays in `@flareapp/js`. Splitting `report.test.ts` may be necessary if it mixes env-agnostic shape assertions with browser-specific attribute checks.

(There is no `solutions.test.ts` in the current repo despite the README mentioning one in the historical structure; the solutions logic is currently tested implicitly by `report.test.ts` / `golden.test.ts`. No separate file to move.)

### `@flareapp/js` tests

Keep `context.test.ts` (browser context). Add a thin integration test that asserts the browser collector is wired into the singleton and the window listeners auto-attach on import.

### `@flareapp/node/tests/`

New suite:

- `processHandlers.test.ts` — attach/detach lifecycle; full `report()` pipeline awaited inside both fatal handlers (not racing `process.exit`); each handler honors all three `'off' | 'report' | 'report-and-exit'` modes; `shutdownTimeoutMs` is enforced.
- `scope.test.ts` — ALS isolation across simulated concurrent requests, `setUser` / `addContext` inside vs outside scope, async boundary propagation.
- `flush.test.ts` — `flare.flush(timeout)` race semantics, timeout enforcement.
- `context.test.ts` — process attribute shape, request attribute projection.
- `integration.test.ts` — spin up real `node:http` server, fire concurrent requests, assert reports captured against the fake-flare-server fixture.

No new Playwright project for Node. Playwright is browser-focused; a Node-only Vitest integration suite against `e2e/fake-flare-server` is the right shape.

## Migration order

1. Create `packages/core` workspace. Move env-agnostic files from `packages/js/src/`: `Flare.ts`, `types.ts`, `api/`, `stacktrace/createStackTrace.ts`, `util/`. Move env-agnostic tests (`configure`, `glows`, `hooks`, `light`, `report`, `solutions`). CI green.
2. Add the three injection points to core's `Flare`: `contextCollector`, `FileReader`, `ScopeProvider`. Introduce `Scope` class and migrate `_glows`, `pendingAttributes`, and `entryPoint` onto it. Default `GlobalScopeProvider` keeps current single-scope behavior. Split `fileReader.ts` into core entry + `FileReader` interface. Rename `redactFullPath` to `redactUrlQuery` with deprecated alias re-export. Add `flush()` tracking Set + public `flush()` method on core `Flare`.
3. Refactor `@flareapp/js` to depend on `@flareapp/core`. Browser-specific files (`browser/`, `context/request|cookie|requestData`) move under `packages/js/src/browser/context/`. Provide `BrowserContextCollector` and `FetchFileReader`. `index.ts` constructs singleton with both, attaches window listeners, re-exports core's surface. Existing framework packages unaffected. CI green.
4. Create `packages/node`. Implement: Node singleton with `NodeContextCollector` + `DiskFileReader` + `AsyncLocalStorageScopeProvider`; process handlers (`uncaughtExceptionMode`/`unhandledRejectionMode`, attached on `light()`); `runWithContext`/`mergeContext`/`setUser`; `NodeScope` extending `Scope`; header denylist/allowlist + body capture pipeline; `flare.configureNode(...)`.
5. Write Node test suite + integration suite against `e2e/fake-flare-server`. Tests must cover: ALS isolation across concurrent requests for _all_ scope buckets (glows, attributes, user, entryPoint); fatal handler awaits full report pipeline; flush drains other in-flight reports; header denylist redacts authorization/cookie; body capture respects size limit and content-type gate.
6. Release tooling. `scripts/release-all.mjs` today runs lockstep across `PUBLISH_ORDER` groups — every package in a release is bumped to the same target version. That contradicts the "core ships at 0.1.0 independently from `@flareapp/js` 2.x" decision. Two valid paths:
    - **6a (preferred for v1):** keep `core` and `node` OUT of `release-all.mjs`. Add `.release-it.json` to each and document that they are released via per-package `npm run release` (the existing per-package flow already documented in CLAUDE.md). `release-all.mjs` stays single-version-per-run for the existing lockstep packages. Update `CROSS_PACKAGE_REFS` only with new dependency edges between the lockstep packages and the independently versioned `core`/`node`; the script just verifies and bumps those references during its existing lockstep runs, never bumping core/node itself.
    - **6b:** rework `release-all.mjs` to track per-package target versions. Larger refactor; defer to a follow-up unless we want it now.

    Adopt 6a. Document the manual release order for the new packages in CLAUDE.md: when `@flareapp/core` ships a new version, run `cd packages/core && npm run release`, then update peer/regular dep ranges in `@flareapp/js` and `@flareapp/node` to point at the new version (these are not auto-bumped, same way the existing per-package release rules handle it).

7. Update `CLAUDE.md` monorepo structure table. Add CHANGELOG note for the `Scope` refactor (private fields removed/relocated). Document `@flareapp/node` README with framework wiring examples (Express, Fastify, Hono) and the header/body redaction defaults.

Each step is a separately mergeable change. Steps 1-3 ship as one PR (the extraction is atomic and back-compat). Step 4-5 ship as the new-package PR. Step 6-7 as a release-tooling/docs PR.

## Open questions resolved

- **Core initial version:** `0.1.0`, unstable. Bump to `1.0.0` once an external integrator depends on it or the API has settled across a sveltekit/nextjs server-side migration.
- **Node engines:** `>=22`. Node 20 reached EOL on 2026-04-30; Node 18 EOL April 2025.
- **Per-request scope:** all mutable per-call state (glows, pendingAttributes, entryPoint, user) lives on `Scope`, accessed via `ScopeProvider`. Browser uses single global scope (no behavior change). Node uses `AsyncLocalStorageScopeProvider` for per-request isolation. Documented as a behavior fix in CHANGELOG, not a breaking change to the public API.
- **`@flareapp/core` env detection:** none. Core is fully env-agnostic; `node:*` imports live in `@flareapp/node` only.
- **NodeConfig vs Config typing:** Node-specific options live as a separate `NodeOptions` typed object owned by the Node singleton; never threaded through core.
- **Fatal report flushing:** handlers `await flare.report(...)` directly (not `reportSilently`), then `flare.flush()` drains other in-flight reports.
- **`unhandledRejection` semantics:** explicit tri-state `off | report | report-and-exit`. Default `report-and-exit` to preserve Node's own default crash behavior.
- **Header capture:** default denylist (authorization, cookie, x-api-key, csrf, forwarded, ...); optional allowlist; `replaceDefaultHeaderDenylist` for full override.
- **Body capture:** off by default. When on: content-type gate (JSON + form-urlencoded), 16 KB cap, key denylist, circular handling.
- **`redactFullPath` rename:** new canonical name `redactUrlQuery` in core; `redactFullPath` re-exported from `@flareapp/js` with a `@deprecated` JSDoc tag for back-compat.
- **First-class framework support:** explicitly NOT v1. v1 ships the primitive (`runWithContext`); README documents how to wire it into Express, Fastify, Hono, Koa. Adapter packages are tracked as follow-ups.
- **Release tooling:** `@flareapp/core` and `@flareapp/node` are released independently via per-package `npm run release` (release-it). `scripts/release-all.mjs` MUST NOT bump `@flareapp/core` or `@flareapp/node` to lockstep version numbers; it stays scoped to the existing public packages. The only change to `release-all.mjs` is adding `CROSS_PACKAGE_REFS` entries that verify (not bump) the `@flareapp/core` / `@flareapp/node` ranges referenced by the lockstep packages.

## Out of scope (tracked as follow-ups)

- Migrate `@flareapp/sveltekit` server hook off `@flareapp/js` onto `@flareapp/node` (or `@flareapp/core` if we want to keep it process-listener-free).
- Migrate `@flareapp/nextjs` runtime helpers onto `@flareapp/node` if any are added (current `@flareapp/nextjs` is sourcemap upload only).
- Express / Fastify / Hono middleware adapters as their own packages (`@flareapp/express`, etc.).
- Serverless / edge runtime support (different lifecycle, no `process.on('uncaughtException')`).
- Cookie parsing utility on the Node side.
