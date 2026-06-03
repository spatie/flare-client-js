import { describe, expect, it } from 'vitest';

import { Flare } from '../src/Flare';
import { FakeApi } from './helpers/FakeApi';

describe('Flare logging integration', () => {
    it('exposes flare.logger and ships logs through configure/flush', async () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.light('KEY');
        flare.configure({ enableLogs: true, logFlushIntervalMs: 999_999 });

        flare.logger.info('hello', { foo: 'bar' });
        expect(api.logEnvelopes).toHaveLength(0);

        await flare.flush();
        expect(api.logEnvelopes).toHaveLength(1);
        const rec = api.logEnvelopes[0].resourceLogs[0].scopeLogs[0].logRecords[0];
        expect(rec.body).toEqual({ stringValue: 'hello' });
        expect(rec.attributes).toContainEqual({ key: 'foo', value: { stringValue: 'bar' } });
    });

    it('keeps a user-supplied resource-prefixed attribute on the record, not the shared resource', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.light('KEY');
        flare.configure({ enableLogs: true, logFlushIntervalMs: 999_999 });

        flare.logger.info('hello', { 'service.name': 'user-supplied' });
        flare.logger.flush();

        const rl = api.logEnvelopes[0].resourceLogs[0];
        const resourceKeys = rl.resource.attributes.map((a) => a.key);
        // user 'service.name' must NOT be promoted onto the shared resource
        expect(rl.resource.attributes).not.toContainEqual({
            key: 'service.name',
            value: { stringValue: 'user-supplied' },
        });
        // it stays on the record
        expect(rl.scopeLogs[0].logRecords[0].attributes).toContainEqual({
            key: 'service.name',
            value: { stringValue: 'user-supplied' },
        });
        void resourceKeys;
    });

    it('ships a backlog buffered before light() once the key is set', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.configure({ enableLogs: true, logFlushIntervalMs: 999_999 });
        flare.logger.info('queued');
        expect(api.logEnvelopes).toHaveLength(0); // no key yet

        flare.light('KEY');
        expect(api.logEnvelopes).toHaveLength(1);
    });

    it('clears the buffer and never sends when logs are disabled', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.light('KEY');
        flare.configure({ enableLogs: true, logFlushIntervalMs: 999_999 });
        flare.logger.info('a');
        flare.configure({ enableLogs: false });
        flare.logger.flush();
        expect(api.logEnvelopes).toHaveLength(0);
    });

    it('deep-merges scope and user context.custom without clobbering addContext data', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.light('KEY');
        flare.configure({ enableLogs: true, logFlushIntervalMs: 999_999 });
        flare.addContext('fromScope', 1);
        flare.logger.info('x', { 'context.custom': { fromUser: 2 } });
        flare.logger.flush();

        const attrs = api.logEnvelopes[0].resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
        const custom = attrs.find((a) => a.key === 'context.custom');
        const values = (custom!.value as { kvlistValue: { values: Array<{ key: string }> } }).kvlistValue.values.map(
            (v) => v.key,
        );
        expect(values).toContain('fromScope');
        expect(values).toContain('fromUser');
    });

    it('freezes per-record attributes at capture time', () => {
        const api = new FakeApi();
        const flare = new Flare(api);
        flare.light('KEY');
        flare.configure({ enableLogs: true, logFlushIntervalMs: 999_999 });

        flare.addContext('k', 'v1');
        flare.logger.info('first');
        flare.addContext('k', 'v2');
        flare.logger.info('second');
        flare.logger.flush();

        const records = api.logEnvelopes[0].resourceLogs[0].scopeLogs[0].logRecords;
        const customOf = (i: number) =>
            (
                records[i].attributes.find((a) => a.key === 'context.custom')!.value as {
                    kvlistValue: { values: Array<{ key: string; value: { stringValue?: string } }> };
                }
            ).kvlistValue.values.find((v) => v.key === 'k')?.value;
        expect(customOf(0)).toEqual({ stringValue: 'v1' });
        expect(customOf(1)).toEqual({ stringValue: 'v2' });
    });
});
