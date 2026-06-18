import { describe, expect, it } from 'vitest';

import { loadExpoModules, projectExpoContext } from '../src/context/expo';

describe('expo loader', () => {
    it('loadExpoModules returns empty object when Expo packages are absent', () => {
        // In the node test env neither expo-device nor expo-application resolve.
        expect(loadExpoModules()).toEqual({});
    });

    it('projectExpoContext maps sync device + application fields to OTel keys', () => {
        const attrs = projectExpoContext({
            device: { modelName: 'iPhone 15', osName: 'iOS', osVersion: '17.0', deviceType: 1 },
            application: { nativeApplicationVersion: '1.2.3', applicationId: 'io.flare.app' },
        });
        expect(attrs['device.model.name']).toBe('iPhone 15');
        expect(attrs['os.name']).toBe('iOS');
        expect(attrs['os.version']).toBe('17.0');
        expect(attrs['device.type']).toBe(1);
        expect(attrs['app.version']).toBe('1.2.3');
        expect(attrs['app.id']).toBe('io.flare.app');
    });

    it('projectExpoContext omits keys for missing/null fields', () => {
        const attrs = projectExpoContext({ device: { modelName: null }, application: {} });
        expect('device.model.name' in attrs).toBe(false);
        expect('app.version' in attrs).toBe(false);
    });

    it('projectExpoContext on empty modules returns empty attrs', () => {
        expect(projectExpoContext({})).toEqual({});
    });
});
