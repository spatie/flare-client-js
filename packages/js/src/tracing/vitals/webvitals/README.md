# Vendored `web-vitals`

Copied from [GoogleChrome/web-vitals](https://github.com/GoogleChrome/web-vitals), Apache 2.0.

- Upstream commit: `45a09da8f71986c81a971a4b1c84e9538acf027b`
- Copied: 2026-07-29

**These files are unmodified.** Re-syncing is a copy, not a merge, and it stays that way only if
nobody edits them. The root `.oxfmtrc.json` and `.oxlintrc.json` both ignore this directory so our
formatter does not rewrite them. For oxlint specifically, the entry that actually does the work is
`packages/js/.oxlintrc.json`'s own `ignorePatterns` field: oxlint does not honor `ignorePatterns`
inherited through `extends`, so the root-level entry alone does not stop it from linting or
`--fix`-ing files here. Every package has its own `.oxlintrc.json` extending the root one, and for
files under `packages/js` that nested file is the one oxlint actually consults.

There is no barrel here on purpose: any file we author inside this directory would inherit the same
ignore rule and never get linted or formatted again. Import straight from the individual modules,
e.g. `import { onCLS } from './webvitals/onCLS'`.

Only the import closure of the five metric entry points is here. Not copied: `attribution/`,
`lib/getLoadState.ts`, `lib/getSelector.ts`, upstream's `index.ts`.

`types/` is copied in full even though it was flagged as out of scope at planning time, because
`types.ts` re-exports every file in it (`export * from './types/cls.js'` and so on for `base`,
`fcp`, `inp`, `lcp`, `ttfb`). Leaving it out means `types.ts` fails to resolve its own re-exports.

`bfcache.ts` and `softNavs.ts` are copied even though we want neither behaviour, because every metric
module imports them. Soft navigations stay off because they are opt-in through `ReportOpts` and we
never pass `reportSoftNavs`. A bfcache re-report is harmless because it lands after we have already
emitted, so nothing reads the updated value.
