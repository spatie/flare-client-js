# CI and test-helpers cleanup — design

Date: 2026-07-15

## Goal

Two independent cleanups, shipped as two separate PRs (per CLAUDE.md: keep commits small and contained):

1. **CI**: collapse three push-triggered workflows into one that installs and builds once, then fans
   out the three checks in parallel. Bump all GitHub Actions to their current latest.
2. **Test helpers**: extract the mocking/fixture code that is duplicated across package test suites
   into a private `@flareapp/test-helpers` workspace package, plus per-package `tests/helpers/` for
   mocks that only duplicate within a single package.

Non-goals: no new checks added to CI (lint stays out); no behavior change to the SDK; no change to
what any test asserts — only where its mocks come from.

---

## Part 1 — CI: one install, fan out (PR 1)

### Current state

Three separate workflows, all `on: push`, each repeating checkout + `setup-node` + `npm install` +
`npm run build`:

- `.github/workflows/test.yml` — install, build, `npm run test`. Uses **default** Node (no
  `.node-version`), no npm cache.
- `.github/workflows/typescript.yml` — install, build, `npm run typescript`, `npm run typecheck:e2e`.
  Uses `.node-version`.
- `.github/workflows/e2e.yml` — install, Playwright browser cache, build, `npm run test:e2e`,
  `npm run test:e2e:node`, upload reports/traces. Uses `.node-version` + `cache: npm`.

So install runs 3× and build runs 3×, and Node pinning/caching is inconsistent across the three.

### Target state

A single `.github/workflows/ci.yml` (`on: push`) with a `setup` job and three parallel check jobs.

```
jobs:
  setup:                       # runs once
    - actions/checkout
    - actions/setup-node       # node-version-file: .node-version
    - npm ci                   # was: npm install
    - npm run build
    - cache node_modules       # actions/cache, key: hashFiles('package-lock.json')
    - upload dist as artifact  # actions/upload-artifact, run-scoped

  test:        { needs: setup } \
  typescript:  { needs: setup }  >  run in parallel
  e2e:         { needs: setup } /
```

Each check job: checkout, `setup-node`, restore the `node_modules` cache, download the `dist`
artifact, then run only its check. No install, no build.

### Decisions and details

- **`npm ci` over `npm install`** — reproducible and faster in CI; `package-lock.json` is present
  (~19k lines).
- **Do not rebuild in check jobs.** `npm run test` today is `npm run build && npm run test
--workspaces --if-present`; running it in the test job would discard the shared `dist`. Add a
  CI-only test script (e.g. `test:ci` = `npm run test --workspaces --if-present`, no build prefix) and
  call that. `typescript` and `e2e` already assume a prior build; the shared `dist` satisfies them
  (typecheck resolves deps' `.d.ts` from `dist`).
- **Node pinning** unified on `.node-version` (currently `22`) across every job, fixing `test.yml`'s
  drift to default Node.
- **Playwright** browser cache stays in the `e2e` job exactly as today (keyed on the resolved
  `@playwright/test` version); `e2e` also keeps `test:e2e:node` and the report/trace uploads.
- **Concurrency**: add a `concurrency` group keyed on the ref with `cancel-in-progress: true` so a new
  push cancels the superseded run.
- **Sharing mechanism tradeoff (accepted):** install+build once then transport `node_modules` (cache)
  and `dist` (artifact) to three jobs. Transporting `node_modules` partly offsets the install saving,
  but building once instead of 3× is a clear win and the structure is simpler to reason about. If the
  `node_modules` cache ever misses in a check job, that job falls back to `npm ci` (correctness over
  speed).

### Action version bumps (same PR)

Verified against GitHub releases on 2026-07-15:

| Action                    | Current | Latest | Risk note                                                                                                      |
| ------------------------- | ------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `actions/checkout`        | v4      | **v7** | low                                                                                                            |
| `actions/setup-node`      | v4      | **v7** | v7 migrated to ESM; low                                                                                        |
| `actions/cache`           | v4      | **v6** | low                                                                                                            |
| `actions/upload-artifact` | v4      | **v7** | sanity-check: the breaking change was v3→v4 (immutable per-run artifacts); v4→v7 is maintenance. CI proves it. |

### Acceptance (Part 1)

- One workflow file; `setup` runs install+build once; `test`/`typescript`/`e2e` run in parallel and do
  not install or build.
- All four actions on the versions above.
- Green run on push; total wall-clock no worse than today (expected: better, mainly from building once).

---

## Part 2 — Private `@flareapp/test-helpers` package (PR 2)

### Why a shared package is safe here

Every package whose tests touch core aliases `@flareapp/core` → `packages/core/src/index.ts` in its
`vitest.config.ts` (verified: core, js, node, electron, react-native). So a helper that does
`class FakeApi extends Api` (importing `Api` from `@flareapp/core`) resolves to the **same source
class** in every suite — there is no src-vs-dist class-identity split. The private helper package is
consumed the same way: via a `vitest.config.ts` alias to its TS source, so it needs no build step.

### Duplication inventory (what we are collapsing)

Cross-package, same shape → move to `@flareapp/test-helpers`:

- `FakeApi` — 3 copies. `packages/core/tests/helpers/FakeApi.ts` is the full one (report/logs/traces +
  capture fields); `packages/js/tests/helpers/FakeApi.ts` is a strict report-only subset;
  `packages/react-native/tests/helpers/FakeApi.ts` already re-exports core's. Consumed by ~26 files
  (18 core, 3 js, 1 rn, plus the migrated node/electron sites).
- `fakeSpan()` — 4 copies (one already extracted at `packages/js/tests/helpers/fakeTracer.ts`; a
  byte-identical redefinition at `packages/js/tests/httpRequestSpan.test.ts`, plus variants in
  `browserTracing.test.ts`, `idleRootController.test.ts`).
- `makeTracer()` — 5 copies (one extracted in js; four in core: `tracer.test.ts`,
  `tracerContinuation.test.ts`, `tracerSpanListener.test.ts`, `tracerWithSpan.test.ts`).
- Fixture literals with no factory — `minimalReport` duplicated in `packages/core/tests/api.test.ts`
  and `apiKeepaliveGate.test.ts`; OTLP envelope literals recur across `api`, `apiKeepaliveGate`,
  `logApi`, `tracingApi`, electron tests. No `makeReport`/`makeSpan`/`makeStackFrame` factory exists.
- `vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 201 }))` — repeated in
  `packages/core/tests/{apiKeepaliveGate,logApi,tracingApi}.test.ts`.
- Same frozen clock `new Date('2026-04-28T12:00:00.000Z')` in `packages/core/tests/report.test.ts` and
  `packages/js/tests/golden.test.ts`.
- node/electron reporter fakes — 15 hand-rolled `api.report = (r) => { sent.push(r); … }` sites across
  7 files (`node/{setUserScope,setFrameworkScope,fatalHandlers}`, `electron/{crashListeners,
electronFlare}`, `core/{contextCollector,flush}`), because they import `Api` from `@flareapp/core`.

Within a single package → extract to that package's own `tests/helpers/` (NOT the shared package):

- Vue: `createMockInstance` (4 files), `createMockRouter` (byte-identical, 2), `getReportedVue`
  (byte-identical, 2).
- Electron: `fakeApp` (3 files), `fakeIpcMain` (2).
- React-Native: `stubErrorUtils` (2).
- The `fakeFlare` identity shape `{ setSdkInfo: vi.fn(), setFramework: vi.fn() }` is byte-identical
  across `react`/`svelte`/`vue`/`core` identify tests — small enough to live in the shared package as
  a tiny `fakeIdentity()` (it needs no core types), collapsing a genuine cross-package dupe.

### Package shape

```
packages/test-helpers/
  package.json          name @flareapp/test-helpers, "private": true, type: module,
                        main/types/exports -> ./src/index.ts (TS source, no build)
                        devDeps: @flareapp/core (workspace), vitest, typescript
  tsconfig.json
  src/
    index.ts            barrel
    FakeApi.ts          canonical full FakeApi (report/logs/traces + capture fields)
    fakeTracer.ts       fakeSpan(), makeTracer()   (moved from packages/js/tests/helpers)
    factories.ts        makeReport(), makeSpan(), makeStackFrame()
    globals.ts          stubFetch(), frozenClock() / FIXED_TEST_DATE, fakeIdentity()
    reporter.ts         makeReporter()  (Api instance with report/logs/traces capturing)
```

Consumption: each consuming package gains a `@flareapp/test-helpers` workspace devDependency and a
`vitest.config.ts` alias `'@flareapp/test-helpers' -> resolve(__dirname, '../test-helpers/src/index.ts')`,
mirroring the existing `@flareapp/core` alias.

### Low-churn migration

- Keep each package's `tests/helpers/index.ts` (and a thin `FakeApi.ts` shim where files import
  `./helpers/FakeApi` directly) as a re-export of `@flareapp/test-helpers`, so the ~26 files importing
  `./helpers` do not change.
- Delete the js report-only `FakeApi` and core's standalone copy once both re-export the shared one.

### Staged commits inside PR 2 (each independently green)

1. Scaffold `@flareapp/test-helpers`; move `FakeApi` + `fakeSpan`/`makeTracer`; wire the vitest alias
   and workspace devDep in core/js/react-native; re-point via shims; migrate consumers.
2. Add `makeReport`/`makeSpan`/`makeStackFrame`; replace the duplicated fixture literals.
3. Add `stubFetch`/`frozenClock`/`fakeIdentity`; migrate the fetch-stub, frozen-clock, and identity
   duplication.
4. Add `makeReporter`; migrate the 15 hand-rolled `api.report = …` sites in node/electron (add the
   alias + devDep to those packages).
5. Extract per-package framework mocks (vue/electron/rn) into their own `tests/helpers/`.

### Acceptance (Part 2)

- `@flareapp/test-helpers` exists as a private workspace package, consumed via vitest alias, no build
  step, and type-checks under `npm run typescript`.
- No `FakeApi`/`fakeSpan`/`makeTracer` definition duplicated across packages; node/electron no longer
  hand-roll `api.report`.
- Framework-only mocks live in their package's `tests/helpers/`.
- `npm run test`, `npm run typescript`, and `npm run build` all pass; no test's assertions changed.

---

## Rollout

- PR 1 (CI) and PR 2 (test-helpers) are independent and can land in either order.
- Each PR is small and self-contained; PR 2 is internally staged into the five commits above.
