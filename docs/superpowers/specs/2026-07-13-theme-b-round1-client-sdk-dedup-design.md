# Theme B, round 1: client-SDK deduplication (design spec)

Date: 2026-07-13
Source: theme B of `.claude/docs/research/code-quality-review-2026-07-13.md`
Status: approved design, pending spec review

## Goal

Remove the cross-package duplication called out in theme B for the client-SDK packages, by hoisting
five shared units into their natural home (`core` or `js`). Every change is behavior-preserving:
existing tests in every touched package must stay green, and new unit tests cover each shared unit.

## Scope (this round)

Five Tier-1 units, all pure JS (no node builtins), so `core` stays node-builtin-free:

1. `safeDecode` export from `core`.
2. `toCustomContext(framework, payload)` in `core`.
3. `createIdentityTagger(...)` in `core`.
4. `createFlareResolver(...)` in `js`.
5. Serializer merge: one `safeClone(value, options)` in `core`; `flatJsonStringify` and vue
   `serializeProps` become thin callers.

## Explicitly deferred (not this round)

- Node-boundary pair: `DiskFileReader` (node/electron) and the fatal/process-handler module
  (node/electron). Deferred because their natural home is `core`, but they import `node:fs` /
  `node:process`, and `core` is currently node-builtin-free (a property worth preserving). A future
  round can add a `@flareapp/core/node` subpath.
- Build-tooling group: sourcemap upload orchestration and plugin option shape
  (vite/webpack/nextjs/flare-api). Different subsystem; separate round.

## Dependency-graph rationale

`core` has no `@flareapp` deps and no node builtins (verified). `js` depends on `core` and already
exposes a `./browser` subpath. react/vue/svelte depend on `core` + `js`; sveltekit depends on
`svelte` + `js`. So: env-agnostic units go in `core`; the one unit that touches `window` and the
browser `Flare` type (`createFlareResolver`) goes in `js`, which every consumer already depends on.

## Unit specifications

### 1. `safeDecode` (core)

`safeDecode` currently exists privately in `core/src/util/redactUrl.ts` and is duplicated verbatim in
`react/src/parseMinifiedReactError.ts:9-15`.

- Export `safeDecode` from `core` (util barrel + `core/src/index.ts`), same signature
  `(value: string) => string`.
- `react/parseMinifiedReactError.ts` imports it from `@flareapp/core` and deletes its copy. React
  depends on `core`, so the import is direct.

### 2. `toCustomContext(framework, payload)` (core)

New helper: `toCustomContext(framework: string, payload: unknown): Attributes` returning
`{ 'context.custom': { [framework]: payload } }`. `Attributes` is a core type.

Consumers (each drops its hand-rolled wrapper):

- `react/contextToAttributes.ts`: builds the react payload object, returns
  `toCustomContext('react', payload)`.
- `svelte/contextToAttributes.ts`: `toCustomContext('svelte', context.svelte)`.
- `sveltekit/contextToAttributes.ts`: `toCustomContext('svelte', context.svelte)` (its key is also
  `svelte`).
- `vue/flareVue.ts` (two sites, currently `{ 'context.custom': { vue } }`):
  `toCustomContext('vue', vue)`.

### 3. `createIdentityTagger(...)` (core)

The two-WeakSet SDK/framework tagger is duplicated across react/vue/svelte `identify.ts`. They differ
in composition, so the factory exposes primitives and each package keeps a thin wrapper:

```ts
function createIdentityTagger(config: { sdkName: string; sdkVersion: string; frameworkName: string }): {
    registerSdkIdentity(flare: SdkTaggable): void; // sets sdkInfo once (name=sdkName, version=sdkVersion)
    tagFramework(flare: SdkTaggable, frameworkVersion: string | undefined): void; // sets framework once
};
```

- `SdkTaggable` is a minimal structural interface `{ setSdkInfo(info: SdkInfo): unknown; setFramework(f: Framework): unknown }` (core exports `SdkInfo` / `Framework`), so it works for the browser `Flare` and any subclass without coupling to `@flareapp/js/browser`.
- The two WeakSets and the once-guard live inside the factory closure (per instantiation).
- `tagFramework` builds `frameworkVersion === undefined ? { name: frameworkName } : { name: frameworkName, version: frameworkVersion }`, so it omits the `version` key when there is no version (matching svelte's `{ name: 'Svelte' }`).
- Composition preserved per package (verified against each `identify.ts`):
    - react: `registerReactSdkIdentity(flare)` = `t.registerSdkIdentity(flare); t.tagFramework(flare, React.version)`; `tagReactFramework(flare)` = `t.tagFramework(flare, React.version)`.
    - vue: `registerVueSdkInfo(flare)` = `t.registerSdkIdentity(flare)` (SDK only, no framework tag); `tagVueFramework(flare, appVersion)` = `t.tagFramework(flare, appVersion)`.
    - svelte: `registerSvelteSdkIdentity(flare)` = `t.registerSdkIdentity(flare); t.tagFramework(flare, undefined)`; `tagSvelteFramework(flare)` = `t.tagFramework(flare, undefined)` (Svelte has no framework version).

Behavior preserved: react/svelte still tag framework inside register; vue still does not; vue's
framework version still comes from `app.version` at call time. One benign normalization: when vue's
`app.version` is `undefined`, the factory emits `{ name: 'Vue' }` rather than today's
`{ name: 'Vue', version: undefined }`; the two are identical once serialized (JSON drops
`undefined`). A `createIdentityTagger` unit test will assert both the present-version and
absent-version shapes.

### 4. `createFlareResolver(...)` (js)

`resolveFlare` + `registerDefaultFlare` + `isDevMode` + the Electron `__flare` tripwire are near-verbatim
across react/vue/svelte. Home is `js` (touches `window` and the `js/browser` `Flare` type).

```ts
function createFlareResolver(config: { packageName: string; injectInstruction?: string }): {
    registerDefaultFlare(provider: () => Flare): void;
    resolveFlare(explicit?: Flare): Flare;
};
```

- Own `defaultProvider` closure per instantiation (each package keeps independent state).
- `isDevMode` lives once inside `js`.
- The tripwire and the "no instance" messages are built from `packageName`. `injectInstruction`
  defaults to `Import ${packageName}/inject and pass the @flareapp/electron/renderer instance instead.`
  Svelte passes a custom `injectInstruction` (its preprocessor-importSource clause) so its exact
  message text is preserved.
- react/vue/svelte each call `createFlareResolver({ packageName: '@flareapp/<fw>' })` and re-export the
  returned `registerDefaultFlare` / `resolveFlare`, so their `index.ts` wiring is unchanged.

### 5. Serializer merge: `safeClone` (core)

`flatJsonStringify` (core) produces a cycle/BigInt/throwing-getter-safe JSON string; `serializeProps`
(vue) produces a bounded, redacted, display-safe object. They share a safety-critical traversal that
already diverged once (the BigInt bug existed in one, not the other). Unify onto one core function:

```ts
type SafeCloneOptions =
    | { mode: 'json' }
    | {
          mode: 'display';
          maxDepth: number;
          arrayCap: number;
          objectKeyCap: number;
          stringCap: number;
          denylist: RegExp;
      };

function safeClone(value: unknown, options: SafeCloneOptions): unknown;
```

Always on (both modes): cycles → `'[Circular]'`, `bigint` → decimal string, a throwing enumerable
getter → `'[Getter threw]'`, plain-object / array walk only.

- `mode: 'json'` reproduces today's `flatJsonStringify`: function / symbol / non-plain objects pass
  through untouched (so `JSON.stringify` still drops functions/symbols and calls `Date.toJSON`), no
  caps. `flatJsonStringify(x)` becomes `JSON.stringify(safeClone(x, { mode: 'json' }))`.
- `mode: 'display'` reproduces today's `serializeProps`: function → `'[Function]'`, symbol →
  `'[Symbol]'`, non-plain object → `'[Object]'`, over-`maxDepth` → `'[Array]'` / `'[Object]'`, arrays
  capped at `arrayCap` with a `'[… N more items]'` tail, object keys capped at `objectKeyCap` with a
  `'…'` summary, strings truncated at `stringCap`, keys matching `denylist` → `'[redacted]'`. vue
  `serializeProps(value, maxDepth, denylist)` becomes a thin caller passing its existing
  `MAX_PROP_*` constants.

Non-behavioral note: `Date`-passthrough in `json` mode is a hard requirement (dates in glow data must
still serialize to ISO strings), which is why `json` mode must NOT convert non-plain objects.

## Execution plan

Sequential, done by the assistant, reviewed step by step (user's choice). Two phases:

1. Foundations (additive only, nothing deleted; builds stay green):
    - core: export `safeDecode`; add `toCustomContext`, `createIdentityTagger`, `safeClone`; rewrite
      `flatJsonStringify` as a `safeClone` caller; add unit tests for each.
    - js: add `createFlareResolver`; add unit tests.
2. Per-package migration (one package at a time, review gate between each):
    - react → vue → svelte → sveltekit. Each switches to the shared units, deletes its local copies,
      and its suite must stay green. vue's `serializeProps` becomes a `safeClone` caller in this phase.

After each package: run that package's build + tests. At the end: full `npm run typescript`,
`npm run build`, `npm run test`, plus `oxfmt` / `oxlint`.

## Testing bar

- Behavior-preserving: every existing test in core/js/react/vue/svelte/sveltekit stays green.
- New unit tests: `toCustomContext` (wrapper shape per framework), `createIdentityTagger` (once-guard,
  SDK vs framework split, injected-path framework-only), `createFlareResolver` (tripwire throw in dev
  / warn in prod, resolveFlare explicit vs default vs throw, per-instance state isolation), `safeClone`
  (both modes: cycles, BigInt, throwing getter, Date-passthrough in json mode, caps + redaction in
  display mode).

## Risks and mitigations

- Serializer merge is the highest-care item. Mitigation: land `safeClone` + rewrite `flatJsonStringify`
  first with the full existing core serializer test suite green before touching vue; add explicit
  Date-passthrough and function-omission tests for `json` mode.
- `createFlareResolver` message text: preserved exactly via `injectInstruction`; add a test asserting
  the svelte-style message.
- Per-instance closure state: `createIdentityTagger` / `createFlareResolver` must instantiate per
  package (not share module-level state), matching today's per-module singletons.

## Non-goals

- No public API changes (the deduped helpers are internal wiring; consumers' package roots keep their
  current exports and side effects).
- No behavior changes, no new dependencies, no node builtins added to `core`.
