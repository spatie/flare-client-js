import { stubFetch } from '@flareapp/test-helpers';
import { describe, expect, it, vi } from 'vitest';

import { Api } from '../src/api';
import type { TracesEnvelope } from '../src/types';

const envelope: TracesEnvelope = { resourceSpans: [] };

describe('Api.traces', () => {
    it('POSTs OTLP/JSON with the x-api-token header and the URL unchanged (no ?key=)', async () => {
        const fetchMock = stubFetch();

        await new Api().traces(envelope, 'https://ingress.flareapp.io/v1/traces', 'pub-key', false, true);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://ingress.flareapp.io/v1/traces');
        expect(init.method).toBe('POST');
        expect(init.keepalive).toBe(true);
        expect(init.headers['x-api-token']).toBe('pub-key');
        expect(init.headers['Content-Type']).toBe('application/json');

        vi.unstubAllGlobals();
    });

    it('logs a non-201 response in debug mode', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ status: 422 });
        vi.stubGlobal('fetch', fetchMock);
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});

        await new Api().traces(envelope, 'https://x/v1/traces', 'k', true);

        expect(err).toHaveBeenCalled();
        err.mockRestore();
        vi.unstubAllGlobals();
    });
});
