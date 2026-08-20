# Needs your attention

Things on the `feat/breadcrumb-buffer` branch that need a human, collected so they are not spread across
task briefs and review comments.

Anything here is either a decision only you can make, a check no automated suite can run, or a finding that
was deliberately left alone. Nothing here is a bug that slipped through review.

Last updated 2026-08-20, on `feat/breadcrumb-buffer`, covering work through the final whole-branch review
fixes (base `d7f3004`).

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
