# @flareapp/react-native-sourcemaps

Upload React Native (Metro) JavaScript sourcemaps to Flare so production stack
traces are symbolicated.

It has two halves that share one version string:

1. A **Babel plugin** that inlines a build-time version into your app bundle.
2. A **CLI** (`flare-rn-sourcemaps upload`) that uploads the `.map` under that
   same version.

> Native auto-wiring (Android Gradle, iOS Xcode, Expo config plugin) ships
> separately. This package covers the manual and `expo export` flows.

## Install

```bash
npm install --save-dev @flareapp/react-native-sourcemaps
```

## 1. Inline the version into your app

Add the Babel plugin to `babel.config.js`:

```js
module.exports = {
    presets: ['module:@react-native/babel-preset'],
    plugins: ['@flareapp/react-native-sourcemaps/babel'],
};
```

Then read the inlined value when configuring Flare:

```js
import { flare } from '@flareapp/react-native';

flare.light(FLARE_KEY).configure({ sourcemapVersionId: process.env.FLARE_SOURCEMAP_VERSION });
```

The plugin replaces `process.env.FLARE_SOURCEMAP_VERSION` with the version it
resolves at bundle time. Set that version in your build environment:

```bash
export FLARE_SOURCEMAP_VERSION="$(git rev-parse --short HEAD)"
```

If unset, it falls back to your app's `package.json` version (with a warning). Use the
**same** version when you build the bundle and when you upload the map. If the two
differ (for example the env var is set during the build but not during a later upload
step, so one side falls back to `package.json`), the map will not match and
symbolication silently fails.

If your Babel config adds a generic `process.env` inliner (such as
`babel-plugin-transform-inline-environment-variables`), list this plugin before it so
the version token is not rewritten first. The default React Native and Expo presets do
not inline `process.env`, so no ordering change is needed for a stock setup.

## 2. Upload the sourcemap

Generate a bundle + map, then upload the map under the **same** version:

> Release builds use Hermes, which compiles your JS to bytecode. The map that
> symbolicates production frames is the **Hermes-composed** map, not the plain Metro JS
> map. Point `--sourcemap` at the composed `.map` your build emits (the one next to the
> shipped bundle), not an intermediate Metro map.

```bash
# Example: Android, Hermes-composed map produced by your build
npx flare-rn-sourcemaps upload \
  --api-key "$FLARE_KEY" \
  --sourcemap android/app/build/.../index.android.bundle.map \
  --bundle-filename index.android.bundle \
  --version "$FLARE_SOURCEMAP_VERSION"
```

Flags:

| Flag                | Required | Description                                                                                    |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `--sourcemap`       | yes      | Path to the composed `.map` file.                                                              |
| `--api-key`         | yes\*    | Flare API key. Falls back to `FLARE_API_KEY`.                                                  |
| `--bundle-filename` | no       | `relative_filename` matched against runtime frames. Defaults to the map basename minus `.map`. |
| `--version`         | no       | Defaults to `FLARE_SOURCEMAP_VERSION`, then `package.json` version.                            |
| `--api-endpoint`    | no       | Defaults to `https://flareapp.io/api/sourcemaps`.                                              |

\* Without a key the command warns and does nothing.

## Expo (`expo export`)

```bash
FLARE_SOURCEMAP_VERSION="$(git rev-parse --short HEAD)" npx expo export
npx flare-rn-sourcemaps upload \
  --api-key "$FLARE_KEY" \
  --sourcemap dist/_expo/static/js/ios/index-*.hbc.map \
  --bundle-filename main.jsbundle \
  --version "$FLARE_SOURCEMAP_VERSION"
```

> `--bundle-filename` must match how frames appear in your Flare reports. If
> traces are not symbolicating, that is the value to adjust.
