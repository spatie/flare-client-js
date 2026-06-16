# Vue Electron Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `@flareapp/vue/inject` entry so `flareVue` and the Vue `FlareErrorBoundary` can route reports through an injected Flare instance (Electron's `RendererFlare`) instead of the `@flareapp/js` root singleton, without breaking web consumers and without pulling the js-root side effects into the renderer.

**Architecture:** Mirrors the shipped React design (`@flareapp/react/inject`, branch `feat/react-electron-injection`). Optional `flare?` resolved ONCE at wiring time (plugin install / component setup) via a shared `resolveFlare` seam. Two entries: the web entry (`@flareapp/vue`) statically imports the root and registers it as the default; the `/inject` entry is root-free. Per-instance `WeakSet` identity (framework-only when injected). **Vue-specific extra work:** Vue has FOUR root imports, two of which are utility value-imports (`resolveDenylist`, `redactFullPath`) that pull the root into the shared module graph — these must move to `@flareapp/core`. Vue also has TWO report sites (`flareVue` plugin AND a `FlareErrorBoundary` component), both needing injection.

**Tech Stack:** TypeScript, tsdown (CJS+ESM+dts), Vitest, Vue 3. Reference: the completed React branch `feat/react-electron-injection` and spec `docs/superpowers/specs/2026-06-16-framework-renderer-injection-design.md`. This branch (`feat/vue-electron-injection`) is stacked on top of the React branch.

---

## Vue vs React: what's different (read before starting)

1. **Two report sites, not one boundary + one handler.** `src/flareVue.ts` (the `app.use(flareVue)` plugin — sets `app.config.errorHandler` and optionally `warnHandler`) AND `src/FlareErrorBoundary.ts` (a `defineComponent` with `onErrorCaptured`). Both call `flare.reportSilently`; `flareVue`'s warn path also calls `flare.reportMessage`.
2. **Four root imports.** `flareVue.ts` and `FlareErrorBoundary.ts` import `{ convertToError, flare }` from the root; `constants.ts` imports `resolveDenylist`; `getRouteContext.ts` imports `redactFullPath`. The last two are utility VALUE imports that pull the root into the shared graph — they must move to `@flareapp/core` (which exports `convertToError`, `resolveDenylist`, `redactUrlQuery`).
3. **Identity timing differs from React.** React sets identity at import. Vue sets it inside `flareVue`'s install because `framework.version = app.version` is only known then. **Preserve that:** the web entry registers only the default provider at import; identity stays at install/setup. Do NOT move identity to import time (that would change web behavior).
4. **Identity guard split.** React's `registerReactSdkIdentity` does sdk+framework together. Vue must split: `registerVueSdkInfo(flare)` (sdk, no version dep) and `tagVueFramework(flare, appVersion)` (framework, needs the app version). Both `WeakSet`-per-instance guarded.

## Carry these four fixes from the React branch (the React plan's verbatim code had these bugs)

- **A. `window` cast:** use `(window as unknown as Record<string, unknown>)`, NOT `(window as Record<string, unknown>)` (TS2352).
- **B. No unused `@ts-expect-error`:** `delete (window as any).x` does not error under `as any`, so a `@ts-expect-error` above it is unused (TS2578). Omit it.
- **C. "Resolves once" tests must spy `resolveFlare`,** not `setFramework` (the per-instance WeakSet masks a per-call regression on `setFramework`).
- **D. Electron cross-package test runs in the default `node` env** (no `@vitest-environment jsdom` directive — oxfmt relocates it and it silently stops applying; the Vue path needs no DOM).

## File structure

- Create `packages/vue/src/resolveFlare.ts` — shared seam (same as React's).
- Create `packages/vue/src/identify.ts` — `registerVueSdkInfo` + `tagVueFramework`, WeakSet guards.
- Modify `packages/vue/src/constants.ts` — `resolveDenylist` import from `@flareapp/core`.
- Modify `packages/vue/src/getRouteContext.ts` — `redactFullPath` import from `@flareapp/core`.
- Modify `packages/vue/src/flareVue.ts` — `flare?` option, resolve at install, conditional identity, report via resolved instance, imports off root.
- Modify `packages/vue/src/FlareErrorBoundary.ts` — `flare` prop, resolve at setup, tag framework, report via resolved instance, imports off root.
- Modify `packages/vue/src/index.ts` — web entry: import root `flare`, register as default. Preserve all exports.
- Create `packages/vue/src/inject.ts` — electron-safe entry, no root.
- Modify `packages/vue/package.json` — `./inject` export, build entry, `sideEffects`, `@flareapp/core` exact dep.
- Modify `scripts/release-all.mjs` — add vue to `CORE_REFS`.
- Create `packages/vue/scripts/verify-inject-no-root.mjs` — chunk-graph no-root guard.
- Create `packages/electron/tests/vueInjection.test.ts` — cross-package regression.
- Tests: `resolveFlare.test.ts`, `identify.test.ts`, `flareVue.test.ts` (extend), `FlareErrorBoundary.test.ts` (extend), `injectEntry.test.ts`, `webEntry.test.ts`.

> Lockfile note: the root `package-lock.json` was already synced on the React branch (this branch is stacked on it), so there is NO standalone lockfile catch-up task. The only lockfile change in this plan is Vue's new `@flareapp/core` dependency (Task 8) and the Vue version bump (Task 11).

---

## Task 1: `resolveFlare` module

**Files:** Create `packages/vue/src/resolveFlare.ts`, Create `packages/vue/tests/resolveFlare.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/vue/tests/resolveFlare.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('resolveFlare', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as any).__flare;
        vi.restoreAllMocks();
    });

    test('returns the explicit instance when provided', async () => {
        const { resolveFlare } = await import('../src/resolveFlare');
        const explicit = { id: 'explicit' } as any;
        expect(resolveFlare(explicit)).toBe(explicit);
    });

    test('returns the registered default when no explicit instance', async () => {
        const { resolveFlare, registerDefaultFlare } = await import('../src/resolveFlare');
        const def = { id: 'default' } as any;
        registerDefaultFlare(() => def);
        expect(resolveFlare()).toBe(def);
    });

    test('throws a clear error when no instance and no default', async () => {
        const { resolveFlare } = await import('../src/resolveFlare');
        expect(() => resolveFlare()).toThrow(/No Flare instance available/);
    });

    test('registerDefaultFlare warns when the electron bridge is already present', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        (window as any).__flare = { report: () => {} };
        const { registerDefaultFlare } = await import('../src/resolveFlare');
        registerDefaultFlare(() => ({}) as any);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('/inject'));
    });

    test('registerDefaultFlare does NOT warn without the bridge', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { registerDefaultFlare } = await import('../src/resolveFlare');
        registerDefaultFlare(() => ({}) as any);
        expect(warn).not.toHaveBeenCalled();
    });
});
```

> Note (fixes A+B): no `@ts-expect-error` above the `delete (window as any).__flare` lines (unused directive → TS2578), and the source uses `as unknown as Record` (fix A).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/vue && npx vitest run tests/resolveFlare.test.ts`
Expected: FAIL — Cannot find module '../src/resolveFlare'.

- [ ] **Step 3: Write the implementation**

```ts
// packages/vue/src/resolveFlare.ts
import type { Flare } from '@flareapp/js/browser';

let defaultProvider: (() => Flare) | null = null;

// Called once by the web entry (index.ts) as an import side effect.
export function registerDefaultFlare(provider: () => Flare): void {
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__flare) {
        console.warn(
            '[flare] @flareapp/js default registered while the electron bridge is present. ' +
                'In a renderer, import @flareapp/vue/inject and pass the ' +
                '@flareapp/electron/renderer instance instead.',
        );
    }
    defaultProvider = provider;
}

// Resolve at WIRING time (plugin install / component setup), never inside a report path.
export function resolveFlare(explicit?: Flare): Flare {
    if (explicit) {
        return explicit;
    }
    if (defaultProvider) {
        return defaultProvider();
    }
    throw new Error(
        '[flare] No Flare instance available. Pass `flare` (e.g. from ' +
            '@flareapp/electron/renderer), or import @flareapp/vue (the package root) ' +
            'to use the @flareapp/js default singleton.',
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/vue && npx vitest run tests/resolveFlare.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/vue/src/resolveFlare.ts packages/vue/tests/resolveFlare.test.ts
git commit -m "feat(vue): add resolveFlare default-provider seam"
```

---

## Task 2: Per-instance identity

**Files:** Create `packages/vue/src/identify.ts`, Create `packages/vue/tests/identify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/vue/tests/identify.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

function fakeFlare() {
    return { setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
}

describe('vue identity', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('registerVueSdkInfo sets sdkInfo (@flareapp/vue) only, never framework', async () => {
        const { registerVueSdkInfo } = await import('../src/identify');
        const flare = fakeFlare();
        registerVueSdkInfo(flare);
        expect(flare.setSdkInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '@flareapp/vue' }));
        expect(flare.setFramework).not.toHaveBeenCalled();
    });

    test('tagVueFramework sets framework (Vue + version) only, never sdkInfo', async () => {
        const { tagVueFramework } = await import('../src/identify');
        const flare = fakeFlare();
        tagVueFramework(flare, '3.4.0');
        expect(flare.setFramework).toHaveBeenCalledWith({ name: 'Vue', version: '3.4.0' });
        expect(flare.setSdkInfo).not.toHaveBeenCalled();
    });

    test('each guard is per-instance: same instance tagged once, distinct instances each tagged', async () => {
        const { tagVueFramework } = await import('../src/identify');
        const a = fakeFlare();
        const b = fakeFlare();
        tagVueFramework(a, '3.4.0');
        tagVueFramework(a, '3.4.0');
        tagVueFramework(b, '3.4.0');
        expect(a.setFramework).toHaveBeenCalledOnce();
        expect(b.setFramework).toHaveBeenCalledOnce();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/vue && npx vitest run tests/identify.test.ts`
Expected: FAIL — module not found / exports missing.

- [ ] **Step 3: Write the implementation**

```ts
// packages/vue/src/identify.ts
import type { Flare } from '@flareapp/js/browser';

import { PACKAGE_VERSION } from './constants';

// Per-instance guards. A boolean cannot serve injection: with a singleton AND an
// injected RendererFlare, each instance must be tagged independently.
const sdkTagged = new WeakSet<object>();
const frameworkTagged = new WeakSet<object>();

// Web path: SDK identity on the default singleton. Split from framework because
// the framework version (app.version) is only known at install time.
export function registerVueSdkInfo(flare: Flare): void {
    if (sdkTagged.has(flare)) {
        return;
    }
    sdkTagged.add(flare);
    flare.setSdkInfo({ name: '@flareapp/vue', version: PACKAGE_VERSION });
}

// Both paths tag the framework (web + injected). Never touches sdkInfo — on an
// injected instance that would clobber the instance's own SDK name (@flareapp/electron).
export function tagVueFramework(flare: Flare, appVersion: string | undefined): void {
    if (frameworkTagged.has(flare)) {
        return;
    }
    frameworkTagged.add(flare);
    flare.setFramework({ name: 'Vue', version: appVersion });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/vue && npx vitest run tests/identify.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/vue/src/identify.ts packages/vue/tests/identify.test.ts
git commit -m "feat(vue): per-instance SDK + framework identity helpers"
```

---

## Task 3: Move shared-graph utility imports off the js root

The inject graph reaches `constants.ts` and `getRouteContext.ts` (both imported by `flareVue.ts` and `FlareErrorBoundary.ts`). They currently value-import from the `@flareapp/js` ROOT, which would pull the root (and its side effects) into `/inject`. `@flareapp/core` re-exports the same functions. This is a pure import-source change — zero behavior change, existing tests stay green.

**Files:** Modify `packages/vue/src/constants.ts`, Modify `packages/vue/src/getRouteContext.ts`

- [ ] **Step 1: Read both files** to see the exact current import lines.

`constants.ts:1` is `import { resolveDenylist as baseResolveDenylist } from '@flareapp/js';`
`getRouteContext.ts:1` is `import { redactFullPath } from '@flareapp/js';`

- [ ] **Step 2: Change the import sources to `@flareapp/core`**

In `constants.ts`, change line 1 to:

```ts
import { resolveDenylist as baseResolveDenylist } from '@flareapp/core';
```

In `getRouteContext.ts`, change line 1 to:

```ts
import { redactUrlQuery as redactFullPath } from '@flareapp/core';
```

(`@flareapp/core` exports `redactUrlQuery`; the root's `redactFullPath` is just its deprecated alias, so aliasing on import keeps every downstream usage of `redactFullPath` unchanged.)

- [ ] **Step 3: Verify the full Vue suite stays green and types are clean**

Run: `cd packages/vue && npx vitest run` — expect ALL existing tests still pass (pure refactor).
Run: `cd packages/vue && npx tsc --noEmit` — note: `flareVue.ts`/`FlareErrorBoundary.ts` still import the root here (handled in Tasks 4-5), so tsc should be clean (the root import is still present/valid, just not in these two files). `@flareapp/core` resolves via the workspace-hoisted node_modules.

- [ ] **Step 4: Commit**

```bash
git add packages/vue/src/constants.ts packages/vue/src/getRouteContext.ts
git commit -m "refactor(vue): import shared utils from @flareapp/core, not the js root"
```

---

## Task 4: `flare` option on `flareVue` (resolve at install)

**Files:** Modify `packages/vue/src/flareVue.ts`, Modify `packages/vue/src/types.ts` (add `flare?` to `FlareVueOptions`), Modify `packages/vue/tests/flareVue.test.ts`

Read `packages/vue/src/flareVue.ts` and `packages/vue/tests/flareVue.test.ts` first.

- [ ] **Step 1: Add tests for injection + resolve-at-install**

In `flareVue.test.ts`: the existing suite installs `flareVue` and asserts reports through the mocked root. Update the top-of-file `@flareapp/js` mock so the mocked singleton exposes `setSdkInfo`+`setFramework`+`reportSilently`+`reportMessage`, and register it as the default. Match the React branch's `flareReactErrorHandler.test.ts` mock pattern:

```ts
// Top-of-file: ensure the mocked root singleton has the identity methods AND is the resolveFlare default.
const mockReport = vi.fn();
const mockMessage = vi.fn();
vi.mock('@flareapp/js', () => ({
    flare: {
        reportSilently: (...a: unknown[]) => mockReport(...a),
        reportMessage: (...a: unknown[]) => mockMessage(...a),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    },
    // convertToError now comes from @flareapp/core in the implementation; kept here only as a
    // self-contained safety net for the mocked '@flareapp/js' surface.
    convertToError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));
import * as resolveModule from '../src/resolveFlare';
import { registerDefaultFlare } from '../src/resolveFlare';
import { flare as mockedRoot } from '@flareapp/js';
registerDefaultFlare(() => mockedRoot as any);
```

(Adapt to whatever the existing mock binding names are; preserve what existing tests rely on. If the existing file already mocks `@flareapp/js`, extend that mock rather than duplicating it.)

Add these tests (use `createApp` from `vue` and a minimal component; mirror how existing tests trigger `app.config.errorHandler`):

```ts
test('reports through an injected flare instance, not the default', () => {
    const injected = {
        reportSilently: vi.fn(),
        reportMessage: vi.fn(),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    } as any;
    const app = createApp({ render: () => null });
    app.use(flareVue, { flare: injected });
    app.config.errorHandler!(new Error('boom'), null, 'render');
    expect(injected.reportSilently).toHaveBeenCalledOnce();
    expect(mockReport).not.toHaveBeenCalled();
});

test('injected instance is tagged framework-only, never sdkInfo', () => {
    const injected = {
        reportSilently: vi.fn(),
        reportMessage: vi.fn(),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    } as any;
    const app = createApp({ render: () => null });
    app.use(flareVue, { flare: injected });
    expect(injected.setFramework).toHaveBeenCalledWith(expect.objectContaining({ name: 'Vue' }));
    expect(injected.setSdkInfo).not.toHaveBeenCalled();
});

test('resolves the instance once at install, not per reported error', () => {
    const injected = {
        reportSilently: vi.fn(),
        reportMessage: vi.fn(),
        setSdkInfo: vi.fn(),
        setFramework: vi.fn(),
    } as any;
    const resolveSpy = vi.spyOn(resolveModule, 'resolveFlare');
    const app = createApp({ render: () => null });
    app.use(flareVue, { flare: injected });
    app.config.errorHandler!(new Error('a'), null, 'render');
    app.config.errorHandler!(new Error('b'), null, 'render');
    expect(resolveSpy).toHaveBeenCalledTimes(1); // resolved at install, NOT per error (fix C)
    resolveSpy.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/vue && npx vitest run tests/flareVue.test.ts`
Expected: FAIL — `FlareVueOptions` has no `flare`; injected instance unused.

- [ ] **Step 3: Add `flare?` to `FlareVueOptions`**

In `packages/vue/src/types.ts`, add `flare?: Flare;` as the first member of `FlareVueOptions`, and add the import at the top of types.ts:

```ts
import type { Flare } from '@flareapp/js/browser';
```

```ts
export type FlareVueOptions = {
    flare?: Flare;
    captureWarnings?: boolean;
    // ...rest unchanged
};
```

- [ ] **Step 4: Rewire `flareVue.ts`**

In `packages/vue/src/flareVue.ts`:

Change the import line 1 `import { type AttributeValue, type Attributes, convertToError, flare } from '@flareapp/js';` to:

```ts
import { convertToError } from '@flareapp/core';
import type { AttributeValue, Attributes } from '@flareapp/js/browser';
```

Add these imports (with the other local imports):

```ts
import { resolveFlare } from './resolveFlare';
import { registerVueSdkInfo, tagVueFramework } from './identify';
```

Inside the `flareVue` install function, AFTER the `installedApps` guard and BEFORE the current `flare.setSdkInfo(...)` / `flare.setFramework(...)` lines, resolve the instance and replace the identity block:

```ts
const flare = resolveFlare(options?.flare);

// Web default (no injected instance): set the SDK identity on the singleton, as before.
// Injected instance: tag the framework only — never setSdkInfo (would clobber @flareapp/electron).
if (!options?.flare) {
    registerVueSdkInfo(flare);
}
tagVueFramework(flare, app.version);
```

Delete the old `flare.setSdkInfo({ name: '@flareapp/vue', version: PACKAGE_VERSION });` and `flare.setFramework({ name: 'Vue', version: app.version });` lines (now handled above). Remove the now-unused `PACKAGE_VERSION` import from flareVue.ts IF it becomes unused (check — it may still be used elsewhere in the file; only remove if oxlint flags it unused).

Every other `flare.reportSilently(...)` / `flare.reportMessage(...)` in the install closure now refers to the locally-resolved `const flare` (block-scoped), so they automatically route through the resolved instance. Confirm there are no remaining references to a module-level `flare`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/vue && npx vitest run tests/flareVue.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 6: Type-check**

Run: `cd packages/vue && npx tsc --noEmit`
Expected: the ONLY remaining error (if any) is from `FlareErrorBoundary.ts` still importing the root `flare` — that's handled in Task 5. flareVue.ts and types.ts must add no new errors.

- [ ] **Step 7: Commit**

```bash
git add packages/vue/src/flareVue.ts packages/vue/src/types.ts packages/vue/tests/flareVue.test.ts
git commit -m "feat(vue): inject optional flare instance into flareVue (resolve at install)"
```

---

## Task 5: `flare` prop on the Vue `FlareErrorBoundary` (resolve at setup)

**Files:** Modify `packages/vue/src/FlareErrorBoundary.ts`, Modify `packages/vue/tests/FlareErrorBoundary.test.ts`

Read `packages/vue/src/FlareErrorBoundary.ts` and its test first.

- [ ] **Step 1: Add tests for injection + default + resolve-at-setup**

The existing `FlareErrorBoundary.test.ts` uses `@vue/test-utils` `mount`, a `ThrowingComponent`, `h`, `nextTick`, and mocks `@flareapp/js` via `vi.mock('@flareapp/js', async (importOriginal) => ({ ...actual, flare: { reportSilently: (...a) => mockReport(...a), setSdkInfo: vi.fn(), setFramework: vi.fn(), ... } }))`. That mock already exposes `setSdkInfo`/`setFramework`, so the only addition is registering the mocked singleton as the resolveFlare default. After the existing `vi.mock(...)` block, add:

```ts
import * as resolveModule from '../src/resolveFlare';
import { registerDefaultFlare } from '../src/resolveFlare';
import { flare as mockedRoot } from '@flareapp/js';
registerDefaultFlare(() => mockedRoot as any);
```

Then add these three tests (reuse the file's existing `ThrowingComponent` and `mockReport`):

```ts
test('reports through an injected flare prop, not the default', async () => {
    const injected = { reportSilently: vi.fn(), setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
    mount(FlareErrorBoundary, {
        props: { flare: injected },
        slots: { default: () => h(ThrowingComponent) },
    });
    await nextTick();
    expect(injected.reportSilently).toHaveBeenCalledOnce();
    expect(mockReport).not.toHaveBeenCalled();
});

test('falls back to the registered default when no flare prop', async () => {
    mount(FlareErrorBoundary, {
        slots: { default: () => h(ThrowingComponent) },
    });
    await nextTick();
    expect(mockReport).toHaveBeenCalledOnce();
});

test('resolves at setup (before any error), not at capture time', () => {
    // Zero errors thrown. If resolution happened in onErrorCaptured it would be 0; proving it
    // is 1 here proves resolution is at setup/wiring time (fix C — and a single-error probe could
    // not distinguish setup-time from capture-time, since both yield exactly one call).
    const injected = { reportSilently: vi.fn(), setSdkInfo: vi.fn(), setFramework: vi.fn() } as any;
    const resolveSpy = vi.spyOn(resolveModule, 'resolveFlare');
    mount(FlareErrorBoundary, {
        props: { flare: injected },
        slots: { default: () => h('div', 'ok') }, // non-throwing child
    });
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    resolveSpy.mockRestore();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/vue && npx vitest run tests/FlareErrorBoundary.test.ts`
Expected: FAIL — no `flare` prop; injected instance unused.

- [ ] **Step 3: Add the `flare` prop and resolve at setup**

In `packages/vue/src/FlareErrorBoundary.ts`:

Change import line 1 `import { convertToError, flare } from '@flareapp/js';` to:

```ts
import { convertToError } from '@flareapp/core';
import type { Flare } from '@flareapp/js/browser';
```

Add:

```ts
import { resolveFlare } from './resolveFlare';
import { tagVueFramework } from './identify';
```

Add a `flare` prop to the component's `props` block:

```ts
        flare: {
            type: Object as PropType<Flare>,
            default: undefined,
        },
```

At the TOP of `setup(props, { slots })`, resolve once at setup (wiring time) and tag the framework:

```ts
const flareInstance = resolveFlare(props.flare);
tagVueFramework(flareInstance, getCurrentInstance()?.appContext.app.version);
```

(`getCurrentInstance` is already imported in this file. The boundary may be used without `flareVue`, so it tags the framework itself — additive, framework-only, never sdkInfo.)

In `onErrorCaptured`, change `flare.reportSilently(...)` to `flareInstance.reportSilently(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/vue && npx vitest run tests/FlareErrorBoundary.test.ts`
Expected: PASS.

- [ ] **Step 5: Full type-check + suite**

Run: `cd packages/vue && npx tsc --noEmit` — expect ZERO errors (no file should import the root `flare` now except `index.ts` after Task 6; until Task 6, index.ts still has its current exports and no root `flare` value import, so tsc is clean).
Run: `cd packages/vue && npx vitest run` — full suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/vue/src/FlareErrorBoundary.ts packages/vue/tests/FlareErrorBoundary.test.ts
git commit -m "feat(vue): inject optional flare into Vue FlareErrorBoundary (resolve at setup)"
```

---

## Task 6: Web entry registers the default

**Files:** Modify `packages/vue/src/index.ts`, Create `packages/vue/tests/webEntry.test.ts`

> Note: unlike React, Vue's web entry does NOT set identity at import (identity needs `app.version`, known only at install). It only registers the default provider. This preserves current web behavior.

- [ ] **Step 1: Write the failing test**

```ts
// packages/vue/tests/webEntry.test.ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/vue web entry', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    test('importing the root registers the js singleton as the resolveFlare default', async () => {
        const singleton = { reportSilently: vi.fn(), setSdkInfo: vi.fn(), setFramework: vi.fn() };
        vi.doMock('@flareapp/js', () => ({ flare: singleton }));

        await import('../src/index');

        const { resolveFlare } = await import('../src/resolveFlare');
        expect(resolveFlare()).toBe(singleton);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/vue && npx vitest run tests/webEntry.test.ts`
Expected: FAIL — no default registered (resolveFlare throws).

- [ ] **Step 3: Add the default registration to `index.ts`**

Read the current `packages/vue/src/index.ts`. Add at the TOP (before the existing exports), preserving ALL existing exports exactly:

```ts
import { flare } from '@flareapp/js';

import { registerDefaultFlare } from './resolveFlare';

// Web entry: the js-root singleton is the default Flare for no-prop/no-option usage.
// Importing @flareapp/js here also runs the root's own side effects (window.flare + global
// catch) — correct for the web. Identity is set at install/setup time (needs app.version),
// not here, preserving existing web behavior.
registerDefaultFlare(() => flare);
```

Keep every existing `export { ... }` / `export type { ... }` line unchanged.

- [ ] **Step 4: Run test + full suite + tsc**

Run: `cd packages/vue && npx vitest run tests/webEntry.test.ts` (pass)
Run: `cd packages/vue && npx vitest run` (full suite green)
Run: `cd packages/vue && npx tsc --noEmit` (0 errors)

- [ ] **Step 5: Commit**

```bash
git add packages/vue/src/index.ts packages/vue/tests/webEntry.test.ts
git commit -m "feat(vue): register js singleton as resolveFlare default in web entry"
```

---

## Task 7: `/inject` entry (no js-root reference)

**Files:** Create `packages/vue/src/inject.ts`, Create `packages/vue/tests/injectEntry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/vue/tests/injectEntry.test.ts
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp, h } from 'vue';

// NOTE: this file registers NO resolveFlare default (it never imports the web entry). Vitest
// isolates the module registry per file, so resolveFlare's defaultProvider stays null here —
// which is exactly what lets the "throws without an instance" assertions hold.

describe('@flareapp/vue/inject entry', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as any).flare;
    });

    test('importing the inject entry does NOT evaluate @flareapp/js root', async () => {
        const rootFactory = vi.fn(() => ({ flare: {} }));
        vi.doMock('@flareapp/js', rootFactory);

        await import('../src/inject');

        expect(rootFactory).not.toHaveBeenCalled();
        expect((window as any).flare).toBeUndefined();
    });

    test('exports flareVue and FlareErrorBoundary', async () => {
        const mod = await import('../src/inject');
        expect(typeof mod.flareVue).toBe('function');
        expect(mod.FlareErrorBoundary).toBeDefined();
    });

    test('app.use(flareVue) from inject throws when no flare option and no default', async () => {
        const { flareVue } = await import('../src/inject');
        const app = createApp({ render: () => null });
        expect(() => app.use(flareVue)).toThrow(/No Flare instance available/);
    });

    test('mounting FlareErrorBoundary from inject throws at setup when no flare prop and no default', async () => {
        const { FlareErrorBoundary } = await import('../src/inject');
        expect(() => mount(FlareErrorBoundary, { slots: { default: () => h('div', 'x') } })).toThrow(
            /No Flare instance available/,
        );
    });
});
```

> The two throw tests exercise the wiring-time fail-fast (Decision 5) THROUGH the `/inject` entry — the behavior the electron README promises. They pass because no default is registered in this file's isolated module registry: `flareVue`'s install and the boundary's `setup` both call `resolveFlare(undefined)`, which throws synchronously.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/vue && npx vitest run tests/injectEntry.test.ts`
Expected: FAIL — Cannot find module '../src/inject'.

- [ ] **Step 3: Create the inject entry**

Read `src/index.ts` to mirror its NON-side-effect exports. Create `src/inject.ts` with the SAME exports MINUS the root import + `registerDefaultFlare` call:

```ts
// packages/vue/src/inject.ts
// Electron-safe entry. NO @flareapp/js root import, NO default registration. The caller MUST
// pass `flare` (plugin option / boundary prop); resolveFlare throws at wiring time if absent.
export { FlareErrorBoundary } from './FlareErrorBoundary';
export { flareVue } from './flareVue';
export { DEFAULT_PROPS_DENYLIST } from './constants';
export type {
    ComponentHierarchyFrame,
    ErrorOrigin,
    FlareErrorBoundaryFallbackProps,
    FlareErrorBoundaryHookParams,
    FlareVueContext,
    FlareVueOptions,
    FlareVueWarningContext,
    RouteContext,
    RouteParamValue,
    RouteQueryValue,
} from './types';
```

(Match the exact export list from the current `index.ts` — copy its export block verbatim, just without the new root-import lines added in Task 6.)

- [ ] **Step 4: Run test + full suite + tsc**

Run: `cd packages/vue && npx vitest run tests/injectEntry.test.ts` (4 pass)
Run: `cd packages/vue && npx vitest run` (full suite green)
Run: `cd packages/vue && npx tsc --noEmit` (0 errors)

- [ ] **Step 5: Commit**

```bash
git add packages/vue/src/inject.ts packages/vue/tests/injectEntry.test.ts
git commit -m "feat(vue): add @flareapp/vue/inject electron-safe entry"
```

---

## Task 8: Package wiring — build entry, export map, sideEffects, core dep

**Files:** Modify `packages/vue/package.json`, Modify `scripts/release-all.mjs`, Modify `package-lock.json`

- [ ] **Step 1: Add `src/inject.ts` to the build command**

In `packages/vue/package.json`, change the `build` script to add `src/inject.ts` (preserve the existing `--env.PACKAGE_VERSION="..."` quoting exactly):

```
"build": "tsdown src/index.ts src/inject.ts --format cjs,esm --dts --env.PACKAGE_VERSION=\"$(node -p \"require('./package.json').version\")\" --clean",
```

- [ ] **Step 2: Add `sideEffects` and the `./inject` export**

Add top-level `sideEffects` (only the index dist files have the registration side effect; inject is pure re-export):

```json
    "sideEffects": ["./dist/index.cjs", "./dist/index.mjs"],
```

Add `./inject` to `exports` after the `.` entry (mirror the `.` shape exactly):

```json
        "./inject": {
            "import": { "types": "./dist/inject.d.mts", "default": "./dist/inject.mjs" },
            "require": { "types": "./dist/inject.d.cts", "default": "./dist/inject.cjs" }
        }
```

- [ ] **Step 3: Declare `@flareapp/core` (EXACT pin)**

vue now value-imports `convertToError`/`resolveDenylist`/`redactUrlQuery` from `@flareapp/core`. Add a `dependencies` block, EXACT pin matching repo convention (verify current core version first with `node -p "require('./packages/core/package.json').version"`; use that):

```json
    "dependencies": {
        "@flareapp/core": "2.4.0"
    },
```

- [ ] **Step 4: Add vue to `CORE_REFS` in `scripts/release-all.mjs`**

```js
const CORE_REFS = [
    { pkg: 'js', field: 'dependencies', dep: '@flareapp/core' },
    { pkg: 'node', field: 'dependencies', dep: '@flareapp/core' },
    { pkg: 'electron', field: 'dependencies', dep: '@flareapp/core' },
    { pkg: 'react', field: 'dependencies', dep: '@flareapp/core' },
    { pkg: 'vue', field: 'dependencies', dep: '@flareapp/core' },
];
```

(The `react` entry is already present from the stacked React branch. Add `vue` after it.)

- [ ] **Step 5: Regenerate the lockfile**

Run: `npm install` (repo root). Expected: the only lockfile change is vue's new `@flareapp/core` dependency. Verify with `git --no-pager diff --stat`.

- [ ] **Step 6: Build, verify entries, type-check**

Run: `cd packages/vue && npm run build` — succeeds; `ls packages/vue/dist/inject.*` shows 4 files.
Run: `cd packages/vue && npx tsc --noEmit` — 0 errors.

- [ ] **Step 7: Commit**

```bash
git add packages/vue/package.json scripts/release-all.mjs package-lock.json
git commit -m "build(vue): emit /inject entry, pin core dep, export map + sideEffects"
```

---

## Task 9: Static guard — inject chunk graph has no js-root specifier

Use the STRENGTHENED guard from the React branch (it follows relative chunk imports transitively — tsdown emits the inject entry as a thin shim that re-exports from a shared chunk, so scanning only the entry would miss a root import in the chunk).

**Files:** Create `packages/vue/scripts/verify-inject-no-root.mjs`, Modify `packages/vue/package.json` (add `verify:inject` script)

- [ ] **Step 1: Write the guard (chunk-graph-following)**

```js
// packages/vue/scripts/verify-inject-no-root.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const rootSpecifier = /["']@flareapp\/js["']/;
const relativeSpecifier = /(?:from\s*|require\(\s*)["'](\.\.?\/[^"']+)["']/g;

const entries = ['inject.mjs', 'inject.cjs'];
const scanned = new Set();
let failed = false;

function scan(absPath) {
    if (scanned.has(absPath)) {
        return;
    }
    scanned.add(absPath);
    const src = readFileSync(absPath, 'utf8');
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
console.log(
    `[verify-inject-no-root] OK — inject bundle (${scanned.size} files incl. chunks) has no @flareapp/js root reference.`,
);
```

- [ ] **Step 2: Add the npm script**

In `packages/vue/package.json` scripts: `"verify:inject": "node scripts/verify-inject-no-root.mjs",`

- [ ] **Step 3: Run against the current build**

Run: `cd packages/vue && npm run build && npm run verify:inject`
Expected: `[verify-inject-no-root] OK — inject bundle (N files incl. chunks) ...` with N > 2 (proves it followed chunks).

- [ ] **Step 4: Prove the guard bites (shared-chunk mutation)**

Temporarily add `import '@flareapp/js';` to the TOP of `src/flareVue.ts` (a SHARED-chunk module, not the entry), rebuild, run the guard:
Run: `cd packages/vue && npm run build && npm run verify:inject`
Expected: exits NON-ZERO, naming a chunk file (e.g. `dist/flareVue-*.mjs`).
Then REMOVE the temporary import, rebuild, confirm OK. Verify `git diff src/flareVue.ts` is empty before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/vue/scripts/verify-inject-no-root.mjs packages/vue/package.json
git commit -m "test(vue): static guard that /inject chunk graph never pulls js root"
```

---

## Task 10: Cross-package regression — drive `@flareapp/vue/inject` into RendererFlare

Post-implementation regression test (no TDD red step). Runs in electron's default `node` env (fix D — no `@vitest-environment` directive; the Vue path needs no DOM).

**Files:** Create `packages/electron/tests/vueInjection.test.ts`, Modify `packages/electron/package.json` (add `@flareapp/vue` + `vue` devDependencies), Modify `package-lock.json`

Prerequisite: `@flareapp/vue` built (`dist/inject.*`).

- [ ] **Step 1: Add `@flareapp/vue` + `vue` as electron devDependencies**

In `packages/electron/package.json` devDependencies (preserve existing, incl. the `@flareapp/react`/`react` entries added on the React branch):

```json
        "@flareapp/vue": "file:../vue",
        "vue": "^3.4.0",
```

Then `npm install` from repo root. Confirm churn is limited to package-lock.json + electron package.json.

- [ ] **Step 2: Write the regression test**

```ts
// packages/electron/tests/vueInjection.test.ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from 'vue';

// The REAL published inject entry (built dist). Importing it must not pull the js root.
// Runs in electron's default `node` env — the vue error path needs no DOM (RendererFlare
// forwards via globalThis[FLARE_BRIDGE_KEY], not window).
import { flareVue } from '@flareapp/vue/inject';

import { FLARE_BRIDGE_KEY } from '../src/constants';
import { RendererFlare } from '../src/renderer/RendererFlare';

describe('@flareapp/vue/inject reports through an injected RendererFlare', () => {
    let bridgeReport: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        bridgeReport = vi.fn(async () => {});
        (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY] = { report: bridgeReport };
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)[FLARE_BRIDGE_KEY];
    });

    test('forwards a STRING payload carrying Vue context.custom over the bridge', async () => {
        const flare = new RendererFlare();

        const app = createApp({ render: () => null });
        app.use(flareVue, { flare });

        // Drive Vue's installed error handler directly.
        app.config.errorHandler!(new Error('boom'), null, 'render function');

        await flare.flush(1000);

        expect(bridgeReport).toHaveBeenCalledOnce();
        const payload = bridgeReport.mock.calls[0][0];
        expect(typeof payload).toBe('string');

        const parsed = JSON.parse(payload);
        expect(parsed.attributes['telemetry.sdk.name']).toBe('@flareapp/electron');
        expect(parsed.attributes['flare.framework.name']).toBe('Vue');
        expect(parsed.attributes['context.custom'].vue).toBeDefined();
        expect((globalThis as Record<string, unknown>).flare).toBeUndefined();
    });
});
```

> If an assertion path is wrong, `console.log(payload)` to inspect the REAL serialized shape and adjust ONLY the test path (never production code). Keep the intent: electron sdk preserved, framework=Vue, vue context.custom survives, payload is a string. The Vue context key is `context.custom.vue` (see `vueContextToAttributes` in `flareVue.ts`).

- [ ] **Step 3: Build vue, then run**

Run: `npm run build` (repo root, or `cd packages/vue && npm run build`).
Run: `cd packages/electron && npx vitest run tests/vueInjection.test.ts` — expect PASS.

- [ ] **Step 4: Full electron suite + tsc**

Run: `cd packages/electron && npx vitest run` (full suite green — includes the React injection test from the stacked branch).
Run: `cd packages/electron && npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit**

```bash
git add packages/electron/tests/vueInjection.test.ts packages/electron/package.json package-lock.json
git commit -m "test(electron): drive @flareapp/vue/inject through RendererFlare bridge"
```

---

## Task 11: Full suite, version bump, docs

**Files:** Modify `packages/vue/package.json` (version), Modify `package-lock.json`, Modify `packages/electron/README.md`, Modify `CLAUDE.md`

- [ ] **Step 1: Full verification gate**

Run: `cd packages/vue && npm run build && npm test && npx tsc --noEmit && npm run verify:inject` — all pass.
Run: `cd packages/electron && npm test && npx tsc --noEmit` — all pass.
If anything fails, STOP and report.

- [ ] **Step 2: Bump `@flareapp/vue` to 2.5.0 + refresh lockfile**

In `packages/vue/package.json`, `"version": "2.4.0"` → `"2.5.0"`. Then `npm install` (repo root); confirm the only lockfile change is the `packages/vue` version entry.

- [ ] **Step 3: Add the Vue section to the electron README**

Append to `packages/electron/README.md` (after the existing React section):

````markdown
## Using `@flareapp/vue` in the renderer

Same model as the React section: the API key lives in **main**, reports travel over IPC, and the renderer injects Electron's Flare instance into Vue instead of letting it reach the `@flareapp/js` singleton.

### Install

```bash
npm install @flareapp/electron @flareapp/vue
```

`@flareapp/js` comes in transitively via `@flareapp/electron` — do **not** import it in the renderer.

Set up main / preload / renderer exactly as in the React section (steps 1-3): `flare.light(key)` in main, `exposeFlare()` in preload, and a renderer `flare.ts` that re-exports `flare` from `@flareapp/electron/renderer`.

### Vue — inject the instance

Import `flareVue` (and, if you use it, `FlareErrorBoundary`) from `@flareapp/vue/inject`, not the package root, and pass the renderer instance:

```ts
// main.ts (renderer entry)
import { createApp } from 'vue';
import { flareVue } from '@flareapp/vue/inject';
import { flare } from './flare';
import App from './App.vue';

const app = createApp(App);
app.use(flareVue, { flare });
app.mount('#app');
```

Component boundary:

```vue
<script setup lang="ts">
import { FlareErrorBoundary } from '@flareapp/vue/inject';
import { flare } from './flare';
</script>

<template>
    <FlareErrorBoundary :flare="flare">
        <App />
    </FlareErrorBoundary>
</template>
```

### Rules

- **Never `import { flare } from '@flareapp/js'` in the renderer.** Import the Vue SDK from `@flareapp/vue/inject`, never the package root. Importing the root prints a console warning that the default was registered while the Electron bridge is present.
- Omitting the `flare` option/prop on the `/inject` entry throws at install / component setup (boot), not silently at error time.

Reports from the renderer carry `sdk = @flareapp/electron` and `framework = Vue`. Your Vue component context (`context.custom.vue`, component hierarchy, props) rides along and survives the IPC trip intact.
````

- [ ] **Step 4: Update CLAUDE.md**

In the "Monorepo structure" table, update the `@flareapp/vue` Purpose cell to mention the `/inject` entry for Electron renderers (mirror how the `@flareapp/react` row was updated on the React branch).

- [ ] **Step 5: Commit**

```bash
git add packages/vue/package.json package-lock.json packages/electron/README.md CLAUDE.md
git commit -m "docs(vue,electron): document renderer injection; bump vue to 2.5.0"
```

---

## Self-review notes (resolved against the spec + React precedent)

- **Decision 1 (optional DI seam):** Tasks 4 (`flareVue` option), 5 (boundary prop).
- **Decision 2 (separate entries, no dynamic import):** Tasks 6, 7, 8. Plus Task 3 (util migration) — Vue-specific prerequisite so the shared graph is root-free.
- **Decision 3 (per-instance identity, framework-only when injected):** Task 2; applied in Tasks 4, 5. Vue note: identity stays at install/setup (needs `app.version`), NOT at import — preserves web behavior.
- **Decision 4 (additive → minor):** Task 11 (vue 2.5.0).
- **Decision 5 (resolve at wiring time, throw there):** Task 4 (install), Task 5 (setup).
- **Decision 6 (sveltekit ordering):** N/A to Vue.
- **Q4 (dev-warn tripwire):** Task 1.
- **Q7 (sideEffects + regression test):** Tasks 6, 8.
- **Q8 (no-root guard, chunk-graph):** Task 9 authoritative; Task 7 runtime check; Task 10 behavioral.

**Four React-branch fixes baked in:** A (window cast) Task 1; B (no unused @ts-expect-error) Tasks 1/7; C (resolves-once via resolveFlare spy) Tasks 4/5; D (node-env electron test) Task 10.

**Vue-specific risks called out:**

- Vue has TWO report sites (plugin + boundary) and FOUR root imports (Task 3 migrates the two utility ones; Tasks 4/5 handle the two singleton ones).
- The Vue boundary now tags `framework = Vue` at setup even when used without `flareVue` — additive (today it tags nothing). Acceptable for a minor; noted so a reviewer isn't surprised.

**Not in this plan (sibling):** Svelte (`@flareapp/svelte/inject`) + the SvelteKit sdk-name regression (Decision 6), stacked on top of this Vue branch.
