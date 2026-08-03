# Needs your attention

Things on the `performance-monitoring-and-tracing` branch (PR #80) that need a human, collected so they are
not spread across nine plan files and a chat log.

Anything here is either a decision only you can make, a check no automated suite can run, or a finding that
was deliberately left alone. Nothing here is a bug that slipped through review.

Last updated 2026-08-03, at branch tip `ec98c45` (plans 1 to 6 complete, plans 7 to 9 not started).

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

| Check                                                                                                    | Why no suite covers it                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drive 500 fetches in a playground with `debug: true`, confirm no visible main-thread stall               | Nothing in the suite measures main-thread time. The baseline to beat is 116ms of blocking across those calls, now 1.7ms by measurement.                                                                                            |
| With a full buffer, switch tabs and confirm the traces POST still ships under 60KB                       | The keepalive budget is asserted in unit tests at a loose ceiling, not against a real browser's limit.                                                                                                                             |
| Boot both React playgrounds, add to cart, watch the count badge, and trigger a render error on `/broken` | The e2e suite never reads the numeric cart badge (`testIds.cartCount` is unused in `e2e/`). A stale-count regression from the shared-store move would not be caught. Risk is low: it was a pure `git mv` with zero content change. |

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

### 4.5 Type-checking gaps

- Test files are not type-checked in **10 of 15 packages** (`"include": ["src"]`), including `core` and `js`.
  Every "typescript clean" claim on this branch says nothing about test files.
- **Nothing type-checks `e2e/specs/*.ts` at all.** `npm run typescript` iterates workspaces and `e2e/` is not
  one; `npm run typecheck:e2e` covers `node-frameworks/**` only; Playwright transpiles without checking.
  Plan 6 moved those specs onto typed helpers, which raises the value of closing this. Expect a pile of
  pre-existing errors when the include is widened.

Both belong to plan 7.

### 4.6 Two small repo inconsistencies

- `packages/node/package.json` has **no `contributors` field at all**, which is inconsistent under either
  convention. It is the one manifest that needs an edit whichever way you eventually go.
- `scripts/check-pack.mjs`'s `PUBLISHED_PACKAGES` lists 12 of the 14 published packages. `react-native` and
  `react-native-sourcemaps` are absent, and the comment above the list only explains `flare-api`'s absence.
  Not a release blocker: this branch changes neither package's `exports` or `files`.

---

## 5. Decisions already taken

Recorded so they are not reopened. No action needed.

| Decision                    | Choice                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version bump                | **2.7.0 lockstep minor**, held until backend aliasing is confirmed deployed. `react-native` 2.7.0, `core` 2.7.0, `node` 0.7.0, `electron` 2.7.0. Fallback is 3.0.0 if aliasing slips.      |
| `nextjs` `removeSourcemaps` | Keep `?? true` and treat the old `?? false` as the bug. Scope removal to the client pass. Document the divergence from `@flareapp/webpack` and `@flareapp/vite` rather than aligning them. |
| `contributors` convention   | Leave alone. The mixed state ships as-is.                                                                                                                                                  |
| PRs #84 and #81             | Both stay open, you handle them. #84 is fully superseded (its `framework.ts` is blob-identical to this branch's) but was not closed.                                                       |

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
