// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('@flareapp/react/react-router entry', () => {
    beforeEach(() => {
        vi.resetModules();
        delete (window as unknown as { flare?: unknown }).flare;
    });

    test('importing the entry does NOT evaluate the @flareapp/js root singleton', async () => {
        const rootFactory = vi.fn(() => ({ flare: {} }));
        vi.doMock('@flareapp/js', rootFactory);
        vi.doMock('@flareapp/js/browser', () => ({ registerNavigationSource: () => ({}) }));
        await import('../src/react-router');
        expect(rootFactory).not.toHaveBeenCalled();
        expect((window as unknown as { flare?: unknown }).flare).toBeUndefined();
    });

    test('exports traceReactRouter', async () => {
        vi.doMock('@flareapp/js/browser', () => ({ registerNavigationSource: () => ({}) }));
        const mod = await import('../src/react-router');
        expect(typeof mod.traceReactRouter).toBe('function');
    });
});
