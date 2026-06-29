#!/bin/sh
# Flare automatic sourcemap upload for bare React Native (iOS).
#
# Invoked from an Xcode "Upload Flare sourcemaps" build phase placed AFTER the stock
# "Bundle React Native code and images" phase, wrapped in with-environment.sh so it
# sees SOURCEMAP_FILE (and any FLARE_* exports) from .xcode.env:
#
#   set -e
#   WITH_ENVIRONMENT="../node_modules/react-native/scripts/xcode/with-environment.sh"
#   FLARE_XCODE="../node_modules/@flareapp/react-native-sourcemaps/scripts/flare-xcode.sh"
#   /bin/sh -c "$WITH_ENVIRONMENT $FLARE_XCODE"
#
# Never fails the build: the CLI exits 0 in --auto mode, and the upload call is
# guarded with `|| true`.

# Don't gate on the configuration NAME being "Release". Brownfield and bare apps rename
# it or add release-style configurations (Staging, Production, AppStore, ...), none of
# which equal "Release" — requiring that literal name would silently skip the upload on
# exactly the builds that ship. The real signal is whether a composed sourcemap was
# produced: only a bundled + Hermes-compiled (release-style) build emits one, and a
# Debug/Metro build emits none, so the SOURCEMAP_PATH check below skips it for free.
# We only fast-path the dev config, matched case-insensitively as a substring so
# "Debug", "debug", "StagingDebug", etc. are all caught (POSIX sh: tr + case, no
# bashisms).
CONFIGURATION_LC=$(printf '%s' "$CONFIGURATION" | tr '[:upper:]' '[:lower:]')
case "$CONFIGURATION_LC" in
    *debug*)
        echo "@flareapp/react-native-sourcemaps: CONFIGURATION=$CONFIGURATION, skipping (dev build)."
        exit 0
        ;;
esac

# Prefer the path the bundle phase wrote (SOURCEMAP_FILE from .xcode.env, the
# documented setup). The fallback is a best-effort heuristic for the stock iOS
# layout; if SOURCEMAP_FILE is unset and no map exists there, we skip below.
SOURCEMAP_PATH="$SOURCEMAP_FILE"
if [ -z "$SOURCEMAP_PATH" ]; then
    SOURCEMAP_PATH="$CONFIGURATION_BUILD_DIR/main.jsbundle.map"
fi

if [ ! -f "$SOURCEMAP_PATH" ]; then
    echo "@flareapp/react-native-sourcemaps: no sourcemap at $SOURCEMAP_PATH, skipping upload."
    exit 0
fi

CONFIG_PATH="$SRCROOT/../flare.json"

CLI="$SRCROOT/../node_modules/.bin/flare-rn-sourcemaps"
if [ -x "$CLI" ]; then
    "$CLI" upload --sourcemap "$SOURCEMAP_PATH" --config "$CONFIG_PATH" --auto || true
else
    npx flare-rn-sourcemaps upload --sourcemap "$SOURCEMAP_PATH" --config "$CONFIG_PATH" --auto || true
fi

exit 0
