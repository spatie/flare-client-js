# Alpine.js error capture

- Date: 2026-08-20
- Status: design approved, not implemented
- Revised: 2026-08-21, after a probe measured Alpine 3.16.2 in jsdom
- Deliverable: `@flareapp/js/alpine`

## Summary

Add a subpath export `@flareapp/js/alpine` that holds one function, `flareAlpine(Alpine, options?)`.
The function installs a Flare error handler on Alpine with `Alpine.setErrorHandler`. Alpine expression
errors then reach Flare with the element and the expression as structured context.

This is error capture only. It adds no tracing and no spans.

## Why

Alpine routes every expression error through one internal function, `handleError`. The default handler
does three things. It assigns `el` and `expression` onto the error object. It writes a `console.warn`.
It rethrows the error inside `setTimeout(..., 0)`.

Flare sees that rethrow through the global `error` listener in
`packages/js/src/browser/catchWindowErrors.ts`. This works today, but it loses information and it drops
some errors completely.

There are three gains. Each one is measured against what Flare receives today, and that depends on the
shape of the expression. Read "Alpine leaks a second rejection" below before you read these.

1. **Errors that Flare drops today start to arrive.** The `error` listener in `catchWindowErrors`
   reports only when `event.error instanceof Error`. Alpine builds its rethrow value with
   `Object.assign(error ?? { message: '...' }, { el, expression })`, so a plain object stays a plain
   object and the listener drops it. `x-on:click="doWork"`, where `doWork` is a method that rejects with
   a plain object, produces no report at all today.
2. **The element and the expression reach the backend.** Alpine puts both on the error object. The Flare
   serializer does not read arbitrary error properties, so both are lost. A custom handler can put them
   in `context.custom.alpine`.
3. **One report for each error.** The handler does not rethrow, so the `error` listener never sees a
   second copy. The other half of this gain is the leaked rejection, and that one needs
   `markRejectionReported`.

## What this does not do

This does not improve stack traces.

Alpine compiles each expression with `new AsyncFunction(...)` and renames the generated function to
`[Alpine] ${expression}`. The stack is captured when the error is constructed, inside that generated
function. The `setTimeout` rethrow does not rewrite the stack. A custom handler receives the same error
object with the same stack.

There is no Blade file and no line number in the stack, before or after this change. Source locations for
Blade need a server-side part that writes them into the DOM. That work belongs to the parked Livewire
slice.

## Verified constraints

**Alpine 3.15.2 is the version floor.** `setErrorHandler` came from
[alpinejs/alpine#4673](https://github.com/alpinejs/alpine/pull/4673), merged on 1 November 2025. The
published bundle of `3.15.1` does not contain the symbol. The bundle of `3.15.2` (15 November 2025) does.
The latest version at the time of writing is `3.16.2`.

**Chaining is impossible.** Alpine exports `setErrorHandler` and nothing else. There is no getter for the
current handler, and `normalErrorHandler` is not exported. We cannot read the handler that we replace.
The pattern in `flareVue`, which captures the previous handler and calls it, does not transfer. We
replace the handler, the last writer wins, and we reimplement the `console.warn` ourselves.

**The third argument is not always a string.** In the 3.16.2 bundle, `runIfTypeOfFunction` calls
`handleError(error, el, value)` where `value` is a function, not an expression string. A plain
`String(expression)` writes a whole function body into the report.

**Alpine leaks a second rejection, and Flare reports it twice.** Measured against Alpine 3.16.2 in
jsdom.

An expression can call an async method in its called form, for example `x-on:click="doWork()"`. Alpine
then gives the rejection to two consumers, and only one of them catches it. The generated
`AsyncFunction` body is `__self.result = doWork(); __self.finished = true`. Nothing awaits the method
there, so `finished` is true while `result` is still a pending promise. Alpine takes the synchronous
branch and calls `runIfTypeOfFunction`, which does `value.then((i) => receiver(i))` with no `catch`. At
the same time the outer promise adopts the same rejection, and its `.catch` calls `handleError`. One
rejection, one call to the error handler, one unhandled rejection.

This is Alpine's behaviour, not ours. It happens with the default handler too. Today it makes Flare send
two reports for that shape: one from the `setTimeout` rethrow through the `error` listener, one from the
leak through the `unhandledrejection` listener. Replacing the handler removes the rethrow but not the
leak, so the count stays at two unless we do more.

The probe measured these shapes:

- Called form of an async method, `doWork()`: the handler runs, and the rejection leaks.
- Bare reference, `doWork`: the handler runs, and nothing leaks.
- `await doWork()` inside the expression: the handler runs, and nothing leaks.
- A synchronous throw: the handler runs, and nothing leaks.
- The handler always runs before the host treats the rejection as unhandled.

The last line is what makes a fix possible. The handler marks the raw value that Alpine gave it, through
a new `markRejectionReported` in `@flareapp/core`. `routeRejection` then skips a marked value. The mark
lives in a `WeakSet`, so we never write a property onto an object the application owns.

**jsdom cannot measure the rethrow.** jsdom does not dispatch a `window` `error` event for a throw
inside a `setTimeout` callback. Every statement above about the `error` listener is read from the
browser specification and from our own listener code, not measured. The end to end suite runs real
Chromium and is the place that proves it.

**Only bundler users are reachable.** `@flareapp/js` builds CJS and ESM only. There is no IIFE build and
no global build. Alpine is often loaded from a CDN with no bundler, and those projects cannot use
`@flareapp/js` at all. This gap exists already and this design does not close it. It does cap how many
Alpine projects the feature reaches.

## Public API

```ts
import Alpine from 'alpinejs';
import { flareAlpine } from '@flareapp/js/alpine';

flareAlpine(Alpine);
Alpine.start();
```

Call `flareAlpine` before `Alpine.start()`. Errors that Alpine throws during its own start are missed
otherwise.

```ts
type FlareAlpineOptions = {
    /** Report through this instance instead of the `window.flare` singleton. */
    flare?: Flare;
    /** Send a truncated `outerHTML` of the element. Off by default, because rendered markup can hold user data. */
    attachElement?: boolean;
    /** Maximum length of that `outerHTML`. Default 500. */
    elementMaxLength?: number;
    /** Runs before Flare builds the report. */
    beforeEvaluate?: (payload: { error: Error; el?: Element; expression?: string }) => void;
    /** Runs after the context is built. Return a context to replace it. */
    beforeSubmit?: (payload: {
        error: Error;
        el?: Element;
        expression?: string;
        context: FlareAlpineContext;
    }) => FlareAlpineContext | void;
};

export function flareAlpine(Alpine: AlpineLike, options?: FlareAlpineOptions): void;
```

`flareAlpine` returns nothing. There is no teardown, because Alpine gives no way to restore the handler
that was there before.

`AlpineLike` is a local structural type, the same approach as `InertiaRouterLike` in
`packages/inertia/src/vendor/inertiaTypes.ts`:

```ts
type AlpineErrorHandler = (error: unknown, el?: Element, expression?: string | Function) => void;

type AlpineLike = {
    setErrorHandler?: (handler: AlpineErrorHandler) => void;
    version?: string;
};
```

The real `alpinejs` package stays a devDependency of `packages/js`, for tests only. It is never a runtime
dependency.

## Handler behaviour

The installed handler runs these steps in order:

1. Mark the raw value with `markRejectionReported` from `@flareapp/core`. This must be first, because
   the same value can leak to the `unhandledrejection` listener a moment later.
2. Convert the value with `convertToError` from `@flareapp/core`. This is what makes a non-Error
   rejection reportable.
3. Call `options.beforeEvaluate`.
4. Build the context (see below).
5. Call `options.beforeSubmit` and use its return value when it returns one.
6. Call `flare.reportSilently(error, toCustomContext('alpine', context))`.
7. Write the same `console.warn` that Alpine writes by default, so development output does not change.

The handler never rethrows. A rethrow produces a second report from `catchWindowErrors`. This is the
same reasoning as the comment in `packages/vue/src/flareVue.ts`.

Every step runs inside a guard. A throw inside the handler must never break the host application.

### Guards

- `flareAlpine` is idempotent. A `WeakSet` of Alpine objects makes a second call a no-op, the same as
  `installedApps` in `flareVue`.
- If `Alpine.setErrorHandler` is not a function, `flareAlpine` writes one `console.warn` that names the
  `3.15.2` floor and returns. It must not throw.

## Context payload

Sent as `context.custom.alpine` through `toCustomContext('alpine', payload)`.

Always present, when Alpine gives an element:

- `tag` — the lowercased tag name.
- `id` — the element id, when it has one.
- `classes` — the class attribute, when it has one.
- `directive` — the name of the attribute whose value equals the expression, for example `x-on:click` or
  `x-text`. Found with a scan over `el.attributes`. Absent when no attribute matches.

Present when the third argument is a string:

- `expression` — the expression source.

Present when the third argument is a function:

- `method` — the `name` of that function. The expression field stays absent.

Present only when `attachElement` is true:

- `outerHtml` — `el.outerHTML`, truncated to `elementMaxLength`.

`attachElement` is off by default. Rendered markup can hold user data, and `flareVue` makes the same
choice for `attachProps`.

## No backend work

The feature adds no new wire values.

- No new `FrameworkName`. Alpine apps stay tagged as `js`. Alpine is a library that is sprinkled into
  server-rendered markup, not the framework of the application. The parked Livewire slice is the one that
  deserves a framework name.
- No new SDK name. The code ships inside `@flareapp/js`, which already sets its own SDK info.
- `context.custom.alpine` uses the generic custom-context channel that `vue` and `react` already use.

Before release, make sure that the Flare interface shows a custom-context group whose key it does not
know. This is the one assumption in this section that is not read from code in this repository.

## Build and instance resolution

The handler reports through the `flare` singleton that `packages/js/src/index.ts` exports, unless
`options.flare` names another instance.

A third tsdown entry does not create a second singleton. tsdown already splits shared code between
`index` and `browser` into one chunk, for both formats: `dist/index.mjs` imports `Flare` from
`./browser.mjs`, and `dist/browser.cjs` requires the same `componentProfiler-*.cjs` chunk that
`dist/index.cjs` requires. A new `alpine` entry joins that graph.

In an Electron renderer the singleton is the wrong instance, because `@flareapp/electron/renderer`
supplies its own. Those applications must pass `options.flare`. This design does not add an `/inject`
entry, because the option already covers the case.

## Files

New, in `packages/js/src`:

- `alpine.ts` — the entry point. Exports `flareAlpine` and the option types.
- `alpine/installErrorHandler.ts` — builds and installs the handler.
- `alpine/elementContext.ts` — turns an element and an expression into the context payload.
- `alpine/types.ts` — `AlpineLike`, `FlareAlpineOptions`, `FlareAlpineContext`.

Changed, in `packages/js`:

- `package.json` — add `src/alpine.ts` to the tsdown entry list in the `build` script. Add an `./alpine`
  key to `exports`. Add `alpinejs` and `@types/alpinejs` to `devDependencies`.

Changed, in `packages/core/src`:

- `util/rejection.ts` — add `markRejectionReported`, and make `routeRejection` skip a marked reason.
- `index.ts` — export `markRejectionReported`.

`@flareapp/react-native` uses `routeRejection` too, so the skip helps that SDK as well.

## Tests

Unit tests go in `packages/js/tests/alpine/`. They drive the real `alpinejs` package in jsdom rather than
a fake object with one method. The version floor and the shape of the third argument are both facts about
Alpine, and a fake cannot hold us honest about them.

Alpine keeps its `started` flag and its error handler in module scope, so each test calls
`vi.resetModules()` and imports Alpine again. Without that, the second test in a file runs against a
started Alpine and against the handler the first test installed.

Cases:

- A synchronous throw in `x-on:click` produces one report with `expression` and `directive`.
- An asynchronous throw after `await` produces one report.
- A rejection with a plain object produces one report.
- A function third argument sets `method` and leaves `expression` absent.
- The called form of an async method marks the rejection, so `routeRejection` skips the leak.
- `attachElement` off leaves `outerHtml` absent. On, it truncates at `elementMaxLength`.
- `beforeSubmit` can replace the context.
- A second `flareAlpine` call is a no-op.
- An Alpine object without `setErrorHandler` does not throw.

The core tests cover `markRejectionReported` on its own: a marked object is skipped, an unmarked one is
routed, and a primitive reason is routed because a `WeakSet` cannot hold it.

## Playground and e2e

The JS playground gets Alpine components. There is no sixth playground.

- `playgrounds/js/package.json` gains an `alpinejs` dependency.
- `playgrounds/js/src/main.ts` calls `flareAlpine(Alpine)` and then `Alpine.start()`.
- `playgrounds/js/src/pages/broken.ts` gains an Alpine section with one component for each new scenario.

The router of this playground writes HTML into the root element after `Alpine.start()` has run. The
mutation observer of Alpine initialises those new nodes, so no extra call is needed on each navigation.

Shared fixtures:

- `playgrounds/shared/src/errorScenarios.ts` gains an `alpine` value in `ErrorScenarioKind`, plus three
  scenarios.
- `playgrounds/shared/src/coverage.ts` excludes all three for `react`, `vue` and `svelte`. This is the
  same mechanism that `sourcemap-mapped` and `sveltekit-server-throw` already use.
- `e2e/specs/shared.ts` gains an `alpine` branch in `runScenario`. The branch clicks the trigger and
  waits for one report whose custom context holds an `alpine` group. It then waits again and counts the
  reports, so a duplicate cannot pass.

Each scenario proves one claim in a real browser:

| Scenario                     | Expression                                              | Today                         | After                          |
| ---------------------------- | ------------------------------------------------------- | ----------------------------- | ------------------------------ |
| `alpine-expression-throw`    | `x-on:click="broken()"`, throws an `Error`              | one report, no Alpine context | one report with Alpine context |
| `alpine-non-error-rejection` | `x-on:click="broken"`, rejects with a plain object      | no report                     | one report                     |
| `alpine-async-duplicate`     | `x-on:click="broken()"`, async, rejects with an `Error` | two reports                   | one report                     |

`alpine-non-error-rejection` proves gain 1. `alpine-async-duplicate` proves gain 3 and the
`markRejectionReported` work. Both fail against the current client.

## Risks

**The last writer wins on the error handler.** If the application or another library calls
`Alpine.setErrorHandler` after `flareAlpine`, Flare stops receiving Alpine errors and nothing reports the
loss. Alpine gives no way to detect this. The documentation must state the ordering.

**Order against `Alpine.start()`.** A call after `Alpine.start()` misses errors from initialisation. The
documentation must state this too.

**Rendered markup can hold user data.** `attachElement` is off by default for this reason.

**Old Alpine versions are common.** Alpine `3.15.2` is from November 2025. Projects on an older version
get the `console.warn` and no behaviour change.

## Out of scope

- Livewire tracing, morph timing, and cached `wire:navigate` hits. Parked on purpose.
- Blade source locations in stack traces. Needs a server-side part.
- An IIFE or global build of `@flareapp/js` for CDN users.
- Any span, trace, or performance work.
