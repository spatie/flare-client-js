import type { AttributeValue, Attributes, Config, ContextCollector } from '@flareapp/core';
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

        // Expo's `expo-device` supplies a friendly model on both platforms. Without
        // it (bare RN), Android still exposes the model via `Platform.constants`;
        // iOS core exposes none, so bare iOS has no model. Only fill when Expo
        // didn't already provide one.
        if (attrs['device.model.name'] == null) {
            const model = nativeModelName();
            if (model) attrs['device.model.name'] = model;
        }

        const user = getUser();
        if (user) {
            if (user.id !== undefined) attrs['enduser.id'] = String(user.id);
            if (user.email !== undefined) attrs['enduser.email'] = user.email;
            if (user.username !== undefined) attrs['enduser.username'] = user.username;
        }

        // Also project the device info as a `context.device` group. The semantic
        // attributes above (`device.*`, `app.*`) are not in Flare's typed
        // AttributesData DTO yet, so they are not rendered; custom context groups
        // ARE rendered generically by the Flare UI, so this surfaces the device
        // info without a backend/type change. Built from `attrs` so Expo's
        // os.name/os.version overrides are reflected.
        const device = buildDeviceContext(attrs);
        if (Object.keys(device).length > 0) attrs['context.device'] = device;

        return attrs;
    };
}

/**
 * Native device model from `Platform.constants`. Android exposes
 * `Model`/`Manufacturer`/`Brand`; iOS core does not surface a device model (it
 * needs `expo-device` or a native module), so iOS returns undefined. Prefixes the
 * model with its maker when available (e.g. `Google Pixel 7`).
 */
function nativeModelName(): string | undefined {
    if (Platform.OS !== 'android') return undefined;
    const constants = (Platform as { constants?: { Model?: string; Brand?: string; Manufacturer?: string } }).constants;
    if (!constants?.Model) return undefined;
    const maker = constants.Manufacturer ?? constants.Brand;
    return maker ? `${maker} ${constants.Model}` : constants.Model;
}

/**
 * Build a human-readable `context.device` group from the collected semantic
 * attributes. Only present fields are included, so the bare app (no Expo)
 * naturally omits `model` / `appVersion` / `appId`.
 */
function buildDeviceContext(attrs: Attributes): Record<string, AttributeValue> {
    const device: Record<string, AttributeValue> = {};

    if (attrs['device.model.name'] != null) device.model = attrs['device.model.name'];

    const os = [attrs['os.name'], attrs['os.version']].filter((v) => v != null).join(' ');
    if (os) device.OS = os;

    const width = attrs['device.screen.width'];
    const height = attrs['device.screen.height'];
    const scale = attrs['device.screen.scale'];
    if (width != null && height != null) {
        device.screen = scale != null ? `${width} × ${height} @ ${scale}x` : `${width} × ${height}`;
    }

    if (attrs['app.version'] != null) device.appVersion = attrs['app.version'];
    if (attrs['app.id'] != null) device.appId = attrs['app.id'];

    return device;
}
