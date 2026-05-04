# Vue Props Capture & Warn Handler Alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the `@flareapp/vue` package with its design spec by making props capture opt-in with a bounded serializer, renaming the warn-handler payload to the documented schema, and resolving the few related type/packaging inconsistencies.

**Architecture:** A new pure helper `serializeProps(value, maxDepth)` handles all props serialization with explicit sentinels (`"[Function]"`, `"[Object]"`, `"[Array]"`, `"[Symbol]"`, `"[Circular]"`) and is called from exactly three places: `flareVue()`, `<FlareErrorBoundary>`, and `buildComponentHierarchyFrames`. Each call site reads `attachProps` (default `false`) and `propsMaxDepth` (default `2`) from its own config and either invokes the serializer or omits the props field entirely. The warn handler payload is renamed in a separate, self-contained change.

**Tech Stack:** TypeScript 5.7 (strict), Vitest for unit tests, `@vue/test-utils` for component tests, tsdown for builds, npm workspaces.

---

## Global conventions (apply to every task)

- Commit messages follow the existing repo style (see `git log`): `feat:`, `fix:`, `tests:`, `docs:`, `chore:`. One short subject line, no body unless necessary.
- **No `Co-Authored-By` trailer. No "Generated with Claude Code" or any AI attribution anywhere.** Commits go out in the user's name only.
- Do not stage any file under `docs/superpowers/` (this plan, the spec). They stay local and untracked.
- Do not use `git add -A` or `git add .`. Stage files by exact path.
- Run all commands from the repo root unless otherwise noted.
- After every task's final step, run `git status` and confirm only the expected files changed.

---

## Task ordering and commit boundaries

Task 1 is a pure utility — commits on its own.

Task 2 (warn handler rename) is self-contained: it only touches `flareVue.ts`'s warn handler block, `flareVue.test.ts`'s warn handler tests, and adds a new `FlareVueWarningContext` type that no existing code references. Commits on its own.

Tasks 3–6 together form one logical change ("opt-in props capture") and commit as a single `feat:` commit at the end of Task 6. Steps within Tasks 3–6 run tests and typecheck against the current working tree, but only Task 6 stages and commits.

Task 7 (`vue-router` peer), Task 8 (playground), and Task 9 (verify + review) each commit individually.

---

## File Structure

Files created:

| Path | Purpose |
|------|---------|
| `packages/vue/src/serializeProps.ts` | Pure function turning an arbitrary props object into a bounded, JSON-safe record. Only module that knows about sentinels. |
| `packages/vue/tests/serializeProps.test.ts` | Unit tests for the serializer. |

Files modified:

| Path | Changes |
|------|---------|
| `packages/vue/src/types.ts` | Add `FlareVueWarningContext` (Task 2). Make `ComponentHierarchyFrame.props`, `FlareVueContext['vue'].componentProps`, `FlareErrorBoundaryFallbackProps.componentProps` optional; add `attachProps` + `propsMaxDepth` to `FlareVueOptions` (Tasks 3–6). |
| `packages/vue/src/index.ts` | Export new `FlareVueWarningContext` type. |
| `packages/vue/src/buildComponentHierarchyFrames.ts` | Required second parameter `{ attachProps, propsMaxDepth }`. When `attachProps` is `false`, each frame omits the `props` key. When `true`, `props` is serialized via `serializeProps`. |
| `packages/vue/src/flareVue.ts` | Warn handler payload renamed (Task 2). Reads `attachProps` + `propsMaxDepth` from options; serializes `componentProps` only when on; omits the key from the payload when off; forwards options to `buildComponentHierarchyFrames` (Task 5). |
| `packages/vue/src/FlareErrorBoundary.ts` | Adds `attachProps` + `propsMaxDepth` props; uses serializer; `componentProps` ref defaults to `undefined`; fallback slot receives `componentProps` only when defined. |
| `packages/vue/tests/buildComponentHierarchyFrames.test.ts` | Every call updated to pass the new required options; new tests for opt-in behavior. |
| `packages/vue/tests/flareVue.test.ts` | Warn handler tests updated to new payload (Task 2); new `attachProps` tests (Task 5). |
| `packages/vue/tests/FlareErrorBoundary.test.ts` | New `attachProps` tests at component level. |
| `packages/vue/package.json` | `vue-router` added to `peerDependencies` and marked optional in `peerDependenciesMeta`. |
| `playground/src/vue/...` | Add an example demonstrating `attachProps: true` with depth limiting. Exact file chosen during Task 8. |

Out of scope for this plan:

- Version bump in `packages/vue/package.json` (stays at `1.0.1`).
- README changes.
- Changes to `packages/react` or `packages/js`.

---

## Task 1: `serializeProps` utility (TDD)

**Files:**
- Create: `packages/vue/src/serializeProps.ts`
- Create: `packages/vue/tests/serializeProps.test.ts`

- [ ] **Step 1.1: Write the full failing test suite**

Create `packages/vue/tests/serializeProps.test.ts` with the exact content:

```ts
import { describe, expect, test } from 'vitest';

import { serializeProps } from '../src/serializeProps';

describe('serializeProps', () => {
    test('passes primitives through unchanged', () => {
        expect(
            serializeProps(
                {
                    str: 'hello',
                    num: 42,
                    bool: true,
                    nul: null,
                    undef: undefined,
                    big: 10n,
                },
                2
            )
        ).toEqual({
            str: 'hello',
            num: 42,
            bool: true,
            nul: null,
            undef: undefined,
            big: 10n,
        });
    });

    test('replaces functions with "[Function]"', () => {
        expect(serializeProps({ fn: () => 1 }, 2)).toEqual({ fn: '[Function]' });
    });

    test('replaces symbols with "[Symbol]"', () => {
        expect(serializeProps({ sym: Symbol('x') }, 2)).toEqual({ sym: '[Symbol]' });
    });

    test('recurses into plain objects up to maxDepth', () => {
        expect(serializeProps({ a: { b: { c: 1 } } }, 2)).toEqual({ a: { b: { c: 1 } } });
    });

    test('replaces plain objects at maxDepth with "[Object]"', () => {
        expect(serializeProps({ a: { b: { c: { d: 1 } } } }, 2)).toEqual({ a: { b: { c: '[Object]' } } });
    });

    test('recurses into plain arrays up to maxDepth', () => {
        expect(serializeProps({ a: [1, [2, [3]]] }, 3)).toEqual({ a: [1, [2, [3]]] });
    });

    test('replaces plain arrays at maxDepth with "[Array]"', () => {
        expect(serializeProps({ a: [[[[1]]]] }, 2)).toEqual({ a: [['[Array]']] });
    });

    test('serializes top-level values at depth 1 with maxDepth 0', () => {
        expect(serializeProps({ obj: { a: 1 }, arr: [1, 2] }, 0)).toEqual({ obj: '[Object]', arr: '[Array]' });
    });

    test('keeps primitives at any maxDepth, including 0', () => {
        expect(serializeProps({ a: 1, b: 'x' }, 0)).toEqual({ a: 1, b: 'x' });
    });

    test('marks direct self-reference as "[Circular]"', () => {
        const input: Record<string, unknown> = { name: 'loop' };
        input.self = input;

        expect(serializeProps(input, 5)).toEqual({ name: 'loop', self: '[Circular]' });
    });

    test('marks indirect circular reference as "[Circular]"', () => {
        const a: Record<string, unknown> = { label: 'a' };
        const b: Record<string, unknown> = { label: 'b' };
        a.next = b;
        b.next = a;

        expect(serializeProps({ a }, 10)).toEqual({ a: { label: 'a', next: { label: 'b', next: '[Circular]' } } });
    });

    test('does not mark diamond shapes (non-circular repeats) as circular', () => {
        const shared = { id: 1 };

        expect(serializeProps({ left: shared, right: shared }, 3)).toEqual({
            left: { id: 1 },
            right: { id: 1 },
        });
    });

    test('collapses Date to "[Object]"', () => {
        expect(serializeProps({ d: new Date(0) }, 5)).toEqual({ d: '[Object]' });
    });

    test('collapses RegExp to "[Object]"', () => {
        expect(serializeProps({ re: /abc/ }, 5)).toEqual({ re: '[Object]' });
    });

    test('collapses Map to "[Object]"', () => {
        expect(serializeProps({ m: new Map([['a', 1]]) }, 5)).toEqual({ m: '[Object]' });
    });

    test('collapses Set to "[Object]"', () => {
        expect(serializeProps({ s: new Set([1, 2]) }, 5)).toEqual({ s: '[Object]' });
    });

    test('collapses class instances to "[Object]"', () => {
        class Widget {
            constructor(public name: string) {}
        }

        expect(serializeProps({ w: new Widget('x') }, 5)).toEqual({ w: '[Object]' });
    });

    test('treats Object.create(null) as a plain object', () => {
        const bare = Object.create(null);
        bare.a = 1;

        expect(serializeProps({ bare }, 5)).toEqual({ bare: { a: 1 } });
    });

    test('ignores symbol-keyed properties on input', () => {
        const sym = Symbol('hidden');
        const input: Record<string | symbol, unknown> = { a: 1 };
        input[sym] = 'secret';

        expect(serializeProps(input as Record<string, unknown>, 2)).toEqual({ a: 1 });
    });

    test('serializes a mixed tree correctly', () => {
        const obj = {
            user: { id: 1, name: 'x', meta: { createdAt: new Date(0), tags: ['a', 'b'] } },
            callback: () => 0,
            id: Symbol('id'),
            items: [{ a: 1 }, { b: 2 }],
        };

        expect(serializeProps(obj, 2)).toEqual({
            user: { id: 1, name: 'x', meta: { createdAt: '[Object]', tags: '[Array]' } },
            callback: '[Function]',
            id: '[Symbol]',
            items: [{ a: 1 }, { b: 2 }],
        });
    });
});
```

- [ ] **Step 1.2: Verify the tests fail (module missing)**

Run: `cd packages/vue && npx vitest run serializeProps`
Expected: FAIL — `Failed to resolve import "../src/serializeProps"`.

- [ ] **Step 1.3: Implement `serializeProps`**

Create `packages/vue/src/serializeProps.ts` with the exact content:

```ts
export function serializeProps(value: Record<string, unknown>, maxDepth: number): Record<string, unknown> {
    const seen = new WeakSet<object>();

    return serializeObject(value, 0, maxDepth, seen);
}

function serializeValue(
    value: unknown,
    depth: number,
    maxDepth: number,
    seen: WeakSet<object>
): unknown {
    if (value === null) {
        return null;
    }

    const type = typeof value;

    if (type === 'function') {
        return '[Function]';
    }

    if (type === 'symbol') {
        return '[Symbol]';
    }

    if (type !== 'object') {
        return value;
    }

    if (seen.has(value as object)) {
        return '[Circular]';
    }

    if (Array.isArray(value)) {
        if (depth > maxDepth) {
            return '[Array]';
        }

        seen.add(value);
        const out = value.map((item) => serializeValue(item, depth + 1, maxDepth, seen));
        seen.delete(value);

        return out;
    }

    if (!isPlainObject(value)) {
        return '[Object]';
    }

    if (depth > maxDepth) {
        return '[Object]';
    }

    return serializeObject(value as Record<string, unknown>, depth, maxDepth, seen);
}

function serializeObject(
    value: Record<string, unknown>,
    depth: number,
    maxDepth: number,
    seen: WeakSet<object>
): Record<string, unknown> {
    seen.add(value);

    const out: Record<string, unknown> = {};

    for (const key of Object.keys(value)) {
        out[key] = serializeValue(value[key], depth + 1, maxDepth, seen);
    }

    seen.delete(value);

    return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === null || prototype === Object.prototype;
}
```

- [ ] **Step 1.4: Verify the tests pass**

Run: `cd packages/vue && npx vitest run serializeProps`
Expected: PASS — 19 tests passing.

- [ ] **Step 1.5: Type-check**

Run: `npm run typescript --workspace=@flareapp/vue`
Expected: no errors.

- [ ] **Step 1.6: Commit**

```bash
git add packages/vue/src/serializeProps.ts packages/vue/tests/serializeProps.test.ts
git commit -m "feat: add serializeProps helper with depth-limited sentinel output"
```

Run `git log -1 --format="%an %ae%n%s%n%b"` and confirm no `Co-Authored-By`, no `Generated with Claude`, no AI attribution.

---

## Task 2: Warn handler payload alignment (TDD, self-contained)

**Files:**
- Modify: `packages/vue/src/types.ts` (add new export)
- Modify: `packages/vue/src/index.ts` (re-export)
- Modify: `packages/vue/src/flareVue.ts` (warn handler block only)
- Modify: `packages/vue/tests/flareVue.test.ts` (warn handler tests only)

- [ ] **Step 2.1: Add `FlareVueWarningContext` export in `packages/vue/src/types.ts`**

Append (do NOT reformat or touch existing types yet) immediately after the existing `FlareVueContext` declaration (currently ending at line 31):

```ts
export type FlareVueWarningContext = {
    vue: {
        type: 'warning';
        info: string;
        componentName: string;
        componentTrace: string;
        route?: RouteContext;
    };
};
```

- [ ] **Step 2.2: Re-export in `packages/vue/src/index.ts`**

Add `FlareVueWarningContext` to the `export type { ... }` list, alphabetically placed. After the change, the list should read:

```ts
export type {
    ComponentHierarchyFrame,
    ErrorOrigin,
    FlareErrorBoundaryFallbackProps,
    FlareErrorBoundaryHookParams,
    FlareVueContext,
    FlareVueOptions,
    FlareVueWarningContext,
    RouteContext,
} from './types';
```

- [ ] **Step 2.3: Update warn handler tests to the new payload schema**

In `packages/vue/tests/flareVue.test.ts`:

Replace the assertion block at lines 577–582 (inside the test `'reports warning via flare.reportMessage with message, context, and VueWarning exception class'`) with:

```ts
        expect(mockReportMessage).toHaveBeenCalledOnce();
        expect(mockReportMessage).toHaveBeenCalledWith(
            'Invalid prop type',
            {
                vue: {
                    type: 'warning',
                    info: 'Invalid prop type',
                    componentName: 'Counter',
                    componentTrace: 'found in\n---> <Counter>',
                },
            },
            'VueWarning'
        );
```

In the test `'context includes component name and trace'`, replace the three final `expect` lines (lines 594–596) with:

```ts
        expect(context.vue.type).toBe('warning');
        expect(context.vue.componentName).toBe('UserProfile');
        expect(context.vue.componentTrace).toBe(trace);
        expect(context.vue.info).toBe('Missing required prop');
```

Leave the `reportMessage` call itself, the describe block, and the other warn-handler tests unchanged.

- [ ] **Step 2.4: Verify the tests fail (current code still sends old schema)**

Run: `cd packages/vue && npx vitest run flareVue`
Expected: FAIL — two failing tests asserting on the new schema.

- [ ] **Step 2.5: Update the warn handler block in `packages/vue/src/flareVue.ts`**

Only modify the warn handler block (current lines 55–72). Replace it with:

```ts
    if (options?.captureWarnings) {
        const initialWarnHandler = app.config.warnHandler;

        app.config.warnHandler = (msg: string, instance: ComponentPublicInstance | null, trace: string) => {
            const componentName = getComponentName(instance);
            const route = getRouteContext(app.config.globalProperties.$router);

            const context: FlareVueWarningContext = {
                vue: {
                    type: 'warning',
                    info: msg,
                    componentName,
                    componentTrace: trace,
                    ...(route && { route }),
                },
            };

            flare.reportMessage(msg, context, 'VueWarning');

            if (typeof initialWarnHandler === 'function') {
                initialWarnHandler(msg, instance, trace);
            }
        };
    }
```

Also add `FlareVueWarningContext` to the existing `import { ... } from './types'` line at the top of the file:

```ts
import { FlareVueContext, FlareVueOptions, FlareVueWarningContext } from './types';
```

- [ ] **Step 2.6: Verify the tests pass**

Run: `cd packages/vue && npx vitest run flareVue`
Expected: PASS — all warn handler tests pass with the new schema.

- [ ] **Step 2.7: Typecheck and run the full vue suite**

Run: `npm run typescript`
Expected: no errors.

Run: `npm run test --workspace=@flareapp/vue`
Expected: all existing vue tests still pass.

- [ ] **Step 2.8: Commit**

```bash
git status  # confirm only the 4 expected files are modified
git add \
    packages/vue/src/types.ts \
    packages/vue/src/index.ts \
    packages/vue/src/flareVue.ts \
    packages/vue/tests/flareVue.test.ts
git commit -m "fix: align warn handler payload schema with vue improvements doc"
```

Run `git log -1 --format="%s%n%b"` and confirm no AI attribution.

---

## Task 3: Type surface for opt-in props capture

**Files:**
- Modify: `packages/vue/src/types.ts`

> **Note on ordering:** This type change breaks TS at `buildComponentHierarchyFrames.ts:14-18`, `flareVue.ts:22` (where `componentProps: null` is currently assigned), and `FlareErrorBoundary.ts:44`/`:95` (ref type and assignment). Those are fixed in Tasks 4–6. Task 3 does not commit on its own — the commit happens at the end of Task 6.

- [ ] **Step 3.1: Update `packages/vue/src/types.ts`**

Replace the file entirely with:

```ts
import type { ComponentPublicInstance } from 'vue';

export type ErrorOrigin = 'setup' | 'render' | 'lifecycle' | 'event' | 'watcher' | 'unknown';

export type ComponentHierarchyFrame = {
    component: string;
    file: string | null;
    props?: Record<string, unknown>;
};

export type RouteContext = {
    name: string | null;
    path: string;
    fullPath: string;
    params: Record<string, unknown>;
    query: Record<string, unknown>;
    hash: string;
    matched: string[];
};

export type FlareVueContext = {
    vue: {
        info: string;
        errorOrigin: ErrorOrigin;
        componentName: string;
        componentProps?: Record<string, unknown>;
        componentHierarchy: string[];
        componentHierarchyFrames: ComponentHierarchyFrame[];
        route?: RouteContext;
    };
};

export type FlareVueWarningContext = {
    vue: {
        type: 'warning';
        info: string;
        componentName: string;
        componentTrace: string;
        route?: RouteContext;
    };
};

export type FlareErrorBoundaryHookParams = {
    error: Error;
    instance: ComponentPublicInstance | null;
    info: string;
};

export type FlareVueOptions = {
    captureWarnings?: boolean;
    attachProps?: boolean;
    propsMaxDepth?: number;
    beforeEvaluate?: (params: FlareErrorBoundaryHookParams) => void;
    beforeSubmit?: (params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => FlareVueContext;
    afterSubmit?: (params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => void;
};

export type FlareErrorBoundaryFallbackProps = {
    error: Error;
    componentProps?: Record<string, unknown>;
    componentHierarchy: string[];
    componentHierarchyFrames: ComponentHierarchyFrame[];
    resetErrorBoundary: () => void;
};
```

- [ ] **Step 3.2: Do NOT typecheck and do NOT commit**

TS errors exist at the call sites; Tasks 4–6 resolve them. Running the full suite here would fail; skip it until Task 6.

---

## Task 4: `buildComponentHierarchyFrames` required options + serializer integration (TDD)

**Files:**
- Modify: `packages/vue/src/buildComponentHierarchyFrames.ts`
- Modify: `packages/vue/tests/buildComponentHierarchyFrames.test.ts`

- [ ] **Step 4.1: Update every existing call in the test file to pass the new required options**

In `packages/vue/tests/buildComponentHierarchyFrames.test.ts`, find every call to `buildComponentHierarchyFrames(instance)` and change it to `buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 2 })`. Preserve the existing expectations — they already assume props are captured, and `attachProps: true` keeps that behavior.

Run: `rg "buildComponentHierarchyFrames\(" packages/vue/tests/buildComponentHierarchyFrames.test.ts -n`
Use the output to verify every call site was updated.

- [ ] **Step 4.2: Append new tests for opt-in behavior**

Inside the existing `describe('buildComponentHierarchyFrames', () => { ... })` block, right before its closing `});`, append:

```ts
    describe('attachProps', () => {
        test('omits props on every frame when attachProps is false', () => {
            const parent = createMockInstance('Parent', { props: { parentProp: 1 } });
            const child = createMockInstance('Child', { parent, props: { childProp: 2 } });

            const frames = buildComponentHierarchyFrames(child, { attachProps: false, propsMaxDepth: 2 });

            expect(frames).toEqual([
                { component: 'Child', file: null },
                { component: 'Parent', file: null },
            ]);
            frames.forEach((frame) => expect('props' in frame).toBe(false));
        });

        test('includes serialized props on each frame when attachProps is true', () => {
            const parent = createMockInstance('Parent', { props: { flag: true } });
            const child = createMockInstance('Child', { parent, props: { count: 3 } });

            const frames = buildComponentHierarchyFrames(child, { attachProps: true, propsMaxDepth: 2 });

            expect(frames).toEqual([
                { component: 'Child', file: null, props: { count: 3 } },
                { component: 'Parent', file: null, props: { flag: true } },
            ]);
        });

        test('forwards propsMaxDepth to serializer', () => {
            const instance = createMockInstance('X', { props: { deep: { a: { b: 1 } } } });

            const frames = buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 1 });

            expect(frames[0].props).toEqual({ deep: { a: '[Object]' } });
        });

        test('replaces functions in props with "[Function]" sentinel', () => {
            const instance = createMockInstance('X', { props: { onClick: () => 0 } });

            const frames = buildComponentHierarchyFrames(instance, { attachProps: true, propsMaxDepth: 2 });

            expect(frames[0].props).toEqual({ onClick: '[Function]' });
        });
    });
```

- [ ] **Step 4.3: Verify the test file fails**

Run: `cd packages/vue && npx vitest run buildComponentHierarchyFrames`
Expected: FAIL — current implementation does not accept a second argument and still unconditionally captures props.

- [ ] **Step 4.4: Update `packages/vue/src/buildComponentHierarchyFrames.ts`**

Replace the file entirely with:

```ts
import type { ComponentPublicInstance } from 'vue';

import { MAX_HIERARCHY_DEPTH } from './constants';
import { getComponentName } from './getComponentName';
import { serializeProps } from './serializeProps';
import { ComponentHierarchyFrame } from './types';

export type BuildComponentHierarchyFramesOptions = {
    attachProps: boolean;
    propsMaxDepth: number;
};

export function buildComponentHierarchyFrames(
    instance: ComponentPublicInstance | null,
    options: BuildComponentHierarchyFramesOptions
): ComponentHierarchyFrame[] {
    const frames: ComponentHierarchyFrame[] = [];
    let current = instance;

    while (current && frames.length < MAX_HIERARCHY_DEPTH) {
        const frameOptions = current.$options as { __file?: string };
        const frame: ComponentHierarchyFrame = {
            component: getComponentName(current),
            file: frameOptions.__file ?? null,
        };

        if (options.attachProps && current.$props) {
            frame.props = serializeProps(current.$props, options.propsMaxDepth);
        }

        frames.push(frame);

        current = current.$parent;
    }

    return frames;
}
```

- [ ] **Step 4.5: Verify the tests pass**

Run: `cd packages/vue && npx vitest run buildComponentHierarchyFrames`
Expected: PASS — all existing tests (still using `attachProps: true`) plus the 4 new tests.

- [ ] **Step 4.6: Do NOT commit**

`flareVue.ts` and `FlareErrorBoundary.ts` still call the old 1-arg `buildComponentHierarchyFrames`; they are updated in Tasks 5 and 6.

---

## Task 5: `flareVue()` uses attachProps/propsMaxDepth (TDD)

**Files:**
- Modify: `packages/vue/src/flareVue.ts`
- Modify: `packages/vue/tests/flareVue.test.ts`

- [ ] **Step 5.1: Add new `attachProps` tests inside the existing `describe('flareVue', () => { ... })` block**

Find the closing `});` of the first `describe('flareVue', () => { ... })` (the one that starts at line 65, containing `test('sets app.config.errorHandler', ...)`). Immediately before that closing `});`, insert:

```ts
    describe('attachProps', () => {
        test('omits componentProps from payload by default', () => {
            const app = createMockApp();
            (flareVue as Function)(app);

            const instance = createMockInstance('MyComponent', null, { userId: 1 });
            callHandler(app, new Error('x'), instance, 'setup function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect('componentProps' in context.vue).toBe(false);
        });

        test('omits frame.props on every hierarchy frame by default', () => {
            const app = createMockApp();
            (flareVue as Function)(app);

            const parent = createMockInstance('Parent', null, { flag: true });
            const child = createMockInstance('Child', parent, { id: 1 });
            callHandler(app, new Error('x'), child, 'render function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            context.vue.componentHierarchyFrames.forEach((frame) => {
                expect('props' in frame).toBe(false);
            });
        });

        test('includes serialized componentProps when attachProps is true', () => {
            const app = createMockApp();
            (flareVue as Function)(app, { attachProps: true } satisfies FlareVueOptions);

            const instance = createMockInstance('MyComponent', null, { userId: 42, onClick: () => 0 });
            callHandler(app, new Error('x'), instance, 'setup function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect(context.vue.componentProps).toEqual({ userId: 42, onClick: '[Function]' });
        });

        test('forwards propsMaxDepth to the serializer for componentProps', () => {
            const app = createMockApp();
            (flareVue as Function)(app, { attachProps: true, propsMaxDepth: 1 } satisfies FlareVueOptions);

            const instance = createMockInstance('MyComponent', null, { nested: { a: { b: 1 } } });
            callHandler(app, new Error('x'), instance, 'setup function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect(context.vue.componentProps).toEqual({ nested: { a: '[Object]' } });
        });

        test('includes serialized props on each hierarchy frame when attachProps is true', () => {
            const app = createMockApp();
            (flareVue as Function)(app, { attachProps: true } satisfies FlareVueOptions);

            const parent = createMockInstance('Parent', null, { flag: true });
            const child = createMockInstance('Child', parent, { id: 1 });
            callHandler(app, new Error('x'), child, 'render function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect(context.vue.componentHierarchyFrames.map((frame) => frame.props)).toEqual([{ id: 1 }, { flag: true }]);
        });
    });
```

- [ ] **Step 5.2: Verify the tests fail**

Run: `cd packages/vue && npx vitest run flareVue`
Expected: FAIL on the 5 new tests — the current error handler always builds `componentProps` and always passes through `buildComponentHierarchyFrames` with the old single argument (which also triggers a TS-surfaced error at runtime).

- [ ] **Step 5.3: Update the error handler block in `packages/vue/src/flareVue.ts`**

Replace the function body (keep the warn handler block from Task 2 exactly as-is). The complete file after this step reads:

```ts
import { flare } from '@flareapp/js';
import type { App, ComponentPublicInstance, Plugin } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { buildComponentHierarchyFrames } from './buildComponentHierarchyFrames';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { getErrorOrigin } from './getErrorOrigin';
import { getRouteContext } from './getRouteContext';
import { serializeProps } from './serializeProps';
import { FlareVueContext, FlareVueOptions, FlareVueWarningContext } from './types';

export const flareVue: Plugin<[FlareVueOptions?]> = (app: App, options?: FlareVueOptions): void => {
    const attachProps = options?.attachProps ?? false;
    const propsMaxDepth = options?.propsMaxDepth ?? 2;

    const initialErrorHandler = app.config.errorHandler;

    app.config.errorHandler = (error: unknown, instance: ComponentPublicInstance | null, info: string) => {
        const errorToReport = convertToError(error);

        options?.beforeEvaluate?.({ error: errorToReport, instance, info });

        const errorOrigin = getErrorOrigin(info);
        const componentName = getComponentName(instance);
        const componentProps = attachProps && instance?.$props
            ? serializeProps(instance.$props, propsMaxDepth)
            : undefined;
        const componentHierarchy = buildComponentHierarchy(instance);
        const componentHierarchyFrames = buildComponentHierarchyFrames(instance, { attachProps, propsMaxDepth });

        const route = getRouteContext(app.config.globalProperties.$router);

        const context: FlareVueContext = {
            vue: {
                info,
                errorOrigin,
                componentName,
                ...(componentProps && { componentProps }),
                componentHierarchy,
                componentHierarchyFrames,
                ...(route && { route }),
            },
        };

        const finalContext = options?.beforeSubmit?.({ error: errorToReport, instance, info, context }) ?? context;

        flare.report(errorToReport, finalContext, { vue: { instance, info } });

        options?.afterSubmit?.({ error: errorToReport, instance, info, context: finalContext });

        if (typeof initialErrorHandler === 'function') {
            initialErrorHandler(error, instance, info);

            return;
        }

        throw errorToReport;
    };

    if (options?.captureWarnings) {
        const initialWarnHandler = app.config.warnHandler;

        app.config.warnHandler = (msg: string, instance: ComponentPublicInstance | null, trace: string) => {
            const componentName = getComponentName(instance);
            const route = getRouteContext(app.config.globalProperties.$router);

            const context: FlareVueWarningContext = {
                vue: {
                    type: 'warning',
                    info: msg,
                    componentName,
                    componentTrace: trace,
                    ...(route && { route }),
                },
            };

            flare.reportMessage(msg, context, 'VueWarning');

            if (typeof initialWarnHandler === 'function') {
                initialWarnHandler(msg, instance, trace);
            }
        };
    }
};
```

- [ ] **Step 5.4: Verify the tests pass**

Run: `cd packages/vue && npx vitest run flareVue`
Expected: PASS — all existing tests plus the 5 new `attachProps` tests.

- [ ] **Step 5.5: Do NOT commit**

`FlareErrorBoundary.ts` is still broken (ref type mismatch). Task 6 closes the loop.

---

## Task 6: `FlareErrorBoundary` attachProps/propsMaxDepth (TDD) + commit Tasks 3–6

**Files:**
- Modify: `packages/vue/src/FlareErrorBoundary.ts`
- Modify: `packages/vue/tests/FlareErrorBoundary.test.ts`

- [ ] **Step 6.1: Inspect existing `FlareErrorBoundary.test.ts` for `componentProps` assertions**

Run: `rg "componentProps" packages/vue/tests/FlareErrorBoundary.test.ts -n`

For each occurrence that asserts `componentProps` equals a non-undefined value without setting `props: { attachProps: true }` on the mount call, update the test: either (a) add `attachProps: true` to that test's mount props so the assertion still makes sense, or (b) change the assertion to `expect(...).toBeUndefined()` to reflect the new default-off behavior.

If the test file does not already mock `@flareapp/js`, copy the mock setup from `flareVue.test.ts` (lines 7–15) verbatim at the top of the file, and add a matching `beforeEach(() => { mockReport.mockReset(); mockReportMessage.mockReset(); })`.

Also: if `h` is not imported in the test file, add `import { h } from 'vue';` at the top.

- [ ] **Step 6.2: Add `attachProps` tests**

Append, inside the existing `describe('FlareErrorBoundary', () => { ... })`, right before its closing `});`:

```ts
    describe('attachProps', () => {
        test('omits componentProps from the reported context by default', async () => {
            const { mount } = await import('@vue/test-utils');
            const Throwing = {
                props: ['userId'],
                setup() {
                    throw new Error('boom');
                },
                template: '<div/>',
            };

            mount(FlareErrorBoundary, {
                slots: { default: () => h(Throwing, { userId: 7 }) },
            });

            const context = mockReport.mock.calls[0][1];
            expect('componentProps' in context.vue).toBe(false);
        });

        test('includes serialized componentProps when attachProps is true', async () => {
            const { mount } = await import('@vue/test-utils');
            const Throwing = {
                props: ['userId'],
                setup() {
                    throw new Error('boom');
                },
                template: '<div/>',
            };

            mount(FlareErrorBoundary, {
                props: { attachProps: true },
                slots: { default: () => h(Throwing, { userId: 7 }) },
            });

            const context = mockReport.mock.calls[0][1];
            expect(context.vue.componentProps).toEqual({ userId: 7 });
        });

        test('forwards propsMaxDepth to the serializer', async () => {
            const { mount } = await import('@vue/test-utils');
            const Throwing = {
                props: ['data'],
                setup() {
                    throw new Error('boom');
                },
                template: '<div/>',
            };

            mount(FlareErrorBoundary, {
                props: { attachProps: true, propsMaxDepth: 1 },
                slots: { default: () => h(Throwing, { data: { nested: { deep: 1 } } }) },
            });

            const context = mockReport.mock.calls[0][1];
            expect(context.vue.componentProps).toEqual({ data: { nested: '[Object]' } });
        });

        test('omits componentProps from fallback slot by default', async () => {
            const { mount } = await import('@vue/test-utils');
            const Throwing = {
                props: ['userId'],
                setup() {
                    throw new Error('boom');
                },
                template: '<div/>',
            };

            let slotProps: Record<string, unknown> | undefined;

            mount(FlareErrorBoundary, {
                slots: {
                    default: () => h(Throwing, { userId: 7 }),
                    fallback: (props: Record<string, unknown>) => {
                        slotProps = props;
                        return 'fallback';
                    },
                },
            });

            expect(slotProps).toBeDefined();
            expect('componentProps' in (slotProps as Record<string, unknown>)).toBe(false);
        });

        test('passes serialized componentProps into the fallback slot when attachProps is true', async () => {
            const { mount } = await import('@vue/test-utils');
            const Throwing = {
                props: ['userId'],
                setup() {
                    throw new Error('boom');
                },
                template: '<div/>',
            };

            let slotProps: { componentProps?: Record<string, unknown> } | undefined;

            mount(FlareErrorBoundary, {
                props: { attachProps: true },
                slots: {
                    default: () => h(Throwing, { userId: 7 }),
                    fallback: (props: { componentProps?: Record<string, unknown> }) => {
                        slotProps = props;
                        return 'fallback';
                    },
                },
            });

            expect(slotProps?.componentProps).toEqual({ userId: 7 });
        });
    });
```

- [ ] **Step 6.3: Verify the tests fail**

Run: `cd packages/vue && npx vitest run FlareErrorBoundary`
Expected: FAIL — no `attachProps` prop exists, `componentProps` is always provided, fallback slot always includes the key.

- [ ] **Step 6.4: Update `packages/vue/src/FlareErrorBoundary.ts`**

Replace the entire file with:

```ts
import { flare } from '@flareapp/js';
import type { ComponentPublicInstance, PropType } from 'vue';
import { defineComponent, getCurrentInstance, onErrorCaptured, ref, watch } from 'vue';

import { buildComponentHierarchy } from './buildComponentHierarchy';
import { buildComponentHierarchyFrames } from './buildComponentHierarchyFrames';
import { convertToError } from './convertToError';
import { getComponentName } from './getComponentName';
import { getErrorOrigin } from './getErrorOrigin';
import { getRouteContext } from './getRouteContext';
import { serializeProps } from './serializeProps';
import { ComponentHierarchyFrame, FlareErrorBoundaryHookParams, FlareVueContext } from './types';

export const FlareErrorBoundary = defineComponent({
    name: 'FlareErrorBoundary',

    props: {
        beforeEvaluate: {
            type: Function as PropType<(params: FlareErrorBoundaryHookParams) => void>,
            default: undefined,
        },
        beforeSubmit: {
            type: Function as PropType<
                (params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => FlareVueContext
            >,
            default: undefined,
        },
        afterSubmit: {
            type: Function as PropType<(params: FlareErrorBoundaryHookParams & { context: FlareVueContext }) => void>,
            default: undefined,
        },
        onReset: {
            type: Function as PropType<(error: Error | null) => void>,
            default: undefined,
        },
        resetKeys: {
            type: Array as PropType<unknown[]>,
            default: undefined,
        },
        attachProps: {
            type: Boolean,
            default: false,
        },
        propsMaxDepth: {
            type: Number,
            default: 2,
        },
    },

    setup(props, { slots }) {
        const currentInstance = getCurrentInstance();
        const error = ref<Error | null>(null);
        const componentProps = ref<Record<string, unknown> | undefined>(undefined);
        const componentHierarchy = ref<string[]>([]);
        const componentHierarchyFrames = ref<ComponentHierarchyFrame[]>([]);

        const resetErrorBoundary = () => {
            props.onReset?.(error.value);

            error.value = null;
            componentProps.value = undefined;
            componentHierarchy.value = [];
            componentHierarchyFrames.value = [];
        };

        watch(
            () => props.resetKeys,
            (nextKeys, prevKeys) => {
                if (error.value === null || !nextKeys) {
                    return;
                }

                const lengthChanged = prevKeys?.length !== nextKeys.length;
                const valuesChanged = nextKeys.some((key, i) => !Object.is(key, prevKeys?.[i]));

                if (lengthChanged || valuesChanged) {
                    resetErrorBoundary();
                }
            }
        );

        onErrorCaptured((currentError: unknown, instance: ComponentPublicInstance | null, info: string) => {
            const errorToReport = convertToError(currentError);

            props.beforeEvaluate?.({ error: errorToReport, instance, info });

            const hierarchy = buildComponentHierarchy(instance);
            const hierarchyFrames = buildComponentHierarchyFrames(instance, {
                attachProps: props.attachProps,
                propsMaxDepth: props.propsMaxDepth,
            });
            const componentName = getComponentName(instance);

            error.value = errorToReport;

            const instanceProps = props.attachProps && instance?.$props
                ? serializeProps(instance.$props, props.propsMaxDepth)
                : undefined;

            const errorOrigin = getErrorOrigin(info);

            const route = getRouteContext(currentInstance?.appContext.config.globalProperties.$router);

            const context: FlareVueContext = {
                vue: {
                    info,
                    errorOrigin,
                    componentName,
                    ...(instanceProps && { componentProps: instanceProps }),
                    componentHierarchy: hierarchy,
                    componentHierarchyFrames: hierarchyFrames,
                    ...(route && { route }),
                },
            };

            const finalContext = props.beforeSubmit?.({ error: errorToReport, instance, info, context }) ?? context;

            componentProps.value = finalContext.vue.componentProps;
            componentHierarchy.value = finalContext.vue.componentHierarchy;
            componentHierarchyFrames.value = finalContext.vue.componentHierarchyFrames;

            flare.report(errorToReport, finalContext, { vue: { instance, info } });

            props.afterSubmit?.({ error: errorToReport, instance, info, context: finalContext });

            // Prevent the error from propagating to app.config.errorHandler (set by flareVue()),
            // so the error is only reported to Flare once when both are used together.
            return false;
        });

        return () => {
            if (error.value !== null) {
                if (slots.fallback) {
                    return slots.fallback({
                        error: error.value,
                        ...(componentProps.value !== undefined && { componentProps: componentProps.value }),
                        componentHierarchy: componentHierarchy.value,
                        componentHierarchyFrames: componentHierarchyFrames.value,
                        resetErrorBoundary,
                    });
                }

                return null;
            }

            return slots.default?.();
        };
    },
});
```

- [ ] **Step 6.5: Verify the tests pass**

Run: `cd packages/vue && npx vitest run FlareErrorBoundary`
Expected: PASS — all existing (updated) tests plus the 5 new `attachProps` tests.

- [ ] **Step 6.6: Run the full vue suite and typecheck**

Run: `npm run test --workspace=@flareapp/vue`
Expected: PASS — every vue test.

Run: `npm run typescript`
Expected: no errors anywhere in the workspace.

Run: `npm run test`
Expected: all workspaces pass.

- [ ] **Step 6.7: Commit Tasks 3–6 as one logical change**

```bash
git status  # sanity-check: only 7 files should be modified

git add \
    packages/vue/src/types.ts \
    packages/vue/src/buildComponentHierarchyFrames.ts \
    packages/vue/src/flareVue.ts \
    packages/vue/src/FlareErrorBoundary.ts \
    packages/vue/tests/buildComponentHierarchyFrames.test.ts \
    packages/vue/tests/flareVue.test.ts \
    packages/vue/tests/FlareErrorBoundary.test.ts

git commit -m "feat: opt-in props capture with depth-limited serialization"
```

`index.ts` was already staged and committed in Task 2 — do not re-stage it here. If `git status` still shows `index.ts` modified, something went wrong; stop and investigate before committing.

Run `git log -1 --format="%s%n%b"` and confirm no AI attribution.

---

## Task 7: `vue-router` optional peer dependency

**Files:**
- Modify: `packages/vue/package.json`

- [ ] **Step 7.1: Update `packages/vue/package.json`**

Add `vue-router` under `peerDependencies` and mark it optional. After the change, the relevant region should read:

```json
    "peerDependencies": {
        "@flareapp/js": "^1.0.0",
        "vue": "^3.0.0",
        "vue-router": "^4.0.0"
    },
    "peerDependenciesMeta": {
        "vue-router": {
            "optional": true
        }
    },
```

Insert `peerDependenciesMeta` after `peerDependencies`, before `publishConfig`. Do NOT change the `version` field.

- [ ] **Step 7.2: Verify npm still installs cleanly**

Run: `npm install`
Expected: no errors, no unexpected warnings. `package-lock.json` may or may not change; if it does, include it in the commit.

- [ ] **Step 7.3: Re-run the vue tests**

Run: `npm run test --workspace=@flareapp/vue`
Expected: PASS — no behavioral change from a peer-meta update.

- [ ] **Step 7.4: Commit**

```bash
git status  # confirm only package.json (and maybe package-lock.json) changed
git add packages/vue/package.json
# Only stage package-lock.json if git status actually shows it modified:
[ -n "$(git status --porcelain package-lock.json)" ] && git add package-lock.json
git commit -m "chore: declare vue-router as optional peer dependency"
```

---

## Task 8: Playground demonstration of `attachProps`

**Files:**
- Identified during the task: an appropriate file under `playground/src/vue/`

- [ ] **Step 8.1: Identify the vue playground entry that hosts existing error-triggering UI**

Run: `rg "FlareErrorBoundary|flareVue" playground/src -n`

Pick the component that already has error-triggering buttons (the same pattern used for the existing playground tests). That file is the target for Step 8.2.

- [ ] **Step 8.2: Add an `attachProps` demo**

Add a child component (a new `.vue` file or an inline component, matching the surrounding file-layout pattern) that:

- Accepts a prop `config` with the shape:
  ```ts
  {
      theme: 'dark' | 'light';
      nested: { layers: { a: number; b: number } };
      onClick: () => void;
  }
  ```
- Throws inside `setup()` with `throw new Error('attachProps demo error')`.

Wrap this child in a `<FlareErrorBoundary :attach-props="true" :props-max-depth="2">` and render the fallback slot's `componentProps` with `<pre>{{ JSON.stringify(componentProps, null, 2) }}</pre>`.

Pass a `config` value to the child that has at least three levels of nesting so the third level collapses to `"[Object]"`.

- [ ] **Step 8.3: Manually verify in the browser**

Run from repo root: `npm run playground`

Navigate to the vue page, trigger the demo error. Confirm the rendered `componentProps` JSON contains (depending on how you name the prop):

```json
{
  "config": {
    "theme": "dark",
    "nested": { "layers": "[Object]" },
    "onClick": "[Function]"
  }
}
```

If `attachProps` is toggled off (edit source, reload), confirm the fallback renders without the `componentProps` pre-block at all.

If the behavior doesn't match, stop and debug rather than adjusting the test to accommodate.

- [ ] **Step 8.4: Commit**

```bash
git status  # confirm only playground files changed, and nothing under docs/superpowers/
git add playground/src/vue/<exact files changed>
git commit -m "tests: add attachProps demo to vue playground"
```

---

## Task 9: Final verification and independent review

- [ ] **Step 9.1: Full verification sweep per `superpowers:verification-before-completion`**

Run from repo root:

```bash
npm run test
npm run typescript
npm run format
npm run build
```

Expected: all four succeed. `npm run format` should leave a clean tree (no pending Prettier diffs).

- [ ] **Step 9.2: Inspect `git status` and `git log`**

```bash
git status
git log --oneline -8
```

Expected:
- `git status` shows a clean tree except for `docs/` (untracked, staying that way).
- Each commit subject uses `feat:` / `fix:` / `chore:` / `tests:`.
- Run `git log --format="%an %s%n%b" -8` and visually confirm: no `Co-Authored-By`, no `Claude`, no `Generated with`, no `Anthropic` anywhere.

If any commit has AI attribution: stop. Report to the user and ask before rewriting history.

- [ ] **Step 9.3: Invoke `superpowers:requesting-code-review`**

Use the `Skill` tool with `superpowers:requesting-code-review`. Ask the reviewer to:

1. Confirm the original gaps (attachProps missing, warn handler schema mismatch, vue-router peer, frame.props optionality) were real at commit `cbaa65b` (the branch tip before this work).
2. Verify the final implementation matches the spec at `docs/superpowers/specs/2026-04-20-vue-props-capture-warn-handler-alignment-design.md`.
3. Flag any adjacent issue that was missed: unused imports, dead branches, tests that only exercise happy paths, missing edge cases for the serializer (especially around Vue reactive proxies, which weren't covered by unit tests).
4. Confirm no commits carry AI attribution.

Pass the reviewer the branch tip and the spec path. Capture the review output verbatim.

- [ ] **Step 9.4: Address review findings**

For each finding:
- Fix inline.
- Re-run `npm run test && npm run typescript`.
- Commit with a `fix:` subject.

If a finding is a genuine disagreement (reviewer suggests something the spec explicitly rejects, or the reviewer misreads code), bring it back to the user rather than silently pushing back.

- [ ] **Step 9.5: Hand off**

Report to the user:
- The commits added (subjects only, in order).
- Spec satisfaction confirmation.
- Note that the version bump in `packages/vue/package.json` is still deferred as requested.
- Note that the spec and plan files under `docs/superpowers/` remain untracked per the user's preference.

---

## Self-review checklist (plan author's notes)

- **Spec coverage:**
  - § Public API → Task 3 (types) + Tasks 5, 6 (call sites).
  - § Serializer behavior → Task 1.
  - § Callers → Tasks 4, 5, 6.
  - § Warn handler alignment → Task 2.
  - § Package metadata → Task 7.
  - § Testing → Tasks 1, 2, 4, 5, 6.
  - § Validation → Task 9.
  - § Out-of-scope items respected (no version bump, no README).
- **Placeholder scan:** no `TBD`/`TODO`/`fill in later` in steps. Task 8 has a "pick the right playground file" step, but it is constrained by an `rg` command and explicit rendering assertions.
- **Type consistency:** `BuildComponentHierarchyFramesOptions` used only in its own module; call sites pass inline literals that match. `FlareVueWarningContext` is introduced in Task 2 (types.ts + index.ts + flareVue.ts import). `serializeProps` signature is identical at all call sites.
- **Commit hygiene:**
  - Each commit step lists exact paths; no `-A`, no `.`.
  - No `Co-Authored-By` or AI attribution anywhere.
  - No commit stages anything under `docs/superpowers/`.
  - Task 2 and Task 6 commits do not overlap (Task 2 stages `types.ts`/`index.ts` for the warning type; Task 6 stages `types.ts` again with the attachProps-related type changes — verified acceptable because the file is modified twice in sequence and each commit represents a coherent type-surface change).
