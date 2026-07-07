import type { AttributeValue, Attributes, Config, ContextCollector } from '@flareapp/core';
import { Dimensions, Platform } from 'react-native';

import { type ExpoModules, loadExpoModules, projectExpoContext } from './expo';

/**
 * Build the synchronous React Native `ContextCollector` core's `Flare` calls on every report. Two layers:
 * RN core (`Platform`, `Dimensions`, read per call) and Expo constants (resolved once, absent on bare RN).
 *
 * The authenticated user is not projected here: `Flare.setUser` (inherited from core) writes `user.*` keys
 * straight to the active scope, like node and electron.
 *
 * `Platform.Version` is a string on iOS, number on Android, so it's stringified for `os.version`.
 * `Platform.OS` maps to `os.name` (not `os.type`, the kernel family); Expo's `osName`/`osVersion` override.
 */
export function makeReactNativeContextCollector(expo: ExpoModules = loadExpoModules()): ContextCollector {
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

        // Only fill the model when Expo didn't. Bare RN Android exposes it via `Platform.constants`;
        // bare iOS exposes none.
        if (attrs['device.model.name'] == null) {
            const model = nativeModelName();
            if (model) attrs['device.model.name'] = model;
        }

        // Also surface the device info as a `context.device` group: the semantic `device.*`/`app.*` attrs
        // aren't in Flare's typed DTO yet so they don't render, but custom context groups do. Built from
        // `attrs` so Expo's os.name/os.version overrides carry through.
        const device = buildDeviceContext(attrs);
        if (Object.keys(device).length > 0) attrs['context.device'] = device;

        return attrs;
    };
}

/**
 * Native device model from `Platform.constants`, maker-prefixed when available (e.g. `Google Pixel 7`).
 * Android exposes `Model`/`Manufacturer`/`Brand`; iOS core surfaces none (needs `expo-device`), so undefined.
 */
function nativeModelName(): string | undefined {
    if (Platform.OS !== 'android') return undefined;
    const constants = (Platform as { constants?: { Model?: string; Brand?: string; Manufacturer?: string } }).constants;
    if (!constants?.Model) return undefined;
    const maker = constants.Manufacturer ?? constants.Brand;
    return maker ? `${maker} ${constants.Model}` : constants.Model;
}

/**
 * Build a human-readable `context.device` group from the semantic attributes. Only present fields are
 * included, so bare RN (no Expo) omits `model`/`appVersion`/`appId`.
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
