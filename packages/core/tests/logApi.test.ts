import { afterEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../src/api';
import type { LogsEnvelope } from '../src/types';

const envelope: LogsEnvelope = {
    resourceLogs: [{ resource: { attributes: [], droppedAttributesCount: 0 }, scopeLogs: [] }],
};

afterEach(() => vi.restoreAllMocks());

describe('Api.logs', () => {
    it('POSTs the envelope with the x-api-token header and keepalive flag', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ status: 201 });
        vi.stubGlobal('fetch', fetchMock);

        await new Api().logs(envelope, 'https://example.test/v1/logs', 'KEY', false, true);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://example.test/v1/logs');
        expect(init.method).toBe('POST');
        expect(init.keepalive).toBe(true);
        expect(init.headers['x-api-token']).toBe('KEY');
        expect(JSON.parse(init.body)).toEqual(envelope);
    });

    it('never rejects on network failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
        await expect(new Api().logs(envelope, 'u', 'k')).resolves.toBeUndefined();
    });
});
