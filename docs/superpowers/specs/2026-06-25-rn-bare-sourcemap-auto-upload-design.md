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
- No JSC-specific handling. Hermes is the RN default; a JSC build still produces a
  plain `.map` the same hooks upload, just without special treatment.
- No Debug-build uploads. Release variants/configurations only.

## Configuration — `flare.json`

A committed JSON file at the project root, read by both platform hooks:

```json
{
    "apiKey": "...",
    "apiEndpoint": "https://flareapp.io/api/sourcemaps",
    "version": "optional-explicit-version"
}
```

The Flare project API key is already embedded in the shipped app for error
reporting, so committing it here is not a meaningful secret leak.

Per-field resolution, **env var wins**, then file, then default:

| Field        | Env override              | `flare.json` key | Default                                 |
| ------------ | ------------------------- | ---------------- | --------------------------------------- |
| API key      | `FLARE_API_KEY`           | `apiKey`         | (none — skip upload with banner)        |
| API endpoint | `FLARE_API_ENDPOINT`      | `apiEndpoint`    | `https://flareapp.io/api/sourcemaps`    |
| Version      | `FLARE_SOURCEMAP_VERSION` | `version`        | `resolveVersion()` chain (package.json) |

The env-first rule lets CI inject the key without editing files, while `flare.json`
is the single committed source of truth the later Expo plugin will reuse.

The `version` must match what the babel plugin inlined into the bundle
(`flareSourcemapVersion`). Both sides flow through the same `resolveVersion()` chain
(flag/`version` > `FLARE_SOURCEMAP_VERSION` > package.json `version`), and the babel
transform and the native upload run inside the same build invocation, so they see
the same env and the same package.json. This coupling is a correctness invariant:
if they diverge, the backend version match fails and frames stay unresolved.

## Android — `flare.gradle`

Ship `flare.gradle` in the package. The user adds one line to
`android/app/build.gradle`:

```gradle
apply from: "../../node_modules/@flareapp/react-native-sourcemaps/flare.gradle"
```

`flare.gradle`:

- Hooks each **release** `bundle{Variant}JsAndAssets` task with a `doLast` action.
- Resolves the composed map RN already generated at
  `android/app/build/generated/sourcemaps/react/release/index.android.bundle.map`.
- Reads `flare.json` / env (via the CLI's self-config — see Shared internals).
- Shells out to `flare-rn-sourcemaps upload --sourcemap <map>
--bundle-filename index.android.bundle`.
- Is guarded to release variants only; debug builds do nothing.

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

    The stock "Bundle React Native code and images" phase now emits the map.

2. Add a new "Upload Flare sourcemaps" build phase **after** the bundle phase,
   running:

    ```sh
    ../node_modules/@flareapp/react-native-sourcemaps/scripts/flare-xcode.sh
    ```

`flare-xcode.sh`:

- Guards on `CONFIGURATION == Release` (no-op otherwise).
- Locates the map at the `SOURCEMAP_FILE` path the bundle phase just wrote.
- Reads `flare.json` / env.
- Calls `flare-rn-sourcemaps upload --sourcemap <map>
--bundle-filename main.jsbundle`.

The stock RN bundle phase is never modified, so RN upgrades that touch it don't
break Flare (upgrade-safe).

## Shared internals

Both hooks ultimately invoke the same CLI / `uploadSourcemaps()` path already
verified end-to-end. The one new shared piece is a small **`flare.json` reader**
that merges env overrides over file values (precedence table above).

The CLI (`flare-rn-sourcemaps upload`) gains an implicit "read `flare.json` if a flag
is absent" behaviour so the hooks can call it with minimal flags and let it
self-configure. Existing explicit flags keep working unchanged and still take
precedence over `flare.json` (explicit flag > env > file > default). This keeps the
manual/verification CLI flow from PR #66 fully backward compatible.

## Failure behaviour & the banner

Uploads **never fail the build**. On no-key or upload error (timeout, 5xx, missing
map, etc.), print a multi-line boxed banner to stderr — deliberately large so it is
not overlooked in a long CI log:

```

============================================================
  FLARE SOURCEMAP UPLOAD FAILED
  Reason: <message>
  Your release will report minified stack traces until the
  sourcemap is uploaded. Re-run manually:
    npx flare-rn-sourcemaps upload --sourcemap <path> \
      --bundle-filename <name> --api-key <key>
============================================================

```

(blank line above and below the box.) Rationale: a transient upload failure should
not block shipping a working app — only symbolication is delayed and is recoverable
with a manual re-run. The no-key case especially must never break a build (e.g. a
contributor building without Flare credentials). A one-line "failed to upload"
message is too easy to miss, hence the banner.

Successful uploads keep the existing concise success log
(`@flareapp/react-native-sourcemaps: Successfully uploaded sourcemap to Flare.`).

## Testing

- **Unit (Vitest, same as the rest of the package):**
    - `flare.json` reader: env-override precedence, missing file, malformed JSON,
      partial file (some keys present), and the explicit-flag > env > file > default
      chain.
    - Banner formatter: shape, reason interpolation, surrounding blank lines.
    - CLI self-config path: flags still win; falls back to `flare.json`; falls back to
      env; skip-with-banner when no key resolvable.
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
