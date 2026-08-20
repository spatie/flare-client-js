# Needs your attention

Things on the `feat/breadcrumb-buffer` branch that need a human, collected so they are not spread across
task briefs and review comments.

Anything here is either a decision only you can make, a check no automated suite can run, or a finding that
was deliberately left alone. Nothing here is a bug that slipped through review.

Last updated 2026-08-20, at branch tip `9700b23` (Task 4, the glow cutover, complete and reviewed).

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
which has only a getter`) in strict mode, or silently no-ops in loose mode. Same semver note as 1.2: nothing
in this monorepo assigns to `.glows` directly (everything goes through `Flare.glow()` /
`Flare.clearGlows()`), but it is a breaking change to a public class's public surface if anything outside
this repo did.

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
