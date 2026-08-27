import { describe, expect, it } from 'vitest';

import { expoToDeviceInfo, loadExpoModules } from '../src/context/expo';

describe('expo loader', () => {
    it('loadExpoModules returns empty object when Expo packages are absent', () => {
        // In the node test env neither expo-device nor expo-application resolve.
        expect(loadExpoModules()).toEqual({});
    });

    it('expoToDeviceInfo maps sync device + application fields', () => {
        const info = expoToDeviceInfo({
            device: { modelName: 'iPhone 15', osName: 'iOS', osVersion: '17.0', deviceType: 1 },
            application: { nativeApplicationVersion: '1.2.3', applicationId: 'io.flare.app' },
        });
        expect(info.os).toEqual({ name: 'iOS', version: '17.0' });
        expect(info.device).toEqual({ model: 'iPhone 15', type: 'phone' });
        expect(info.app).toEqual({ version: '1.2.3', id: 'io.flare.app' });
    });

    it('expoToDeviceInfo omits missing/null fields', () => {
        const info = expoToDeviceInfo({ device: { modelName: null }, application: {} });
        expect(info.device).toBeUndefined();
        expect(info.os).toBeUndefined();
        expect(info.app).toBeUndefined();
    });

    it('expoToDeviceInfo on empty modules returns an empty object', () => {
        expect(expoToDeviceInfo({})).toEqual({});
    });

    it('expoToDeviceInfo handles a partial module set (device only, no application)', () => {
        const info = expoToDeviceInfo({ device: { modelName: 'X', deviceType: 2 } });
        expect(info.device).toEqual({ model: 'X', type: 'tablet' });
        expect(info.app).toBeUndefined();
    });
});
