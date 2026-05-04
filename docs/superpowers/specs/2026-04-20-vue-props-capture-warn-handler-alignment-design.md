# Vue package: props capture and warn handler alignment

## Context

`.claude/docs/projects-vue-improvements.md` lists every Vue improvement as checked off, but three parts of the implementation do not match what the doc specifies:

1. **Props capture is not opt-in.** The doc specifies an `attachProps` option (default `false`) and a `propsMaxDepth` option (default `2`). Neither exists in the code. `packages/vue/src/flareVue.ts:22` and `packages/vue/src/FlareErrorBoundary.ts:84` shallow-clone `instance.$props` unconditionally, which leaks whatever is in props on every reported error.
2. **Warn handler payload schema differs from the doc.** `packages/vue/src/flareVue.ts:62-66` sends `{ message, componentName, trace }`. The doc specifies `{ type: 'warning', info, componentName, componentTrace }`. The `captureWarnings` feature was added in commit `773edf9` and has not been released, so this is a clean rename, not a migration.
3. **Two minor items** carried forward with the above fixes: `vue-router` is auto-detected but not declared as an optional peer dependency in `packages/vue/package.json`, and `ComponentHierarchyFrame.props` is typed as `Record<string, unknown> | null` rather than an optional field (needed once props capture is opt-in).

This spec covers all three as a single change set, since they all align existing code with the already-approved Vue improvements doc.

## Goals

- Make props capture strictly opt-in, gated by a single `attachProps` flag that applies to both the erroring component's props and every `componentHierarchyFrames[].props`.
- Serialize captured props with a depth limit and explicit sentinels for functions, symbols, circular references, and non-plain objects.
- Align the warn handler payload with the schema in the Vue improvements doc.
- Declare `vue-router` as an optional peer.
- Update types to match the new shape (optional `props` on frames, etc.).

## Non-goals

- No version bump. The user has explicitly paused on publishing.
- No README changes. There is a separate docs site for consumer-facing documentation.
- No changes to `packages/react` or core `@flareapp/js`. The serializer stays Vue-local.
- No change to how component hierarchies are built (names, files, traversal) beyond gating the `props` field.

## Public API

### `flareVue()` options

```ts
type FlareVueOptions = {
    beforeEvaluate?: (params: { error: Error; instance: ComponentPublicInstance | null; info: string }) => void;
    beforeSubmit?: (params: {
        error: Error;
        instance: ComponentPublicInstance | null;
        info: string;
        context: FlareVueContext;
    }) => FlareVueContext;
    afterSubmit?: (params: {
        error: Error;
        instance: ComponentPublicInstance | null;
        info: string;
        context: FlareVueContext;
    }) => void;
    captureWarnings?: boolean;
    attachProps?: boolean;      // default: false
    propsMaxDepth?: number;     // default: 2
};
```

### `<FlareErrorBoundary>` props

Two new props, same semantics:

```ts
type FlareErrorBoundaryProps = {
    // ...existing props (beforeEvaluate, beforeSubmit, afterSubmit, onReset, resetKeys)
    attachProps?: boolean;      // default: false
    propsMaxDepth?: number;     // default: 2
};
```

No propagation across the boundary: if a `<FlareErrorBoundary>` catches an error and returns `false` from `onErrorCaptured`, `flareVue`'s handler never runs, so each caller configures its own capture independently.

### Types

`packages/vue/src/types.ts`:

- `ComponentHierarchyFrame.props: Record<string, unknown> | null` → `props?: Record<string, unknown>`.
- `FlareVueContext['vue'].componentProps` must be optional (`componentProps?: Record<string, unknown>`). If the current type declares it non-optional, change it here.
- New exported type `FlareVueWarningContext`:

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

Re-export from `packages/vue/src/index.ts`.

## Serializer

New file `packages/vue/src/serializeProps.ts`. Pure function:

```ts
export function serializeProps(value: Record<string, unknown>, maxDepth: number): Record<string, unknown>;
```

Only ever called with `instance.$props` (a plain record). Internal recursion handles nested values.

### Sentinel table

| Input                                                        | Output          |
|--------------------------------------------------------------|-----------------|
| primitive (`string`, `number`, `boolean`, `null`, `undefined`, `bigint`) | as-is |
| `function`                                                   | `"[Function]"`  |
| `symbol`                                                     | `"[Symbol]"`    |
| object or array already seen in the current ancestor chain   | `"[Circular]"`  |
| plain `Array` at depth `< maxDepth`                          | recurse         |
| plain object at depth `< maxDepth`                           | recurse         |
| plain `Array` at depth `>= maxDepth`                         | `"[Array]"`     |
| plain object at depth `>= maxDepth`                          | `"[Object]"`    |
| any non-plain object (Date, RegExp, Map, Set, class instance, DOM node, Vue reactive proxy, etc.) | `"[Object]"` at any depth |

### Depth counting

`maxDepth` is the maximum recursion depth allowed when descending into nested objects/arrays. The top-level props record is depth 0; its direct values are at depth 1; values one level deeper are at depth 2; and so on. An object or array at depth `d` is recursed into when `d <= maxDepth` and replaced with `"[Object]"` / `"[Array]"` when `d > maxDepth`. Primitives are never replaced.

Worked examples with `propsMaxDepth: 2`:

- `{ a: { b: { c: 1 } } }` → `{ a: { b: { c: 1 } } }` — every object is at depth ≤ 2; `c`'s value is a primitive.
- `{ a: { b: { c: { d: 1 } } } }` → `{ a: { b: { c: "[Object]" } } }` — the object at depth 3 collapses.
- `{ a: 1 }` → `{ a: 1 }` — primitives stay at any depth.

Worked examples with `propsMaxDepth: 1`:

- `{ a: { b: 1 } }` → `{ a: { b: 1 } }` — recursing into `{b:1}` at depth 1 only reaches primitives.
- `{ a: { b: { c: 1 } } }` → `{ a: { b: "[Object]" } }` — `{c:1}` is at depth 2, which is > 1.

Worked example with `propsMaxDepth: 0`:

- `{ a: { b: 1 }, n: 1 }` → `{ a: "[Object]", n: 1 }` — any object at depth 1 collapses; primitives stay.

### Plain-object check

A value is a "plain object" when `Object.getPrototypeOf(value) === Object.prototype` or `null`. Arrays are detected via `Array.isArray`. Everything else is non-plain and collapses to `"[Object]"`.

Rationale: Vue's reactive proxies are transparent to property access but can contain internal reactivity traps; class instances may have custom `toJSON` that we don't want to trigger; DOM nodes are huge and unsafe to walk. Collapsing them keeps the serializer predictable.

### Circular detection

A `WeakSet` is threaded through recursion. Before recursing into an object or array, the serializer checks membership; if present, emit `"[Circular]"`. After the subtree is serialized, the entry can be removed (not strictly necessary, but cleaner for diamond shapes where the same object appears in multiple subtrees without being circular).

### Functions and symbols as object keys

Symbol-keyed properties are not serialized (consistent with `JSON.stringify`). String-keyed properties whose value is a function become `"[Function]"` in the output (the key is preserved, the value becomes the sentinel).

## Callers

Three call sites, all gated on `attachProps`:

### `packages/vue/src/flareVue.ts`

```ts
const { attachProps = false, propsMaxDepth = 2 } = options ?? {};

const componentProps = attachProps && instance?.$props
    ? serializeProps(instance.$props, propsMaxDepth)
    : undefined;

const componentHierarchyFrames = buildComponentHierarchyFrames(instance, { attachProps, propsMaxDepth });

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
```

### `packages/vue/src/FlareErrorBoundary.ts`

Same pattern: pull `attachProps` / `propsMaxDepth` from props (with the same defaults), serialize `componentProps` through the helper, pass the options into `buildComponentHierarchyFrames`. The fallback slot's `componentProps` ref is set to `finalContext.vue.componentProps` (which may be `undefined` — update the slot types accordingly so consumers destructure safely).

### `packages/vue/src/buildComponentHierarchyFrames.ts`

New second parameter:

```ts
export function buildComponentHierarchyFrames(
    instance: ComponentPublicInstance | null,
    options: { attachProps: boolean; propsMaxDepth: number },
): ComponentHierarchyFrame[];
```

Inside, for each frame:

```ts
const frame: ComponentHierarchyFrame = {
    component: getComponentName(current),
    file: current.$options.__file ?? null,
};

if (options.attachProps && current.$props) {
    frame.props = serializeProps(current.$props, options.propsMaxDepth);
}

frames.push(frame);
```

No default values for the options — callers always supply them. This forces every consumer of `buildComponentHierarchyFrames` to think about props capture explicitly.

## Warn handler alignment

`packages/vue/src/flareVue.ts`, warn handler block:

```ts
app.config.warnHandler = (msg: string, instance: ComponentPublicInstance | null, trace: string) => {
    const componentName = getComponentName(instance);
    const route = getRouteContext(app.config.globalProperties.$router);

    flare.reportMessage(
        msg,
        {
            vue: {
                type: 'warning',
                info: msg,
                componentName,
                componentTrace: trace,
                ...(route && { route }),
            },
        },
        'VueWarning',
    );

    if (typeof initialWarnHandler === 'function') {
        initialWarnHandler(msg, instance, trace);
    }
};
```

Rename `message` → `info`, `trace` → `componentTrace`, add `type: 'warning'`. No backward-compat branch.

## Package metadata

`packages/vue/package.json`:

- Keep `vue` under `peerDependencies`.
- Add `vue-router` to `peerDependencies` and mark it optional via `peerDependenciesMeta`:

```json
"peerDependencies": {
    "@flareapp/js": "^1.0.0",
    "vue": "^3.0.0",
    "vue-router": "^4.0.0"
},
"peerDependenciesMeta": {
    "vue-router": { "optional": true }
}
```

No version bump in this change set.

## Testing

Per `superpowers:test-driven-development`, tests come first.

1. **`packages/vue/tests/serializeProps.test.ts`** (new file, pure unit tests):
   - Primitives pass through untouched
   - Functions → `"[Function]"`
   - Symbols → `"[Symbol]"`
   - Plain nested objects recurse up to `maxDepth`
   - Plain nested arrays recurse up to `maxDepth`
   - Object at `maxDepth` → `"[Object]"`
   - Array at `maxDepth` → `"[Array]"`
   - Direct self-reference → `"[Circular]"`
   - Indirect self-reference through two hops → `"[Circular]"`
   - Diamond shape (same object in two siblings, no cycle) → serialized twice, not marked circular
   - Date / RegExp / Map / Set → `"[Object]"`
   - `Object.create(null)` → recurses (prototype is `null`, treated as plain)
   - Class instance → `"[Object]"`
   - `maxDepth: 0` → every value at depth 1 is a sentinel
   - Mixed tree combining the above cases

2. **`packages/vue/tests/flareVue.test.ts`** additions:
   - Default (`attachProps` not set) → payload has no `componentProps` and every `frame.props` is absent
   - `attachProps: true` → `componentProps` present and serialized
   - `attachProps: true` with nested object exceeding `propsMaxDepth: 1` → deep values sentinelized
   - `attachProps: true` with `propsMaxDepth: 0` → all prop values become sentinels
   - Warn handler emits new schema: `type: 'warning'`, `info`, `componentName`, `componentTrace`
   - Warn handler includes `route` when router is present

3. **`packages/vue/tests/FlareErrorBoundary.test.ts`** additions (via `@vue/test-utils`):
   - `attachProps` prop default omits props from payload and from fallback slot
   - `attachProps: true` passes serialized props into fallback slot
   - `propsMaxDepth` prop overrides the default

4. **`packages/vue/tests/buildComponentHierarchyFrames.test.ts`** additions:
   - Options required (compile-time — caught by TS)
   - `attachProps: false` → no frame has a `props` field
   - `attachProps: true` → every frame with `$props` has a serialized `props` field
   - `propsMaxDepth` is forwarded to the serializer

5. **Playground** (`playground/src/vue/`): add a toggle / example exercising `attachProps: true` with a deeply nested prop so the behavior is visible in the dev UI. Not required for correctness but good to have for manual verification.

## Validation

After implementation, invoke `superpowers:requesting-code-review` against the diff. The reviewer's job: confirm (a) the original findings were real, (b) the implementation matches this spec, (c) nothing adjacent was missed. This is the "let superpowers validate what you say" step from the user's request.

Additional verification before claiming done (per `superpowers:verification-before-completion`):
- `npm run test` passes from repo root
- `npm run typescript` passes from repo root
- `npm run format` leaves a clean tree
- `npm run build` for the vue package succeeds
- Playground loads, error capture still works with and without `attachProps`

## Out of scope / deferred

- Version bump for `@flareapp/vue`
- Consumer-facing documentation (separate docs site)
- Back-porting any of these options to `packages/react` (React cannot reach component instances the same way)
- Backend dashboard work for rendering the new sentinels (backend task, not frontend)

## Process notes

- This spec file lives under `docs/superpowers/specs/` but is not committed. It is a working artifact.
- No implementation plan has been generated yet; next step is `superpowers:writing-plans`.
