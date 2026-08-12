# Needs your attention

Things on the `performance-monitoring-and-tracing` branch (PR #80) that need a human, collected so they are
not spread across nine plan files and a chat log.

Anything here is either a decision only you can make, a check no automated suite can run, or a finding that
was deliberately left alone. Nothing here is a bug that slipped through review.

Last updated 2026-08-12, at branch tip `c371f11`. **All nine plans are complete**, and an adversarial
review has since landed six defect fixes plus three of its low findings (see
`research/pr80-tracing-defects-and-fixes.md` and `research/pr80-tracing-low-findings.md`). Gate at that
commit: build and type check exit 0, oxlint 0 errors, 1725 unit tests, 136 end-to-end tests passing,
working tree clean. Pack check not re-run since `d702e80`.

What is left is in this file: two backend agreements, four manual checks, three release-note items, and a
handful of findings deliberately left alone.

**For agents:** you may append to this file. See the house rules at the bottom.

---

## 1. Blocking the release

### 1.1 The backend has to agree three things

The release cannot run until these are confirmed, and confirmed as **deployed**, not planned.

- **The eight `flare.framework.name` values are accepted**: `js`, `node`, `node-electron`, `react`, `vue`,
  `svelte`, `sveltekit`, `react-native`.
- **Read-time aliasing of the five old values is live**: `React`, `Vue`, `Svelte`, `SvelteKit`,
  `React Native`. All five packages are published at 2.6.0, so all five have historical data under the old
  spelling.
- **The five `browser_*` span types are accepted**: `browser_pageload`, `browser_navigation`, `browser_fetch`,
  `browser_xhr`, `browser_component`. `browser_component` is the newest and the one most likely to be missing.
  `packages/js/src/tracing/spanTypes.ts` states these are wire format and can never change, so a rename after
  release is not available.

    For that last one you no longer have to describe the shape from the code. This is what the client actually
    put on the wire, captured from the fake ingest server during an end-to-end run:

    ```json
    {
        "name": "ProductsPage",
        "parentSpanId": "ce3e24af421139e9",
        "attributes": [
            { "key": "flare.span_type", "value": { "stringValue": "browser_component" } },
            { "key": "flare.component.name", "value": { "stringValue": "ProductsPage" } }
        ]
    }
    ```

    The nesting is the part worth flagging to whoever owns ingest: `parentSpanId` points at the nearest
    **profiled ancestor**, not at the root. The observed chain was `ProductsPage` under `Layout` under the
    pageload root. So component spans arrive as a tree, not flat.

The aliasing item is what makes this a hard gate rather than a parallel conversation. You chose the **2.7.0
minor** on the explicit condition that aliasing ships first. Without it, a minor bump silently breaks
`flare.framework.name` grouping for everyone who upgrades. If aliasing cannot ship in time, the fallback is
the 3.0.0 major, not releasing the minor anyway.

### 1.2 One manual build check

Run a production `next build` in a Next 15 app wrapped with `withFlareSourcemaps`, pointed at a server that
returns 200. Confirm the server `.js.map` files survive on disk while the client ones are removed.

Point it at a working endpoint, not a dead one: `FlareWebpackPlugin` skips removal entirely for any map whose
upload settled rejected, so a failing upload would make the check pass for the wrong reason.

---

## 2. Manual checks owed

None of these can be automated here. Each names what would go wrong and what evidence already exists.

| Check                                                                                                    | Why no suite covers it                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drive 500 fetches in a playground with `debug: true`, confirm no visible main-thread stall               | Nothing in the suite measures main-thread time. The baseline to beat is 116ms of blocking across those calls, now 1.7ms by measurement.                                                                                                                                                                                                    |
| With a full buffer, switch tabs and confirm the traces POST still ships under 60KB                       | The keepalive budget is asserted in unit tests at a loose ceiling, not against a real browser's limit.                                                                                                                                                                                                                                     |
| Boot both React playgrounds, add to cart, watch the count badge, and trigger a render error on `/broken` | The e2e suite never reads the numeric cart badge (`testIds.cartCount` is unused in `e2e/`). A stale-count regression from the shared-store move would not be caught. Risk is low: it was a pure `git mv` with zero content change.                                                                                                         |
| Nothing further owed on Inertia typing                                                                   | **This one is closed.** `@inertiajs/core@2.3.27` is now a devDependency of `packages/inertia`, and `traceInertiaRouter`'s narrowed parameter compiles against the real `Router` class with no cast (`tsc --noEmit`, exit 0). Only v2 is proven, which is what the README claims; v3 dropped axios so the test approach would not transfer. |

---

## 3. Must go in the release notes

- **Five framework names change on the wire**, plus three packages that now claim a framework where they
  claimed none (`@flareapp/js`, `@flareapp/node`, `@flareapp/electron`). Anyone filtering or alerting on
  `flare.framework.name` has to update the filter. Note that `context.custom.framework` already lowercased,
  so React, Vue, Svelte and SvelteKit are unchanged on that key; only React Native moves there.
- **`@flareapp/nextjs` `removeSourcemaps` now defaults to `true`**, matching what the 2.6.0 README always
  documented, and removal is scoped to the client build. Server and edge maps upload but stay on disk.
- **`Logger.flush()` now catches errors** from the envelope build and send, surfacing them only under
  `debug`. This is correct under the never-throw-into-the-host rule, but `Logger` is public API and this is a
  behaviour change. Three sibling changes are already named in commit `79b4404`'s body; this one is not.

- **Two technically-breaking type narrowings on the public surface.** Both are safe in this repo but a
  consumer compiling against the types could see an error.
    - `recordComponentSpan`'s `attributes` parameter, on the `@flareapp/js/browser` export map. Deliberately
      accepted and planned. Verified: none of the three in-repo profilers passes `attributes`.
    - `OtelSpan.status`, exported from `packages/core`, went from `{ code: number }` to `SpanStatus`, which
      narrows `code` to `0 | 1 | 2`. **This one was not on anyone's accepted list; it was found by the final
      review.** Reading is unaffected, since `0 | 1 | 2` is assignable to `number`. Only _constructing_ an
      `OtelSpan` or `TracesEnvelope` literal with some other numeric status now fails to compile. In-repo blast
      radius is zero: the only consumer builds it from a `BufferedSpan` whose `status` was already `SpanStatus`.

---

## 4. Open findings, not blocking

### 4.1 A real pre-existing bug, worth its own ticket

Fetch URLs resolve against `origin` rather than the document href. So `fetch('api/x')` called from `/foo/bar`
records `url.full` as `/api/x`, while the browser actually fetches `/foo/api/x`. Untouched by any plan on
this branch, and found only because plan 6's final review read across all nine commits.

### 4.2 OTLP integers ship as JSON numbers

`packages/core/src/types.ts` types the attribute as `intValue: number` and `logging/otel.ts` passes the raw
number, so the wire carries `{"intValue":200}`. The protobuf JSON mapping canonically encodes int64 as a
**string**. Most parsers accept both.

**Nobody has verified this against the OTLP spec text or the live Flare ingest parser.** Do not treat it as a
bug until someone does. Raised here because it belongs with the backend conversation in section 1, which is
already open.

### 4.3 The throwing-getter cluster, deliberately deferred

A hostile nested resource-attribute getter can throw out of `flush()` into an unguarded listener.

**Do not "just widen the `try`".** That leaves the buffer undrained on a throw and turns one poison-pill
attribute into an infinite retry loop, which is strictly worse than the current bug. It needs a
drain-then-guard redesign. The comment at `packages/core/src/telemetry/TelemetryBuffer.ts` now describes the
real exposure accurately, so start there.

### 4.4 Continuation-path state clobber

`resolveTrace`'s continuation branch calls `createState` directly, which ends in an unconditional
`traceStates.set`, so a colliding inbound `traceparent` replaces a live trace's state. Plan 4's generation
gate made this better, not worse.

### 4.5 A trap that makes end-to-end results lie

A playground dev server left running from an earlier session keeps its port. Playwright's `reuseExistingServer`
then picks it up instead of starting a fresh one, so the suite runs against whatever code that process was
started with. This survives a `git checkout`, which means it looks exactly like a real regression and it
reproduces under bisection.

It cost real time once already: 16 `react-router` failures that looked like a code regression were a stale
server on port 5185. Before trusting any end-to-end failure, check
`lsof -ti tcp:5180,5181,5182,5183,5185,7765` and kill anything left over.

### 4.6 Type-checking gaps

- Test files are not type-checked in **10 of 15 packages** (`"include": ["src"]`), including `core` and `js`.
  Every "typescript clean" claim on this branch says nothing about test files.
- **Nothing type-checks `e2e/specs/*.ts` at all.** `npm run typescript` iterates workspaces and `e2e/` is not
  one; `npm run typecheck:e2e` covers `node-frameworks/**` only; Playwright transpiles without checking.
  Plan 6 moved those specs onto typed helpers, which raises the value of closing this. Expect a pile of
  pre-existing errors when the include is widened.

**Plan 7 has now finished and did NOT close either of these.** It cleaned up types and naming inside the code
that already gets checked; widening the check itself was never one of its tasks. So both are still open, and
the second one got more valuable to close, because plan 6 moved the end-to-end specs onto typed helpers that
no compiler currently reads.

### 4.7 Web vitals: the capture point is the first tab-away, not the end of the session

`packages/js/src/tracing/browserTracing.ts:333` is now the only `emitWebVitals` call, reached from
`endRootAndFlush`, which runs on both `pagehide` and `visibilitychange: hidden`. The second of those fires on
a plain tab switch, so on a session where the user tabs away early that is where the one span is built. LCP is
genuinely final by then (the spec stops tracking it at first hidden), but CLS and INP are not.

**If ignored:** vitals still arrive for almost every page view, but INP and CLS under-report on any session
with an early tab switch. The number is wrong in a direction that looks plausible, which is the bad kind.

**The alternative is one line:** drop `visibilitychange` from that path and emit on `pagehide` only. That
captures more per page and loses everything on the pages where `pagehide` never fires. Which is better
depends on the real `pagehide` miss rate in production, which nobody here can measure.

**Verified:** that both events reach `endRootAndFlush`, and that a vital reporting after a navigation now
lands in the hide-time span (`packages/js/tests/browserTracing.test.ts`). **Not verified:** any miss rate,
or how much INP actually moves after a first tab switch in the field.

### 4.8 The comment standard has nothing holding it

Plan 8 applied the comment standard by hand: em dashes in `packages/*/src` went from 6 to 0, shouty capitals
came down, and over-long comments were cut. **Nothing in continuous integration holds any of that.** The next
feature branch reintroduces all of it, and the next person doing this pass starts from scratch.

A single grep for the em dash character under `packages/*/src`, wired into the lint step, is roughly a
ten-minute change and is the only part of that work that survives contact with the next contributor. The same
trick works for the `--` sequence, though note that all current `--` matches in `src` comments are legitimate
command-line flag references, so that rule needs to allow those.

This is a decision, not a defect: it is your call whether the standard is worth enforcing mechanically or
whether a periodic manual pass is good enough.

### 4.9 `npm run format` is not idempotent

Running it repo-wide produces drift in files nobody touched, so a formatting run cannot be trusted to be a
no-op on an already-formatted tree. This surfaced when a task ran it, saw unrelated files change, and had to
revert them by hand to keep its commit clean.

It is a nuisance rather than a defect: it makes "just run the formatter" an unsafe instruction, because the
result has to be inspected before committing. Worth tracking down whichever rule is unstable.

### 4.10 Two small repo inconsistencies

- `packages/node/package.json` has **no `contributors` field at all**, which is inconsistent under either
  convention. It is the one manifest that needs an edit whichever way you eventually go.
- `scripts/check-pack.mjs`'s `PUBLISHED_PACKAGES` lists 12 of the 14 published packages. `react-native` and
  `react-native-sourcemaps` are absent, and the comment above the list only explains `flare-api`'s absence.
  Not a release blocker: this branch changes neither package's `exports` or `files`.

---

## 5. Decisions already taken

Recorded so they are not reopened. No action needed.

| Decision                     | Choice                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version bump                 | **2.7.0 lockstep minor**, held until backend aliasing is confirmed deployed. `react-native` 2.7.0, `core` 2.7.0, `node` 0.7.0, `electron` 2.7.0. Fallback is 3.0.0 if aliasing slips.                                                       |
| `nextjs` `removeSourcemaps`  | Keep `?? true` and treat the old `?? false` as the bug. Scope removal to the client pass. Document the divergence from `@flareapp/webpack` and `@flareapp/vite` rather than aligning them.                                                  |
| `contributors` convention    | Leave alone. The mixed state ships as-is.                                                                                                                                                                                                   |
| PRs #84 and #81              | Both stay open, you handle them. #84 is fully superseded (its `framework.ts` is blob-identical to this branch's) but was not closed.                                                                                                        |
| Web vitals span count        | **One `browser_web_vital` span per document, emitted at page hide.** Emitting on the first navigation as well was the bug: it froze LCP, CLS and INP a second after load. Losing vitals on a page whose hide event never fires is accepted. |
| Web vitals value corrections | **Rejected.** Letting a moved LCP or a late INP ship as a second span would need the backend to treat a later value as replacing an earlier one for the same page view, which it cannot do reliably today. Do not re-propose without that.  |

Three extractions were also deliberately **refused** during plan 6, each because a shared helper would have
needed flags to paper over real differences: a shared navigation tracker across the five routers, a shared
`keyOf`, and merging the node and electron process handler managers. The reasoning for the third is written
into both files. Do not let a future cleanup pass undo these without reading why.

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
  entry, because this file gets trusted. Section 4.2 shows the shape.
- Update the "Last updated" line at the top with the date and branch tip.
- Delete items once they are genuinely resolved, rather than growing a graveyard.
