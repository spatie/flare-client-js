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
 * Lazy, synchronous Expo load. Uses `require` (synchronous under Metro) inside
 * try/catch so bare React Native — where these packages are absent — degrades
 * to an empty object instead of throwing. Guards `require` itself so the call
 * is safe in environments where it is undefined (e.g. some ESM test runners).
 */
export function loadExpoModules(): ExpoModules {
    const mods: ExpoModules = {};
    const req: ((id: string) => unknown) | null = typeof require !== 'undefined' ? require : null;
    if (!req) return mods;
    try {
        mods.device = req('expo-device') as ExpoDeviceModule;
    } catch {
        // expo-device not installed (bare RN) — skip.
    }
    try {
        mods.application = req('expo-application') as ExpoApplicationModule;
    } catch {
        // expo-application not installed (bare RN) — skip.
    }
    return mods;
}

// Maps Expo's `DeviceType` enum (UNKNOWN=0, PHONE=1, TABLET=2, DESKTOP=3, TV=4) to a label.
const DEVICE_TYPE_LABELS: Record<number, string> = { 1: 'phone', 2: 'tablet', 3: 'desktop', 4: 'tv' };

/**
 * Project the synchronous Expo constants into report attributes. Only the
 * fields that are present (non-null, non-undefined) are emitted. Async Expo
 * getters are intentionally not used (the context collector is synchronous).
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
