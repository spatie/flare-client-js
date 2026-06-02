// @vitest-environment jsdom
/**
 * Verifies that `new Flare()` from @flareapp/js produces browser-wired behavior:
 * - telemetry.sdk.name is '@flareapp/js'
 * - flare.entry_point.type is 'web' (browser context collected)
 * - flare.entry_point.value is a non-empty string (derived from window.location.href)
 */
import { NullFileReader } from '@flareapp/core';
import { describe, expect, it } from 'vitest';

import { Flare } from '../src';
import { FakeApi } from './helpers';

describe('Flare class from @flareapp/js', () => {
    it('new Flare() uses @flareapp/js as sdk name', async () => {
        const api = new FakeApi();
        // NullFileReader avoids network calls in jsdom
        const flare = new Flare(api, undefined, new NullFileReader());
        flare.light('test-key');
        await flare.report(new Error('test'));

        expect(api.lastReport!.attributes['telemetry.sdk.name']).toBe('@flareapp/js');
    });

    it('new Flare() collects browser context (entry_point.type === web)', async () => {
        const api = new FakeApi();
        const flare = new Flare(api, undefined, new NullFileReader());
        flare.light('test-key');
        await flare.report(new Error('test'));

        expect(api.lastReport!.attributes['flare.entry_point.type']).toBe('web');
    });

    it('new Flare() sets a non-empty flare.entry_point.value from window.location', async () => {
        const api = new FakeApi();
        const flare = new Flare(api, undefined, new NullFileReader());
        flare.light('test-key');
        await flare.report(new Error('test'));

        const val = api.lastReport!.attributes['flare.entry_point.value'];
        expect(typeof val).toBe('string');
        expect((val as string).length).toBeGreaterThan(0);
    });
});
