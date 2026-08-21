# Needs your attention

Things on the `feat/breadcrumb-buffer` branch that need a human, collected so they are not spread across
task briefs and review comments.

Anything here is either a decision only you can make, a check no automated suite can run, or a finding that
was deliberately left alone. Nothing here is a bug that slipped through review.

Last updated 2026-08-21, on `feat/breadcrumb-buffer`, covering work through Task 6 (documentation and
whole-repository verification) of the instrumentation-handlers plan (base `7d7e823`).

**For agents:** you may append to this file. See the house rules at the bottom.

---

## 1. Must go in the release notes / docs

### 1.1 `maxGlowsPerReport` stops being a ceiling

The public configuration reference on flareapp.io (`javascript/reference/configuration.md`) documents
`maxGlowsPerReport` as a hard cap on the number of glows sent per report. As of `packages/core/src/Flare.ts`
and `packages/core/src/breadcrumbs/BreadcrumbBuffer.ts` on this branch, it is a reserved floor instead:
eviction skips glows while the buffer holds `maxGlowsPerReport` or fewer, and only falls back to evicting a
glow once every non-glow entry is gone. Three new options join it on the same `Config` type —
`maxBreadcrumbs`, `maxBreadcrumbBytes`, `maxBreadcrumbEntryBytes` (`packages/core/src/types.ts:35-42`).

If ignored: a glow-heavy application (anyone calling `flare.glow()` more than 30 times before a report) will
see its report payload grow on upgrade, silently, because the documented ceiling no longer applies. The
flareapp.io page needs to describe the floor/eviction behaviour, not just the old cap.

**Not verified:** the current wording of that page. It lives in another repository, not this one.

### 1.2 `@flareapp/core` loses two public methods

`Scope.addGlow` and `Scope.clearGlows` are removed from the exported `Scope` class
(`packages/core/src/Scope.ts`). Verified nothing inside this monorepo calls either method
(`grep -rn "\.addGlow(\|\.clearGlows()"` across `packages/` turns up only `Flare.clearGlows()`, a different,
unaffected method). Nothing here breaks. The version chosen for `@flareapp/core`'s next release should
reflect a public API removal on an exported class, in case anything outside this monorepo constructs `Scope`
directly rather than going through `Flare`.

### 1.3 `Scope.glows` changes from a mutable field to a read-only getter

`packages/core/src/Scope.ts:38-41`:

```ts
get glows(): readonly Glow[] {
    return this.breadcrumbs.glows();
}
```

Before this branch, `glows` was a plain `Glow[]` field, so `scope.glows = [...]` was legal. It is now a
getter with no setter, so the same assignment throws (`TypeError: Cannot set property glows of #<Scope>
which has only a getter`) in strict mode, or silently no-ops in loose mode. Same semver note as 1.2: this is
a breaking change to a public class's public surface if anything outside this repo assigns to `.glows`
directly.

**Verified:** nothing inside this monorepo assigns to `.glows` (everything goes through `Flare.glow()` /
`Flare.clearGlows()`). Checked with `grep -rn "\.glows\s*=" packages/*/src packages/*/tests`, no matches;
also checked for `.glows.push(`, `.glows.splice(`, `.glows.pop(` and bracket-index writes (`.glows[`),
also no matches. The only other hits for `.glows` in `src`/`tests` are two doc-comment mentions of
`Flare.glows` (`packages/core/src/breadcrumbs/SpanEventsRecorder.ts:10`,
`packages/core/src/breadcrumbs/types.ts:22`), not code.

**Recommendation (not a decision — the release version is your call):** take the major on `@flareapp/core`
for 1.2 and 1.3 rather than adding deprecated `addGlow` / `clearGlows` shims. Reasoning: `Scope` is exported
mainly so `@flareapp/node`'s `NodeScope` can extend it; `@flareapp/js` pins `@flareapp/core` to an exact
version, so the bump cascades to nothing there; and a compatibility shim would reintroduce the special case
this branch exists to delete (glows as a thing separate from the buffer).

### 1.4 An oversized glow is now dropped whole, and only tells you in debug mode

`packages/core/src/breadcrumbs/SpanEventsRecorder.ts:35-41`: when a glow's serialized event exceeds
`maxBreadcrumbEntryBytes` (default 8,000 bytes, `packages/core/src/Flare.ts:48`), `BreadcrumbBuffer.add`
returns `false` and the entry never enters the buffer. `SpanEventsRecorder` logs that drop with
`console.error` only `if (this.deps.getConfig().debug)` — a production app, which normally runs with
`debug: false`, gets no signal at all.

Before this branch, every glow shipped on the report regardless of size (`glowsToEvents` had no size check).
This is the second of the two intended behavioural changes on the branch (the plan calls it out explicitly,
`docs/superpowers/plans/2026-08-20-breadcrumb-buffer.md`, Global Constraints).

If ignored: a customer glowing something non-trivial (an API response body, a Redux/Pinia state slice) loses
that glow silently after upgrading, with no report-side trace that it happened, only in production where
`debug` is off. Worth a release-notes mention and worth considering whether the drop should also surface
some other way (a report-level attribute counting drops, for example) — that is a design call, not something
this item resolves.

**Verified:** the `if (!kept) return false` path and the `debug`-gated `console.error`
(`SpanEventsRecorder.ts:39-41`); the 8,000-byte default (`Flare.ts:48`); pinned by
`packages/core/tests/glows.test.ts`, "a glow over maxBreadcrumbEntryBytes is dropped whole, not shipped".
**Not verified:** whether flareapp.io's configuration reference already documents a size limit on glow
context; that page lives in another repository.

### 1.5 A third behaviour change: a navigation handler's errors are now swallowed silently

`packages/js/src/instrument/handlers.ts:61-69`, `createHandlerSet.each`, wraps every call to a
registered handler in a `try`/`catch` that discards the error, with no logging even under
`debug: true`. Tracing's navigation handler (`packages/js/src/tracing/browserTracing.ts:445-466`) runs
through this path: `onStart` calls `startRoot`, `onRouteName` and `onSettle` call `applyRouteName`, all
invoked from `instrument/navigation.ts:46-58` inside that swallowed `try`/`catch`.

Before this branch, `main`'s `browserTracing.ts` called `startRoot` and `applyRouteName` directly from
`startNavigation`, `setActiveRouteName` and `settleNavigation`, with nothing catching a throw. An
exception there reached the router integration that had called the method — a TanStack Router or
vue-router callback, for example.

The plan's own self-review names exactly two intended behaviour changes for this branch. This is a
third one that no plan document lists.

If ignored: an exception inside `applyRouteName` or `startRoot` (a bad route name, a tracer bug) now
disappears with no trace, in production and with `debug: true` alike, instead of surfacing as an
uncaught error pointing at the real cause.

**Verified:** the `try`/`catch` and its comment at `handlers.ts:61-69`; that `navigationHandler`'s three
methods (`browserTracing.ts:446`, `:460`, `:463`) call `startRoot`/`applyRouteName` directly and run
only inside `handlers.each` (`instrument/navigation.ts:46-58`); that on `main`,
`startNavigation`/`setActiveRouteName`/`settleNavigation` called the same functions with nothing
catching a throw (`git show main:packages/js/src/tracing/browserTracing.ts`, lines 460-483).

---

## 2. Findings deliberately left unfixed

### 2.1 `safeClone`'s truncation is bounded in walk cost, not in output size

`packages/core/src/util/flatJsonStringify.ts:8-9` runs `JSON.stringify(safeClone(value, { mode: 'json' }))`.
`safeClone` (`packages/core/src/util/safeClone.ts`) charges one unit of a 50,000-node budget
(`MAX_TRAVERSAL_NODES`, `packages/core/src/util/traversalBudget.ts:12`) per node visited via `spendNode`. Once
the budget is spent, `walk()` returns the 22-character `TRUNCATED` marker in O(1)
(`safeClone.ts:29-31`) — but its callers do not stop iterating: the array branch's `.map()`
(`safeClone.ts:66`) and the object branch's `for` loop (`safeClone.ts:87-97`) still call `walk` once per
remaining child of every container already entered, each call just returning `TRUNCATED` immediately. The
node budget bounds how much real work each call does; it does not bound how many `TRUNCATED` strings end up
in the output.

Concretely: `flare.glow('x', 'info', { items: <1 million numbers> })` builds a JSON array of roughly one
million `"[truncated: too large]"` strings, a synchronous string of about 24 MB, before
`BreadcrumbBuffer.add` measures it and discards it for being over `maxBreadcrumbEntryBytes` (default 8,000
bytes). The same hazard already exists today at report time: `Api.report` (`packages/core/src/api/Api.ts:48`)
runs every report body through the same `flatJsonStringify`, so an application that puts a huge object into
`addContext` (or any other path that flows into a report's attributes) already pays this cost once per
report. This branch does not introduce the hazard — it raises how often it can fire, from once per report to
once per `flare.glow()` call, since a glow that used to ship at any size now measures its size synchronously
on every call.

**Ruling: document, do not fix.** The fix belongs in `safeClone`, not here: stop iterating a container's
children once `spendNode` fails partway through it, and emit one `TRUNCATED` marker for the whole container
instead of one per remaining child. That changes the serialized shape of every truncated payload across
every SDK that calls `flatJsonStringify` (glows, `addContext`, log attributes, span attributes), so it
deserves its own change with its own tests rather than riding in on this branch. Fixing it would also close
the equivalent report-time hazard described above, for free.

**Verified:** the `walk()` early-return at `safeClone.ts:29-31` and that its callers keep iterating past a
spent budget (`safeClone.ts:59-72` for arrays, `safeClone.ts:82-101` for objects); the 22-character length of
`TRUNCATED` (`traversalBudget.ts:29`, checked with `"[truncated: too large]".length` — 22); that
`flatJsonStringify` is the only thing standing between `BreadcrumbBuffer.add` and this cost
(`BreadcrumbBuffer.ts:18`); that `Api.report` uses the same `flatJsonStringify` on the whole report body
(`Api.ts:48`). **Not verified:** an actual timed run of the 1-million-item case; the "roughly 24 MB" and
"synchronously" characterization is arithmetic (1,000,000 × ~24 bytes per quoted `TRUNCATED` entry plus
separators) and code-path reading, not a measured benchmark.

### 2.2 The design spec says tracing subscribes to navigation "when `enableTracing`"; the code always does

`docs/superpowers/specs/2026-08-14-automatic-breadcrumbs-design.md:281` describes two navigation
subscribers: tracing, "subscribed when `enableTracing`," and breadcrumbs, subscribed when
`enableBreadcrumbs`. The code does not gate tracing that way. `packages/js/src/tracing/browserTracing.ts:485`
registers tracing's navigation handler once, at module top level, on import — not from
`startBrowserTracing`, and not conditioned on `enableTracing` anywhere.

This was a deliberate deviation, not an oversight. On `main`, three of the four navigation methods
(`setActiveRouteName`, `settleNavigation`, `unregister`) already ran unconditionally regardless of
whether tracing was on, so a route name handed over before tracing started still parked for the next
pageload root. Subscribing only for the length of a tracing session would silently drop that. The
comment at `browserTracing.ts:481-484` explains the choice.

Making the spec true again is bigger than a docs fix: it means moving the pending-route-name parking
out of `browserTracing.ts` and into `instrument/navigation.ts`, so a late subscriber can still be
replayed a name that arrived before it registered. That is next-step-sized work.

If ignored: a reader who trusts the spec's wording will expect tracing's navigation handler to come and
go with `enableTracing`. It does not — the handler is live from the moment `@flareapp/js/browser` is
imported, whether or not tracing is on.

**Verified:** the spec wording at `docs/superpowers/specs/2026-08-14-automatic-breadcrumbs-design.md:281`;
the unconditional module-level call at `packages/js/src/tracing/browserTracing.ts:485`; that
`packages/js/src/browser.ts:17` imports `./tracing` unconditionally, so every consumer of `browser.ts`
pulls this in; that on `main`, `setActiveRouteName`/`settleNavigation`/`unregister` ran with no
`enableTracing` check, only `startNavigation` checked `activeFlare` (`git show
main:packages/js/src/tracing/browserTracing.ts`).

### 2.3 Two comments claim `@flareapp/js/browser` has no import-time side effects; it now has one

`packages/js/tests/browserExport.test.ts:5` titles a test "importing src/browser.ts has NO import-time
side effects." `packages/react/src/tanstack-router.ts:1-2` tells the reader that the navigation-source
export "comes from `@flareapp/js/browser` (side-effect-free)." Both are wrong now: `browser.ts:17`
imports `./tracing`, and `tracing/browserTracing.ts:485` runs `addNavigationHandler(...)` at module top
level (see 2.2) — an import-time side effect.

Nothing breaks today: the effect only touches Flare's own module-level state, not anything the test
actually asserts (`window.flare` stays undefined), and not anything the Electron-safe entry point's
promise of no runtime dependency on `@flareapp/js`'s root actually needs. But the test's title no
longer matches what it proves, so it would not catch a future, less benign top-level call landing in
the same file.

The test title is fixable here. The comment is not: `tanstack-router.ts` lives in `packages/react`, one
of the four router packages this plan was not allowed to touch.

If ignored: two confidently-worded, stale claims stay in the tree, and the test keeps passing for the
wrong reason — it asserts something the new side effect doesn't touch, not that there is no side
effect.

**Verified:** both comments at the cited lines; the import chain `browser.ts:17` -> `tracing/index.ts`
-> `browserTracing.ts:485` (see 2.2); that the test's actual assertions only check `window.flare` and
the shape of `browser.ts`'s exports (`browserExport.test.ts:5-16`), not the absence of side effects in
general.

### 2.4 `npm run typescript` never type-checks `packages/js/tests`

`packages/js/tsconfig.json` sets `"include": ["src"]`, and the package's own `typescript` script is
plain `tsc --noEmit` (`packages/js/package.json:58`). A type error inside `packages/js/tests` compiles
clean through both `npx vitest run` (Vitest uses its own transform) and `npm run typescript`, which
never looks at that directory. The same pattern holds elsewhere in the monorepo:
`packages/core/tsconfig.json` also sets `"include": ["src"]`, and no package has a separate `tsconfig.json`
for its `tests` directory.

This is pre-existing, not introduced by this branch; it surfaced while writing this branch's tests.

If ignored: a test file can carry a real type error (a wrong mock shape, a stale import) that only
shows up as a runtime failure, or not at all if the mistyped path isn't exercised, never as a
build-time signal.

**Verified:** `packages/js/tsconfig.json`'s `include` field; `packages/js/package.json:58`'s
`typescript` script; the same `include: ["src"]` shape in `packages/core/tsconfig.json`; no
`tsconfig.json` under `packages/js/tests` (`find packages/js/tests -iname "tsconfig*"`, no results).
**Not verified:** every other package's tsconfig individually — only `core` and `js` were checked.

### 2.5 Multi-instance ingest-URL checks now read the last-constructed client, not the one that installed the patch

`packages/js/src/instrument/config.ts` holds one module-global config getter, overwritten by whichever
`Flare` instance constructs last (`setInstrumentationConfig`, called from the constructor). `openRequest`
in `packages/js/src/instrument/request.ts:106` reads that getter to decide whether a request targets
Flare's own ingest endpoint and should be dropped from instrumentation.

Before this branch, that same ingest check read the config of whichever client had installed the
fetch/XHR patch — not necessarily the last one constructed. Under two `Flare` instances with different
`ingestUrl`s, one instance's own flush request can now be checked against the other instance's ingest
list, so it stops being recognised as internal traffic.

This is an accepted trade-off, not an oversight:
`packages/js/tests/multiInstance.characterisation.test.ts` already documents multi-instance patch
ownership as unplanned and unfixed, and this is one more instance of the same gap.

If ignored: an application running two Flare clients against different backends (a staging and a
production project, for instance) could see one client's own outgoing report traffic recorded as a
breadcrumb or request span, or the reverse.

**Verified:** `instrumentationConfig()`'s "last constructed client wins" comment and implementation
(`packages/js/src/instrument/config.ts:3-15`); `openRequest`'s use of it to build the ingest-drop check
(`packages/js/src/instrument/request.ts:104-113`); that
`packages/js/tests/multiInstance.characterisation.test.ts`'s header comment still calls multi-instance
patch ownership "deliberately unplanned."
**Not verified:** an actual two-instance run reproducing the misclassification; this is code-path
reading, not a measured reproduction.

---

## 3. Left for the next step

### 3.1 `enableBreadcrumbs` does not exist yet

Searching the whole `packages/` tree for `enableBreadcrumbs` finds nothing: no config field, no reader,
no test. This plan built the neutral instrumentation layer underneath breadcrumbs — the handler
registry, the request and navigation hook points — but nothing yet turns any of it into a recorded
breadcrumb. The four recorders (click, input, request, navigation) are the next step's work.

If ignored: releasing this branch without the next step ships a layer that records nothing, silently,
because there is no flag yet to even try to turn it on.

**Verified:** `grep -rn "enableBreadcrumbs" packages/ --include="*.ts"` returns no matches anywhere in
the repository, tests included.

### 3.2 Three backend `SpanEventType` cases are still unbuilt

The next step's recorders need `browser_click`, `browser_input` and `browser_route_change` as
`SpanEventType` values on the Flare backend (`~/srv/flareapp.io`). This repository's client code
defines none of them yet either — searching `packages/core/src` and `packages/js/src` for those three
names finds nothing outside this note. The next step cannot ship breadcrumbs for clicks, inputs or
route changes until the backend accepts them.

If ignored: the next step either blocks on backend work nobody scheduled, or ships a client that sends
span-event types the backend rejects or silently drops.

**Verified:** `grep -rn "browser_click\|browser_input\|browser_route_change\|SpanEventType"
packages/core/src packages/js/src` (excluding tests) returns no matches, confirming the client side
carries no trace of these values yet.
**Not verified:** the backend's current state directly — `~/srv/flareapp.io` is outside this
repository and outside this task's scope.

### 3.3 Navigation broadcasts cover router-driven sources only

`registerNavigationSource()` in `packages/js/src/instrument/navigation.ts` is the only path into the
navigation handler registry, and the four router packages (`react`'s `tanstack-router.ts` and
`react-router.ts`, `vue`'s `traceVueRouter.ts`, `sveltekit`'s `traceSvelteKitRouter.svelte.ts`,
`inertia`'s `traceInertiaRouter.ts`) are its only callers. The vanilla History-API fallback
(`pushState`/`replaceState`/`popstate` detection) and the initial pageload root both live inside
`startBrowserTracing` (`packages/js/src/tracing/browserTracing.ts:257-275` and `:294-345`), patch
`history` directly, and call `startRoot` without ever going through `addNavigationHandler`. Both only
run when tracing turns on.

So an application with no router integration, running breadcrumbs with tracing off, would record no
navigation breadcrumbs at all — not on route change, and not on the initial page load, which the
design spec asks for explicitly
(`docs/superpowers/specs/2026-08-14-automatic-breadcrumbs-design.md:291`: "The initial page load emits
the same `browser_route_change`...").

The next step's plan has to choose: move the History-API and pageload detection into
`instrument/navigation.ts` so breadcrumbs can subscribe to them independently of `enableTracing`, or
accept that navigation breadcrumbs only exist for applications using one of the four router
integrations. This plan deliberately built neither.

If ignored: the next step ships navigation breadcrumbs that silently don't fire for any application not
using TanStack Router, React Router v7, vue-router or SvelteKit, without anyone having decided that on
purpose.

**Verified:** the four router packages are `registerNavigationSource`'s only callers (`grep -rn
"registerNavigationSource(" packages/react packages/vue packages/sveltekit packages/inertia`); the
History-API patch and the pageload `startRoot` call both live inside `startBrowserTracing`, with no
`addNavigationHandler` call anywhere in that function (`packages/js/src/tracing/browserTracing.ts:257-345`);
the spec's pageload wording at
`docs/superpowers/specs/2026-08-14-automatic-breadcrumbs-design.md:291`.

### 3.4 Twenty-three more deferred, non-blocking items live in the plan's working ledger

Every task review in this plan recorded minor findings directly in the working ledger at
`.superpowers/sdd/2026-08-21-instrumentation-handlers/progress.md`, on lines starting `Task N: minor
(deferred):` — stale comments, gaps in test strength, one file-size note. None of them block anything.
Two of the more consequential ones are written up above as their own items (2.3's stale comments, 1.5's
silent error swallow); the other twenty-three are still only in that ledger. A whole-branch review is
expected to triage them next — decide which are worth a follow-up commit and which are not — so they
are not copied here.

**Verified:** `grep -c "^Task [0-9]*: minor (deferred):" progress.md` in that plan's directory returns
25; 2 of those are promoted above, leaving 23 untouched in the ledger.

---

## House rules for agents

Append to this file when you find something that genuinely needs Dries, and only then.

**Belongs here:** a decision only he can make, a check no suite can run, a finding deliberately left
unfixed, or something that must reach the release notes.

**Does not belong here:** anything you can just fix, anything a test already covers, or a summary of work
you did. This is not a changelog and not a progress log. Git history and the SDK workspace ledgers cover
those.

When you add an item:

- Put it in the right section, and say plainly what happens if it is ignored.
- Cite `file:line` where there is one.
- **Mark what you verified and what you did not.** An unverified claim recorded as fact is worse than no
  entry, because this file gets trusted. Item 1.3 shows the shape.
- Update the "Last updated" line at the top with the date and branch tip.
- Delete items once they are genuinely resolved, rather than growing a graveyard.
