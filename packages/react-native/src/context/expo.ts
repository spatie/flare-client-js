import type { Attributes } from '@flareapp/core';

export type ExpoDeviceModule = {
    modelName?: string | null;
    osName?: string | null;
    osVersion?: string | null;
    deviceType?: number | null;
};

export type ExpoApplicationModule = {
    nativeApplicationVersion?: string | null;
    applicationId?: string | null;
};

export type ExpoModules = {
    device?: ExpoDeviceModule;
    application?: ExpoApplicationModule;
};

/**
 * Lazy, synchronous Expo load. The `require(...)` calls MUST be direct string literals: Metro statically
 * collects only literal `require('pkg')` calls, treating those inside a try/catch as optional deps
 * (`allowOptionalDependencies` is on by default), so a missing package degrades to a caught throw not a
 * build error. Do NOT alias `require` to a local; that defeats the static collection and the module never
 * resolves even when installed. The `typeof require` guard keeps non-Metro/ESM envs (some test runners) safe.
 */
export function loadExpoModules(): ExpoModules {
    const mods: ExpoModules = {};
    if (typeof require === 'undefined') return mods;
    try {
        mods.device = require('expo-device') as ExpoDeviceModule;
    } catch {
        // expo-device not installed (bare RN); skip.
    }
    try {
        mods.application = require('expo-application') as ExpoApplicationModule;
    } catch {
        // expo-application not installed (bare RN); skip.
    }
    return mods;
}

/** Maps Expo's `DeviceType` enum (UNKNOWN=0, PHONE=1, TABLET=2, DESKTOP=3, TV=4) to a label. */
const DEVICE_TYPE_LABELS: Record<number, string> = { 1: 'phone', 2: 'tablet', 3: 'desktop', 4: 'tv' };

/**
 * Project the synchronous Expo constants into report attributes. Only present (non-null) fields are emitted.
 * Async Expo getters are not used, since the context collector is synchronous.
 */
export function projectExpoContext(expo: ExpoModules): Attributes {
    const attrs: Attributes = {};
    const device = expo.device;
    if (device) {
        if (device.modelName != null) attrs['device.model.name'] = device.modelName;
        if (device.osName != null) attrs['os.name'] = device.osName;
        if (device.osVersion != null) attrs['os.version'] = device.osVersion;
        if (device.deviceType != null) {
            const label = DEVICE_TYPE_LABELS[device.deviceType];
            if (label) attrs['device.type'] = label;
        }
    }
    const application = expo.application;
    if (application) {
        if (application.nativeApplicationVersion != null) {
            attrs['app.version'] = application.nativeApplicationVersion;
        }
        if (application.applicationId != null) attrs['app.id'] = application.applicationId;
    }
    return attrs;
}
