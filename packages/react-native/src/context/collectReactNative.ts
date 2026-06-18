import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import { Dimensions, Platform } from 'react-native';

import type { User } from '../types';
import { type ExpoModules, loadExpoModules, projectExpoContext } from './expo';

/**
 * Build the React Native `ContextCollector` that core's `Flare` calls on every
 * report. Synchronous, matching `ContextCollector = (config) => Attributes`.
 *
 * Sources, layered:
 * 1. RN core (`Platform`, `Dimensions`) — read on every call.
 * 2. Expo constants — resolved once (injected for tests, else `loadExpoModules()`)
 *    and projected; absent on bare RN.
 * 3. The authenticated user — read from `getUser()` at call time so
 *    `setUser(...)` after construction is reflected without rebuilding.
 *
 * `Platform.Version` is a string on iOS but a number on Android, so it is
 * stringified for the `os.version` attribute. `Platform.OS` maps to `os.name`
 * (NOT `os.type`, which conventionally means the kernel family); when Expo is
 * present its `osName`/`osVersion` overwrite these coarser values.
 */
export function makeReactNativeContextCollector(
    getUser: () => User | null,
    expo: ExpoModules = loadExpoModules(),
): ContextCollector {
    const expoAttrs = projectExpoContext(expo);

    return (_config: Readonly<Config>): Attributes => {
        const screen = Dimensions.get('window');

        const attrs: Attributes = {
            'os.name': Platform.OS,
            'os.version': String(Platform.Version),
            'device.screen.width': screen.width,
            'device.screen.height': screen.height,
            'device.screen.scale': screen.scale,
            ...expoAttrs,
        };

        const user = getUser();
        if (user) {
            if (user.id !== undefined) attrs['enduser.id'] = String(user.id);
            if (user.email !== undefined) attrs['enduser.email'] = user.email;
            if (user.username !== undefined) attrs['enduser.username'] = user.username;
        }

        return attrs;
    };
}
