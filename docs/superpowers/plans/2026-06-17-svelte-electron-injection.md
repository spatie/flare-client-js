# Svelte Electron Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `@flareapp/svelte/inject` entry so the Svelte SDK (`createFlareErrorHandler` and the `FlareErrorBoundary.svelte` component) can run in an Electron renderer and route reports through an injected Flare instance (Electron's `RendererFlare`) instead of the `@flareapp/js` root singleton — without breaking web consumers, without breaking SvelteKit's identity-override ordering, and without pulling the js-root side effects into the renderer.

**Architecture:** Mirrors the shipped React (`@flareapp/react/inject`, PR #58) and Vue (`@flareapp/vue/inject`, PR #59) designs. Optional `flare?` resolved ONCE at wiring time (handler creation) via a shared `resolveFlare` seam. Two entries: the web entry (`@flareapp/svelte`) statically imports the root, registers it as the default, AND keeps its import-time SDK-identity registration (SvelteKit depends on that ordering); the `/inject` entry is root-free. Per-instance `WeakSet` identity (framework-only when injected). **Svelte-specific:** the `FlareErrorBoundary.svelte` component delegates to `createFlareErrorHandler` (one report site, not two — the component just forwards a `flare` prop). Build is `svelte-package` (per-file `.js` output, not bundled chunks). SvelteKit's `export * from '@flareapp/svelte'` makes svelte's import-time identity registration a hard constraint (spec Decision 6).

**Tech Stack:** TypeScript, `svelte-package` (preprocess + emit dist), Vitest (jsdom + `@sveltejs/vite-plugin-svelte`), Svelte 5. Reference: the completed React branch `feat/react-electron-injection` and Vue branch `feat/vue-electron-injection` (this branch is stacked on Vue), and spec `docs/superpowers/specs/2026-06-16-framework-renderer-injection-design.md`.

---

## Svelte vs React/Vue: what's different (read before starting)

1. **ONE report site.** `src/createFlareErrorHandler.ts` is the only thing that calls `flare.reportSilently`. `FlareErrorBoundary.svelte` does NOT touch `flare` — it internally calls `createFlareErrorHandler({ ancestor, beforeEvaluate, ... })`. So the boundary just needs a `flare` prop it forwards into that call; all resolution lives in `createFlareErrorHandler`.
2. **THREE root imports.** `identify.ts` (`flare`), `createFlareErrorHandler.ts` (`convertToError, flare`), `contextToAttributes.ts` (type-only `AttributeValue, Attributes`). `config.ts` and `preprocessor.ts` do NOT import the root (preprocessor only emits the string `'@flareapp/svelte'` as generated code).
3. **TWO module-load identity call sites.** `index.ts:3` calls `registerSvelteSdkIdentity()` AND `createFlareErrorHandler.ts:11` calls it at module top. The index.ts call MUST stay (import-time) for SvelteKit; the createFlareErrorHandler.ts module-top call MUST be removed (it's in the inject graph and moves into the function body, resolving per-instance).
4. **SvelteKit ordering is a hard constraint (Decision 6).** `@flareapp/sveltekit` does `export * from '@flareapp/svelte'` and re-asserts `sdk = @flareapp/sveltekit` on every report to beat svelte's module-load identity registration. The svelte WEB entry (`index.ts`) MUST keep registering identity at import (byte-for-byte timing) so this override ordering is preserved. SvelteKit's own tests fully mock `@flareapp/js`, so they will NOT catch a regression here — guard it svelte-side (Task 6 webEntry test + Task 11).
5. **`svelte-package` build, not tsdown.** `svelte-package -i src -o dist` compiles EVERY `src/` file to a `dist/` file (1:1, that is how `./config` already exists). Adding `src/inject.ts` needs NO build-command change — it is auto-compiled. Output is `.js` (single ESM format), and `.svelte` files are emitted preprocessed (NOT compiled to JS). Relative imports use explicit `.js` extensions.
6. **Identity has no version.** `setFramework({ name: 'Svelte' })` takes no version (unlike Vue's `app.version`). So identity is like React: `registerSvelteSdkIdentity(flare)` sets sdk+framework together; `tagSvelteFramework(flare)` sets framework only. Both `WeakSet`-per-instance guarded.
7. **`.js` import extensions.** All relative imports in svelte src use `.js` (e.g. `from './resolveFlare.js'`). Match this.

## Carry these four fixes from the React branch (verbatim React code had these bugs)

- **A. `window` cast:** `(window as unknown as Record<string, unknown>)`, NOT `(window as Record<...>)` (TS2352).
- **B. No unused `@ts-expect-error`:** under `as any`, a `@ts-expect-error` above `delete (window as any).x` is unused (TS2578). Omit it.
- **C. "Resolves once" tests spy `resolveFlare`,** not `setFramework` (WeakSet masks a per-call regression).
- **D. The cross-package Electron-bridge test runs without a fragile `@vitest-environment` directive.** (For Svelte it lives in the svelte package whose vitest is already jsdom — fine; just don't add a directive.)

## File structure

- Create `packages/svelte/src/resolveFlare.ts` — shared seam (`.js`-extension imports).
- Modify `packages/svelte/src/identify.ts` — `registerSvelteSdkIdentity(flare)` + `tagSvelteFramework(flare)`, WeakSet guards; no longer imports the root or self-registers.
- Modify `packages/svelte/src/contextToAttributes.ts` — type imports from `@flareapp/core`.
- Modify `packages/svelte/src/createFlareErrorHandler.ts` — `flare?` option, resolve at creation, tag framework, report via resolved; `convertToError` from core; REMOVE module-top `registerSvelteSdkIdentity()`.
- Modify `packages/svelte/src/FlareErrorBoundary.svelte` — `flare?` prop forwarded into `createFlareErrorHandler`.
- Modify `packages/svelte/src/index.ts` — web entry: import root `flare`, register default, KEEP import-time `registerSvelteSdkIdentity(flare)`. Preserve all exports.
- Create `packages/svelte/src/inject.ts` — electron-safe entry, no root, no import-time identity.
- Modify `packages/svelte/package.json` — `./inject` export, `sideEffects`, `@flareapp/core` exact dep, `@flareapp/electron` devDep (for the cross-package test).
- Modify `scripts/release-all.mjs` — add svelte to `CORE_REFS`.
- Create `packages/svelte/scripts/verify-inject-no-root.mjs` — chunk-graph no-root guard (scans `.js`).
- Create `packages/svelte/scripts/verify-exports.mjs` — post-build `./inject` export-map check (fs-based node script, NOT a vitest test — avoids a `dist`-dependent test in the bare `vitest run` suite).
- Create `packages/svelte/tests/electronInjection.test.ts` — cross-package regression (lives in svelte, not electron, because electron's node vitest cannot load `.svelte`).
- Tests: `resolveFlare.test.ts`, `identify.test.ts` (rewrite), `createFlareErrorHandler.test.ts` (extend), `FlareErrorBoundary.test.ts` (extend), `injectEntry.test.ts`, `webEntry.test.ts`, plus Task 11 SvelteKit-ordering regression.

> Lockfile: synced on the React branch (this branch is stacked through Vue). The only lockfile changes here are svelte's new `@flareapp/core` dep + `@flareapp/electron` devDep (Task 8/10) and the svelte version bump (Task 12).

---

## Task 1: `resolveFlare` module

**Files:** Create `packages/svelte/src/resolveFlare.ts`, Create `packages/svelte/tests/resolveFlare.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/svelte/tests/resolveFlare.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('resolveFlare', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as any).__flare;
        vi.restoreAllMocks();
    });

    test('returns the explicit instance when provided', async () => {
        const { resolveFlare } = await import('../src/resolveFlare.js');
        const explicit = { id: 'explicit' } as any;
        expect(resolveFlare(explicit)).toBe(explicit);
    });

    test('returns the registered default when no explicit instance', async () => {
        const { resolveFlare, registerDefaultFlare } = await import('../src/resolveFlare.js');
        const def = { id: 'default' } as any;
        registerDefaultFlare(() => def);
        expect(resolveFlare()).toBe(def);
    });

    test('throws a clear error when no instance and no default', async () => {
        const { resolveFlare } = await import('../src/resolveFlare.js');
        expect(() => resolveFlare()).toThrow(/No Flare instance available/);
    });

    test('registerDefaultFlare warns when the electron bridge is already present', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        (window as any).__flare = { report: () => {} };
        const { registerDefaultFlare } = await import('../src/resolveFlare.js');
        registerDefaultFlare(() => ({}) as any);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('/inject'));
    });

    test('registerDefaultFlare does NOT warn without the bridge', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { registerDefaultFlare } = await import('../src/resolveFlare.js');
        registerDefaultFlare(() => ({}) as any);
        expect(warn).not.toHaveBeenCalled();
    });
});
```

> Note (fixes A+B): no `@ts-expect-error` above the `delete` lines; source uses `as unknown as Record`. Imports use the `.js` extension (svelte ESM convention) — vitest resolves `../src/resolveFlare.js` to the `.ts` source.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/svelte && npx vitest run tests/resolveFlare.test.ts`
Expected: FAIL — cannot resolve '../src/resolveFlare.js'.

- [ ] **Step 3: Write the implementation**

```ts
// packages/svelte/src/resolveFlare.ts
import type { Flare } from '@flareapp/js/browser';

let defaultProvider: (() => Flare) | null = null;

// Called once by the web entry (index.ts) as an import side effect.
export function registerDefaultFlare(provider: () => Flare): void {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__flare) {
        console.warn(
            '[flare] @flareapp/js default registered while the electron bridge is present. ' +
                'In a renderer, import @flareapp/svelte/inject and pass the ' +
                '@flareapp/electron/renderer instance instead.',
        );
    }
    defaultProvider = provider;
}

// Resolve at WIRING time (handler creation / component setup), never inside a report path.
export function resolveFlare(explicit?: Flare): Flare {
    if (explicit) {
        return explicit;
    }
    if (defaultProvider) {
        return defaultProvider();
    }
    throw new Error(
        '[flare] No Flare instance available. Pass `flare` (e.g. from ' +
            '@flareapp/electron/renderer), or import @flareapp/svelte (the package root) ' +
            'to use the @flareapp/js default singleton.',
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/svelte && npx vitest run tests/resolveFlare.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check**

Run: `cd packages/svelte && npm run typescript`
Expected: 0 new errors from resolveFlare.ts/test.

- [ ] **Step 6: Commit**

```bash
git add packages/svelte/src/resolveFlare.ts packages/svelte/tests/resolveFlare.test.ts
git commit -m "feat(svelte): add resolveFlare default-provider seam"
```

---

## Task 2: Per-instance identity

**Files:** Modify `packages/svelte/src/identify.ts`, Rewrite `packages/svelte/tests/identify.test.ts` (if it exists; else create)

Current `identify.ts` imports the root `flare`, has a module-level boolean `registered`, and `registerSvelteSdkIdentity()` (no arg) sets sdk+framework on the root singleton. Rewrite to per-instance, argument-driven, root-free. Framework has NO version (`{ name: 'Svelte' }`).

- [ ] **Step 1: Write/rewrite the test**

```ts
// packages/svelte/tests/identify.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

function fakeFlare() {
    return { setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
}

describe('svelte identity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('registerSvelteSdkIdentity sets sdkInfo (@flareapp/svelte) and framework (Svelte)', async () => {
        const { registerSvelteSdkIdentity } = await import('../src/identify.js');
        const flare = fakeFlare();
        registerSvelteSdkIdentity(flare);
        expect(flare.setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/svelte' }));
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Svelte' });
    });

    test('tagSvelteFramework sets framework only, never sdkInfo', async () => {
        const { tagSvelteFramework } = await import('../src/identify.js');
        const flare = fakeFlare();
        tagSvelteFramework(flare);
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Svelte' });
        expect(flare.setSdkInfo).not.toHaveBeenCalled();
    });

    test('each guard is per-instance: same instance tagged once, distinct instances each tagged', async () => {
        const { tagSvelteFramework } = await import('../src/identify.js');
        const a = fakeFlare();
        const b = fakeFlare();
        tagSvelteFramework(a);
        tagSvelteFramework(a);
        tagSvelteFramework(b);
        expect(a.setFramework).toHaveBeenCalledOnce();
        expect(b.setFramework).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/svelte && npx vitest run tests/identify.test.ts`
Expected: FAIL — `tagSvelteFramework` not exported / `registerSvelteSdkIdentity` takes no argument.

- [ ] **Step 3: Rewrite the implementation**

```ts
// packages/svelte/src/identify.ts
import type { Flare } from '@flareapp/js/browser';

import { PACKAGE_VERSION } from './version.js';

// Per-instance guards. A boolean cannot serve injection: with a singleton AND an
// injected RendererFlare, each instance must be tagged independently.
const sdkTagged = new WeakSet<object>();
const frameworkTagged = new WeakSet<object>();

// Web path: full identity on the default singleton (sdk + framework). Svelte's framework has no version.
export function registerSvelteSdkIdentity(flare: Flare): void {
    if (!sdkTagged.has(flare)) {
        sdkTagged.add(flare);
        flare.setSdkInfo({ name: '@flareapp/svelte', version: PACKAGE_VERSION });
    }
    tagSvelteFramework(flare);
}

// Injected path: framework tag ONLY. Never touch sdkInfo — that would clobber the
// injected instance's own SDK name (e.g. @flareapp/electron).
export function tagSvelteFramework(flare: Flare): void {
    if (frameworkTagged.has(flare)) {
        return;
    }
    frameworkTagged.add(flare);
    flare.setFramework({ name: 'Svelte' });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/svelte && npx vitest run tests/identify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/src/identify.ts packages/svelte/tests/identify.test.ts
git commit -m "feat(svelte): per-instance SDK identity with framework-only tag"
```

> Note: after this, `index.ts:3` (`registerSvelteSdkIdentity()` no-arg) and `createFlareErrorHandler.ts:11` (same) are STALE — fixed in Tasks 6 and 4 respectively. The package may not fully type-check until those land; only run `tests/identify.test.ts` here.

---

## Task 3: Move shared-graph type imports off the js root

`contextToAttributes.ts` is in the inject graph (imported by `createFlareErrorHandler`). Its type-only `AttributeValue`/`Attributes` import from the root is erased at runtime, but move it to `@flareapp/core` for consistency with React/Vue and to keep the root out of the type graph too.

**Files:** Modify `packages/svelte/src/contextToAttributes.ts`

- [ ] **Step 1: Read the file's import line 1** (`import type { AttributeValue, Attributes } from '@flareapp/js';`).

- [ ] **Step 2: Change it to `@flareapp/core`**

```ts
import type { AttributeValue, Attributes } from '@flareapp/core';
```

- [ ] **Step 3: Verify suite + types**

Run: `cd packages/svelte && npx vitest run tests/identify.test.ts tests/resolveFlare.test.ts` (the tests landed so far stay green).
Run: `cd packages/svelte && npm run typescript` — note: createFlareErrorHandler.ts / index.ts still import the root + have stale no-arg identity calls (handled in Tasks 4/6), so `tsc` may report errors THERE; contextToAttributes.ts itself must add none.

- [ ] **Step 4: Commit**

```bash
git add packages/svelte/src/contextToAttributes.ts
git commit -m "refactor(svelte): import attribute types from @flareapp/core, not the js root"
```

---

## Task 4: `flare` option on `createFlareErrorHandler` (resolve at creation)

**Files:** Modify `packages/svelte/src/createFlareErrorHandler.ts`, Modify `packages/svelte/tests/createFlareErrorHandler.test.ts`

Read both first. The current file imports `{ convertToError, flare }` from the root, calls `registerSvelteSdkIdentity()` at module top (line 11), and the returned handler calls `flare.reportSilently`.

- [ ] **Step 1: Extend the test (do NOT rewrite the existing mock)**

The existing `createFlareErrorHandler.test.ts` mocks `@flareapp/js`. Inspect its exact shape and preserve it. Make ONLY additive edits:

1. Ensure the mocked `flare` exposes `reportSilently` (routed to a `mockReport` the existing tests use), `setSdkInfo`, `setFramework`. If the existing mock lacks `setSdkInfo`/`setFramework`, add them (the handler now tags the resolved instance). Keep `convertToError` on the mock (the handler imports it from core after Step 3, but keeping it harmless avoids a red-step crash).
2. After the mock block, register the mocked singleton as the default:

```ts
import * as resolveModule from '../src/resolveFlare.js';
import { registerDefaultFlare } from '../src/resolveFlare.js';
import { flare as mockedRoot } from '@flareapp/js';
registerDefaultFlare(() => mockedRoot as any);
```

3. Add these tests (the handler is async — await it):

```ts
test('reports through an injected flare instance, not the default', async () => {
    const injected = { reportSilently: vi.fn(), setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
    const handler = createFlareErrorHandler({ flare: injected });
    await handler(new Error('boom'), () => {});
    expect(injected.reportSilently).toHaveBeenCalledOnce();
    expect(mockReport).not.toHaveBeenCalled();
});

test('injected instance tagged framework-only, never sdkInfo', () => {
    const injected = { reportSilently: vi.fn(), setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
    createFlareErrorHandler({ flare: injected });
    expect(injected.setFramework).toHaveBeenCalledWith({ name: 'Svelte' });
    expect(injected.setSdkInfo).not.toHaveBeenCalled();
});

test('resolves the instance once at creation, not per call', async () => {
    const injected = { reportSilently: vi.fn(), setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
    const resolveSpy = vi.spyOn(resolveModule, 'resolveFlare');
    const handler = createFlareErrorHandler({ flare: injected });
    await handler(new Error('a'), () => {});
    await handler(new Error('b'), () => {});
    expect(resolveSpy).toHaveBeenCalledTimes(1); // resolved at creation, NOT per call (fix C)
    resolveSpy.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/svelte && npx vitest run tests/createFlareErrorHandler.test.ts`
Expected: FAIL — `FlareErrorHandlerOptions` has no `flare`; injected instance unused.

- [ ] **Step 3: Rewire `createFlareErrorHandler.ts`**

Change import line 1 `import { convertToError, flare } from '@flareapp/js';` to:

```ts
import { convertToError } from '@flareapp/core';
import type { Flare } from '@flareapp/js/browser';
```

Change the identify import + REMOVE the module-top call. The current lines:

```ts
import { registerSvelteSdkIdentity } from './identify.js';
...
registerSvelteSdkIdentity();   // <- DELETE this module-top call
```

Change to:

```ts
import { resolveFlare } from './resolveFlare.js';
import { tagSvelteFramework } from './identify.js';
```

(no module-top call). Add `flare?: Flare` as the first member of `FlareErrorHandlerOptions`:

```ts
export interface FlareErrorHandlerOptions {
    flare?: Flare;
    ancestor?: ComponentTreeNode | null;
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
}
```

At the TOP of `createFlareErrorHandler`, resolve once at creation and tag the framework, then report via the resolved instance:

```ts
export function createFlareErrorHandler(options?: FlareErrorHandlerOptions) {
    const flare = resolveFlare(options?.flare);
    tagSvelteFramework(flare);

    return async (rawError: unknown, _reset: () => void) => {
        // ...unchanged body, but the existing `flare.reportSilently(...)` now refers to the
        // block-scoped resolved `const flare` above.
    };
}
```

Confirm the `flare.reportSilently(error, contextToAttributes(context))` line now uses the block-scoped `flare`. Confirm NO module-level root `flare` reference remains.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/svelte && npx vitest run tests/createFlareErrorHandler.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Declare the `@flareapp/core` runtime dependency (it is imported now, not in Task 8)**

This task introduces the first RUNTIME import from `@flareapp/core` (`convertToError`). Declare the dependency in the same commit so no intermediate commit has an undeclared runtime dep. svelte already has a `dependencies` block (`error-stack-parser`). Add `@flareapp/core` pinned EXACT to the current core version (check `node -p "require('./packages/core/package.json').version"`):

```json
    "dependencies": {
        "@flareapp/core": "2.4.0",
        "error-stack-parser": "^2.1.4"
    },
```

Also add svelte to `CORE_REFS` in `scripts/release-all.mjs` (after the `vue` entry added on the stacked Vue branch):

```js
    { pkg: 'svelte', field: 'dependencies', dep: '@flareapp/core' },
```

Then `npm install` from repo root. Confirm the only lockfile change is svelte's new `@flareapp/core` dep (`git --no-pager diff --stat`).

- [ ] **Step 6: Type-check**

Run: `cd packages/svelte && npm run typescript`
Expected: the ONLY remaining error (if any) is `index.ts` still calling `registerSvelteSdkIdentity()` no-arg (Task 6). createFlareErrorHandler.ts adds none.

- [ ] **Step 7: Commit**

```bash
git add packages/svelte/src/createFlareErrorHandler.ts packages/svelte/tests/createFlareErrorHandler.test.ts packages/svelte/package.json scripts/release-all.mjs package-lock.json
git commit -m "feat(svelte): inject optional flare into createFlareErrorHandler (resolve at creation); declare core dep"
```

---

## Task 5: `flare` prop on `FlareErrorBoundary.svelte`

**Files:** Modify `packages/svelte/src/FlareErrorBoundary.svelte`, Modify `packages/svelte/tests/fixtures/BoundaryWithBuggyChild.svelte`, Modify `packages/svelte/tests/FlareErrorBoundary.test.ts`

The boundary delegates to `createFlareErrorHandler`. Add a `flare?` prop and forward it.

- [ ] **Step 1a: Add a `flare` prop to the test fixture so it can be forwarded**

The boundary tests render fixture wrappers (e.g. `tests/fixtures/BoundaryWithBuggyChild.svelte`) that wrap `FlareErrorBoundary` and provoke a render error. That fixture does NOT currently accept or forward a `flare` prop, so a `render(BoundaryWithBuggyChild, { props: { flare } })` would never reach the boundary. Make the fixture forward it additively (default `undefined`, so existing tests are unaffected).

In `packages/svelte/tests/fixtures/BoundaryWithBuggyChild.svelte`:

- Add to the `Props` interface: `flare?: import('../../src/createFlareErrorHandler').FlareErrorHandlerOptions['flare'];`
- Add `flare` to the `$props()` destructure.
- Forward it on the wrapped boundary: `<FlareErrorBoundary {flare} {beforeEvaluate} {beforeSubmit} {afterSubmit} {onReset} {resetKeys}>`.

- [ ] **Step 1b: Add the injection tests to `FlareErrorBoundary.test.ts`**

The existing mock uses `vi.mock('@flareapp/js', async (importOriginal) => ({ ...actual, flare: { report, reportSilently: (...a)=>mockReport(...a), setSdkInfo: vi.fn(), setFramework: vi.fn(), addContext: vi.fn() } }))`. Keep it. After that block, register the mocked singleton as the default:

```ts
import { registerDefaultFlare } from '../src/resolveFlare.js';
import { flare as mockedRoot } from '@flareapp/js';
registerDefaultFlare(() => mockedRoot as any);
```

Then add these two tests (reuse the file's `mockReport`, `render`, and the `BoundaryWithBuggyChild` fixture; existing tests wait `await new Promise((r) => setTimeout(r, 0))` after render to let the async handler run):

```ts
test('forwards an injected flare prop into the handler (reports through injected, not default)', async () => {
    const injected = { reportSilently: vi.fn(), setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
    render(BoundaryWithBuggyChild, { props: { flare: injected } });
    await new Promise((r) => setTimeout(r, 0));
    expect(injected.reportSilently).toHaveBeenCalledOnce();
    expect(mockReport).not.toHaveBeenCalled();
});

test('falls back to the registered default when no flare prop', async () => {
    render(BoundaryWithBuggyChild);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockReport).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/svelte && npx vitest run tests/FlareErrorBoundary.test.ts`
Expected: FAIL — `FlareErrorBoundary` has no `flare` prop, so the forwarded prop is ignored and `injected.reportSilently` is never called (the default mock receives it instead).

- [ ] **Step 3: Add the `flare` prop and forward it**

In `FlareErrorBoundary.svelte`'s `<script>`:

Add `flare` to the `Props` interface and `$props()` destructure:

```ts
interface Props {
    children: Snippet;
    failed?: Snippet<[error: Error, reset: () => void]>;
    resetKeys?: unknown[];
    flare?: FlareErrorHandlerOptions['flare'];
    beforeEvaluate?: FlareErrorHandlerOptions['beforeEvaluate'];
    beforeSubmit?: FlareErrorHandlerOptions['beforeSubmit'];
    afterSubmit?: FlareErrorHandlerOptions['afterSubmit'];
    onReset?: (error: Error | null) => void;
}

let {
    children,
    failed: fallbackSnippet,
    resetKeys,
    flare,
    beforeEvaluate,
    beforeSubmit,
    afterSubmit,
    onReset,
}: Props = $props();
```

Forward `flare` into the handler creation:

```ts
const handler = $derived(createFlareErrorHandler({ ancestor, flare, beforeEvaluate, beforeSubmit, afterSubmit }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/svelte && npx vitest run tests/FlareErrorBoundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Full type-check + suite**

Run: `cd packages/svelte && npm run typescript` (expect only the index.ts stale call, fixed next task) and `npx vitest run` (full suite green).

- [ ] **Step 6: Commit**

```bash
git add packages/svelte/src/FlareErrorBoundary.svelte packages/svelte/tests/fixtures/BoundaryWithBuggyChild.svelte packages/svelte/tests/FlareErrorBoundary.test.ts
git commit -m "feat(svelte): forward optional flare prop from FlareErrorBoundary to the handler"
```

---

## Task 6: Web entry — register default + KEEP import-time identity (SvelteKit constraint)

**Files:** Modify `packages/svelte/src/index.ts`, Create `packages/svelte/tests/webEntry.test.ts`

The current `index.ts` calls `registerSvelteSdkIdentity()` (no-arg) at module load (line 3). This import-time registration is the contract SvelteKit's `export *` depends on. Keep it at import — but now with the resolved singleton, and ALSO register the default provider.

- [ ] **Step 1: Write the failing test**

```ts
// packages/svelte/tests/webEntry.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/svelte web entry', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('importing the root sets SDK identity at import AND registers the singleton as default', async () => {
        const setSdkInfo = vi.fn();
        const setFramework = vi.fn();
        const singleton = { setSdkInfo, setFramework, reportSilently: vi.fn() };
        vi.doMock('@flareapp/js', () => ({ flare: singleton }));

        await import('../src/index.js');

        // SvelteKit contract: identity is set at IMPORT (module load), not deferred.
        expect(setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/svelte' }));
        expect(setFramework).toHaveBeenCalledWith({ name: 'Svelte' });

        // default provider registered for no-option usage
        const { resolveFlare } = await import('../src/resolveFlare.js');
        expect(resolveFlare()).toBe(singleton);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/svelte && npx vitest run tests/webEntry.test.ts`
Expected: FAIL — importing `../src/index.js` throws because the stale `registerSvelteSdkIdentity()` (no-arg, after Task 2 requires a `flare`) hits `WeakSet.add(undefined)` → `TypeError: Invalid value used in weak set`.

- [ ] **Step 3: Rewrite the top of `index.ts`**

The current top is:

```ts
import { registerSvelteSdkIdentity } from './identify.js';

registerSvelteSdkIdentity();
```

Change to (import the root singleton, register default, AND keep import-time identity with the singleton):

```ts
import { flare } from '@flareapp/js';

import { registerSvelteSdkIdentity } from './identify.js';
import { registerDefaultFlare } from './resolveFlare.js';

// Web entry. Importing @flareapp/js runs the root's own side effects (window.flare + global
// catch) — correct for the web. Register the singleton as the default Flare AND set its SDK
// identity AT IMPORT. The import-time identity registration is a hard contract: @flareapp/sveltekit
// does `export * from '@flareapp/svelte'` and overrides the SDK name per-report, relying on this
// running first (spec Decision 6). Do not defer it.
registerDefaultFlare(() => flare);
registerSvelteSdkIdentity(flare);
```

Keep EVERY existing export line below unchanged.

- [ ] **Step 4: Run test + full suite + tsc**

Run: `cd packages/svelte && npx vitest run tests/webEntry.test.ts` (pass)
Run: `cd packages/svelte && npx vitest run` (full suite green)
Run: `cd packages/svelte && npm run typescript` (0 errors now — the stale call is fixed)

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/src/index.ts packages/svelte/tests/webEntry.test.ts
git commit -m "feat(svelte): web entry registers default + keeps import-time identity (sveltekit contract)"
```

---

## Task 7: `/inject` entry (no js-root reference)

**Files:** Create `packages/svelte/src/inject.ts`, Create `packages/svelte/tests/injectEntry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/svelte/tests/injectEntry.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/svelte/inject entry', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as any).flare;
    });

    test('importing the inject entry does NOT evaluate @flareapp/js root', async () => {
        const rootFactory = vi.fn(() => ({ flare: {} }));
        vi.doMock('@flareapp/js', rootFactory);

        await import('../src/inject.js');

        expect(rootFactory).not.toHaveBeenCalled();
        expect((window as any).flare).toBeUndefined();
    });

    test('exports createFlareErrorHandler and FlareErrorBoundary', async () => {
        const mod = await import('../src/inject.js');
        expect(typeof mod.createFlareErrorHandler).toBe('function');
        expect(mod.FlareErrorBoundary).toBeDefined();
    });

    test('createFlareErrorHandler from inject throws when no flare option and no default', async () => {
        const { createFlareErrorHandler } = await import('../src/inject.js');
        expect(() => createFlareErrorHandler()).toThrow(/No Flare instance available/);
    });
});
```

> The throw test relies on no default being registered in this file's isolated module registry (vitest isolates per file) — do NOT register one to make it pass.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/svelte && npx vitest run tests/injectEntry.test.ts`
Expected: FAIL — cannot resolve '../src/inject.js'.

- [ ] **Step 3: Create the inject entry**

Read `src/index.ts` and mirror its export block MINUS the root import + `registerDefaultFlare` + `registerSvelteSdkIdentity` calls. Use `.js` extensions:

```ts
// packages/svelte/src/inject.ts
// Electron-safe entry. NO @flareapp/js root import, NO default registration, NO import-time
// identity. The caller MUST pass `flare` (handler option / boundary prop); resolveFlare throws
// at wiring time if absent.
export { default as FlareErrorBoundary } from './FlareErrorBoundary.svelte';
export { createFlareErrorHandler, type FlareErrorHandlerOptions } from './createFlareErrorHandler.js';
export { __flareRegisterComponent, getComponentTreeContext } from './componentTree.js';
export { withFlareConfig, type WithFlareConfigOptions } from './config.js';
export { flarePreprocessor, type FlarePreprocessorOptions } from './preprocessor.js';
export type { FlareSvelteContext, SvelteErrorOrigin } from './types.js';
```

(Copy the EXACT export list from the current `index.ts` minus the three side-effect lines. Confirm none of `componentTree`/`config`/`preprocessor` value-import the root — they don't, per the pre-task survey.)

- [ ] **Step 4: Run test + full suite + tsc**

Run: `cd packages/svelte && npx vitest run tests/injectEntry.test.ts` (3 pass)
Run: `cd packages/svelte && npx vitest run` (full suite green)
Run: `cd packages/svelte && npm run typescript` (0 errors)

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/src/inject.ts packages/svelte/tests/injectEntry.test.ts
git commit -m "feat(svelte): add @flareapp/svelte/inject electron-safe entry"
```

---

## Task 8: Package wiring — `./inject` export map, sideEffects, export smoke test

NOTE: NO build-command change — `svelte-package` auto-compiles `src/inject.ts`. The `@flareapp/core` dependency + `CORE_REFS` were already declared in Task 4 (where the runtime import lands), so they are NOT repeated here.

**Files:** Modify `packages/svelte/package.json`, Create `packages/svelte/tests/injectExportMap.test.ts`

- [ ] **Step 1: Add the `./inject` export**

Mirror the `.` entry's shape (it has a `svelte` condition because it exports a `.svelte` component, which `/inject` also does). After the `./config` entry, add:

```json
        "./inject": {
            "svelte": "./dist/inject.js",
            "import": {
                "types": "./dist/inject.d.ts",
                "default": "./dist/inject.js"
            }
        }
```

- [ ] **Step 2: Add `sideEffects`**

Only the index dist file has the registerDefaultFlare + import-time identity side effects:

```json
    "sideEffects": ["./dist/index.js"],
```

- [ ] **Step 3: Build and verify the entry files exist**

Run: `cd packages/svelte && npm run build` — succeeds.
Run (from packages/svelte): `ls dist/inject.js dist/inject.d.ts` — both exist.
Run: `cd packages/svelte && npm run typescript` — 0 errors.

- [ ] **Step 4: Add a post-build export-map check (a node script, NOT a vitest test)**

The unit tests import `../src/inject.js` (source); nothing exercises the published `@flareapp/svelte/inject` subpath, so a typo in the `exports` map (wrong path) could ship broken. This must NOT be a vitest test: it depends on `dist`, and `packages/svelte`'s `test` script is a bare `vitest run` with no prebuild — a `dist`-dependent test would break `cd packages/svelte && npm test` on a clean checkout. It also must not statically `import '@flareapp/svelte/inject'` (a static import that fails to compile the built `.svelte` re-export aborts module load before any fallback can run). Instead use a deterministic fs-based node script (same pattern as `verify-inject-no-root.mjs` and electron's existing `verify-exports.mjs`): assert the export-map paths resolve to real files AND that `dist/inject.js` exposes the expected names.

Create `packages/svelte/scripts/verify-exports.mjs`:

```js
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));

const inject = pkg.exports?.['./inject'];
let failed = false;

if (!inject) {
    console.error('[verify-exports] package.json exports["./inject"] is missing');
    process.exit(1);
}

// Collect every leaf path string from the (possibly nested) export condition object.
const paths = [];
(function collect(node) {
    if (typeof node === 'string') {
        paths.push(node);
    } else if (node && typeof node === 'object') {
        for (const v of Object.values(node)) collect(v);
    }
})(inject);

for (const p of paths) {
    if (!existsSync(resolve(pkgDir, p))) {
        console.error(`[verify-exports] exports["./inject"] points at a missing file: ${p}`);
        failed = true;
    }
}

// The runtime entry must expose the expected public surface.
const entry = resolve(pkgDir, 'dist/inject.js');
if (!existsSync(entry)) {
    console.error('[verify-exports] dist/inject.js does not exist (build first)');
    failed = true;
} else {
    const src = readFileSync(entry, 'utf8');
    for (const name of [
        'createFlareErrorHandler',
        'FlareErrorBoundary',
        '__flareRegisterComponent',
        'withFlareConfig',
        'flarePreprocessor',
    ]) {
        if (!new RegExp(`\\b${name}\\b`).test(src)) {
            console.error(`[verify-exports] dist/inject.js is missing export: ${name}`);
            failed = true;
        }
    }
}

if (failed) {
    process.exit(1);
}
console.log(
    `[verify-exports] OK — exports["./inject"] resolves (${paths.length} paths) and dist/inject.js exposes the expected surface.`,
);
```

Add the npm script to `packages/svelte/package.json` (next to the build/test scripts; do NOT wire it into `test`):

```json
        "verify:exports": "node scripts/verify-exports.mjs",
```

Run: `cd packages/svelte && npm run build && npm run verify:exports`
Expected: `[verify-exports] OK ...`. To confirm it bites, temporarily change the `./inject` `default` path to a wrong filename, run it (expects non-zero + "missing file"), then revert.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/package.json packages/svelte/scripts/verify-exports.mjs
git commit -m "build(svelte): publish /inject export + sideEffects; verify the export map"
```

---

## Task 9: Static guard — inject graph has no js-root specifier (scans `.js`)

`svelte-package` emits per-file `.js` (1:1, not bundled), so the inject entry re-exports from sibling `.js` files. The chunk-graph-following guard handles this — it follows relative `.js`/`.svelte` imports transitively. Adapt the React/Vue guard to scan `.js` entries.

**Files:** Create `packages/svelte/scripts/verify-inject-no-root.mjs`, Modify `packages/svelte/package.json` (add `verify:inject` script)

- [ ] **Step 1: Write the guard**

```js
// packages/svelte/scripts/verify-inject-no-root.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const rootSpecifier = /["']@flareapp\/js["']/;
const relativeSpecifier = /(?:from\s*|require\(\s*)["'](\.\.?\/[^"']+)["']/g;

// svelte-package emits per-file .js (ESM). The inject entry re-exports from sibling files;
// follow the relative import graph transitively so a root import in any reachable file is caught.
const entries = ['inject.js'];
const scanned = new Set();
let failed = false;

function scan(absPath) {
    if (scanned.has(absPath)) {
        return;
    }
    scanned.add(absPath);
    let src;
    try {
        src = readFileSync(absPath, 'utf8');
    } catch {
        return; // .svelte sources or type-only paths that resolved oddly — skip silently
    }
    if (rootSpecifier.test(src)) {
        console.error(
            `[verify-inject-no-root] ${absPath} references the @flareapp/js root. The inject entry must not pull the root.`,
        );
        failed = true;
    }
    for (const match of src.matchAll(relativeSpecifier)) {
        scan(resolve(dirname(absPath), match[1]));
    }
}

for (const entry of entries) {
    scan(resolve(distDir, entry));
}

if (failed) {
    process.exit(1);
}
console.log(`[verify-inject-no-root] OK — inject graph (${scanned.size} files) has no @flareapp/js root reference.`);
```

> `.svelte` files are emitted by svelte-package preprocessed (not `.js`); if the relative graph references a `.svelte` file the `readFileSync` of that exact path may miss (the dist file could be `FlareErrorBoundary.svelte`). The try/catch skips unreadable paths. The FlareErrorBoundary.svelte source does not import the root anyway (it delegates to createFlareErrorHandler, which IS a `.js` and IS scanned). If you want belt-and-suspenders, also add `'FlareErrorBoundary.svelte'` text scan — but the createFlareErrorHandler chain is the load-bearing path and is covered.

- [ ] **Step 2: Add the npm script**

`"verify:inject": "node scripts/verify-inject-no-root.mjs",`

- [ ] **Step 3: Run against the current build**

Run: `cd packages/svelte && npm run build && npm run verify:inject`
Expected: `[verify-inject-no-root] OK — inject graph (N files) ...`, N > 1 (followed siblings). If it FAILS on the correct build, a reachable file pulls the root — STOP and report which.

- [ ] **Step 4: Prove the guard bites**

Temporarily add `import '@flareapp/js';` to the TOP of `src/createFlareErrorHandler.ts` (a reachable inject-graph module), rebuild, run the guard:
Run: `cd packages/svelte && npm run build && npm run verify:inject`
Expected: exits NON-ZERO naming `dist/createFlareErrorHandler.js`.
Then REMOVE the temporary import, rebuild, confirm OK. Verify `git diff src/createFlareErrorHandler.ts` is empty before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/scripts/verify-inject-no-root.mjs packages/svelte/package.json
git commit -m "test(svelte): static guard that /inject graph never pulls js root"
```

---

## Task 10: Cross-package regression — drive `@flareapp/svelte/inject` into RendererFlare

This test lives in the SVELTE package (NOT electron): electron's vitest is plain `node` and cannot load the `.svelte` re-export in the inject entry, whereas svelte's vitest has `@sveltejs/vite-plugin-svelte`. It drives the REAL inject handler against a real `RendererFlare`.

**Files:** Create `packages/svelte/tests/electronInjection.test.ts`, Modify `packages/svelte/package.json` (add `@flareapp/electron` devDependency), Modify `package-lock.json`

Prerequisite: `@flareapp/electron` is built (`@flareapp/electron/renderer` resolves to its dist).

- [ ] **Step 1: Add `@flareapp/electron` as a svelte devDependency**

In `packages/svelte/package.json` devDependencies, add:

```json
        "@flareapp/electron": "file:../electron",
```

Then `npm install` from repo root. Confirm churn limited to package-lock.json + svelte package.json.

- [ ] **Step 2: Write the regression test**

```ts
// packages/svelte/tests/electronInjection.test.ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The REAL inject entry. Importing it must not pull the js root.
import { createFlareErrorHandler } from '../src/inject.js';
import { FLARE_BRIDGE_KEY, RendererFlare } from '@flareapp/electron/renderer';

describe('@flareapp/svelte/inject reports through an injected RendererFlare', () => {
    let bridgeReport: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        bridgeReport = vi.fn(async () => {});
        (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY] = { report: bridgeReport };
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY];
    });

    test('forwards a STRING payload carrying Svelte context.custom over the bridge', async () => {
        const flare = new RendererFlare();
        const handler = createFlareErrorHandler({ flare });

        await handler(new Error('boom'), () => {});
        await flare.flush(1000);

        expect(bridgeReport).toHaveBeenCalledOnce();
        const payload = bridgeReport.mock.calls[0][0];
        expect(typeof payload).toBe('string');

        const parsed = JSON.parse(payload);
        expect(parsed.attributes['telemetry.sdk.name']).toBe('@flareapp/electron');
        expect(parsed.attributes['flare.framework.name']).toBe('Svelte');
        expect(parsed.attributes['context.custom'].svelte).toBeDefined();
        // NOTE: do NOT assert window.flare/globalThis.flare is undefined here. Importing the public
        // `@flareapp/electron/renderer` entry runs renderer.ts, which legitimately assigns
        // `window.flare` and installs the global catch — that is the renderer entry's job, not a
        // leak from the svelte inject path. The no-root guarantee is covered by Task 9 (dist-grep)
        // and Task 7 (runtime mock-factory check), not by this assertion.
    });
});
```

> If an assertion path is wrong, `console.log(payload)` and adjust ONLY the test path (never production). Keep the intent: electron sdk preserved, framework=Svelte, svelte context.custom survives, payload is a string. Svelte's context key is `context.custom.svelte` (see `contextToAttributes.ts`). `@flareapp/electron/renderer` exports `RendererFlare` + `FLARE_BRIDGE_KEY` AND has an import-time side effect (sets `window.flare`) — that is why the `globalThis.flare` assertion was removed (the React/Vue tests imported `RendererFlare` from electron SOURCE internals to dodge this, but this svelte test consumes the published electron entry, so accept the side effect and rely on Tasks 7/9 for no-root).

- [ ] **Step 3: Build svelte + electron, then run**

Run: `npm run build` from repo root (ensures svelte dist/inject + electron dist exist).
Run: `cd packages/svelte && npx vitest run tests/electronInjection.test.ts` — expect PASS.

- [ ] **Step 4: Full svelte suite + tsc**

Run: `cd packages/svelte && npx vitest run` (full suite green).
Run: `cd packages/svelte && npm run typescript` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/tests/electronInjection.test.ts packages/svelte/package.json package-lock.json
git commit -m "test(svelte): drive @flareapp/svelte/inject through RendererFlare bridge"
```

---

## Task 11: SvelteKit ordering regression (Decision 6)

SvelteKit's unit tests fully mock `@flareapp/js`, so they will NOT catch a regression in svelte's import-time identity registration. Two guards: (a) confirm the full SvelteKit suite still passes against the modified svelte; (b) an explicit svelte-side assertion that importing the web entry sets SDK identity at module load (already covered by Task 6's webEntry test — here we add the SvelteKit-framed contract and verify the re-export surface).

**Files:** Create `packages/svelte/tests/sveltekitContract.test.ts`

- [ ] **Step 1: Confirm the SvelteKit suite is green against modified svelte**

Run: `cd packages/sveltekit && npx vitest run`
Expected: ALL pass (sveltekit code is unchanged; its tests mock the root). If anything fails, the svelte change broke sveltekit's import chain — STOP and report.

- [ ] **Step 2: Write the contract test**

```ts
// packages/svelte/tests/sveltekitContract.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

// SvelteKit does `export * from '@flareapp/svelte'` and relies on (a) the web entry registering
// SDK identity AT IMPORT, and (b) the full export surface remaining intact so the re-export works.
describe('@flareapp/svelte web entry — SvelteKit contract', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('sets SDK identity at import (module-load), the ordering sveltekit overrides', async () => {
        const setSdkInfo = vi.fn();
        const singleton = { setSdkInfo, setFramework: vi.fn(), reportSilently: vi.fn() };
        vi.doMock('@flareapp/js', () => ({ flare: singleton }));
        await import('../src/index.js');
        expect(setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/svelte' }));
    });

    test('re-export surface still includes everything sveltekit `export *`s', async () => {
        const singleton = { setSdkInfo: vi.fn(), setFramework: vi.fn(), reportSilently: vi.fn() };
        vi.doMock('@flareapp/js', () => ({ flare: singleton }));
        const mod = await import('../src/index.js');
        for (const name of [
            'FlareErrorBoundary',
            'createFlareErrorHandler',
            '__flareRegisterComponent',
            'getComponentTreeContext',
            'withFlareConfig',
            'flarePreprocessor',
        ]) {
            expect(mod, `missing export: ${name}`).toHaveProperty(name);
        }
    });
});
```

- [ ] **Step 3: Run it**

Run: `cd packages/svelte && npx vitest run tests/sveltekitContract.test.ts` (2 pass)

- [ ] **Step 4: Commit**

```bash
git add packages/svelte/tests/sveltekitContract.test.ts
git commit -m "test(svelte): guard the import-time identity + export surface sveltekit depends on"
```

---

## Task 12: Full suite, version bump, docs

**Files:** Modify `packages/svelte/package.json` (version), Modify `package-lock.json`, Modify `packages/electron/README.md`, Modify `CLAUDE.md`

- [ ] **Step 1: Full verification gate**

Run: `cd packages/svelte && npm run build && npm test && npm run typescript && npm run verify:inject && npm run verify:exports` — all pass.
Run: `cd packages/sveltekit && npx vitest run` — all pass.
Run: `cd packages/electron && npm test` — all pass (unchanged, but confirm no breakage).
If anything fails, STOP and report.

- [ ] **Step 2: Bump `@flareapp/svelte` to 2.5.0 + refresh lockfile**

In `packages/svelte/package.json`, `"version": "2.4.0"` → `"2.5.0"`. Note svelte's `src/version.ts` is generated at release (`generate:version`) — do NOT hand-edit version.ts; only bump package.json. Then `npm install` (repo root); confirm the only lockfile change is the `packages/svelte` version entry.

- [ ] **Step 3: Add the Svelte section to the electron README**

Append to `packages/electron/README.md` (after the React + Vue sections):

````markdown
## Using `@flareapp/svelte` in the renderer

Same model as the React/Vue sections: the API key lives in **main**, reports travel over IPC, and the renderer injects Electron's Flare instance into Svelte instead of letting it reach the `@flareapp/js` singleton.

### Install

```bash
npm install @flareapp/electron @flareapp/svelte
```

`@flareapp/js` comes in transitively via `@flareapp/electron` — do **not** import it in the renderer.

Set up main / preload / renderer exactly as in the React section (steps 1-3): `flare.light(key)` in main, `exposeFlare()` in preload, and a renderer `flare.ts` that re-exports `flare` from `@flareapp/electron/renderer`.

### Svelte — inject the instance

Import `FlareErrorBoundary` (and/or `createFlareErrorHandler`) from `@flareapp/svelte/inject`, not the package root, and pass the renderer instance:

```svelte
<script lang="ts">
    import { FlareErrorBoundary } from '@flareapp/svelte/inject';
    import { flare } from './flare';
</script>

<FlareErrorBoundary {flare}>
    <App />
</FlareErrorBoundary>
```

Or the handler directly (e.g. in a SvelteKit-free Svelte app's error hook):

```ts
import { createFlareErrorHandler } from '@flareapp/svelte/inject';
import { flare } from './flare';

const handleError = createFlareErrorHandler({ flare });
```

### Rules

- **Never `import { flare } from '@flareapp/js'` in the renderer.** Import the Svelte SDK from `@flareapp/svelte/inject`, never the package root. Importing the root prints a console warning that the default was registered while the Electron bridge is present.
- Omitting the `flare` prop/option on the `/inject` entry throws at handler creation / component setup (boot), not silently at error time.

Reports from the renderer carry `sdk = @flareapp/electron` and `framework = Svelte`. Your Svelte component context (`context.custom.svelte`, component hierarchy) rides along and survives the IPC trip intact.
````

- [ ] **Step 4: Update CLAUDE.md**

In the "Monorepo structure" table, update the `@flareapp/svelte` row's Purpose cell to mention the `/inject` entry for Electron renderers (mirror the React/Vue rows).

- [ ] **Step 5: Commit**

```bash
git add packages/svelte/package.json package-lock.json packages/electron/README.md CLAUDE.md
git commit -m "docs(svelte,electron): document renderer injection; bump svelte to 2.5.0"
```

---

## Self-review notes (resolved against spec + React/Vue precedent)

- **Decision 1 (optional DI seam):** Task 4 (handler option), Task 5 (boundary prop forwards it).
- **Decision 2 (separate entries, no dynamic import):** Tasks 6, 7, 8. Task 3 (type migration) keeps the graph root-free.
- **Decision 3 (per-instance identity, framework-only when injected):** Task 2; applied in Tasks 4, 6.
- **Decision 4 (additive → minor):** Task 12 (svelte 2.5.0).
- **Decision 5 (resolve at wiring time, throw there):** Task 4 (handler creation).
- **Decision 6 (SvelteKit ordering):** Task 6 keeps import-time identity in index.ts; Task 11 guards it explicitly + verifies the sveltekit suite + re-export surface.
- **Q4 (dev-warn tripwire):** Task 1.
- **Q7 (sideEffects + regression):** Tasks 6, 8.
- **Q8 (no-root guard, chunk-graph over `.js`):** Task 9 authoritative; Task 7 runtime check; Task 10 behavioral.

**Four React-branch fixes baked in:** A (window cast) Task 1; B (no unused @ts-expect-error) Tasks 1/7; C (resolves-once via resolveFlare spy) Task 4; D (no fragile env directive — Task 10 lives in svelte's jsdom vitest).

**Svelte-specific risks called out:**

- ONE report site (handler); boundary forwards a prop — simpler than Vue.
- SvelteKit import-time identity is a hard constraint — index.ts keeps it; sveltekit tests mock the root and CANNOT catch a regression, so Task 11 guards svelte-side.
- `svelte-package` per-file `.js` output (no bundled chunks) — guard scans `.js` and follows the relative graph; the `.svelte` boundary delegates to a `.js` handler that IS scanned.
- Cross-package test lives in the svelte package (svelte-aware vitest) because electron's node vitest cannot load `.svelte`.
- `.js` import extensions throughout.

**Not in this plan:** none — Svelte is the last framework. After this merges, the three-framework `/inject` set (React #58, Vue #59, Svelte) is complete.
