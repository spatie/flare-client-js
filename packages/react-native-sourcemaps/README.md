# @flareapp/react-native-sourcemaps

Upload React Native (Metro) JavaScript sourcemaps to Flare so production stack
traces are symbolicated.

It has two halves that share one version string:

1. A **Babel plugin** that inlines a build-time version into your app bundle.
2. A **CLI** (`flare-rn-sourcemaps upload`) that uploads the `.map` under that
   same version.

> The manual CLI flow below works everywhere. For **bare React Native** you can also
> wire the upload into the native release build so it happens automatically — see
> "Automatic upload (bare React Native)" near the end. The Expo config plugin ships
> separately.

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

Then pass the inlined version when configuring Flare. Import `flareSourcemapVersion`
from the package's runtime entry — it's a typed `string`, so there is no `process`
global to type and no `@types/node` to add:

```ts
import { flare } from '@flareapp/react-native';
import { flareSourcemapVersion } from '@flareapp/react-native-sourcemaps/runtime';

flare.light(FLARE_KEY).configure({ sourcemapVersionId: flareSourcemapVersion });
```

The plugin replaces every reference to `flareSourcemapVersion` with the version it
resolves at bundle time (and removes the import, so nothing of this package ships in
your app bundle). Without the plugin the value is an empty string, which is harmless.
Set the version in your build environment:

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

## Automatic upload (bare React Native)

Instead of running the CLI by hand, wire it into your native release build. Both
hooks read a committed `flare.json` at your project root:

```json
{
    "apiKey": "your-flare-api-key",
    "apiEndpoint": "https://flareapp.io/api/sourcemaps"
}
```

`apiKey` may also come from the `FLARE_API_KEY` environment variable (which wins over
the file, so CI can inject it without committing a key).

The version is taken **only** from `FLARE_SOURCEMAP_VERSION` here (the same variable
the Babel plugin reads), so the inlined version and the uploaded version always match.
Set it in your build environment:

```bash
export FLARE_SOURCEMAP_VERSION="$(git rev-parse --short HEAD)"
```

If the key or `FLARE_SOURCEMAP_VERSION` is missing, the upload is **skipped with a
large warning banner** — your build never fails because of a sourcemap problem.

### Android

Add one line to `android/app/build.gradle` (after the `react` block):

```gradle
apply from: "../../node_modules/@flareapp/react-native-sourcemaps/flare.gradle"
```

This uploads the Hermes-composed map after every `release` JS-bundle task.

### iOS

1. Tell the stock React Native bundle phase to emit a sourcemap by adding this line
   to `ios/.xcode.env`:

    ```sh
    export SOURCEMAP_FILE="$CONFIGURATION_BUILD_DIR/main.jsbundle.map"
    ```

2. In Xcode, add a new "Run Script" build phase named **Upload Flare sourcemaps**,
   placed **after** "Bundle React Native code and images", with this script:

    ```sh
    set -e
    WITH_ENVIRONMENT="../node_modules/react-native/scripts/xcode/with-environment.sh"
    FLARE_XCODE="../node_modules/@flareapp/react-native-sourcemaps/scripts/flare-xcode.sh"
    /bin/sh -c "$WITH_ENVIRONMENT $FLARE_XCODE"
    ```

    The `with-environment.sh` wrapper is required so the phase sees `SOURCEMAP_FILE`
    (and any `FLARE_*` vars) exported by `.xcode.env`.

Both hooks only run for **Release** builds; debug builds do nothing.

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
