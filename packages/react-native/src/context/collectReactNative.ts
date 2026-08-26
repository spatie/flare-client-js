import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import { deviceInfoToAttributes } from '@flareapp/core';

import { ReactNativeDeviceInfoProvider } from './deviceInfo';
import { type ExpoModules, loadExpoModules } from './expo';

export function makeReactNativeContextCollector(expo: ExpoModules = loadExpoModules()): ContextCollector {
    const provider = new ReactNativeDeviceInfoProvider(expo);
    return (_config: Readonly<Config>): Attributes => deviceInfoToAttributes(provider.collect());
}
