# Code quality review, flare-client-js (2026-07-13)

## Scope and method

A whole-codebase quality audit of every `packages/*/src`, along the three axes you asked for:
simplification, bugs, security. This is not a diff review against a commit; it reviews the current
state of `HEAD` (branch `react-router-v7-integration`).

Method: nine parallel sub-agents each reviewed one cohesive slice of the monorepo, then every
high-severity claim (and a sample of the medium ones) was re-read against the source before landing
here.

Legend:

- `[verified]`: I read the cited code myself and confirmed the finding. Everything unmarked is
  sub-agent reported and plausible from the code, but I did not personally re-read every line.
- Severity: high / med / low. Judged for a client SDK that runs in customers' browsers and servers
  and whose whole job is to be trustworthy with error data.

---

## Status: top items fixed (2026-07-13)

The following were implemented and verified (full workspace: type-check clean, build clean, 1280
tests passing, lint clean). Nothing was committed.

- FIXED X-core-1 / B-core-1: `configure()` no longer reverts a custom `urlDenylist` when a later call
  omits it (`Flare.ts`, guarded re-resolve + regression tests).
- FIXED X-cookie-1: cookies now run through the denylist (`cookie.ts` takes the denylist,
  `collectBrowser.ts` passes it); accumulator is null-prototype.
- FIXED X-sveltekit-1 and X-vue-1 (params): route params redacted via a new shared
  `redactObjectValues` core helper.
- FIXED userinfo part of X-redact-1: `user:pass@` stripped from URLs in `redactUrlQuery`.
  DEFERRED to the tracing pass: URL path-segment redaction and HTTP span-name redaction.
- FIXED B-core-2 and B-vue-1: `flatJsonStringify` coerces BigInt and survives throwing getters;
  `serializeProps` survives throwing reactive getters.
- FIXED B-svelte-1/2/3: preprocessor escapes the component name, registers module-only components,
  and returns real sourcemaps (via `magic-string`).
- FIXED B-react-1: `parseComponentStack` now handles the React 16/17/18 `in X (at File:line)` format.
- FIXED X-nextjs-1: `removeSourcemaps` defaults to `true` so the force-enabled browser maps are
  deleted after upload (verified the webpack plugin unlinks client maps, not just server).

Still open: everything else in this document, including the two cross-cutting simplification themes
and the tracing internal-complexity items (next planned pass).

---

## Executive summary

Three things explain most of what you are feeling.

1. **Redaction is applied inconsistently.** The SDK carefully redacts URL query strings against a
   denylist that even lists `cookie|session|token|password`. That same denylist is then not applied
   to the cookie jar, route params, URL path segments, URL userinfo, request header values, HTTP
   span names, or component prop values. And a config bug silently reverts a custom denylist back to
   the default. This is the single biggest theme and it spans the security and simplification axes at
   once: the fix is one shared redaction pass applied uniformly, not eight partial ones.

2. **Cross-package duplication is most of the "complexity".** `resolveFlare`, `identify`,
   `contextToAttributes`, the flush schedulers, the disk file readers, the fatal/process handlers,
   the sourcemap-upload orchestration, and the prop/JSON serializers are copy-pasted across
   react/vue/svelte/sveltekit/node/electron/react-native/vite/webpack/nextjs. The line count is large
   because the same shapes exist five times, not because any one thing is deep. Hoisting the shared
   shapes into `core`/`js` is the highest-leverage simplification available.

3. **The tracing subsystem carries real internal complexity.** It is the newest code (~1,958 lines
   across `core` and `js`) and the densest. SpanBuffer measures its own size three different ways,
   the Tracer threads an `epoch` staleness counter through two files for one narrow race, browser
   tracing is a seven-global implicit state machine, and the fetch/XHR span-open logic is written
   twice. None of it is wrong, but it is where "make some things simpler" pays off most.

Counts: 9 security findings of note (3 high), ~20 bugs (0 high beyond the denylist reset, which is
counted under both), and a long simplification list led by the two cross-cutting themes above.

---

## Cross-cutting theme A: inconsistent redaction

The denylist (`DEFAULT_URL_DENYLIST`, `redactUrl.ts:3`) is `password|token|secret|...|cookie|session|csrf|...`.
Where it is and is not applied today:

| Data captured                         | Denylist applied? | Where                                                     |
| ------------------------------------- | ----------------- | --------------------------------------------------------- |
| URL query-string keys                 | yes               | `redactUrlQuery` (core)                                   |
| Request data / query context          | yes               | `request()` / `requestData()` (js)                        |
| Cookie names and values               | **no**            | `js/src/browser/context/cookie.ts:46` `[verified]`        |
| SvelteKit route params                | **no**            | `sveltekit/.../server/getRouteContext.ts:30` `[verified]` |
| Vue route params / query values       | **partial**       | `vue/src/getRouteContext.ts:47` (keys only)               |
| URL path segments (`/reset/<token>`)  | **no**            | `redactUrlQuery` only touches the query `[verified]`      |
| URL userinfo (`user:pass@host`)       | **no**            | preserved in `abs.href` `[verified]`                      |
| HTTP span name (`GET /reset/<token>`) | **no**            | `instrumentFetch.ts:46` (no redaction at all)             |
| HTTP span `url.full`                  | query only        | `httpRequestSpan.ts:42` `[verified]`                      |
| Node request header values            | fixed denylist    | `node/src/context/headers.ts` (gaps, see X-node)          |
| Vue prop values                       | keys only         | `serializeProps.ts:89` `[verified]`                       |

Two structural fixes collapse most of this:

- Make redaction value-aware, not only key-aware, and apply it in one place that every collector
  calls. Right now each collector re-implements a slice of the policy.
- Redact path segments and strip userinfo in `redactUrlQuery` (or a sibling `redactUrl`), since it is
  already the choke point for `window.location.href`, `document.referrer`, and span `url.full`.

---

## Cross-cutting theme B: cross-package duplication

| Duplicated shape                              | Copies live in                                     | Suggested home                             |
| --------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| `resolveFlare` + dev-mode + Electron tripwire | react, vue, svelte                                 | `createFlareResolver(pkgName)` in core     |
| `identify` two-WeakSet tagger                 | react, vue                                         | `createIdentityTagger(name)` in core       |
| `contextToAttributes`                         | react, svelte, sveltekit                           | one core helper                            |
| `DiskFileReader` + `isLocalFileUrl`           | node, electron (byte-identical)                    | one `DiskFileReader` in core               |
| fatal callbacks + process-handler manager     | node, electron, react-native                       | one shared fatal module in core            |
| flush schedulers                              | browser, node, electron, react-native              | keep subclasses, but share the trigger     |
| sourcemap upload orchestration                | vite, webpack (near-verbatim)                      | `flare.uploadSourcemaps(...)` in flare-api |
| plugin option shape + defaults                | vite, webpack, nextjs                              | shared base type + constants               |
| cyclic/size-bounded serializer                | `flatJsonStringify` (core), `serializeProps` (vue) | one serializer in core                     |
| `safeDecode`                                  | `redactUrl.ts`, `parseMinifiedReactError.ts`       | core export                                |

Note the serializer split is worth calling out: Vue's `serializeProps` is the _better_
implementation (it handles BigInt, line 36; caps depth, arrays, keys, strings), while core's
`flatJsonStringify` throws on BigInt (see B-core-2). Merging them upward fixes a bug and removes a
copy at the same time.

---

## Part 1: simplification, by area (your first ask)

Ranked roughly by leverage. The two cross-cutting themes above are items 0a and 0b and outweigh
everything below them.

### Tracing (core/src/tracing + js/src/tracing): the complexity hotspot

- **SpanBuffer measures its own size three ways.** `estimateBytes`/`bufferBytes` use
  `flatJsonStringify(...).length` (UTF-16 char count) while `packForKeepalive` uses
  `TextEncoder().encode(...).length` (real UTF-8 bytes); every `add()` re-serializes the whole buffer
  at least twice, so cost is O(n^2) at unload (`SpanBuffer.ts:33,87,106,115,156`). Cache one
  `estimatedBytes` per span on insert, keep a running total, measure one way everywhere. This also
  removes bug B-trace-1.
- **Two overlapping overflow mechanisms** (`evaluateTriggers` flush-and-return, then `trim`
  slice/shift) encode the same two limits twice; the length branch of `trim` is only reachable when a
  flush is a no-op (`SpanBuffer.ts:82,102`). Collapse to one overflow method.
- **The `epoch` staleness system** threads a generation counter through `SpanInit`, `SpanImpl`,
  `clear()`, and `onSpanEnd` to guard a disable-then-re-enable race that `onSpanEnd`'s existing
  `enableTracing` gate largely already covers (`Tracer.ts:66,120,211,320`, `Span.ts:10,51`). Either
  drop it or document the exact case it uniquely handles. Candidate Speculative Generality.
- **Browser tracing is a seven-global implicit state machine** (`controller, uninstall, lastPath,
pageloadTraced, navSource, activeFlare, currentRoot`, `browserTracing.ts:23`). Fold the
  per-session ones into a single `session` object created in `start` and nulled in `stop`; that also
  fixes B-browsertrace-1 (stale `navSource`).
- **The fetch and XHR wrappers open their HTTP span with the same sequence** (absolutize, ingest
  skip, pathname, `startSpan`) written twice (`instrumentFetch.ts:40`, `instrumentXHR.ts:103`).
  Extract one `openHttpSpan(...)`. Each wrapper then keeps only its own traceparent quirk.
- **`mergeTraceparentHeader` has five near-identical branches** (`propagation.ts:62`). Normalize
  every header shape to `[string,string][]` once, then one caller-wins check plus one append. Cuts
  ~30 lines.
- **`createPatcher` is a Middle Man for single-method fetch** (`createPatcher.ts`,
  `instrumentFetch.ts:88`); its atomic multi-method restore earns its keep for XHR's three shared
  methods but not for fetch. Use `fill`/`unfill` directly for fetch.
- `TraceState.traceId` is written but never read (`Tracer.ts:35,272`); the map is keyed by traceId.
  Remove the field. `SamplingContext` is built in three branches of `resolveTrace` (`Tracer.ts:234`):
  build it once.

### Core foundation + logging

- **`Flare.ts` is a god class with divergent change**: config, glows, user, five report entry points,
  and ~90 lines of attribute assembly all live here (`Flare.ts:30,418`). Extract an
  `AttributeAssembler` seeded with config/scopeProvider/framework/contextCollector.
- The sample gate (`sampleRate < 1 && Math.random() >= sampleRate`) plus `seenAtUnixNano` is
  triplicated across the three `report*Internal` methods (`Flare.ts:316`). Extract
  `sampledNow(): number | null`.
- "flush logger + tracer" recurs in `light`, `configure` (twice), and `flush`, and `configure` has
  two separate `if (config.key !== undefined)` blocks (`Flare.ts:210,217`). One `flushTelemetry()`
  helper, one key-changed branch.
- `FlushScheduler` never schedules (the count/weight/timer policy lives in `Logger`); it only
  registers a lifecycle-end trigger. Rename (Mysterious Name). Cycle detection is also duplicated
  between `flatJsonStringify.decycle` and `otel.valueToOpenTelemetry` inPath.

### Framework packages (react / vue / svelte / sveltekit)

- Beyond the shared-helper extraction in theme B: the whole report pipeline
  (`buildContext -> beforeSubmit -> toAttributes -> reportSilently -> afterSubmit`) is duplicated
  between `FlareErrorBoundary` and `flareReactErrorHandler` in React, and again between `flareVue.ts`
  and `FlareErrorBoundary` in Vue. Extract one `reportFrameworkError(...)` per package.
- `vue/src/constants.ts:15` `DEFAULT_PROPS_DENYLIST` is character-for-character identical to core's
  `DEFAULT_URL_DENYLIST`. Reuse the core export.
- SvelteKit `client/*` and `server/*` are over-fragmented: 18 files for ~310 lines, several of them
  1 to 4 line wiring files. The only real per-side difference is `getRouteContext`. One `client.ts`
  and one `server.ts` would do.
- Dead branch: `sveltekit/src/handleError.ts:35` (`type === 'error' && 4xx`) is fully subsumed by the
  4xx return above it. `svelte/src/getErrorOrigin.ts:11` uses a 21-element regex array where one
  alternation would do.

### Node + Electron

- `ElectronDiskFileReader` is byte-identical to node's `DiskFileReader` (it even says "Mirrors
  @flareapp/node's DiskFileReader"); `buildFatalCallbacks` and the process-handler manager are
  near-verbatim copies. See theme B.
- `ElectronFlare.flush()` wraps `super.flush(timeoutMs)` (which already races its own timeout) in a
  second `setTimeout(timeoutMs)` (`ElectronFlare.ts:214`). Redundant timeout-on-timeout. Let core
  `flush()` accept extra promises instead.

### React Native + sourcemaps tooling

- `resolveVersion` and `resolveAutoVersion` are near-duplicates differing only in a package.json
  fallback (`version.ts:18,51`). One function with an `allowPackageJsonFallback` flag.
- `buildDeviceContext` re-reads the `attrs` map it was just handed, by magic string keys, to
  re-derive a `context.device` group (`collectReactNative.ts:64`). Build the group directly from the
  source values.
- Over-fragmentation: a whole `constants.ts` module for one `LOG_PREFIX` string, inside a 14-file
  package where env/config/banner/version are each tiny.

### Build tooling

- The upload orchestration (build list, `Promise.allSettled`, filter rejected, log failures, unlink
  loop) is near-verbatim in `vite/src/index.ts:114` and `webpack/.../FlareWebpackPlugin.ts:61`. Move
  into flare-api. See theme B.
- `new FlareApi(endpoint, key, version)` is three same-typed positional strings (Primitive
  Obsession, transposition-prone; `FlareApi.ts:15`). Single options object.
- `base` (vite) vs `publicPath` (webpack/nextjs) name the same concept differently.

---

## Part 2: bugs (your second ask)

### High

- **B-core-1 `[verified]` `Flare.ts:201`: `configure()` silently reverts a custom `urlDenylist` to
  the default.** `configure()` unconditionally runs `resolveDenylist(config.urlDenylist, ...)`. On a
  later call that omits `urlDenylist` (for example `configure({ sampleRate: 0.5 })`),
  `config.urlDenylist` is `undefined`, so `resolveDenylist` returns `DEFAULT_URL_DENYLIST` and
  overwrites the custom regex the spread on line 191 had just preserved. A user who set a denylist to
  hide `/secret/` stops redacting it after any unrelated reconfigure. This is also security finding
  X-core-1. Fix: only re-resolve when `config.urlDenylist` or `config.replaceDefaultUrlDenylist` is
  present; otherwise leave `_config.urlDenylist` untouched.

### Medium

- **B-core-2 `[verified]` `flatJsonStringify.ts:5`: throws on BigInt, dropping the whole send.**
  `clone()` passes a `bigint` through untouched, then `JSON.stringify` throws `TypeError`, which
  propagates out of `Api.report`/`logs`/`traces` synchronously and loses the report/batch. Glow
  `metaData` and `addContext` values are typed `unknown`, so a BigInt is reachable. Fix: coerce
  `bigint` to string in `clone` (Vue's `serializeProps` already does this).
- **B-catch-1 `[verified]` `catchWindowErrors.ts:12`: no idempotency guard.** Listeners are never
  removed and re-register on every call; a double `configure()` or a Vite HMR reload stacks handlers,
  so each error is reported N times. Fix: register once behind a module flag.
- **B-catch-2 `[verified]` `catchWindowErrors.ts:16`: non-Error throws are dropped.**
  `if (event.error instanceof Error)` skips `throw "boom"` / `throw {code:1}`, whose `ErrorEvent`
  carries the value in `.error` plus `message`/`filename`/`lineno`. The comment's intent (skip
  cross-origin "Script error." where `.error` is null) is right, but the check also drops legitimate
  non-Error throws. The rejection path already synthesizes via `routeRejection`; mirror it here.
- **B-svelte-1 `[verified]` `preprocessor.ts:36,69`: `componentName` is interpolated unescaped** into
  `'${componentName}'` while only `escapedFile` is escaped. A component filename containing `'` or
  `\` (legal on macOS/Linux) emits invalid or injected JS and breaks the build. Fix: escape
  `componentName` too.
- **B-svelte-2 `[verified]` `preprocessor.ts:26,53`: module-only components never register.** The
  markup hook bails when `hasScript` matches any `<script>` (including `<script module>`), then the
  script hook bails on `attributes.module != null`, so a component with only a module script never
  enters the tree.
- **B-svelte-3 `[verified]` `preprocessor.ts:40,71`: no sourcemap returned.** Both hooks prepend
  lines and return `{ code }` with no `map`, shifting every subsequent line number. Stack frames and
  debugger positions inside the component are offset. Ironic in an error tracker's own preprocessor.
  Fix: return a sourcemap (magic-string) or inject on one line.
- **B-react-1 `[verified]` `parseComponentStack.ts` + `constants.ts:4,9`: stack regexes are
  React-19-only.** Both patterns match only the native V8 shape (`at X (url:line:col)` and
  `X@url:line:col`). React 16/17/18 emit `in X (at File:line)`, which matches neither, and the
  fallback strips only a leading `at `, so every frame degrades to a name-only frame with null
  file/line. Peer range is `^16 || ^17 || ^18 || ^19`, so this breaks documented-supported versions.
- **B-vue-1 `[verified]` `serializeProps.ts:74,94`: a throwing getter crashes the error handler.** A
  bare `reactive({...})` proxy has `Object.prototype`, so `isPlainObject` returns true (the "don't
  walk proxies" comment at line 71 only excludes non-plain prototypes). `value[key]` then triggers
  getters/ref-unwrap, and a getter that throws propagates out of `serialize`; no call site wraps it.
  Fix: try/catch per key.
- **B-fetchreader-1 `[verified]` `FetchFileReader.ts:19`: no fetch timeout.** A source URL that never
  responds leaves the snippet promise pending. Combined with `getCodeSnippet` having no rejection
  handler on `read()` (`fileReader.ts`), a rejecting reader would also hang `Promise.all`. Fix:
  `AbortSignal.timeout(...)` and a `.catch(() => null)` in `readFile`.
- **B-browsertrace-1 `browserTracing.ts:186`: `stop` never clears `navSource`.** After
  disable-then-re-enable without re-registering, `onUrlChanged` early-returns on the stale source and
  built-in History navigation stays dead. (Fixed for free by the session-object refactor above.)
- **B-browsertrace-2 `browserTracing.ts:92`: navigation detected by `pathname` only.** A route change
  that alters only query or hash opens no navigation root, so the new view's fetches nest under the
  stale prior root. Fix: compare `pathname + search`.
- **B-browsertrace-3 `httpRequestSpan.ts:56`, `instrumentXHR.ts:139`: aborts recorded as errors.** An
  `AbortController` cancel (component unmount) becomes `code:2`; XHR `abort()` hits the status-0
  `zeroIsError` path. User cancellations inflate the error rate. Fix: detect abort and mark cancelled.
- **B-node-1 `NodeFlushScheduler.ts:4`: `beforeExit` misses common shutdowns and is not awaited.**
  `process.exit()`, SIGTERM, and SIGINT never fire `beforeExit`, so buffered logs/reports are lost;
  even on a natural drain the bare `flush()` promise is not awaited, so an in-flight send can be cut
  off. Fix: rely on explicit `flare.flush()` (and document it) or add signal handlers.
- **B-electron-1 `ipcReceiver.ts:14,70`: `currentOwner` is module-global.** Only one `ElectronFlare`
  can receive; a second `registerIpcReceiver` calls `removeHandler` and silently steals the channel
  from the first. Fix: scope ownership to the instance or warn on a second registrant.
- **B-rn-1 `babel.ts:51` via `version.ts:38`: `resolveVersion()` throws inside the Babel visitor.**
  With no `--version`, no `FLARE_SOURCEMAP_VERSION`, and no readable package.json version, a throw in
  the `ImportDeclaration` visitor aborts the whole Metro build, contradicting `runtime.ts:11` which
  treats the unresolved value as a harmless empty string. Fix: fall back to `''` in the plugin.
- **B-tanstack-1 `tanstack-router.ts:48`: `inFlight` leaks on aborted navigation.** If a nav is
  aborted before `onResolved`, `inFlight` stays true and the next nav opens no `browser_navigation`
  root. Fix: reset on abort/timeout.
- **B-build-1 `FlareApi.ts:35` + plugins: no request timeout and unbounded upload concurrency.** A
  backend that accepts the connection but never responds hangs the build (CI stall); a large app fans
  out hundreds of simultaneous uploads with every map buffered in memory. Fix: `AbortSignal.timeout`
  per attempt and a small concurrency pool.

### Low

- `SpanBuffer.ts:157` byte guard undercounts non-ASCII (see B-trace-1 below, listed as security-
  adjacent). `Tracer.ts:253` LRU eviction of a live trace re-samples on the next child and can ship
  an orphan whose root was never sent. `SpanBuffer.ts:44` `flush()` early returns skip `clearTimer()`
  (benign today). `cli.ts:60` a value flag given no value becomes the string `'true'` and fails later
  with a confusing ENOENT. `env.ts:58` inline `# comment` is not stripped from `FLARE_*` env values.
  `fatal.ts:30` / `processHandlers.ts:31` in opt-in `'report'` mode an uncaught exception is neither
  re-thrown nor exited, leaving a possibly-corrupt process running. `handleError.ts` (sveltekit)
  writes route context in two shapes that both land in one report.

---

## Part 3: security (your third ask)

### High

- **X-core-1 `[verified]` `Flare.ts:201`: reconfiguration re-exposes redacted data.** Same mechanism
  as B-core-1: any `configure()` that omits `urlDenylist` reverts to the default denylist, so values
  a custom denylist was added to hide start flowing to the backend again. High because it silently
  defeats a control the user explicitly set for privacy.
- **X-cookie-1 `[verified]` `cookie.ts:10` + `collectBrowser.ts:46`: the whole cookie jar is
  exfiltrated unredacted.** `collectBrowser` passes `config.urlDenylist` to `request()` and
  `requestData()` but calls `cookie()` with no denylist. Every JS-readable cookie (non-httpOnly
  session tokens, CSRF/XSRF tokens, JWTs, auth cookies) is sent verbatim under
  `http.request.cookies`, even though the denylist literally contains `cookie|session|csrf|token`.
  Fix: run cookie names/values through the denylist, or make cookie capture opt-in.
- **X-nextjs-1 `[verified]` `withFlareSourcemaps.ts:13,20`: original client source is published by
  default.** The wrapper forces `productionBrowserSourceMaps: true` while `removeSourcemaps` defaults
  to `false`, so enabling it emits public, browser-referenced `.map` files containing the app's
  original source and leaves them in the served output. Anyone can download the source. Fix: default
  `removeSourcemaps` to true, or use hidden browser maps.

### Medium

- **X-redact-1 `[verified]` `redactUrl.ts:38`, `httpRequestSpan.ts:42`, `instrumentFetch.ts:46`:
  path and userinfo secrets leak.** `redactUrlQuery` only touches the query segment, so
  `/reset-password/<token>` and `https://user:pass@host/` ship verbatim in `flare.entry_point.value`,
  `document.referrer`, and span `url.full`; the HTTP span name (`GET /reset-password/<token>`) gets no
  redaction at all. The `httpRequestSpan` comment claiming "tokens never leak" is misleading. Fix:
  strip userinfo, offer path-segment scrubbing, and run the span name through redaction.
- **X-sveltekit-1 `[verified]` `server/getRouteContext.ts:30` and `client/getRouteContext.ts`: route
  params spread raw.** `params: { ...event.params }` bypasses the denylist that `redactQueryParams`
  applies to the query, so `/reset-password/[token]` sends the token in cleartext.
- **X-vue-1 `[verified]` `getRouteContext.ts:47` and `serializeProps.ts:89`: value-blind capture.**
  Route params/query are captured independent of `attachProps`, and the props denylist matches key
  names only, so a secret under an innocuous key (`?email=...`, `value="<jwt>"`, a nested `apiToken`)
  is transmitted. Fix: value-aware redaction; gate route capture.
- **X-disk-1 `[verified]` `DiskFileReader.ts:33`, `ElectronDiskFileReader.ts:21`: no root
  confinement.** `isLocalFileUrl` accepts any absolute path or `file://` URL and reads it whole into
  the report snippet. The doc comment claims it "avoids traversal," but it only rejects relative and
  http paths: `/etc/passwd` is accepted. Realistically exploitable only if a frame's filename can be
  attacker-influenced (for example `//# sourceURL=/etc/passwd` in eval'd code, or a set `error.stack`),
  but the comment overstates the safety. Fix: confine reads to the app root/cwd via `path.resolve` +
  prefix check.
- **X-node-1 `headers.ts:26`, `collectNode.ts:70`: header capture denylist has gaps.** Every request
  header is captured by default, filtered by a fixed denylist that covers `authorization`/`cookie`
  but not `x-real-ip`, `cf-connecting-ip`, `true-client-ip`, or custom `x-*-token`/`x-session-*`
  carriers. Fix: broaden the default, or make allowlist the default posture.
- **X-endpoint-1 `FlareApi.ts:35` (build tooling), `uploadSourcemaps.ts:28` / `cli.ts:80` (RN):
  upload endpoint has no scheme validation.** An `http://` endpoint sends the Flare API key in a
  cleartext POST body; a mistyped or stale endpoint silently exfiltrates it. Fix: require `https:`
  (or warn loudly on `http:`).
- **X-webpack-1 `FlareWebpackPlugin.ts`: does not enforce `hidden-source-map`.** If the user's
  `devtool` is `source-map`, the emitted JS keeps a public `sourceMappingURL` and the map is served.
  Vite correctly uses `'hidden'`. Fix: steer to hidden or warn.

### Low

- `propagation.ts:17` `[verified]`: string `tracePropagationTargets` use `url.includes(t)` against
  the whole URL, so `"myapi.com"` also matches `https://evil.com/?ref=myapi.com` and injects
  `traceparent` toward a third party (and triggers a CORS preflight). The default same-origin gate
  (line 19) is correct; only the opt-in string mode is loose, and it matches OTel semantics. Match
  against origin/host or document it.
- `ids.ts:7`: `Math.random()` fallback when `crypto.getRandomValues` is absent yields predictable
  correlation ids (not secrets; only very old runtimes hit it).
- `[verified]` `__proto__` as a cookie name (`cookie.ts:18`), span attribute key (`Span.ts:56`), or
  prop key (`serializeProps.ts:94`) hits the prototype setter and is silently dropped rather than
  stored. No global prototype pollution (the bag is a per-object literal), but use `Object.create(null)`
  for the accumulators to be safe and correct.
- `ipcReceiver.ts:17`: a trusted renderer can forge any non-identity attribute (`isReportShape` is
  structural only); acceptable if the `file:`/loopback trust boundary holds, but consider allowlisting
  emitted attribute namespaces.
- `expoTransforms.ts:80`: `withEnvironmentPath` is interpolated into a double-quoted shell assignment
  in `project.pbxproj` with no escaping of `"`/`` ` ``/`$`. Near-zero in practice (values are relative
  node_modules paths) but defense-in-depth is missing.

### Cleared (checked, not a problem)

- Command injection in the RN sourcemaps native hooks: `flare.gradle` uses `ProcessBuilder` with an
  argument array, `flare-xcode.sh` quotes every variable, no `shell:true` anywhere.
- API key handling: masked in `banner.ts`, never logged in full; `env.ts` only reads `FLARE_`-prefixed
  keys and never logs values.
- TLS: no `rejectUnauthorized:false` / `NODE_TLS_REJECT_UNAUTHORIZED` bypass anywhere.
- ReDoS: the React and minified-error regexes have no catastrophic backtracking (worst case quadratic
  on developer-controlled per-line input).
- Tracing DoS: buffers are bounded (`maxSpanBufferSize` + trim, oversized-span drop, capped
  attributes/events, `maxLiveTraces`), and `traceparent` is built only from locally generated hex ids.

---

## Suggested order of attack

1. **X-core-1 / B-core-1** (denylist reset). Small fix, high impact, security.
2. **X-cookie-1 and X-redact-1** (apply the denylist to cookies, path, userinfo, span names). One
   redaction pass, closes several findings at once.
3. **The two serializers merge** (`flatJsonStringify` adopts `serializeProps`' BigInt/getter
   handling), which fixes B-core-2 and B-vue-1 and removes a duplicate.
4. **B-svelte-1/2/3** (preprocessor correctness: escaping, module-only, sourcemap).
5. **B-react-1** (React 16-18 component stacks) if you still support that peer range; otherwise
   narrow the range and say so.
6. Then the larger simplification refactors (theme B extraction into core, tracing SpanBuffer and
   browser-tracing state machine), which pay down the complexity you are feeling but are bigger
   changes best done deliberately.
