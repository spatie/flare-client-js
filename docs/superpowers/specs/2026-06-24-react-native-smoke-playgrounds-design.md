# React Native smoke-test playgrounds — design

Date: 2026-06-24
Status: Approved, ready for implementation plan

## Goal

Add two manually-runnable React Native apps under `playgrounds/` that exercise
`@flareapp/react-native` on real simulators/devices: one **bare** React Native
app and one **Expo** (managed) app. They are a manual smoke-test harness — tap a
button per capture path, confirm the report lands in Flare. They close the
"manual Expo + bare smoke tests pending before un-drafting" task and give a
runtime check of the recent fixes (#1 Metro-safe Expo require, #2 fatal
flush-before-delegate, #3 shared rejection routing).

Not automated e2e, not a CI target, not a UI showcase.

## Decisions (locked during brainstorming)

1. **Purpose:** manual smoke-test harness (run on simulator/device, tap, verify).
2. **Monorepo integration:** standalone apps, excluded from npm workspaces. Own
   `node_modules` + Metro each; never hoisted. Keeps root `npm install` lean.
3. **Scaffolding:** official CLIs at latest stable (no version pin in the spec;
   `@latest` resolves to ~Expo SDK 56 / RN 0.86 as of 2026-06). Record the exact
   resolved versions in each app's README after scaffolding.
4. **Version coverage:** latest only. No 0.79-floor app (the Metro harness in
   `.context/metro-validation/` already covers the bundler-level part of fix #1;
   a floor runtime check can be added later if breakage surfaces).
5. **Reports destination:** configurable. A git-ignored `flare.config.ts` holds
   `key` + `ingestUrl`, defaulting to real Flare ingress, with an escape hatch to
   the local fake-flare-server.

## Layout

```
playgrounds/
  react-native-bare/    # @react-native-community/cli init (RN latest)
  react-native-expo/    # create-expo-app (Expo SDK latest, managed)
```

### Workspace exclusion

`playgrounds/*` is an npm-workspace glob, and RN apps as workspace members is a
Metro/hoisting minefield (duplicate react, haste collisions, every contributor's
`npm install` pulling RN + Expo + native deps). So both apps are excluded:

```jsonc
// root package.json
"workspaces": [
    "packages/*",
    "playgrounds/*",
    "!playgrounds/react-native-bare",
    "!playgrounds/react-native-expo"
]
```

npm's `map-workspaces` supports `!` negation. **Verify before relying:** after
editing, run `npm query .workspace` (or `npm install --dry-run`) and confirm
neither RN app appears as a workspace. If negation is not honored on the
installed npm version, fall back to listing the web playgrounds explicitly
instead of the `playgrounds/*` glob.

### Git

- Gitignore (root or per-app): `node_modules`, `ios/Pods`, `*.xcworkspace/xcuserdata`,
  build output (`android/build`, `android/app/build`, `ios/build`, `.expo`).
- **Bare app commits its native `ios/` and `android/` dirs.** A bare RN app has
  no clean regeneration step, so gitignoring them would make it non-runnable
  after clone. Large file count is inherent to "bare" and accepted.
- **Expo app stays managed** — no `ios/`/`android/` committed; it runs via
  `expo run:ios` / `expo run:android` (prebuild on demand) or Expo Go.

## SDK consumption — tarball relink

A script `scripts/rn-relink.mjs` (Node, run from repo root) that:

1. Builds the local packages: `@flareapp/core`, `@flareapp/react`,
   `@flareapp/react-native` (`npm run build` each).
2. `npm pack` each into a temp dir, producing three tarballs.
3. `npm install --omit=peer <core>.tgz <react>.tgz <react-native>.tgz` into the
   target app (argument selects bare / expo / both). `--omit=peer` is required:
   without it npm 7+ auto-installs `@flareapp/react`'s `@flareapp/js` peer from
   the registry into the app (see the constraints below).
4. **Verify the install closure** before declaring success (see "Install
   verification" below). The relink fails loudly if the wrong core leaked in or
   if `@flareapp/js` ended up in the tree.

This installs the **exact published artifacts** — exports map, the
`react-native` export condition fix #1 added, the inlined SDK version — rather
than symlinked source, so the smoke test validates real packaging.

Constraints / notes:

- `@flareapp/react-native` hard-pins `@flareapp/core` to exact `2.5.0`, and the
  local core is also `2.5.0`. The risk is **not** a version bump (the spec's
  earlier framing was wrong): the dangerous case is **same version, different
  content**. The whole point of a smoke test is to validate local fixes that are
  not yet published, so the local `2.5.0` will routinely contain code the
  registry `2.5.0` does not (e.g. fix #3's `routeRejection` in
  `packages/core/src/util/rejection.ts`, a new file). When npm resolves the RN
  SDK's nested `@flareapp/core@2.5.0` dependency, dedup _should_ point it at the
  top-level local tarball (it satisfies the range), but if the registry copy
  leaks in instead, the harness silently validates the wrong core. Do not rely on
  dedup silently — assert it (see "Install verification").
- `react` / `react-native` are peers, provided by each app's own template install.
- `@flareapp/react` is a peer of the RN SDK; installing its tarball satisfies it.
  The RN SDK consumes only `@flareapp/react/inject` at runtime, never the package
  main entry. This matters: `@flareapp/react`'s **main** entry imports
  `@flareapp/js`, which the relink does **not** install. The `/inject` subpath
  exists precisely to avoid that dependency. So the bundle is clean only as long
  as nothing resolves `@flareapp/react`'s `.` entry — never add a bare
  `@flareapp/react` (main) import to either app, or Metro breaks on an
  unresolvable `@flareapp/js`.
- **`@flareapp/js` is also an auto-installed peer.** Separately from any import,
  `@flareapp/react` declares `@flareapp/js` as a **peer dependency**, and npm 7+
  auto-installs missing peers by default. A plain `npm install` of the react
  tarball therefore pulls a registry `@flareapp/js` into the app even though
  nothing imports it (verified on npm 10). The relink passes `--omit=peer` to
  prevent this; the install-verification asserts `@flareapp/js` absence as a
  backstop. `react` / `react-native` peers stay satisfied by the app template, so
  `--omit=peer` costs nothing.
- **Metro package-exports prerequisite.** `@flareapp/react/inject` is a subpath
  with no main-field fallback, so Metro resolves it ONLY via the exports map,
  which requires `unstable_enablePackageExports`. Expo's `@expo/metro-config`
  enables it by default; the **bare template does not** (it defaults to `false`
  through current RN), so the bare app MUST set
  `resolver.unstable_enablePackageExports = true` in `metro.config.js` — this is
  required, not defensive. Note `@flareapp/react`'s exports map has **no
  `react-native` condition** (only `import`/`require`); fix #1 added that
  condition to the RN SDK package, not to `@flareapp/react`. Metro falls back to
  `require`/`import`, which works. Record the resolved entry in the README.
- The **Expo app additionally** `npm install`s `expo-device` + `expo-application`
  (real packages) so the Expo enrichment path runs. The **bare app installs
  neither**, exercising the graceful-degrade path.
- Re-run `rn-relink` after any SDK source change; document this in each README.

### Install verification (relink step 4)

After `npm install`, the script asserts the install closure and exits non-zero
on any failure rather than printing a green checkmark:

1. **Correct core, not the registry copy.** Stamp the local core build with a
   sentinel the registry `2.5.0` cannot have, then confirm it landed. Cheapest
   reliable check: pack the local core, then after install compare the installed
   `node_modules/@flareapp/core` against the packed tarball (e.g. a content hash
   of `dist/`, or assert a known local-only symbol such as the `routeRejection`
   export is present in the installed `dist`). If they differ, the registry copy
   leaked in via dedup — fail with a message telling the user to clear the app's
   `node_modules`/lockfile and re-run.
2. **`@flareapp/js` absent.** Assert `node_modules/@flareapp/js` does not exist
   in the app. This is a defense-in-depth backstop, not the primary guard (the
   bundle gate is — physical presence is harmless unless something imports it).
   With the relink's `--omit=peer` it should never appear; if it does, the likely
   cause is a dropped peer-omit letting npm auto-install `@flareapp/react`'s
   `@flareapp/js` peer, not an App import of `@flareapp/react`'s main entry. Fail
   loudly either way.
3. **Single react / react-native.** Sanity-check there is exactly one copy of
   `react` and `react-native` resolved (no haste collision from a stray hoist).

## App content

Both apps render one `ScrollView` screen titled "Flare RN smoke test", with the
whole tree wrapped in `<FlareErrorBoundary fallback={…}>`. At boot:

```ts
import { flare } from '@flareapp/react-native';
import { config } from './flare.config';

flare.configure({ ingestUrl: config.ingestUrl, stage: 'smoke' });
flare.light(config.key);
```

If `config.key` is still the placeholder, the screen shows a "set your project
key in flare.config.ts" banner instead of running scenarios.

One button per scenario (each shows a short toast/status line after tapping):

| #   | Button                                                           | Exercises                                                                                                    |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Sync throw (uncaught)                                            | `ErrorUtils` global handler, non-fatal                                                                       |
| 2   | Fatal error (`global.ErrorUtils.reportFatalError(new Error(…))`) | **fix #2** flush-before-delegate                                                                             |
| 3   | Unhandled rejection — Error reason                               | engine tracker → `reportSilently` (stack kept)                                                               |
| 4   | Unhandled rejection — string reason                              | engine tracker → `reportUnhandledRejection`                                                                  |
| 5   | React render error + Reset                                       | `FlareErrorBoundary` capture + `resetKeys`/reset                                                             |
| 6   | Manual `flare.report(new Error(…))`                              | direct report path                                                                                           |
| 7   | `flare.glow(…)` then report                                      | breadcrumb attached to report                                                                                |
| 8   | `flare.setUser({…})` then report                                 | `enduser.*` attributes                                                                                       |
| 9   | Context marker report                                            | eyeball `os.*`, `device.screen.*`, and (Expo) `device.model.name` / `app.version` = **fix #1 runtime proof** |

`App.tsx` is written per app (≈80 lines). Slight differences (Expo wires the
context-marker expectation around `expo-device`; bare notes those keys will be
absent) make cross-app sharing not worth the linking complexity for standalone
apps — duplication is accepted.

### Fix #2 caveat (must be in the README)

The fatal flush-before-delegate path is gated to `!__DEV__`. In a dev bundle the
button reports but does **not** delay the crash, so to actually observe fix #2 you
must run a **release build** (`npm run ios -- --mode Release` / `expo run:ios
--configuration Release`).

Observability is the hard part: pointing a release build at real Flare ingress
proves the report _arrives_ but not that it beat the crash. To actually verify
the _ordering_ (flushed before delegate, i.e. before termination), point
`ingestUrl` at the **local fake-flare-server** (LAN IP, see Config) and read the
timestamped receipt from `/__inspect/reports`. A receipt logged before the
process dies is the proof; real ingress cannot give you that ordering signal.
The README must steer scenario #2 to the fake-server path for this reason.

## Config

- `flare.config.ts` — git-ignored, real values:
    ```ts
    export const config = {
        key: 'YOUR-FLARE-PROJECT-KEY',
        ingestUrl: 'https://ingress.flareapp.io/v1/errors',
    };
    ```
- `flare.config.example.ts` — checked-in template (placeholder key, real ingress
  URL, and a commented fake-server line).
- Fake-flare-server escape hatch: set `ingestUrl` to
  `http://<your-Mac-LAN-IP>:7765/api/reports` (NOT `localhost` — a sim/device
  resolves `localhost` to itself). Boot the server with the existing
  `e2e/fake-flare-server` and inspect via its `/__inspect/reports` API.

## Run & docs

- Per-app `README.md`: prerequisites, `node scripts/rn-relink.mjs <app>`, then
  `npm run ios` / `npm run android` (bare) or `npx expo run:ios` / Expo Go
  (Expo); the scenario table; where reports go; the fix #2 release-build note;
  the recorded resolved RN/Expo versions.
- Root `README.md`: add two rows to the package/playground table.
- Optional root convenience scripts (non-workspace, plain `node`/`cd`):
  `rn:relink`, and a note that the apps are run from their own dirs (they are not
  workspace members, so `--workspace` does not apply).

## What this validates

- **fix #1 at runtime:** Expo app surfaces `device.model.name` / `app.version`;
  bare app gracefully omits them. Complements the build-time Metro harness.
- **fix #2:** fatal button in a release build delivers the report before crash.
- **fix #3 + baseline:** rejection routing (Error vs string), boundary capture,
  device/screen/OS context, `setUser` projection, glows.

## Out of scope / follow-ups

- Automated e2e (Detox or Maestro) against the fake server.
- A 0.79-floor app.
- CI integration / headless device farm.
- Sharing a scenario module across the two apps.

## Risks

- **Scaffolding is heavy and may snag headlessly.** The CLIs download templates,
  run `npm install`, and (iOS) `pod install`. Run non-interactively with flags;
  if a step fails in the sandbox, report it rather than fabricate success. A
  CocoaPods/native step failing does not block the JS-level scaffold — the app
  can still be relinked and run later on a full dev machine.
- **npm workspace negation** must be verified (see above); have the explicit-list
  fallback ready.
- **Relink closure can validate the wrong code.** Same-version local-vs-registry
  core, or a stray `@flareapp/js`, would make the harness pass against the wrong
  bundle. Mitigated by the mandatory install verification (relink step 4); the
  script must fail loudly, never warn-and-continue.
- **Bare native dirs enlarge the diff** — accepted, documented.
