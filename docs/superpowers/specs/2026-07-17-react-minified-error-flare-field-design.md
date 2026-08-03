# Move the React minified error to `flare.exception.react_minified_error`

Date: 2026-07-17
Package: `@flareapp/react`
Supersedes the reporting destination chosen in `2026-06-08-decode-minified-react-errors-design.md`.

## Problem

`2026-06-08-decode-minified-react-errors-design.md` shipped in `@flareapp/react@2.6.0`
(feature commit `61ccaa3`, released 2026-06-30). It parses a production React error
message into structured fields and reports them at:

```
context.custom.react.minifiedError = { number, args, url }
context.custom.react.version       = "19.0.0"
```

`context.custom` is the user-visible display namespace. Everything a consumer puts
there via `addContext` / `addContextGroup` is rendered as context in the Flare UI.
`minifiedError` is not context: it is plumbing for a backend decode step, and it has
no meaning to the person reading the report. It should be a field only Flare reads.

The backend has not been built against the current field yet, so there is no consumer
to keep working. We move rather than dual-write.

## Decision

Emit one atomic, self-contained attribute, only when the error parses as a minified
React error:

```js
'flare.exception.react_minified_error': {
    number: 418,
    args: ['Foo', 'Bar'],
    url: 'https://react.dev/errors/418?args[]=Foo&args[]=Bar',
    react_version: '19.0.0',
}
```

`context.custom.react` keeps `componentStack`, `componentStackFrames` and `version`
unchanged. Only `minifiedError` leaves it.

### Why these choices

**`flare.*` namespace.** Proposed by the backend. It already exists and is already
the de facto internal namespace: `flare.language.name`, `flare.framework.name`,
`flare.entry_point.type`. `context.*` is the display namespace. The split is
convention, documented nowhere central, but consistent across the codebase.

**One key holding an object, not a prefix of flat keys.** Every existing `flare.*`
key is a flat dotted scalar, so this deviates. Justified: the backend gates on
presence of the field to decide whether to decode, and an atomic key is either
wholly present or wholly absent — no partial state to reason about. `args` is an
array regardless, so a flat shape would not actually be flat. Nesting is safe on
this path: `AttributeValue` is recursive (`packages/core/src/types.ts:3-5`) and the
errors path serializes via `flatJsonStringify`, which despite its name does not
flatten — it only decycles (`packages/core/src/util/flatJsonStringify.ts:4-6`).

**Merge safety.** `assembleAttributes` (`packages/core/src/Flare.ts:495-548`) merges
attribute sources with a _shallow_ spread. Core hand-writes a one-level deep merge
for exactly one key, `context.custom` (`Flare.ts:521-538`), because both scope and
integrations write to it. `flare.exception.react_minified_error` has a single
producer — this package — so the shallow spread is correct and no deep-merge special
case is needed. If a second producer ever writes this key, revisit.

**snake_case interior.** This object is a backend-read wire contract, so it follows
the backend-facing convention of the key it lives under, not the camelCase used by
JS-facing payload interiors under `context.custom` (`componentStackFrames`). Only
`react_version` is affected; `number`, `args` and `url` are single words. The
`MinifiedReactError` type therefore needs no rename.

**`react_version` bundled into the field.** The backend cannot decode `#418` from
the number alone — it needs the React version to select the matching `codes.json`,
since templates drift across majors. Bundling it makes the field self-sufficient:
the backend reads one key, and the field never depends on a display value a consumer
can strip. `context.custom.react.version` stays for UI display. The duplicated
version string is the intended cost.

## Components

### 1. `types.ts`

Remove `minifiedError` from `FlareReactContext`:

```ts
export type FlareReactContext = {
    react: {
        componentStack: string[];
        componentStackFrames: ComponentStackFrame[];
        version?: string;
    };
};
```

`MinifiedReactError` (`{ number, args, url }`) keeps its current shape and stays
exported from `index.ts`, so existing type imports still compile.

### 2. `buildReactContext.ts`

Signature drops to `buildReactContext(rawStack: string)`. Drops the
`parseMinifiedReactError` import — it no longer builds a field it does not own.

```ts
export function buildReactContext(rawStack: string): FlareReactContext {
    return {
        react: {
            componentStack: formatComponentStack(rawStack),
            componentStackFrames: parseComponentStack(rawStack),
            version,
        },
    };
}
```

### 3. `contextToAttributes.ts`

```ts
import { version } from 'react';

export function contextToAttributes(context: FlareReactContext, minifiedError?: MinifiedReactError | null): Attributes {
    return {
        'context.custom': {
            react: {
                componentStack: context.react.componentStack as AttributeValue,
                componentStackFrames: context.react.componentStackFrames as AttributeValue,
                ...(context.react.version ? { version: context.react.version as AttributeValue } : {}),
            },
        },
        ...(minifiedError
            ? {
                  'flare.exception.react_minified_error': {
                      number: minifiedError.number,
                      args: minifiedError.args,
                      url: minifiedError.url,
                      react_version: version,
                  } as AttributeValue,
              }
            : {}),
    };
}
```

**`react_version` reads the `version` imported from `react`, NOT
`context.react.version`.** This is load-bearing, not incidental. Reading it off the
context would re-couple the internal field to a value a `beforeSubmit` hook can
strip, which is the failure this design exists to prevent. Do not "simplify" it.

When there is no minified error the key is absent entirely, not present-and-empty.

### 4. Call sites

`FlareErrorBoundary.componentDidCatch` and `flareReactErrorHandler` both already
hold `error`, so nothing new is threaded through:

```ts
const context = buildReactContext(rawStack);

const finalContext = beforeSubmit?.({ error, errorInfo, context }) ?? context;

flare.reportSilently(error, contextToAttributes(finalContext, parseMinifiedReactError(error)));
```

## Data flow change

Today the parse happens inside `buildReactContext`, _before_ `beforeSubmit`. Since
`beforeSubmit` returns a **replacement** `FlareReactContext` and the call sites only
fall back on an `undefined` return (`?? context`), a hook returning a fresh literal
— a normal thing to do when scrubbing a component stack — silently drops
`minifiedError` and silently breaks the backend decode.

After this change the parse happens at the report call, _after_ `beforeSubmit`, on
the original `error` object. The internal field cannot be dropped by a user hook,
and `beforeSubmit` keeps full control of what it should control: the display context.

No opt-out is added. Nobody has asked to suppress this field; YAGNI until they do.

## Testing

- `parseMinifiedReactError.test.ts` — untouched. Pure function, unchanged.
- `buildReactContext.test.ts` — drop the two `minifiedError` tests and the `error`
  argument. Version and component-stack tests stay.
- `contextToAttributes.test.ts` — rework:
    - minified error passed → `flare.exception.react_minified_error` with `number`,
      `args`, `url` and a non-empty string `react_version`.
    - not passed → key absent entirely.
    - `context.custom.react` never carries `minifiedError` in either case.
    - `react_version` is populated even when `context.react.version` is absent
      (i.e. a `beforeSubmit` literal that omitted it) — this pins the decoupling.
- `FlareErrorBoundary.test.tsx` and `flareReactErrorHandler.test.ts` — each has a
  `describe('minified React errors')` block with two tests asserting against
  `context.custom`; repoint both to the new key. Add one test per file: a
  `beforeSubmit` returning a fresh context literal still yields
  `flare.exception.react_minified_error` in the reported attributes. These are the
  only tests that exercise the real hook-then-report path, so the unstrippability
  property belongs here.
- `e2e/specs/react-prod.spec.ts` — drives a genuine production `react-dom` invariant,
  so it is the only test proving the field survives a real minified throw. Repoint
  the `reactContextOf` helper from `attributes['context.custom'].react` to
  `attributes['flare.exception.react_minified_error']`, and move the
  `react.version` assertion onto the field's `react_version`.
- `packages/react/README.md` — update the documented field location.

## Release

Lockstep minor: 2.6.0 -> 2.7.0 across `js`, `react`, `vue`, `svelte`, `webpack`,
`vite`, `sveltekit`, `nextjs` (`scripts/release-all.mjs:41`).

Removing an optional field from a public type is strictly breaking, and CLAUDE.md
says breaking -> major. Treated as minor deliberately: the field is ~2 weeks old,
optional, never had a backend consumer, and `MinifiedReactError` stays exported so
type imports still compile. A major would drag seven packages with no changes of
their own to 3.0.0 and trigger a `peerDependencies` audit across the integrations —
disproportionate to one optional field. Call the relocation out in the release notes.

## Risk

The field name, interior casing and `react_version` are a cross-repo wire contract.
The backend has not written the reader yet, so a rename now is free and a rename
later is a coordinated release across two repos. Confirm the shape with the backend
dev before shipping.

## Out of scope

- The backend `codes.json` lookup and interpolation.
- Global `window.onerror` in `@flareapp/js` (unchanged from the 2026-06-08 design:
  keeping React-specific regex out of the framework-agnostic core).
- `vue` / `svelte` / `sveltekit` — no minified-error concept.
- A general `flare.exception.*` convention or a shared `contextToAttributes` helper.
  Four packages hand-write their own today; consolidating is not in service of this
  change.
