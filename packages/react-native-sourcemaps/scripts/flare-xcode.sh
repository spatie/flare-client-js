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

if [ "$CONFIGURATION" != "Release" ]; then
    echo "@flareapp/react-native-sourcemaps: CONFIGURATION=$CONFIGURATION, skipping (Release only)."
    exit 0
fi

# Prefer the path the bundle phase wrote (SOURCEMAP_FILE from .xcode.env); otherwise
# reconstruct the stock location from Xcode's auto-exported build settings.
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
