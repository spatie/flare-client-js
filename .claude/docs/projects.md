# Projects

## Project 1: Core SDK hardening

Make `@flareapp/js` robust and feature-complete with what every competitor ships. This is the foundation everything else
builds on — every framework package inherits its gaps.

**Error capture**

- [ ] Switch from `window.onerror =` to `addEventListener('error')` / `addEventListener('unhandledrejection')`
- [ ] Error cause chain traversal: follow `error.cause` recursively, capture linked errors
- [ ] Handle non-Error promise rejections: wrap strings/numbers/objects into a proper error

**Context collection**

- [ ] `setUser({ id, name, email, ...custom })` and `clearUser()` API
- [ ] Device/browser/OS context: parse user agent into structured data (browser name+version, OS name+version, device
  type) — use `navigator.userAgentData` where available, fall back to UA string parsing
- [ ] Screen/viewport context: `screen.width/height`, `innerWidth/innerHeight`
- [ ] Additional context: `navigator.language`, timezone (`Intl.DateTimeFormat`), `navigator.onLine`

**Automatic breadcrumbs** (evolve the existing "glows" system)

- [ ] Breadcrumb infrastructure: typed breadcrumb entries with category/timestamp, circular buffer, coexist with
  manual `glow()` API
- [ ] Console interception: monkey-patch `console.log/warn/error/info/debug`, record as breadcrumbs
- [ ] DOM click tracking: global click listener, generate readable selector (tag + id/class/text)
- [ ] Navigation/History tracking: patch `pushState`/`replaceState`, listen to `popstate`

**Reliability & filtering**

- [ ] Client-side rate limiting: configurable max errors per minute
- [ ] Error deduplication: hash by message + top stack frames, suppress repeats within a window
- [ ] Retry logic for report submission: exponential backoff on network failure (adapt pattern from vite plugin's
  `postWithRetry`)
- [ ] `sampleRate` config option (0.0-1.0)

**Config**

- [ ] `enabled` toggle
- [ ] `release` — track the user's app version
- [ ] `ignoreErrors` — array of strings/regexes to suppress known noise
- [ ] `allowUrls` / `denyUrls` — filter errors by script origin

**Release**

- [ ] Release @flareapp/js
- [ ] Write announcement post

**Deferred from Project 1** (next sprint):

- XHR/Fetch request breadcrumbs — monkey-patching both `XMLHttpRequest` and `fetch` reliably is the single most
  complex item (streams, cloning, abort controllers, CORS). Worth its own focused effort.
- `sendBeacon()` fallback for page unload — useful but not table stakes.

---

## Project 2: Enhanced React package

Make `@flareapp/react` competitive. Current implementation is 28 lines with no fallback UI.

- [ ] Fallback UI: implement `getDerivedStateFromError` so the boundary renders a fallback instead of unmounting
- [ ] Configurable fallback: accept a component (`fallback={<ErrorPage />}`) or render prop
  (`fallback={(error, reset) => ...}`)
- [ ] `onError` callback prop
- [ ] `onReset` callback prop for error recovery flows
- [ ] Capture the erroring component's display name (not just the raw stack string)
- [ ] Release @flareapp/react
- [ ] Write announcement post

**Deferred:** Component props capture, React Router integration, Redux/Zustand state capture.

---

## Project 4: Svelte package

New `@flareapp/svelte` package. Svelte/SvelteKit is increasingly popular and has no good lightweight error tracker.

- [ ] Create `@flareapp/svelte` package in the monorepo (package.json, tsconfig, tsdown build config)
- [ ] Svelte error boundary component or `handleError` wrapper
- [ ] SvelteKit integration: `handleError` server/client hooks
- [ ] Capture component context (name, props where available)
- [ ] Release @flareapp/svelte
- [ ] Write announcement post

**Deferred:** SvelteKit routing breadcrumbs.

---

## Project 5: Turbopack sourcemap support

Currently Vite-only. The vite plugin's `FlareApi` (HTTP client, retry, compression) is mostly framework-agnostic —
main work is abstracting away Vite's hook system.

- [ ] Extract shared sourcemap upload core from `@flareapp/vite` (API client, upload logic, retry, compression)
- [ ] Create `@flareapp/turbopack` package: Turbopack/Next.js sourcemap upload plugin
- [ ] Release @flareapp/turbopack (and updated @flareapp/vite if API changed)
- [ ] Write announcement post

**Deferred:** Webpack plugin, Rollup plugin, esbuild plugin.

---

## Project 7: Documentation

Update docs after all features ship. Do this last so docs reflect the final state.

- [ ] Update frontend docs on flareapp.io
- [ ] Split "JavaScript" docs into separate sections: JavaScript, React, Vue, Svelte
- [ ] Review existing docs for clarity and completeness
- [ ] Update spatie/flare-client-js internal docs (monorepo workflow, version tagging, local dev setup)
- [ ] Release + announce

---

## Deferred projects

### Project 3: Vue enhancements

TypeScript rewrite is done. Remaining work (component props, Vue Router integration, Pinia state capture) deferred to
next sprint.

### Project 6: Node.js and other environments

Verify Flare works in Node.js, Electron, React Native. Deferred because scope is unpredictable — could be quick if
things already work, could balloon if they don't.