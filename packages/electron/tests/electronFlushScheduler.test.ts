import { describe, expect, it, vi } from 'vitest';

import { ElectronFlushScheduler } from '../src/main/ElectronFlushScheduler';
import { fakeApp } from './helpers';

describe('ElectronFlushScheduler', () => {
    it('flushes when the app emits before-quit', () => {
        const app = fakeApp();
        const flush = vi.fn();
        new ElectronFlushScheduler(app as any).register(flush);

        expect(app.handlers['before-quit']?.length).toBe(1);
        app.handlers['before-quit'][0]();
        expect(flush).toHaveBeenCalledTimes(1);
    });

    it('does not stack duplicate listeners across repeated register calls', () => {
        const app = fakeApp();
        const scheduler = new ElectronFlushScheduler(app as any);
        scheduler.register(vi.fn());
        scheduler.register(vi.fn());

        expect(app.handlers['before-quit']?.length).toBe(1);
    });

    it('detaches the before-quit listener on dispose', () => {
        const app = fakeApp();
        const flush = vi.fn();
        const scheduler = new ElectronFlushScheduler(app as any);
        scheduler.register(flush);

        scheduler.dispose();

        expect(app.handlers['before-quit']?.length).toBe(0);
    });

    it('can re-register after dispose', () => {
        const app = fakeApp();
        const scheduler = new ElectronFlushScheduler(app as any);
        scheduler.register(vi.fn());
        scheduler.dispose();
        scheduler.register(vi.fn());

        expect(app.handlers['before-quit']?.length).toBe(1);
    });
});
