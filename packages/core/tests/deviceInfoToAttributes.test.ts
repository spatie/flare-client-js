import { describe, expect, it } from 'vitest';

import { buildDeviceContextGroup, deviceInfoToAttributes } from '../src/device/deviceInfoToAttributes';
import type { DeviceInfo } from '../src/device/types';

describe('deviceInfoToAttributes', () => {
    it('returns an empty object for empty info', () => {
        expect(deviceInfoToAttributes({})).toEqual({});
    });

    it('drops undefined and null fields', () => {
        const info: DeviceInfo = { os: { name: 'iOS', version: undefined }, device: { memoryGb: undefined } };
        expect(deviceInfoToAttributes(info)).toEqual({ 'os.name': 'iOS' });
    });

    it('maps os and runtime to flat keys without a device card', () => {
        const info: DeviceInfo = {
            os: { name: 'Darwin', version: '23.4.0' },
            runtime: { name: 'nodejs', version: 'v22.0.0' },
        };

        const attrs = deviceInfoToAttributes(info);

        expect(attrs).toEqual({
            'os.name': 'Darwin',
            'os.version': '23.4.0',
            'process.runtime.name': 'nodejs',
            'process.runtime.version': 'v22.0.0',
        });
        expect(attrs['context.device']).toBeUndefined();
    });

    it('maps device and network to flat keys and a device card', () => {
        const info: DeviceInfo = {
            device: { memoryGb: 8, cpuCores: 10, screen: { width: 1920, height: 1080, scale: 2 } },
            network: { effectiveType: '4g', downlinkMbps: 10, rttMs: 50, online: true },
            locale: { language: 'en-US', timezone: 'Europe/Brussels' },
        };

        const attrs = deviceInfoToAttributes(info);

        expect(attrs['device.memory_gb']).toBe(8);
        expect(attrs['device.cpu_cores']).toBe(10);
        expect(attrs['device.screen.width']).toBe(1920);
        expect(attrs['device.screen.height']).toBe(1080);
        expect(attrs['device.screen.scale']).toBe(2);
        expect(attrs['network.effective_type']).toBe('4g');
        expect(attrs['network.downlink_mbps']).toBe(10);
        expect(attrs['network.rtt_ms']).toBe(50);
        expect(attrs['network.online']).toBe(true);

        expect(attrs['context.device']).toEqual({
            'Screen': '1920 × 1080 @ 2x',
            'Memory': '8 GB',
            'CPU cores': 10,
            'Connection': '4g',
            'Downlink': '10 Mbps',
            'RTT': '50 ms',
            'Online': true,
            'Language': 'en-US',
            'Timezone': 'Europe/Brussels',
        });
    });
});

describe('buildDeviceContextGroup', () => {
    it('returns an empty object when only os or runtime is present', () => {
        expect(buildDeviceContextGroup({ os: { name: 'Darwin' }, runtime: { name: 'nodejs' } })).toEqual({});
    });

    it('joins os name and version into one OS row when device data exists', () => {
        const group = buildDeviceContextGroup({
            os: { name: 'iOS', version: '17.4' },
            device: { model: 'iPhone 15' },
        });
        expect(group).toEqual({ Model: 'iPhone 15', OS: 'iOS 17.4' });
    });

    it('omits scale from the screen row when it is absent', () => {
        const group = buildDeviceContextGroup({ device: { screen: { width: 800, height: 600 } } });
        expect(group.Screen).toBe('800 × 600');
    });
});
