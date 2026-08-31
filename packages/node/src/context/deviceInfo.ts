import os from 'node:os';

import type { DeviceInfo, DeviceInfoProvider } from '@flareapp/core';

// Node os + runtime as normalised device info.
export class NodeDeviceInfoProvider implements DeviceInfoProvider {
    collect(): DeviceInfo {
        return {
            os: { name: os.type(), version: os.release() },
            runtime: { name: 'nodejs', version: process.version },
        };
    }
}

export const nodeDeviceInfoProvider = new NodeDeviceInfoProvider();
