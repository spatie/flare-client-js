import { describe, expect, it, vi } from 'vitest';

import { NodeFlare } from '../src/Flare';

describe('Node log request context', () => {
    it('captures request attributes into a log recorded inside runWithContext', async () => {
        const flare = new NodeFlare();
        flare.light('KEY');
        flare.configure({ enableLogs: true, logFlushIntervalMs: 999_999 });

        const logsSpy = vi.spyOn(flare.api, 'logs').mockResolvedValue();

        // runWithContext(request: RequestContext, fn) — RequestContext fields are
        // top-level (packages/node/src/types.ts: method/path/headers).
        await flare.runWithContext({ method: 'GET', path: '/cart', headers: {} }, async () => {
            flare.logger.info('in request');
        });
        flare.logger.flush();

        expect(logsSpy).toHaveBeenCalledTimes(1);
        const envelope = logsSpy.mock.calls[0][0];
        const attrs = envelope.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
        const byKey = Object.fromEntries(attrs.map((a) => [a.key, a.value]));
        expect(byKey['http.request.method']).toEqual({ stringValue: 'GET' });
    });
});
