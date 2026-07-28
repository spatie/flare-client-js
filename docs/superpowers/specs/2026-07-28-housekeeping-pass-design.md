# Housekeeping pass — design

Date: 2026-07-28
Branch: `housekeeping-pass` (off `performance-monitoring-and-tracing`)

## Scope

`packages/*/src` across all 16 packages, roughly 11,700 lines. Out of scope: test suites
(`packages/*/tests`, ~20,400 lines), `playgrounds/`, `e2e/`.

The pass is behavior-preserving. A bug found along the way gets flagged, not fixed inline.

Baseline before starting: `npm run build`, `npm run typescript` and `npm run test` all exit 0.

## 1. Braces

`curly: "error"` goes into the root `.oxlintrc.json`. oxlint 1.68 implements the rule and auto-fixes
it; `oxfmt` then expands `{return null;}` into a real block. So the change is tool-applied, not hand
written.

279 sites in `src`, 10 in `tests`. The test sites have to be fixed too, otherwise `npm run lint`
fails. lint-staged already runs `oxlint --fix` and `oxfmt` before every commit, so the rule stays
enforced.

## 2. DRY

`@flareapp/core` is runtime-agnostic: `@flareapp/node`, `@flareapp/react-native` and Electron's main
process all import it, so helpers that touch the DOM cannot live there. The seam for browser-shared
code is `@flareapp/js/browser`, which every router package already imports from. That is where these
go.

| Helper                                    | Replaces duplication in                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `routeName(derive, fallbackPath, url)`    | tanstack, react-router, vue                                                   |
| `resolveHref(build, fallback)`            | vue (`resolve`), react-router (`createHref`), tanstack (`publicHref ?? href`) |
| `currentPath()`                           | inertia, browserTracing                                                       |
| `instrumentOnce(target, install)`         | vue, inertia (HMR WeakMap dedup)                                              |
| `resolveComponentParent(inherited, live)` | react/profiler, vue/profileVueComponents                                      |

`PACKAGE_VERSION` has four definitions in two shapes. The react/vue pair (build-time `process.env`
injection) collapses into one helper. The svelte/sveltekit pair stays as generated files;
`.claude/docs/svelte-packaging.md` documents why `svelte-package` forces that.

## 3. Complexity

- Failure-first ordering: guards at the top, happy path last and unindented.
  `browserTracing.applyRouteName` wraps its whole body in one positive `if`.
- `browserTracing.ts` repeats `if (controller && !controller.isEnded) { try { ... } catch {} }` five
  times. Collapse into one local helper.
- 24 conditions with two or more boolean operators. Split into named booleans or sequential guards
  where that helps. Atomic ranges like `status >= 400 && status < 500` stay.
- Nested ternaries become named functions, e.g. `vue/getRouteContext`'s string/symbol/null chain.

## 4. Comments

Delete:

- Comments that restate the signature or the function name.
- Numbered "safety gate" lists that narrate the code directly below them.
- Per-`catch` noise (`// ignore`, `// never throw into the host`) repeated dozens of times.

Keep, compressed to three lines or fewer:

- Framework quirks: Kit's pre-hydration `a:` URL, React Router publishing a non-idle state before the
  URL commits, Inertia's background-visit shapes, StrictMode effect replay, `g`/`y` regex `lastIndex`.
- Ordering invariants where the order is load-bearing and not obvious.
- Deliberate deviations, e.g. `||` rather than `??` for empty component names.

`traceInertiaRouter.ts` and `createPatcher.ts` hold the highest-value reasoning in the repo. Those get
compressed, not cut.

## 5. Delivery

Four commits, in order:

1. `chore: enforce curly braces on all control flow`
2. `refactor: extract shared router and profiler helpers`
3. `refactor: failure-first control flow`
4. `refactor: trim comments to why-only`

Braces go first because they churn the most lines and would otherwise pollute every later diff.
Comments go last, once the code they describe has stopped moving.

After each commit: `npm run build && npm run typescript && npm run test && npm run lint`.
