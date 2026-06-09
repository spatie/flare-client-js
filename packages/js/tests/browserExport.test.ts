// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

describe('@flareapp/js side-effect split', () => {
    it('importing src/browser.ts has NO import-time side effects', async () => {
        // Fresh module graph so index.ts side effects from other tests do not leak.
        vi.resetModules();
        // @ts-expect-error test global
        delete (window as any).flare;
        const mod = await import('../src/browser');
        expect((window as any).flare).toBeUndefined();
        expect(typeof mod.Flare).toBe('function');
        expect(typeof mod.catchWindowErrors).toBe('function');
        expect(typeof mod.collectBrowser).toBe('function');
        expect(typeof mod.FetchFileReader).toBe('function');
        expect(typeof mod.BrowserFlushScheduler).toBe('function');
    });

    it('importing the package root still installs window.flare (existing behavior preserved)', async () => {
        vi.resetModules();
        // @ts-expect-error test global
        delete (window as any).flare;
        await import('../src/index');
        expect((window as any).flare).toBeDefined();
    });
});
