import { makeReport, stubFetch } from '@flareapp/test-helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../src/api';
import type { LogsEnvelope, TracesEnvelope } from '../src/types';

// ~40 KB serialized: two of these on the wire at once exceed the ~60 KB budget.
const bigTraces = (): TracesEnvelope =>
    ({ resourceSpans: [{ filler: 'x'.repeat(40_000) }] }) as unknown as TracesEnvelope;
const bigLogs = (): LogsEnvelope => ({ resourceLogs: [{ filler: 'x'.repeat(40_000) }] }) as unknown as LogsEnvelope;

const URL_T = 'https://x/v1/traces';
const URL_L = 'https://x/v1/logs';

afterEach(() => vi.unstubAllGlobals());

describe('Api keepalive byte-budget gate', () => {
    it('keeps keepalive for a single in-budget request', async () => {
        const fetchMock = stubFetch();

        await new Api().traces({ resourceSpans: [] }, URL_T, 'k', false, true);

        expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
    });

    it('downgrades keepalive when a concurrent request would breach the shared budget (logs + traces)', () => {
        const pending: Array<(v: unknown) => void> = [];
        const fetchMock = vi.fn(() => new Promise((res) => pending.push(res)));
        vi.stubGlobal('fetch', fetchMock);
        const api = new Api();

        void api.traces(bigTraces(), URL_T, 'k', false, true); // ~40 KB, stays in flight
        void api.logs(bigLogs(), URL_L, 'k', false, true); // +~40 KB would exceed the budget

        expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
        expect(fetchMock.mock.calls[1][1].keepalive).toBe(false); // downgraded to a normal fetch
    });

    it('frees the budget once an in-flight request settles', async () => {
        const pending: Array<(v: unknown) => void> = [];
        const fetchMock = vi.fn(() => new Promise((res) => pending.push(res)));
        vi.stubGlobal('fetch', fetchMock);
        const api = new Api();

        const first = api.traces(bigTraces(), URL_T, 'k', false, true);
        void api.logs(bigLogs(), URL_L, 'k', false, true);
        expect(fetchMock.mock.calls[1][1].keepalive).toBe(false); // over budget while first is in flight

        pending[0]({ status: 201 });
        await first; // resolves the then + finally, releasing the reserved bytes

        void api.traces(bigTraces(), URL_T, 'k', false, true);
        expect(fetchMock.mock.calls[2][1].keepalive).toBe(true); // budget freed
    });

    it('does not set keepalive when it was not requested (report path)', async () => {
        const fetchMock = stubFetch();

        await new Api().report(makeReport({ message: 'm' }), 'https://x/ingest', 'k', false);

        expect(fetchMock.mock.calls[0][1].keepalive).toBe(false);
    });
});
