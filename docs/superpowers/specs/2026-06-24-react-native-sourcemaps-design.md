# `@flareapp/react-native-sourcemaps` — design

Date: 2026-06-24
Status: approved for planning
Author: brainstorm session (Dries + Claude)

## Summary

A new build-time package, `@flareapp/react-native-sourcemaps`, that uploads React
Native JavaScript sourcemaps to Flare and gets a matching version into the running
app so reports symbolicate. It pairs three pieces:

1. a **Babel plugin** that inlines a build-time `version` into the app bundle,
2. a **CLI** (`flare-rn-sourcemaps upload`) that uploads a `.map` under that same
   version, and
3. **native build wiring** (an Android Gradle script + an iOS build-phase shell
   script + an Expo config plugin) so the upload runs automatically as part of a
   release build.

It reuses the shared `@flareapp/flare-api` client (same uploader, retry logic, and
payload as the vite/webpack/nextjs plugins). It is never imported into the running
app; only `@flareapp/react-native` runs there.

## Background and constraints

This is the "Metro sourcemap-upload package" follow-up named in the React Native
client handoff. Three facts drive the whole design:

- **Flare matches sourcemaps by version, not Debug ID.** The client reports
  `sourcemapVersionId` (`packages/core/src/Flare.ts:564`) and the uploader sends a
  matching `version_id` + `relative_filename` (`packages/flare-api/src/FlareApi.ts:26`).
  The backend has no Debug ID concept. Sentry's Debug ID model (a GUID baked into
  both bundle and map, matched without a release string) is more robust but needs
  backend work, so it is **out of scope**. We use the version model.

- **The version must be fixed before the bundle is built.** It has to be baked into
  the bundle's runtime config _and_ used at upload. The CLI therefore cannot
  generate a fresh version at upload time (the shipped bundle would not carry it).
  The version is an input to both halves, never an output of either.

- **The version must be inlined at bundle time, and `process.env` is the wrong
  channel.** Metro does not inline arbitrary `process.env.X` (bare RN only exposes
  `__DEV__`/`NODE_ENV`; Expo adds `EXPO_PUBLIC_*`), so a build-time transform is
  needed either way — this is why the Babel plugin exists (the same reason Sentry
  ships one). The original plan used `process.env.FLARE_SOURCEMAP_VERSION` as the
  inlined token, but verification on a bare RN app showed that is a real DX wart:
  bare RN does not type `process` (it requires `@types/node`, which wrongly drags
  Node globals into an RN app), and `process.env.X` _looks_ like a runtime env read
  when it is actually build-time-substituted. So the plugin instead inlines a
  **typed import** the app reads as a normal `string` (see Babel plugin below).

The runtime config surface already exists: core's public
`configure(config: Partial<Config>)` (`packages/core/src/Flare.ts:259`) accepts
`sourcemapVersionId`, so app code does:

```ts
import { flareSourcemapVersion } from '@flareapp/react-native-sourcemaps/runtime';
flare.light(KEY).configure({ sourcemapVersionId: flareSourcemapVersion });
```

## Why a separate package (not folded into `@flareapp/react-native`)

`@flareapp/react-native` is the runtime SDK; it loads inside Hermes/JSC and has a
fragile packaging contract (the `react-native` export condition that dodges
`node:module`). A sourcemap uploader is the opposite: a build-time Node tool needing
`node:fs`/`node:zlib` (via `@flareapp/flare-api`) and arg parsing. Folding Node build
tooling into the runtime package invites Metro to resolve `node:*`, bloats the app
install, and blurs the package's purpose. Every other sourcemap tool in this repo is
its own package (`@flareapp/vite`, `@flareapp/webpack`, `@flareapp/nextjs`), all
depending on `@flareapp/flare-api`. This follows that precedent.

## Components

### Package layout

```
packages/react-native-sourcemaps/
  src/
    version.ts            # resolveVersion() — shared by babel + cli
    babel.ts              # the version-inlining Babel plugin
    runtime.ts            # RN-safe: `export const flareSourcemapVersion = ''` (./runtime)
    uploadSourcemaps.ts   # core upload logic (no process.argv; testable)
    cli.ts                # bin entry: arg parse -> uploadSourcemaps()
    types.ts
    index.ts              # programmatic API + types
  expo/
    index.ts              # Expo config plugin (withFlareSourcemaps)
  flare.gradle            # Android: applied from android/app/build.gradle
  scripts/
    flare-xcode.sh        # iOS: wraps react-native-xcode.sh then uploads
  app.plugin.js           # Expo entry pointer -> ./expo
  package.json
```

`package.json` highlights:

- `"bin": { "flare-rn-sourcemaps": "./dist/cli.cjs" }`
- `"exports"`: `"."` (programmatic API), `"./babel"` (Babel plugin),
  `"./runtime"` (the RN-safe `flareSourcemapVersion` const, the only entry app code
  imports), `"./expo"` (config plugin), `"./package.json"`, and the raw
  `flare.gradle` / `scripts/flare-xcode.sh` shipped via `"files"`.
- `"files"` must include `dist`, `flare.gradle`, `scripts/`, `app.plugin.js`.
- depends on `@flareapp/flare-api`; dev/peer dep on `@babel/core` for the plugin.
- Built with tsdown (CJS + ESM + d.ts), matching the other build-time packages.

### 1. Version resolution (`version.ts`)

A single `resolveVersion(opts?: { version?: string }): string` used by **both** the
Babel plugin and the CLI, so they cannot disagree. Precedence:

1. explicit `--version` flag / plugin option,
2. `FLARE_SOURCEMAP_VERSION` env var,
3. fallback: the app's `package.json` `version`, with a warning logged.

Never a random UUID as a fallback — a random default would silently desync the two
halves. The env var is the recommended single channel for CI/native builds.

The `package.json` fallback is a convenience for the manual flow, but it carries the
same desync hazard in a quieter form: if `FLARE_SOURCEMAP_VERSION` is set when the
bundle is built but absent when the CLI later uploads (or vice versa), one half
resolves to the real version and the other silently falls back to the `package.json`
version. They mismatch, symbolication fails, and the only signal is a `console.warn`.
The fallback is therefore safe only when both halves resolve it identically. The
automatic native wiring (Android/iOS/Expo) must NOT rely on the fallback: it requires
`FLARE_SOURCEMAP_VERSION` to be set and fails the build when it is absent, so a desync
surfaces as a hard error rather than a broken-but-green release.

### 2. Babel plugin (`babel.ts`, exposed as `@flareapp/react-native-sourcemaps/babel`)

Added to `babel.config.js`:

```js
module.exports = { plugins: ['@flareapp/react-native-sourcemaps/babel'] };
```

At bundle time the plugin finds `import { flareSourcemapVersion } from
'@flareapp/react-native-sourcemaps/runtime'`, replaces every reference to that binding
with the resolved version string literal, and removes the now-dead import (so nothing
of this package ships in the app bundle). It resolves the version once per file
(lazily, only when the import is present) via the shared `resolveVersion()`, and a
`pre()` hook resets that per-file cache since Babel reuses plugin instances across
files.

Why a typed import rather than `process.env.FLARE_SOURCEMAP_VERSION` (the original
plan): the import is a normal typed `string`, so app authors need no `process` global,
no `@types/node`, and no ambient declaration, and there is no "looks like a runtime env
var but isn't" confusion. The `/runtime` entry is RN-safe (no Node imports) so it is
safe in Metro's graph; without the plugin it is the empty-string default, which is
harmless because maps are only uploaded for release builds. This mirrors the
ecosystem norm for build constants (e.g. expo-updates' `Updates.runtimeVersion`)
rather than `process.env`.

Plugin ordering: matching a named import is robust against other `process.env`
transforms, so ordering is not a concern in a stock setup. The aliased form
(`import { flareSourcemapVersion as v }`) is handled.

### 3. CLI (`cli.ts` + `uploadSourcemaps.ts`)

```
npx flare-rn-sourcemaps upload \
  --api-key <key> \
  --sourcemap <path/to.bundle.map> \
  --bundle-filename <index.android.bundle> \
  [--version <v>] \
  [--api-endpoint <url>] \
  [--strip-prefix <path>]
```

`uploadSourcemaps(opts)` reads the `.map`, builds a
`Sourcemap { originalFile, content }`, and calls `FlareApi.uploadSourcemap` under the
resolved `version_id`. Flare's upload payload needs only `relative_filename` +
sourcemap content (`FlareApi.ts:26-27`), **not** the bundle bytes — so, unlike
`sentry-cli`, the CLI does not ingest the bundle file. `cli.ts` only parses
`process.argv` and delegates; all logic lives in the testable `uploadSourcemaps`.

API-key handling mirrors the other plugins: missing key warns and no-ops rather than
throwing.

### 4. Android — `flare.gradle`

User adds one line to `android/app/build.gradle` (and commits it):

```groovy
apply from: "../../node_modules/@flareapp/react-native-sourcemaps/flare.gradle"
```

In `project.afterEvaluate`, for each build variant the script:

1. finds the RN bundle task `bundle{Variant}JsAndAssets`,
2. reads that task's `bundleOutput` / `sourcemapOutput`; if the app did not set a
   sourcemap output, forces one (`bundleOutput + ".map"`) so there is a map to
   upload,
3. registers an upload task wired via `bundleTask.finalizedBy(uploadTask)` that calls
   the CLI with the bundle's own paths, `--bundle-filename` = the bundle asset name,
   and the resolved version.

This mirrors Sentry's `sentry.gradle.kts` flow minus the Debug ID copy step.
`FLARE_SOURCEMAP_VERSION` must be present in the build environment so the Babel plugin
inlines the same value the upload uses; the Gradle script forwards it to the CLI
invocation and fails the build (rather than falling back to `package.json`) when it is
unset, so the inlined value and the uploaded `version_id` cannot silently diverge.

### 5. iOS — `scripts/flare-xcode.sh`

The user repoints the _"Bundle React Native code and images"_ build phase from
`react-native-xcode.sh` to `flare-xcode.sh` (documented, manual; committed once):

```sh
set -e
WITH_ENVIRONMENT="../node_modules/react-native/scripts/xcode/with-environment.sh"
FLARE_XCODE="../node_modules/@flareapp/react-native-sourcemaps/scripts/flare-xcode.sh"
/bin/sh -c "$WITH_ENVIRONMENT $FLARE_XCODE"
```

`flare-xcode.sh` runs the normal `react-native-xcode.sh` (producing bundle + map),
then runs the CLI upload against the produced map. Env (`FLARE_API_KEY`,
`FLARE_SOURCEMAP_VERSION`, `FLARE_DISABLE_AUTO_UPLOAD`) comes from `.xcode.env` or the
build phase. Like the Gradle path, it requires `FLARE_SOURCEMAP_VERSION` and errors
when it is unset rather than falling back, so the inlined and uploaded versions stay
in lockstep. No pbxproj codemod ships in v1 — this is the one genuinely manual step.

### 6. Expo — config plugin (`expo/index.ts`, `withFlareSourcemaps`)

For Expo (and EAS) users, a config plugin in `app.json` / `app.config.js`:

```js
{ "plugins": [["@flareapp/react-native-sourcemaps/expo", { /* options */ }]] }
```

At `expo prebuild` it code-mods the generated native projects: applies the Gradle
script in `app/build.gradle` and repoints the iOS bundle build phase at
`flare-xcode.sh`. Idempotent because prebuild regenerates the native dirs. These
mods are unit-testable (as Sentry's `modify*` plugin tests are). For the
managed/`expo export` flow that does not run a native build, the same CLI uploads the
maps emitted into `dist/`.

## Controls and safety

- `FLARE_DISABLE_AUTO_UPLOAD=true` opts out of the native auto-upload.
- Upload runs only for release / non-dev builds.
- Missing API key warns and no-ops (consistent with vite/webpack/nextjs).
- The native auto-wiring requires `FLARE_SOURCEMAP_VERSION` and fails the build when it
  is unset (no `package.json` fallback in the automatic path), so the inlined runtime
  version and the uploaded `version_id` cannot silently diverge.

## Open risks: map composition and `relative_filename` matching

Two things are unverified until a real release build is symbolicated end to end. Both
are folded into the single required implementation checkpoint below.

**1. Hermes-composed map.** RN release builds default to Hermes, which compiles the JS
bundle to bytecode. Production stack frames are positions in that bytecode, so the map
that actually symbolicates is the _composed_ map (the Metro JS->source map composed
with the Hermes bytecode->JS map, via `compose-source-maps`). Uploading the plain
Metro JS map instead yields wrong lines or no match at all. We do not run the
composition ourselves (out of scope below); we consume the build's composed output.
The checkpoint must confirm the map handed to `--sourcemap` is the Hermes-composed
one, not the intermediate Metro map. This is the more common RN symbolication pitfall
and matters more than the filename.

**2. `relative_filename` matching.** The backend matches a map to a stack frame by
`relative_filename` (suffix) + `version_id`. What an RN **production** stack frame's
`fileName` actually is (`index.android.bundle`? a full APK path? `main.jsbundle` /
`index.bundle` on iOS?) is **not yet verified** against a live Flare report or the
backend matcher. So `--bundle-filename` is a required, configurable flag (native wiring
defaults it to the bundle asset name the build emits); if matching needs a different
value, this flag is the adaptation point.

**End-to-end symbolication of a real release build is a required implementation
checkpoint** covering both the composed-map and the filename questions, not an
assumption.

## Testing

- **Fully unit-tested (Vitest, package-local):** `resolveVersion()` precedence; the
  Babel transform (input source -> inlined literal) via `@babel/core` `transform`;
  `uploadSourcemaps` against the shared `FakeApi`; the Expo config-plugin mods
  (Gradle-apply insertion + Xcode-phase repoint) against fixture project files.
- **Not unit-testable in this JS monorepo:** `flare.gradle` and `flare-xcode.sh`.
  These are validated by a **manual smoke build** on a sample bare-RN app (iOS +
  Android release), the same way the RN client itself was smoke-tested. The plan and
  docs state this plainly rather than imply coverage we do not have.

## Out of scope

- **Debug IDs** (needs Flare backend work; a separate initiative).
- **Owning bundle / Hermes compilation.** We consume the native build's outputs
  (composed `.map`); we do not run `react-native bundle`, `hermesc`, or
  `compose-source-maps`.
- **A bare-RN codemod wizard** (pbxproj patching). Manual docs cover bare-RN iOS;
  a wizard is a clean follow-up if demand appears.
- **Auto-injecting the `configure({ sourcemapVersionId })` call** into app code.

## Decisions captured

- Matching model: **version-based** (not Debug ID). [backend constraint]
- Package: **separate `@flareapp/react-native-sourcemaps`**, not folded into the
  runtime SDK. [packaging hygiene]
- Version injection: **Babel plugin** inlining a typed `flareSourcemapVersion` import
  from `./runtime` (revised from `process.env.FLARE_SOURCEMAP_VERSION` after the bare-RN
  verification showed `process` is untyped and the channel is misleading), shared
  `resolveVersion()` with `FLARE_SOURCEMAP_VERSION` env-var single channel. [Approach 2]
- Native wiring: **Sentry-parity** — Android Gradle one-liner + iOS build-phase
  script + Expo config plugin. [option 2]
- Name: **`...-sourcemaps`**, not `...-metro` (carries Gradle/Xcode, not just Metro).
- iOS bare-RN injection: **manual docs**, no postinstall, no v1 codemod wizard.

## Follow-ups (own specs/PRs)

- Bare-RN codemod wizard (`flare-rn-sourcemaps init`) if manual setup proves painful.
- Debug ID support (gated on Flare backend).
- Verify the Hermes-composed map (not the intermediate Metro map) is what gets
  uploaded, and verify/document per-platform `relative_filename`, once real-build
  symbolication is exercised.
