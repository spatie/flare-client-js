# React Router v7 (data mode) playground

Date: 2026-07-14
Status: Approved (design)

## Problem

The repo ships four parallel webshop playgrounds (`js`, `react`, `vue`, `svelte`),
one per framework, each implementing the same spec so the Playwright suite can
exercise the SDK uniformly. The React playground is built on **TanStack Router**
and exercises `traceTanStackRouter`.

`@flareapp/react` also ships a second router integration —
`@flareapp/react/react-router`'s `traceReactRouter` — for **React Router v7 data
mode** (`createBrowserRouter` / `createHashRouter` / `createMemoryRouter` +
`RouterProvider`). Nothing exercises it end-to-end. It is covered only by vitest
unit/integration tests against `createMemoryRouter`. There is no playground and no
Playwright regression coverage for its two navigation branches (held loader roots
vs. loader-less navigations).

This design adds a fifth playground: a faithful webshop twin of the React
playground, re-wired onto React Router v7 data mode and traced with
`traceReactRouter`, plus a Playwright project that exercises it.

## Goals

- A new `@flareapp/playgrounds-react-router` workspace: a faithful twin of the
  React playground (same header, product grid, detail, cart, checkout,
  confirmation, broken page; same shared `testIds`, scenarios, and Tailwind
  styling), built on `createBrowserRouter` + `RouterProvider`.
- `traceReactRouter(router)` wired in `main.tsx`.
- A mix of loader and loader-less routes so both `traceReactRouter` navigation
  branches are exercised: `/product/:id` has an async loader (held nav root),
  the rest are loader-less.
- Error/log scenarios reuse the shared spec via `coverageFor('react')` /
  `logCoverageFor('react')` — no change to the shared `Framework` union.
- The Flare profiler (`withFlareProfiler`) mirrors the React playground's
  wrapping, demonstrating profiler component spans nesting under RR data-mode
  nav roots.
- A `react-router` Playwright project (port 5185) with a `react-router.spec.ts`
  mirroring `react.spec.ts`, plus tracing assertions for the pageload root and
  both navigation branches.

## Non-goals

- No change to any `@flareapp/*` package behavior. This is playground UI + e2e
  only; `traceReactRouter` is consumed as-is.
- No change to the shared `Framework` union or `coverageFor`/`logCoverageFor`
  exclusion maps. The RR playground is React and reuses the `'react'` coverage.
- No `reactInvariant` route. That route exists only for the prod-build minified
  error-decode suite (`react-prod.spec.ts`); the RR playground runs dev-mode e2e
  only, so it is omitted. (A prod suite for RR is a later, separate change.)
- No RR **framework mode** (formerly Remix, file-based + SSR) and no
  **declarative mode** (`<BrowserRouter>` + `<Routes>`). `traceReactRouter`
  targets **data-mode** routers only (it needs `router.subscribe` / `router.state`).
- No hash-router variant. `createBrowserRouter` only. (`traceReactRouter` has a
  documented hash-fragment url limitation that is out of scope here.)

## Package layout

New workspace `playgrounds/react-router/` (picked up by the existing
`playgrounds/*` glob in the root `package.json` workspaces).

```
playgrounds/react-router/
  package.json          # @flareapp/playgrounds-react-router, dep react-router@^7.6.0
  index.html            # verbatim from react playground (title updated)
  env.d.ts              # verbatim
  vite.config.ts        # port 5185 (server + preview), sourcemap: true
  tsconfig.json         # verbatim
  tsconfig.node.json    # verbatim
  .env.example          # verbatim
  src/
    main.tsx            # initFlare(); traceReactRouter(router); render RouterProvider
    router.tsx          # createBrowserRouter([rootRoute])
    flare.ts            # copied; default key 'test-key-react-router'
    cart.ts             # verbatim (framework-agnostic useSyncExternalStore store)
    components/
      Fallback.tsx      # verbatim
    routes/
      root.tsx          # RootLayout (header/nav + FlareErrorBoundary>Outlet) + rootRoute
      products.tsx      # ProductsPage (index route)
      product.tsx       # ProductPage + async loader
      cart.tsx          # CartPage
      checkout.tsx      # CheckoutPage
      confirmation.tsx  # ConfirmationPage
      broken.tsx        # BrokenPage (error + log scenario buttons)
```

- **npm name:** `@flareapp/playgrounds-react-router`
- **port:** 5185 (5180 js, 5181 react, 5182 vue, 5183 svelte, 5184 nextjs are taken)
- **deps:** `@flareapp/js: *`, `@flareapp/react: *`, `@flareapp/playgrounds-shared: *`,
  `react-router: ^7.6.0` (unified v7 package; `createBrowserRouter`, `RouterProvider`,
  `useLoaderData`, `Link`, `Outlet`, `useNavigate`, `useLocation` all export from it),
  `react`/`react-dom: ^19`.
- **devDeps:** `@tailwindcss/vite`, `@vitejs/plugin-react`, `@types/react`,
  `@types/react-dom`, `tailwindcss`, `typescript`, `vite` (same set as react playground,
  minus TanStack).

## Router & tracing wiring

`src/router.tsx` builds a data router from per-file `RouteObject` modules, using
`Component` + `loader` (not `element`):

```ts
export const router = createBrowserRouter([rootRoute]);
```

where `rootRoute` (in `routes/root.tsx`) is:

```ts
export const rootRoute: RouteObject = {
    path: '/',
    Component: RootLayout,
    children: [
        { index: true, Component: ProductsPage },
        { path: 'product/:id', Component: ProductPage, loader: productLoader },
        { path: 'cart', Component: CartPage },
        { path: 'checkout', Component: CheckoutPage },
        { path: 'confirmation', Component: ConfirmationPage },
        { path: 'broken', Component: BrokenPage },
    ],
};
```

`src/main.tsx`:

```tsx
initFlare();
traceReactRouter(router); // subscribes once, outside React

createRoot(container).render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>,
);
```

`traceReactRouter` is called before render; it reads the router's
synchronously-resolved initial matches to name the `browser_pageload` root and
subscribes for subsequent navigations. StrictMode's double-invocation does not
affect it (the subscription lives outside React, and the profiler's record-once
ref already handles StrictMode).

`src/flare.ts` is copied from the react playground unchanged except the default
key (`'test-key-react-router'`): same `idleTimeout: 2000` / `spanFlushIntervalMs: 500`
e2e timing, `enableLogs`, `enableTracing`, `tracesSampleRate: 1`,
`beforeEvaluate` (drops `hook-drop-report`), `beforeSubmit` (mutates
`hook-mutate-report`), and the `__flare` global for the e2e suite.

## Loaders (both tracing branches)

- **`/product/:id`** gets an async loader:

  ```ts
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  export async function productLoader({ params }) {
      await sleep(150);            // deterministic loading window, no network
      return { product: productById(params.id) };
  }
  ```

  `ProductPage` reads it via `useLoaderData()`. The loading window makes RR
  publish a non-idle `navigation.state` before the URL commits, so
  `traceReactRouter` opens a **held** `browser_navigation` root and names it at
  settle from the committed matches (`/product/:id`).

- **`/`, `/cart`, `/checkout`, `/confirmation`, `/broken`** are loader-less. RR
  short-circuits to a single idle fire with the committed location, so
  `traceReactRouter` takes its **loader-less** branch (open + settle in one fire,
  no hold).

The `sleep(150)` is a fixed delay with no network dependency, keeping the e2e
deterministic. (A real fetch inside the loader to demonstrate fetch spans nesting
under the nav root is a possible later enhancement, not part of this cut.)

## Error handling in RR data mode

This is the one non-trivial difference from the React (TanStack) playground.

In RR data mode, RR intercepts a route's render error via its own error-boundary
machinery **before** any React error boundary mounted *above* `RouterProvider`
sees it, and it **latches** the error in `router.state.errors` (which would break
a naive rethrow-to-outer-boundary reset). The TanStack playground's approach
(wrap `RouterProvider` from outside + disable the router catch) does not port
cleanly.

Instead, the **root route element wraps `<Outlet/>` in `FlareErrorBoundary`**:

```tsx
function RootLayout() {
    const pathname = useLocation().pathname;
    return (
        <div /* header + nav, same markup as react Layout */>
            ...
            <main>
                <FlareErrorBoundary fallback={Fallback} resetKeys={[pathname]}>
                    <Outlet />
                </FlareErrorBoundary>
            </main>
        </div>
    );
}
```

Because **no route defines an `errorElement`/`ErrorBoundary`**, RR inserts no
per-route error boundary. A child-route render error therefore propagates up the
React tree to this `FlareErrorBoundary` (a descendant of RR's default root
boundary, an ancestor of the route component), which catches it first. RR never
handles or latches it. Consequences:

- `render-error`: reported with React component-stack context (via
  `FlareErrorBoundary`'s `componentDidCatch`), Fallback shown.
- `boundary-reset`: `resetErrorBoundary()` re-renders the Outlet subtree, which
  remounts `BrokenPage` with fresh local state (`renderTrigger = null`), so it
  does not re-throw and the Fallback hides — identical recovery semantics to the
  other playgrounds, with no RR error state to clear.
- Navigating to a different route changes `useLocation().pathname`, so
  `resetKeys` auto-resets the boundary on navigation (matching the react
  playground's `resetKeys={[pathname]}` behavior). Unlike the TanStack playground,
  `RootLayout` renders *inside* `RouterProvider`, so `useLocation()` is available
  directly (no `router.subscribe` shim).

**Scope of capture.** Wrapping `<Outlet/>` means this boundary catches child-route
*render* errors only. Two classes are intentionally out of scope and fall through
to RR's own default boundary (which latches them in `router.state.errors`): (a) a
render error thrown by `RootLayout` itself (header / `useCartCount`), and (b)
loader/action errors — RR routes those to its error path, never a React render
throw, and no route defines an `errorElement`. No playground scenario exercises
either, so this is an accepted limitation; a future scenario that throws in the
layout or a loader would need an explicit `errorElement`/handler to reach Flare.

**Validation-first risk:** the assumption that RR's default root boundary does
not intercept a child-route render error before the inner `FlareErrorBoundary` is
the single behavior to confirm first during implementation (via the
`render-error` / `boundary-reset` e2e). If it turns out RR's default boundary
wins, the fallback is: set the root route's `ErrorBoundary` to
`() => { throw useRouteError(); }` (bubbling above `RouterProvider` to an outer
`FlareErrorBoundary`) and drive reset by navigating to clear the latched error.
The inner-wrap approach is expected to work and is cleaner, so it is the primary
design.

Event/manual scenarios (`sync-throw`, `async-throw`, `unhandled-rejection`,
`manual-report`, `glow-then-throw`, `hook-drop-report`, `hook-mutate-report`)
need no boundary: they route through `@flareapp/js` window listeners (set up on
import) or `flare.report`, identical to the react playground. `BrokenPage` reuses
the react playground's `eventTriggers` map and `MaybeThrowing` / `renderTrigger`
render-error pattern verbatim.

## Profiler

Mirror the react playground's `withFlareProfiler` usage for parity:
`RootLayout`, `ProductsPage`, `ProductPage`, and the `AddToCartButton` are
wrapped. This exercises profiler component spans under RR data-mode roots,
including the persistent-layout case (a profiled root layout that stays mounted
across navigations), which the profiler re-homes to the live root.

## Shared spec reuse

- `coverageFor('react')` drives `BrokenPage`'s error buttons; `logCoverageFor('react')`
  drives the log buttons. The `'react'` coverage excludes `sourcemap-mapped` and
  `sveltekit-server-throw` (both irrelevant here) and includes `render-error` /
  `boundary-reset` (handled by the root `FlareErrorBoundary` above).
- No new `testIds`, scenarios, or `Framework` values. The e2e project name is
  `react-router`, but the spec passes `'react'` to the shared coverage helpers.

## e2e integration

### `playwright.config.ts`

Add to `devProjects`:

```ts
{
    name: 'react-router',
    testMatch: /react-router\.spec\.ts$/,
    use: { baseURL: 'http://localhost:5185', browserName: 'chromium' },
},
```

Add to `devWebServers`:

```ts
{
    command: 'npm run dev --workspace=@flareapp/playgrounds-react-router',
    url: 'http://localhost:5185',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { ...sharedEnv, VITE_FLARE_KEY: 'test-key-react-router' },
},
```

The prod suite (`prodProjects`/`prodWebServers`) is untouched.

### `e2e/specs/react-router.spec.ts`

Mirrors `react.spec.ts`, reusing `runScenario` / `scenariosFor('react')`,
`runLogScenario` / `logScenariosFor('react')`, and the same OTLP span helpers:

- `renders product grid`
- `checkout happy path reports no errors` (add to cart -> cart -> checkout ->
  submit -> confirmation; `assertNoReports`)
- `error scenarios` — `runScenario` per `scenariosFor('react')`
- `log scenarios` — `runLogScenario` per `logScenariosFor('react')`
- `pageload root carries the parameterized route and route source` — deep-link
  `/product/p01`, `waitForTrace` for a `browser_pageload` span whose
  `flare.route.source` is `route` and whose name is `/product/:id`
- `loader navigation opens a parameterized browser_navigation root` — from `/`,
  click a product link, `waitForTrace` for a `browser_navigation` span named
  `/product/:id` with `route` source (exercises the **held loader** branch)
- `loader-less navigation opens a parameterized browser_navigation root` — click
  the Cart link, `waitForTrace` for a `browser_navigation` span named `/cart`
  (exercises the **loader-less** branch)

Each nav test uses `page.waitForLoadState('networkidle')` after the initial
`goto` before clicking, matching the existing specs.

## Root scripts & docs

- Root `package.json`: add
  `"playgrounds:react-router": "npm run build --workspaces --if-present && npm run dev --workspace=@flareapp/playgrounds-react-router"`
  (same shape as the other `playgrounds:*` scripts).
- `CLAUDE.md`: add a `playgrounds/react-router` row to the Monorepo structure
  table and a `playgrounds:react-router` line to the Commands block.

## Testing strategy

- **Primary:** the `react-router` Playwright project. The playground app has no
  standalone unit tests (consistent with the other playgrounds); its behavior is
  asserted by e2e.
- **TDD order:** wire the playground enough to boot, then make the e2e spec pass
  scenario-group by scenario-group, validating the `render-error` /
  `boundary-reset` error-boundary behavior first (the one design risk), then the
  tracing assertions (pageload, loader nav, loader-less nav).
- **Manual:** `npm run playgrounds:react-router` -> `http://localhost:5185` for
  exploration (reports fail to send without a fake server, as with the others).

## Rollout

Single PR on the current `react-router-v7-integration` branch (or a follow-on
branch), independent of the pending `@flareapp/js` version bump / react peer-floor
raise tracked for the `traceReactRouter` feature itself — the playground consumes
the workspace `*` versions and does not gate the publish.
