import { describe, expect, it, vi } from 'vitest';

vi.mock('@flareapp/react/inject', () => ({
    FlareErrorBoundary: (props: Record<string, unknown>) => ({ type: 'InjectBoundary', props }),
}));

import * as RN from '../src/index';

describe('@flareapp/react-native public exports', () => {
    it('exposes the flare singleton and core methods', () => {
        expect(RN.flare).toBeDefined();
        expect(typeof RN.flare.light).toBe('function');
        expect(typeof RN.flare.report).toBe('function');
        expect(typeof RN.flare.setUser).toBe('function');
        expect(typeof RN.flare.removeHandlers).toBe('function');
    });

    it('exposes ReactNativeFlare and FlareErrorBoundary', () => {
        expect(typeof RN.ReactNativeFlare).toBe('function');
        expect(typeof RN.FlareErrorBoundary).toBe('function');
    });

    it('re-exports core Flare', () => {
        expect(typeof RN.Flare).toBe('function');
    });
});
