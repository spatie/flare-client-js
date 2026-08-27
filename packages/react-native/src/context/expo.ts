import type { DeviceInfo } from '@flareapp/core';

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
    if (typeof require === 'undefined') {
        return mods;
    }
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

/** Expo's `DeviceType` enum (UNKNOWN=0, PHONE=1, TABLET=2, DESKTOP=3, TV=4). */
const DEVICE_TYPE_LABELS: Record<number, string> = { 1: 'phone', 2: 'tablet', 3: 'desktop', 4: 'tv' };

/** Normalise the synchronous Expo constants into `DeviceInfo`. Only present (non-null) fields are set. */
export function expoToDeviceInfo(expo: ExpoModules): DeviceInfo {
    const info: DeviceInfo = {};

    const device = expo.device;
    if (device) {
        const os: NonNullable<DeviceInfo['os']> = {};
        if (device.osName != null) {
            os.name = device.osName;
        }
        if (device.osVersion != null) {
            os.version = device.osVersion;
        }
        if (Object.keys(os).length > 0) {
            info.os = os;
        }

        const target: NonNullable<DeviceInfo['device']> = {};
        if (device.modelName != null) {
            target.model = device.modelName;
        }
        if (device.deviceType != null && DEVICE_TYPE_LABELS[device.deviceType]) {
            target.type = DEVICE_TYPE_LABELS[device.deviceType];
        }
        if (Object.keys(target).length > 0) {
            info.device = target;
        }
    }

    const application = expo.application;
    if (application) {
        const app: NonNullable<DeviceInfo['app']> = {};
        if (application.nativeApplicationVersion != null) {
            app.version = application.nativeApplicationVersion;
        }
        if (application.applicationId != null) {
            app.id = application.applicationId;
        }
        if (Object.keys(app).length > 0) {
            info.app = app;
        }
    }

    return info;
}
