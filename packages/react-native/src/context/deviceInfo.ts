import type { DeviceInfo, DeviceInfoProvider } from '@flareapp/core';
import { Dimensions, Platform } from 'react-native';

import { type ExpoModules, expoToDeviceInfo, loadExpoModules } from './expo';

/** Expo constants (resolved once) override the per-call RN-core `Platform`/`Dimensions` values. */
export class ReactNativeDeviceInfoProvider implements DeviceInfoProvider {
    private readonly expoInfo: DeviceInfo;

    constructor(expo: ExpoModules = loadExpoModules()) {
        this.expoInfo = expoToDeviceInfo(expo);
    }

    collect(): DeviceInfo {
        const screen = Dimensions.get('window');

        const device: NonNullable<DeviceInfo['device']> = {
            screen: { width: screen.width, height: screen.height, scale: screen.scale },
            ...this.expoInfo.device,
        };
        if (device.model == null) {
            const model = nativeModelName();
            if (model != null) {
                device.model = model;
            }
        }

        const info: DeviceInfo = {
            os: {
                name: this.expoInfo.os?.name ?? Platform.OS,
                version: this.expoInfo.os?.version ?? String(Platform.Version),
            },
            device,
        };
        if (this.expoInfo.app) {
            info.app = this.expoInfo.app;
        }
        return info;
    }
}

/** Android device model from `Platform.constants`, maker-prefixed (e.g. `Google Pixel 7`). iOS core exposes none. */
function nativeModelName(): string | undefined {
    if (Platform.OS !== 'android') {
        return undefined;
    }
    const constants = (Platform as { constants?: { Model?: string; Brand?: string; Manufacturer?: string } }).constants;
    if (!constants?.Model) {
        return undefined;
    }
    const maker = constants.Manufacturer ?? constants.Brand;
    return maker ? `${maker} ${constants.Model}` : constants.Model;
}
