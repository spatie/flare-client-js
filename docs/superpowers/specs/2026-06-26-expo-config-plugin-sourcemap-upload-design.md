# Expo config plugin for automatic sourcemap upload (CNG) — design

Date: 2026-06-26
Package: `@flareapp/react-native-sourcemaps` (new `./expo` subpath)
Status: approved, ready for implementation planning

## Goal

Give an **Expo CNG / managed** React Native project the same automatic
release-build sourcemap upload that bare RN already has, without the user
hand-editing native files — because `expo prebuild` regenerates `android/` and
`ios/`, so manual edits to `build.gradle`, `.xcode.env`, or the `.pbxproj` do not
survive.

The plugin is a thin **native-wiring layer**: on every prebuild it re-injects
exactly the bare hooks already shipped and verified end-to-end
(`flare.gradle`, `scripts/flare-xcode.sh`) and reuses the existing CLI
(`flare-rn-sourcemaps upload --config <flare.json> --auto`), banner, and env-only
version logic unchanged. The only new code is the plugin and its pure
transformation helpers.

This is "Plan 2, part 2" — the follow-on to the bare-RN auto-upload work
(`2026-06-25-rn-bare-sourcemap-auto-upload-design.md`), which was built first so the
plugin has concrete hooks to inject.

It ships **inside the existing `@flareapp/react-native-sourcemaps` package** as a new
`./expo` subpath export. No new npm package.

**Scope of "automatic".** The plugin automates only the **native-wiring** third of
the flow. The user still does three things by hand: add
`@flareapp/react-native-sourcemaps/babel` to `babel.config.js`, pass
`flareSourcemapVersion` to `flare.configure()`, and set `FLARE_SOURCEMAP_VERSION` in
the build environment (see "Version & EAS"). And it covers **native release builds
only** (`expo run:* --variant/--configuration Release`, EAS Build) — **not** OTA /
EAS Update (see Out of scope). The docs must list the steps that remain so the plugin
is not mistaken for drop-in symbolication.

## Out of scope (non-goals)

- **No Babel auto-wiring.** Adding `@flareapp/react-native-sourcemaps/babel` to
  `babel.config.js` and passing `flareSourcemapVersion` to `flare.configure()` stay
  manual (docs steps 1-2), identical to bare. `babel.config.js` is bundler config,
  not a native project, so a config plugin is the wrong tool for it.
- **No `version` prop.** Version stays the `FLARE_SOURCEMAP_VERSION` env var (see
  "Version & EAS"). A static, committed `version` in `app.json` would upload every
  build under the same id, and — because Babel reads the env var, not the prop — would
  silently desync the inlined and uploaded versions. This is the exact footgun the
  bare design eliminated.
- **No bare-style installer**, no classic eject-and-hand-edit flow (that is just the
  bare path).
- **No OTA / EAS Update coverage.** The injected hooks fire only during a **native**
  build (`expo run:*`, EAS Build). `eas update` ships a JS bundle via `expo export`
  with no Gradle/Xcode phase, so it uploads **no map** and those frames stay minified
  even with the plugin installed. OTA releases must upload sourcemaps with the manual
  CLI (`flare-rn-sourcemaps upload`), setting the **same** `FLARE_SOURCEMAP_VERSION`
  used for the export so the inlined and uploaded versions match — the exact desync
  hazard the native path eliminates, now the user's responsibility on the export path.
  EAS Update is a primary reason teams choose managed Expo, so this gap must be called
  out prominently in the docs, not left implicit.

## Plugin API

Added to `app.json` (or `app.config.js`):

```json
{
    "expo": {
        "plugins": [
            [
                "@flareapp/react-native-sourcemaps/expo",
                { "apiKey": "YOUR_KEY", "apiEndpoint": "https://flareapp.io/api/sourcemaps" }
            ]
        ]
    }
}
```

Props:

| Prop          | Required | Default                              | Notes                                                                                                                |
| ------------- | -------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `apiKey`      | no\*     | (none)                               | Falls back to the `FLARE_API_KEY` env at build.                                                                      |
| `apiEndpoint` | no       | `https://flareapp.io/api/sourcemaps` | Override the upload endpoint (rarely needed; e.g. tests). `FLARE_API_ENDPOINT` env still overrides it at build time. |

\* If neither the prop nor `FLARE_API_KEY` is set at build time, the injected hook
skips the upload and prints the banner — the build still succeeds.

The Flare project API key is already embedded in the shipped app for error
reporting, so putting it in the committed `app.json` is not a meaningful secret leak.

The plugin is default-exported as a `createRunOncePlugin`-wrapped `ConfigPlugin`, so
applying it twice (e.g. transitively) is a no-op. `createRunOncePlugin` needs a name
and version; read the version from the package's own `package.json` (the
`./package.json` export already exists, so it is resolvable from `src/expo.ts`).

## What it injects at prebuild

1. **`flare.json` (project root).** Written from the props via a `withDangerousMod`,
   so the reused bare hooks read it through `--config`. The plugin **also appends
   `flare.json` to `.gitignore`** idempotently: it is a generated artifact derived
   from `app.json`, not a second source of truth. (This is documented as normal,
   expected behaviour so users are not surprised to see the plugin write a root file
   and touch `.gitignore`.) The bare hooks resolve this exact path already: Android
   `flare.gradle` reads `rootProject.projectDir.parentFile/flare.json`, iOS
   `flare-xcode.sh` reads `$SRCROOT/../flare.json` — both the project root.

2. **Android — `withAppBuildGradle`.** Appends an `apply from: "<path>/flare.gradle"`
   line to the generated `android/app/build.gradle`, using `mergeContents` with an
   anchor tag so it is idempotent. `<path>` is **resolved at prebuild via
   `require.resolve('@flareapp/react-native-sourcemaps/package.json')`** and expressed
   relative to `android/app/`, not hardcoded as `../../node_modules/...`. A bare user
   types that relative string by hand and can fix it; the plugin writes it where the
   user cannot, so under npm workspaces / hoisting a literal `../../node_modules`
   would silently point at nothing. Resolving the real install location keeps the
   plugin correct in monorepos. (The mod only adds the `apply from` line; all the
   task wiring lives inside `flare.gradle` itself, unchanged.)

3. **iOS (a) — `.xcode.env`.** Ensures `ios/.xcode.env` contains
   `export SOURCEMAP_FILE="$CONFIGURATION_BUILD_DIR/main.jsbundle.map"` (idempotent
   merge), so Expo's stock bundle phase emits the composed map. Confirmed against
   RN 0.85: `react-native-xcode.sh` emits and Hermes-composes the map only when
   `SOURCEMAP_FILE` is set (its `EMIT_SOURCEMAP` path), and `with-environment.sh`
   sources `ios/.xcode.env` before the phased command runs. The mod must treat a
   **missing** `ios/.xcode.env` as empty input (read `''` before merging) rather than
   assuming the prebuild template emitted one. (Editing `.xcode.env` via the plugin is
   CNG-correct because the plugin re-applies it on every prebuild — unlike a one-off
   manual edit, which prebuild would discard.)

4. **iOS (b) — `withXcodeProject`.** Adds an "Upload Flare sourcemaps"
   `PBXShellScriptBuildPhase` to the app target, running the
   `with-environment.sh`-wrapped `flare-xcode.sh` (the same snippet bare users add by
   hand). It is **appended to the end of the target's build phases**, not anchored
   after a phase located by name. The JS bundle phase ("Bundle React Native code and
   images") is never the last phase in the RN/Expo template, so appending is
   unconditionally after it — the plugin therefore does not depend on that phase's
   name or index staying stable across Expo SDKs. Idempotency is the only guard: skip
   if a phase named "Upload Flare sourcemaps" already exists.

The injected shell snippet (matching the bare iOS setup):

```sh
set -e
WITH_ENVIRONMENT="../node_modules/react-native/scripts/xcode/with-environment.sh"
FLARE_XCODE="../node_modules/@flareapp/react-native-sourcemaps/scripts/flare-xcode.sh"
/bin/sh -c "$WITH_ENVIRONMENT $FLARE_XCODE"
```

Both paths in the snippet are subject to the same hoisting concern as Android: resolve
`react-native` and `@flareapp/react-native-sourcemaps` via `require.resolve` at
prebuild and emit the resulting paths relative to `ios/`, rather than baking in the
literal `../node_modules/...` strings shown above (which are the bare, hand-typed
form).

## Idempotency & CNG behaviour

**Precondition: prebuild runs before every native build.** The injected hooks and the
generated `flare.json` exist only after `expo prebuild`. Pure-CNG apps (no committed
`android/`/`ios/`) and EAS Build satisfy this automatically. A team that **commits**
the native dirs and then builds without re-running prebuild gets no regenerated
`flare.json` (it is gitignored) and possibly stale wiring — the upload then skips with
the banner and frames stay minified, with no build failure to flag it. Documenting the
gitignore is what makes this committed-native-dirs path a deliberate, visible choice
rather than a silent degradation.

`expo prebuild --clean` regenerates the native dirs from scratch, but plain
`expo prebuild` applies mods **on top of existing** native files. So every mod must
be guarded or it duplicates on repeated prebuilds:

- `build.gradle` and `.xcode.env`: `mergeContents` with a stable anchor tag (insert
  once; a second run detects the tag and no-ops).
- The Xcode build phase: check the app target's existing phases and skip if an
  "Upload Flare sourcemaps" phase already exists (the phase is appended, so this
  name check is the whole idempotency guard — there is no insert-after-index to
  re-derive).
- `flare.json`: overwrite on each write (always reflects current props).
- `.gitignore`: append the `flare.json` line only if absent.

To make this testable, the transformations are **pure functions** wrapped by thin
`withXxx` adapters:

- `flareJsonContents(props): string`
- `addFlareGradleApply(buildGradle: string): string`
- `addSourcemapFileEnv(xcodeEnv: string): string`
- `addUploadBuildPhase(project: XcodeProject): XcodeProject`
- `ensureGitignored(gitignore: string): string`

Each is unit-testable in isolation (string in / string out, or a fixture
`XcodeProject` in/out), and each is idempotent. Note `addUploadBuildPhase` is not
literally "pure": the `xcode` library mutates the `XcodeProject` in place. Test its
contract by asserting on the mutated project — after one call exactly one
"Upload Flare sourcemaps" phase exists; after a second call still exactly one — not by
referential purity.

## Version & EAS

The plugin does **not** manage the version. `FLARE_SOURCEMAP_VERSION` is read by the
Babel plugin at bundle time and by the injected upload hook at upload time; because
both run in the same build environment they see the same value and match.

Documented placement:

- **Local:** `export FLARE_SOURCEMAP_VERSION="$(git rev-parse --short HEAD)"` before
  `expo run:android --variant release` / `expo run:ios --configuration Release`.
- **EAS Build:** set it in `eas.json` under `build.<profile>.env`, e.g.
  `"env": { "FLARE_SOURCEMAP_VERSION": "..." }`, or as an EAS environment variable.
  Both the JS bundling and the native build on the EAS machine read it.

If `FLARE_SOURCEMAP_VERSION` is unset, the injected hook skips with the banner (the
auto path has no `package.json` fallback) and the build stays green.

## Packaging

- New `src/expo.ts`, added to the tsdown `entry` list.
- New `./expo` export in `package.json`, with `require → ./dist/expo.cjs` first
  (the Expo CLI loads config plugins via Node `require`, so CJS resolution matters),
  plus the ESM/types conditions like the other subpaths.
- `@expo/config-plugins` added as an **optional `peerDependency` + `devDependency`**,
  mirroring the existing `@babel/core` pattern — only Expo users load `./expo`, and
  Expo apps already have `@expo/config-plugins` via `expo`. `xcode` types for dev as
  needed (the `XcodeProject` API comes through `@expo/config-plugins`).
- `flare.gradle` and `scripts/` are already in the package `files` allowlist from the
  bare work, so no `files` change is needed.

## Testing

- **Unit (Vitest, same as the rest of the package):**
    - `flareJsonContents`: shape from props; `apiEndpoint` defaulting; omitted `apiKey`.
    - `addFlareGradleApply`: inserts the `apply from` line; idempotent on a second run;
      leaves an unrelated `build.gradle` otherwise intact.
    - `addSourcemapFileEnv`: inserts the `SOURCEMAP_FILE` export; idempotent.
    - `addUploadBuildPhase`: against a fixture `.pbxproj`, adds exactly one
      "Upload Flare sourcemaps" phase; a second run adds none; the phase runs after the
      bundle phase.
    - `ensureGitignored`: appends `flare.json` once; no duplicate on re-run.
- **Not unit-tested:** the actual `expo prebuild` + native build (no Expo/Android/
  Xcode toolchain in CI). Correctness is the **ship gate**: on the
  `playgrounds/react-native-expo` app, `expo prebuild` then a release build on **both**
  Android and iOS must resolve a real minified frame to source in Flare under the
  build's `FLARE_SOURCEMAP_VERSION` (the "uploaded" log alone is insufficient), plus
  the negative check (build green with the banner when the version is unset). This
  mirrors bare Task 9. Runbook → `.context/rn-expo-auto-upload-runbook.md` (gitignored).

## Docs

- Update the flareapp.io RN sourcemaps doc
  (`resources/views/front/docs/react/react-native/resolving-bundled-code.md`,
  branch `docs/react-native`): replace the "Expo config plugin … on the way" note and
  the interim Step 4 callout wording with a real **Expo (CNG)** subsection — plugin
  install, the `app.json` `plugins` entry, the `eas.json` env placement, and a note
  that the plugin writes a generated `flare.json` and gitignores it (expected
  behaviour). The subsection must also: (a) list the steps that stay **manual** (babel
  plugin, `flare.configure({ flareSourcemapVersion })`, `FLARE_SOURCEMAP_VERSION`), so
  the plugin is not read as drop-in; and (b) carry a prominent **OTA / EAS Update**
  callout — the plugin does not cover `eas update`, which needs a manual
  `flare-rn-sourcemaps upload` under the same `FLARE_SOURCEMAP_VERSION` as the export.
  Coordinate with the package release (docs reference an installed version), as for the
  bare work.
- Update the package `README.md` with the Expo plugin usage alongside the bare
  section.

## Build / packaging risks to confirm during implementation

- The Expo CLI must resolve `@flareapp/react-native-sourcemaps/expo` to the **CJS**
  build. Confirm the `./expo` export's `require` condition and that the emitted
  `dist/expo.cjs` loads cleanly under `require` (no ESM-only `node:` shim breakage,
  the same class of issue the RN client hit — see the RN packaging notes).
- **iOS bundle-phase shape (de-risked on SDK 56 / RN 0.85).** RN 0.85's
  `react-native-xcode.sh` still emits and Hermes-composes the map when `SOURCEMAP_FILE`
  is set (its `EMIT_SOURCEMAP` path), and `with-environment.sh` sources `ios/.xcode.env`
  before running the phased command, so the wrapped Flare phase sees `SOURCEMAP_FILE`.
  Expo's own CLI still references the phase as "Bundle React Native code and images" on
  SDK 56, but the plugin does **not** rely on that name: **appending** the Flare phase
  (see iOS (b)) sidesteps the name/position question entirely. The only remaining
  ship-gate check is that the appended phase finds the composed map at runtime on the
  actually-prebuilt project (the bundle phase having run earlier in the same build).
- That `@flareapp/react-native-sourcemaps/expo` and `react-native` resolve via
  `require.resolve` from the prebuild context so the injected relative paths are
  correct under hoisting (the monorepo playground is itself a hoisting case to verify).
