import type { DeviceInfo, DeviceInfoProvider } from '@flareapp/core';

import { readNetwork, readScreen, readTimezone, type NavigatorWithExtras } from './deviceReaders';

// Reads what the User-Agent lacks: hardware, screen, network. Static reads cached; screen and network per call.
export class BrowserDeviceInfoProvider implements DeviceInfoProvider {
    private staticInfo: Pick<DeviceInfo, 'device' | 'locale'> | null = null;

    collect(): DeviceInfo {
        // Node 21+ has a global `navigator`; require `window` too so SSR reads nothing.
        if (typeof window === 'undefined' || typeof navigator === 'undefined') {
            return {};
        }

        const nav = navigator as NavigatorWithExtras;
        const info: DeviceInfo = {};

        const staticInfo = this.readStatic(nav);
        const screen = readScreen();
        const device = { ...staticInfo.device, ...(screen ? { screen } : {}) };
        if (Object.keys(device).length > 0) {
            info.device = device;
        }
        if (staticInfo.locale) {
            info.locale = staticInfo.locale;
        }

        const network = readNetwork(nav);
        if (network) {
            info.network = network;
        }

        return info;
    }

    private readStatic(nav: NavigatorWithExtras): Pick<DeviceInfo, 'device' | 'locale'> {
        if (this.staticInfo) {
            return this.staticInfo;
        }

        const device: NonNullable<DeviceInfo['device']> = {};
        if (typeof nav.deviceMemory === 'number') {
            device.memoryGb = nav.deviceMemory;
        }
        if (typeof nav.hardwareConcurrency === 'number') {
            device.cpuCores = nav.hardwareConcurrency;
        }

        const locale: NonNullable<DeviceInfo['locale']> = {};
        if (nav.language) {
            locale.language = nav.language;
        }
        const timezone = readTimezone();
        if (timezone) {
            locale.timezone = timezone;
        }

        this.staticInfo = {
            device: Object.keys(device).length > 0 ? device : undefined,
            locale: Object.keys(locale).length > 0 ? locale : undefined,
        };
        return this.staticInfo;
    }
}

// Shared singleton so the static read is cached across reports.
export const browserDeviceInfoProvider = new BrowserDeviceInfoProvider();
