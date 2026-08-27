import os from 'node:os';

import type { DeviceInfo, DeviceInfoProvider } from '@flareapp/core';

/** Electron main os + runtime as normalised device info. */
export class ElectronDeviceInfoProvider implements DeviceInfoProvider {
    collect(): DeviceInfo {
        const versions = process.versions as Record<string, string | undefined>;
        return {
            os: { name: os.type(), version: os.release() },
            runtime: { name: 'electron', version: versions.electron },
        };
    }
}

export const electronDeviceInfoProvider = new ElectronDeviceInfoProvider();
