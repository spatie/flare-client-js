/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserDeviceInfoProvider } from '../src/browser/context/deviceInfo';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('BrowserDeviceInfoProvider', () => {
    it('reads hardware, screen, network and locale', () => {
        vi.stubGlobal('navigator', {
            deviceMemory: 8,
            hardwareConcurrency: 10,
            onLine: true,
            language: 'en-US',
            connection: { effectiveType: '4g', downlink: 10, rtt: 50 },
        });
        vi.stubGlobal('screen', { width: 1920, height: 1080 });
        vi.stubGlobal('devicePixelRatio', 2);

        const info = new BrowserDeviceInfoProvider().collect();

        expect(info.device).toEqual({ memoryGb: 8, cpuCores: 10, screen: { width: 1920, height: 1080, scale: 2 } });
        expect(info.network).toEqual({ online: true, effectiveType: '4g', downlinkMbps: 10, rttMs: 50 });
        expect(info.locale?.language).toBe('en-US');
        expect(typeof info.locale?.timezone).toBe('string');
    });

    it('drops an unknown effectiveType such as 5g', () => {
        vi.stubGlobal('navigator', { onLine: true, connection: { effectiveType: '5g' } });

        const info = new BrowserDeviceInfoProvider().collect();

        expect(info.network).toEqual({ online: true });
    });

    it('returns nothing when there is no window', () => {
        vi.stubGlobal('window', undefined);

        expect(new BrowserDeviceInfoProvider().collect()).toEqual({});
    });
});
