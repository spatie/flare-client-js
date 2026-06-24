import { DEFAULT_URL_DENYLIST } from '@flareapp/core';
import { Platform } from 'react-native';
import { afterEach, describe, expect, it } from 'vitest';

import { makeReactNativeContextCollector } from '../src/context/collectReactNative';
import type { User } from '../src/types';

const config = { urlDenylist: DEFAULT_URL_DENYLIST } as never;

afterEach(() => {
    Platform.OS = 'ios';
    Platform.Version = '17.0';
    Platform.constants = undefined;
});

describe('React Native ContextCollector', () => {
    it('emits RN core platform + screen attributes', () => {
        const collect = makeReactNativeContextCollector(() => null, {});
        const attrs = collect(config);
        expect(attrs['os.name']).toBe('ios');
        expect(attrs['os.version']).toBe('17.0');
        expect(attrs['device.screen.width']).toBe(390);
        expect(attrs['device.screen.height']).toBe(844);
        expect(attrs['device.screen.scale']).toBe(3);
    });

    it('stringifies a numeric Android Platform.Version', () => {
        Platform.OS = 'android';
        Platform.Version = 34;
        const collect = makeReactNativeContextCollector(() => null, {});
        const attrs = collect(config);
        expect(attrs['os.name']).toBe('android');
        expect(attrs['os.version']).toBe('34');
    });

    it('Expo osName/osVersion override the coarser RN-core values', () => {
        const collect = makeReactNativeContextCollector(() => null, {
            device: { modelName: 'Pixel 8', osName: 'Android', osVersion: '14' },
            application: { nativeApplicationVersion: '2.0.0' },
        });
        const attrs = collect(config);
        expect(attrs['device.model.name']).toBe('Pixel 8');
        expect(attrs['os.name']).toBe('Android'); // Expo's value wins over RN's 'ios'/'android'
        expect(attrs['os.version']).toBe('14');
        expect(attrs['app.version']).toBe('2.0.0');
    });

    it('projects the current user via the getter (read at call time)', () => {
        let user: User | null = null;
        const collect = makeReactNativeContextCollector(() => user, {});
        expect('enduser.id' in collect(config)).toBe(false);
        user = { id: 7, email: 'a@b.c', username: 'neo' };
        const attrs = collect(config);
        expect(attrs['enduser.id']).toBe('7');
        expect(attrs['enduser.email']).toBe('a@b.c');
        expect(attrs['enduser.username']).toBe('neo');
    });

    it('emits all three layers together (RN core + Expo overrides + user)', () => {
        const collect = makeReactNativeContextCollector(() => ({ id: 'u9', email: 'z@z.io' }), {
            device: { modelName: 'iPhone 15', osName: 'iOS', osVersion: '17.4', deviceType: 1 },
            application: { nativeApplicationVersion: '3.1.0' },
        });
        const attrs = collect(config);
        // RN core
        expect(attrs['device.screen.width']).toBe(390);
        // Expo overrides RN os.* and adds device/app
        expect(attrs['os.name']).toBe('iOS');
        expect(attrs['os.version']).toBe('17.4');
        expect(attrs['device.model.name']).toBe('iPhone 15');
        expect(attrs['device.type']).toBe('phone');
        expect(attrs['app.version']).toBe('3.1.0');
        // User
        expect(attrs['enduser.id']).toBe('u9');
        expect(attrs['enduser.email']).toBe('z@z.io');
    });

    it('projects a readable context.device group (bare: OS + screen, no model/app)', () => {
        const collect = makeReactNativeContextCollector(() => null, {});
        const device = collect(config)['context.device'] as Record<string, unknown>;
        expect(device).toBeTruthy();
        expect(device.OS).toBe('ios 17.0');
        expect(device.screen).toBe('390 × 844 @ 3x');
        // Bare RN has no Expo: these keys are absent from the group.
        expect('model' in device).toBe(false);
        expect('appVersion' in device).toBe(false);
    });

    it('falls back to the native Android model when Expo is absent', () => {
        Platform.OS = 'android';
        Platform.Version = 34;
        Platform.constants = { Model: 'Pixel 7', Manufacturer: 'Google', Brand: 'google' };
        const collect = makeReactNativeContextCollector(() => null, {});
        const attrs = collect(config);
        expect(attrs['device.model.name']).toBe('Google Pixel 7');
        const device = attrs['context.device'] as Record<string, unknown>;
        expect(device.model).toBe('Google Pixel 7');
    });

    it('does not invent a model on bare iOS (RN core exposes none)', () => {
        Platform.OS = 'ios';
        const collect = makeReactNativeContextCollector(() => null, {});
        const attrs = collect(config);
        expect('device.model.name' in attrs).toBe(false);
        expect('model' in (attrs['context.device'] as Record<string, unknown>)).toBe(false);
    });

    it('context.device includes Expo model + app fields when present', () => {
        const collect = makeReactNativeContextCollector(() => null, {
            device: { modelName: 'iPhone 15', osName: 'iOS', osVersion: '17.4' },
            application: { nativeApplicationVersion: '3.1.0', applicationId: 'io.flare.smoke' },
        });
        const device = collect(config)['context.device'] as Record<string, unknown>;
        expect(device.model).toBe('iPhone 15');
        expect(device.OS).toBe('iOS 17.4');
        expect(device.appVersion).toBe('3.1.0');
        expect(device.appId).toBe('io.flare.smoke');
    });
});
