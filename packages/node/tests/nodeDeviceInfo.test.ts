import os from 'node:os';

import { describe, expect, it } from 'vitest';

import { NodeDeviceInfoProvider } from '../src/context/deviceInfo';

describe('NodeDeviceInfoProvider', () => {
    it('maps os and runtime', () => {
        const info = new NodeDeviceInfoProvider().collect();
        expect(info.os).toEqual({ name: os.type(), version: os.release() });
        expect(info.runtime).toEqual({ name: 'nodejs', version: process.version });
    });
});
