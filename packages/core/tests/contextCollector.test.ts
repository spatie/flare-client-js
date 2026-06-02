import { describe, expect, it, vi } from 'vitest';

import { Api } from '../src/api';
import { Flare } from '../src/Flare';
import type { Config } from '../src/types';

describe('Flare ContextCollector', () => {
    it('merges collector output into report attributes', async () => {
        const collector = vi.fn((_config: Config) => ({ 'custom.key': 'custom-value' }));
        const api = new Api();
        const sent: any[] = [];
        api.report = (report: any) => {
            sent.push(report);
            return Promise.resolve();
        };

        const flare = new Flare(api, collector);
        flare.light('test-key');
        await flare.report(new Error('boom'));

        expect(collector).toHaveBeenCalledTimes(1);
        expect(sent[0].attributes['custom.key']).toBe('custom-value');
    });

    it('defaults to a no-op collector', async () => {
        const api = new Api();
        const sent: any[] = [];
        api.report = (report: any) => {
            sent.push(report);
            return Promise.resolve();
        };
        const flare = new Flare(api);
        flare.light('test-key');
        await flare.report(new Error('boom'));
        expect(sent.length).toBe(1);
    });
});
