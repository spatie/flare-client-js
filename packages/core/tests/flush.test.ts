import { FakeApi } from '@flareapp/test-helpers';
import { describe, expect, it } from 'vitest';

import { Flare } from '../src/Flare';

describe('Flare.flush', () => {
    it('awaits in-flight reports', async () => {
        let resolveApi: () => void = () => {};
        const apiPromise = new Promise<void>((res) => {
            resolveApi = res;
        });
        const api = new FakeApi();
        api.report = () => apiPromise;
        const flare = new Flare(api);
        flare.light('k');

        let flushDone = false;
        const reportPromise = flare.report(new Error('x'));
        const flushPromise = flare.flush(1000).then(() => {
            flushDone = true;
        });

        // flush should not resolve while the report is in flight
        await new Promise((r) => setTimeout(r, 10));
        expect(flushDone).toBe(false);

        resolveApi();
        await reportPromise;
        await flushPromise;
        expect(flushDone).toBe(true);
    });

    it('returns after timeout even if a report is stuck', async () => {
        const api = new FakeApi();
        api.report = () => new Promise(() => {}); // never resolves
        const flare = new Flare(api);
        flare.light('k');
        const reportPromise = flare.report(new Error('x'));
        const start = Date.now();
        await flare.flush(50);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeGreaterThanOrEqual(45);
        expect(elapsed).toBeLessThan(500);
        // swallow the never-resolving promise
        void reportPromise;
    });
});
