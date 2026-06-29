# Bare React Native automatic sourcemap upload — design

Date: 2026-06-25
Package: `@flareapp/react-native-sourcemaps`
Status: approved, ready for implementation planning

## Goal

Make a **bare** React Native release build upload its composed Hermes sourcemap to
Flare automatically, as part of the native build, with no manual CLI step. This is
"Plan 2 — native auto-wiring" deferred from the original RN sourcemaps work
(`2026-06-24-react-native-sourcemaps-design.md`). The JS core it builds on — the
`flare-rn-sourcemaps upload` CLI, `uploadSourcemaps()`, `resolveVersion()`, and the
babel version-inlining plugin — already shipped (PR #66) and is verified end-to-end
on Android/iOS/Expo.

This spec covers **bare RN only** (Android + iOS). The Expo config plugin for CNG
mode is a **separate, later spec** that injects these same hooks at prebuild; it is
explicitly out of scope here. Building bare first gives that plugin concrete hooks
to inject.

All new artifacts ship **inside the existing `@flareapp/react-native-sourcemaps`
package**. No new npm package.

## Non-goals (YAGNI)

- No automated installer that patches `build.gradle` / `.pbxproj`. Wiring is manual
  and documented. (The Expo plugin is the automated-wiring story for CNG users.)
- No `failBuild` strict mode. Uploads never fail the build (see Failure behaviour).
- No `FLARE_DISABLE_AUTO_UPLOAD` opt-out env var. The wiring is manual and tiny (one
  `apply from` line on Android, one build phase on iOS), so to disable the upload you
  remove the wiring rather than toggle an env var. This drops the control the original
  `2026-06-24` design listed; it is redundant given how small the wiring is.
- No JSC-specific handling. Hermes is the RN default; a JSC build still produces a
  plain `.map` the same hooks upload, just without special treatment.
- No Debug-build uploads. The hooks skip **debug** builds (matched case-insensitively
  as a substring) and otherwise upload whenever a composed sourcemap was produced —
  configuration-name-agnostic, so renamed/custom release configs (Staging, Production,
  AppStore, custom Android build types) are covered. Gating on the artifact, not a
  literal `Release` name, is what makes bare/brownfield projects work.

## Configuration — `flare.json`

A committed JSON file at the project root, read **only by the upload hooks** (never
by the Babel plugin):

```json
{
    "apiKey": "...",
    "apiEndpoint": "https://flareapp.io/api/sourcemaps"
}
```

`flare.json` carries only the API key and endpoint. It deliberately does **not**
carry a `version` key (reasons in "Version resolution in the auto path" below) nor a
`relative_filename` override (reasons in "`relative_filename` and the deferred
override" below).

The Flare project API key is already embedded in the shipped app for error
reporting, so committing it here is not a meaningful secret leak.

Per-field resolution, **env var wins**, then file, then default:

| Field        | Env override         | `flare.json` key | Default                              |
| ------------ | -------------------- | ---------------- | ------------------------------------ |
| API key      | `FLARE_API_KEY`      | `apiKey`         | (none — skip upload with banner)     |
| API endpoint | `FLARE_API_ENDPOINT` | `apiEndpoint`    | `https://flareapp.io/api/sourcemaps` |

The env-first rule lets CI inject the key without editing files, while `flare.json`
is the single committed source of truth the later Expo plugin will reuse.

### `relative_filename` and the deferred override

`--bundle-filename` sets the `relative_filename` the backend matches against runtime
stack frames. The hooks do **not** hardcode it; the CLI defaults it to the map
basename minus `.map`, which is correct for a stock build and follows a renamed bundle
automatically. The manual `--bundle-filename` flag remains the override for the manual
CLI flow.

There is **no auto-path override in v1** (no `flare.json` key, no `--platform` flag).
An override would only matter if a production frame's `fileName` differs from the map
basename, which is still unverified (`2026-06-24` open risks), and the step that would
prove it — end-to-end symbolication on the bare playground — is in this plan's
verification task. So the override is deferred: ship the basename default, let
verification be the gate, and add an override only if a real mismatch appears, shaped
by the real data (including whether it even needs to be per-platform). Because each
hook already knows its platform, that knowledge is available at the point of need
without a generic CLI flag.

### Locating `flare.json` (no cwd guessing)

The hooks run with a platform-specific working directory (`android/` for Gradle,
`ios/` for the Xcode phase), not the project root, so the reader must NOT resolve
`flare.json` relative to `process.cwd()`. Each hook computes the project root from
its own known location and passes it explicitly:

- The CLI gains a `--config <path-to-flare.json>` flag; the hooks always pass it.
- Android: the Gradle script derives the root from `rootProject.projectDir` (the RN
  project root) and passes `--config "$rootDir/flare.json"`.
- iOS: `flare-xcode.sh` runs in `ios/`, so it passes `--config "$SRCROOT/../flare.json"`.

A missing `flare.json` is not an error: the reader returns an empty config and
resolution falls through to env, then to the no-key skip-with-banner.

### Version resolution in the auto path

The version inlined into the bundle (by the Babel plugin, during Metro bundling) and
the version the map is uploaded under (by the hook) **must be identical**, or the
backend match fails and frames stay minified. This is a correctness invariant, not a
convenience.

The two halves run as **separate processes with different working directories**
(Metro at the project root; the hook in `android/` or `ios/`). The only input
guaranteed identical to both is an **environment variable** in the shared build
environment. `package.json` is not: it is resolved cwd-relative by `resolveVersion()`
(`src/version.ts`), so Metro and the hook would read different files (and the hook
would read a non-existent `ios/package.json` and throw). `flare.json` is not either:
the Babel plugin never reads it. Therefore, in the auto path:

- **Version flows exclusively through `FLARE_SOURCEMAP_VERSION`.** Both the Babel
  plugin and the upload hook read the same env var from the same build invocation.
  `flare.json` has no `version` key.
- **The hooks disable the `package.json` fallback.** The CLI gains an `--auto` flag
  the hooks pass; in that mode `resolveVersion()` does not fall back to `package.json`.
  The fallback remains available only for the **manual CLI flow** (PR #66), where the
  user controls both sides and resolves the same value themselves.
- **Key present but `FLARE_SOURCEMAP_VERSION` unset → skip the upload and print the
  failure banner** with reason `FLARE_SOURCEMAP_VERSION is not set`. Do not fall back
  to `package.json`, and do not fail the build. Skipping is the safe choice: uploading
  a map we cannot guarantee matches the bundle is worse than not uploading, and the
  loud banner names exactly what to set. (The no-key contributor build already skipped
  one check earlier, so this only fires on a real, keyed release that forgot the
  version.)

This restores the hard guarantee from the original design (`2026-06-24`: "the
automatic native wiring must NOT rely on the fallback") while honouring the non-goal
of never failing the build. A version misconfiguration degrades to skip-with-banner,
not a build break.

## Android — `flare.gradle`

Ship `flare.gradle` in the package. The user adds one line to
`android/app/build.gradle`:

```gradle
apply from: "../../node_modules/@flareapp/react-native-sourcemaps/flare.gradle"
```

`flare.gradle`:

- Hooks each **release** `bundle{Variant}JsAndAssets` task with a `doLast` action.
- Reads the map path **off the task** (`sourcemapOutput`, falling back to
  `bundleOutput + ".map"`) rather than a literal path, so a custom `bundleAssetName`
  flows through. For a stock app this resolves to
  `android/app/build/generated/sourcemaps/react/release/index.android.bundle.map`.
- Does **not** hardcode `--bundle-filename`; the CLI defaults it to the map basename
  minus `.map`, so a renamed bundle is handled for free (no auto-path override in v1,
  see "`relative_filename` and the deferred override").
- Invokes the CLI through `npx` (or the resolved `node_modules/.bin` path), because a
  bare `flare-rn-sourcemaps` is not on `PATH` inside a Gradle `exec`:
  `npx flare-rn-sourcemaps upload --sourcemap <map> --config "$rootDir/flare.json"
--auto`.
- Skips only `*debug*` (case-insensitive) variants; for every other variant it relies
  on the "no sourcemap -> skip" guard, so renamed/custom release build types still
  upload. The fallback map path derives the variant subdir from the task name (not a
  hardcoded `release/`).

The exact task-graph wiring (variant iteration, task-name resolution across RN
Gradle Plugin versions) is to be confirmed during implementation research against
the bare playground.

## iOS — `flare-xcode.sh` + `.xcode.env` (approach iOS-1)

`react-native-xcode.sh` only emits a composed `.map` when `SOURCEMAP_FILE` is set.
We get that without touching RN's stock build phase. Two documented manual edits:

1. Add to `ios/.xcode.env` (committed — safe in bare RN; unlike CNG, native dirs are
   not regenerated):

    ```sh
    export SOURCEMAP_FILE="$CONFIGURATION_BUILD_DIR/main.jsbundle.map"
    ```

    The stock "Bundle React Native code and images" phase sources `.xcode.env`
    through `with-environment.sh` and now emits the map at that path.

2. Add a new "Upload Flare sourcemaps" build phase **after** the bundle phase. It
   must source the **same** environment the bundle phase used, so it sees
   `SOURCEMAP_FILE` (and any `FLARE_*` exports in `.xcode.env` / `.xcode.env.local`).
   Wrap it in `with-environment.sh`, exactly as RN's own bundle phase does:

    ```sh
    set -e
    WITH_ENVIRONMENT="../node_modules/react-native/scripts/xcode/with-environment.sh"
    FLARE_XCODE="../node_modules/@flareapp/react-native-sourcemaps/scripts/flare-xcode.sh"
    /bin/sh -c "$WITH_ENVIRONMENT $FLARE_XCODE"
    ```

    Invoking `flare-xcode.sh` directly (without `with-environment.sh`) is wrong: a
    separate run-script phase does not inherit the shell exports `.xcode.env` set for
    the bundle phase, so `SOURCEMAP_FILE` and any `FLARE_*` vars would be absent.

`flare-xcode.sh`:

- Skips only when `$CONFIGURATION` contains `debug` (case-insensitive, via `tr` +
  `case` — POSIX, no bashisms). For every other configuration name it falls through to
  the sourcemap-existence check below, so renamed/custom release configs upload.
- Resolves the map path. Prefer `$SOURCEMAP_FILE` (present now that the phase is
  wrapped in `with-environment.sh`); if it is unset, reconstruct
  `$CONFIGURATION_BUILD_DIR/main.jsbundle.map` (Xcode build settings like
  `CONFIGURATION_BUILD_DIR` are auto-exported to run-script phases even without
  `.xcode.env`). Banner-and-skip if neither yields an existing file.
- Reads `flare.json` via `--config "$SRCROOT/../flare.json"`, with env overrides.
- Does **not** hardcode `--bundle-filename`; the CLI defaults it to the map basename
  minus `.map` (`main.jsbundle` for a stock app). A renamed iOS bundle means editing the
  `SOURCEMAP_FILE` line above to match, after which the basename default follows
  automatically.
- Calls `flare-rn-sourcemaps upload --sourcemap "$SOURCEMAP_FILE"
--config "$SRCROOT/../flare.json" --auto`.

The stock RN bundle phase is never modified, so RN upgrades that touch it don't
break Flare (upgrade-safe).

## Shared internals

Both hooks ultimately invoke the same CLI / `uploadSourcemaps()` path already
verified end-to-end. Two small new shared pieces:

1. A **`flare.json` reader** that takes an explicit path (`--config <path>`, never
   cwd-relative — see "Locating `flare.json`") and merges env overrides over file
   values for `apiKey` and `apiEndpoint`.
2. An **`--auto` flag** on `flare-rn-sourcemaps upload` that the hooks pass. In auto
   mode the CLI: (a) reads `--config` for key/endpoint,
   (b) resolves the version from `FLARE_SOURCEMAP_VERSION` only, with the
   `package.json` fallback disabled, and (c) when a key is present but the version is
   unresolved, skips the upload and prints the failure banner instead of uploading a
   guaranteed-mismatched map.

Per-flag precedence stays `explicit flag > env > file (flare.json) > default`, except
version in auto mode, which is env-only by design (the desync hazard above). Existing
explicit flags keep working unchanged, so the manual/verification CLI flow from
PR #66 — and its `package.json` version fallback — is fully backward compatible.

## Failure behaviour & the banner

Uploads **never fail the build**. On no-key, **version unset** (auto mode with a key
but no `FLARE_SOURCEMAP_VERSION`), or an upload error (timeout, 5xx, unreadable map,
etc.), print a multi-line boxed banner to stderr — deliberately large so it is not
overlooked in a long CI log:

```

============================================================
  FLARE SOURCEMAP UPLOAD FAILED
  Reason: <message>
  Your release will report minified stack traces until the
  sourcemap is uploaded. Re-run manually:
    npx flare-rn-sourcemaps upload --sourcemap <path> \
      --bundle-filename <name> --version <version> --api-key <key>
============================================================

```

(blank line above and below the box.) The `<path>`, `<name>`, `<version>`, and
`<key>` in the re-run command are **interpolated with the real resolved values**
where known, falling back to labelled placeholders otherwise (e.g. `<version>` stays
a placeholder in the version-unset case, which is the value the user must supply), so
the user can copy-paste the recovery command.

**No map produced is a skip, not a banner.** If the build emitted no sourcemap at all
(e.g. Hermes disabled, or a misconfigured bundle step), the hook logs a single-line
skip ("no sourcemap at `<path>`, skipping upload") rather than the loud banner, and
never invokes the CLI. That is a distinct condition from a failed upload: there is
nothing to upload, so the banner's "re-run manually" recovery would not apply. The
banner is reserved for the cases where a map exists but the upload cannot complete
(no-key, version-unset, network/5xx, unreadable map handed to the CLI).

**Exit-code contract** (this is what makes "never fail the build" real — a Gradle
`doLast` and an Xcode run-script phase both abort the build on a non-zero child
exit): in auto mode the CLI **always exits 0** for no-key, version-unset, and upload
errors, printing the banner. The only non-zero exit is genuine CLI misuse (unknown
command, missing `--sourcemap`), which a correctly wired hook never triggers. Note
this is a change from the current code: `uploadSourcemaps()` lets `FlareApi` errors
propagate (which would exit non-zero), so the CLI must catch them in auto mode,
banner, and exit 0.

Rationale: a transient upload failure should not block shipping a working app — only
symbolication is delayed and is recoverable with a manual re-run. The no-key case
especially must never break a build (e.g. a contributor building without Flare
credentials). A one-line "failed to upload" message is too easy to miss, hence the
banner.

Successful uploads keep the existing concise success log
(`@flareapp/react-native-sourcemaps: Successfully uploaded sourcemap to Flare.`).

## Testing

- **Unit (Vitest, same as the rest of the package):**
    - `flare.json` reader: explicit `--config <path>` (no cwd dependence — assert it
      reads the passed path, not `process.cwd()`), env-override precedence for
      `apiKey`/`apiEndpoint`, missing file (returns empty config), malformed JSON,
      partial file, and that it ignores any `version` key if present.
    - `relative_filename` resolution: with no `--bundle-filename`, the CLI defaults to
      the map basename minus `.map` (there is no auto-path override in v1).
    - Banner formatter: shape, reason interpolation, real path/name/key interpolation
      (not literal placeholders), surrounding blank lines.
    - CLI config path: explicit flags still win; falls back to `flare.json`; falls
      back to env; skip-with-banner when no key resolvable.
    - `--auto` mode version handling: uses `FLARE_SOURCEMAP_VERSION`; does **not**
      fall back to `package.json`; key-present-but-version-unset skips the upload and
      banners. Non-auto (manual) mode keeps the `package.json` fallback.
    - Exit-code contract: auto-mode no-key / version-unset / upload error all exit 0
      (assert `process.exitCode` is unset/0 and `FlareApi` rejections are caught);
      arg misuse exits 1.
- **Not unit-tested:** the Gradle and shell glue (no RN/Android/Xcode toolchain in
  CI). Correctness is verified via a manual runbook against the bare playground
  (`playgrounds/react-native-bare`) on an Android emulator and an iOS simulator,
  the same approach that validated the JS core in PR #66. The runbook is recorded in
  `.context/` (gitignored).

## Docs

- Update the package `README.md`: the Android one-liner, the two iOS edits, the
  `flare.json` format and resolution rules, and the failure/banner behaviour.
- Cross-link / extend the flareapp.io RN sourcemaps doc in a separate docs PR,
  coordinated with the package release (the docs reference an installed package
  version), as was done for PR #66 / docs PR #2436.

## Build / packaging notes

- New shipped files (`flare.gradle`, `scripts/flare-xcode.sh`) must be added to the
  package `files` allowlist so they are published. They are not TypeScript build
  outputs — confirm tsdown / `files` includes them (currently `files: ["dist"]`).
- `flare-xcode.sh` must be executable (mode `0755`) in the published tarball.
