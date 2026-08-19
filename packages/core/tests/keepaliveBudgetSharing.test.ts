import { describe, expect, it, vi } from 'vitest';

import { Api } from '../src/api';
import { Flare } from '../src/Flare';
import type { FlushFn, FlushScheduler } from '../src/logging';

type ParsedEnvelope = {
    resourceLogs?: Array<{ scopeLogs: Array<{ logRecords: unknown[] }> }>;
    resourceSpans?: Array<{ scopeSpans: Array<{ spans: unknown[] }> }>;
};

/** Records what each POST was actually sent with, and holds every request open so the Api's in-flight
 *  keepalive budget stays occupied across both flushes, the way a real page hide does. */
class RecordingApi extends Api {
    sent: Array<{ url: string; keepalive: boolean; bytes: number; records: number }> = [];

    constructor() {
        super();
        globalThis.fetch = ((url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body)) as ParsedEnvelope;
            const records = url.includes('/v1/logs')
                ? (body.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.length ?? 0)
                : (body.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.length ?? 0);
            this.sent.push({
                url,
                keepalive: !!init.keepalive,
                bytes: new TextEncoder().encode(String(init.body)).length,
                records,
            });
            return new Promise(() => {}); // never settles: the request stays in flight
        }) as unknown as typeof fetch;
    }
}

/** Fires every registered buffer the way BrowserFlushScheduler does on page hide, in registration order. */
class ManualScheduler implements FlushScheduler {
    private flushes: FlushFn[] = [];
    register(flush: FlushFn): void {
        this.flushes.push(flush);
    }
    hide(): void {
        for (const flush of this.flushes) {
            flush({ keepalive: true });
        }
    }
}

function fill(flare: Flare, logs: number, spans: number): void {
    const filler = 'x'.repeat(2000);
    for (let i = 0; i < logs; i++) {
        flare.logger.info(`log-${i}`, { filler });
    }
    for (let i = 0; i < spans; i++) {
        flare.startSpan(`span-${i}`, { attributes: { filler } }).end();
    }
}

describe('logs and traces share one keepalive budget', () => {
    it('the first signal packs partially against the budget; the second, finding nothing left, ships anyway without keepalive', () => {
        const api = new RecordingApi();
        const scheduler = new ManualScheduler();
        const flare = new Flare(api, () => ({}), undefined, undefined, scheduler);
        flare.configure({
            key: 'k',
            enableLogs: true,
            enableTracing: true,
            maxLogBufferSize: 1000,
            maxSpanBufferSize: 1000,
            logFlushIntervalMs: 10 ** 6,
            spanFlushIntervalMs: 10 ** 6,
        });

        // Enough of each to overfill the shared allowance on its own.
        fill(flare, 40, 40);
        api.sent = [];
        scheduler.hide();

        expect(api.sent).toHaveLength(2);
        const [logsSent, spansSent] = api.sent;

        // Logger is constructed before Tracer, so logs flush first and pack what fits of the full 60,000-byte
        // budget, retaining the rest for a later flush.
        expect(logsSent.keepalive).toBe(true);
        expect(logsSent.bytes).toBeLessThanOrEqual(60_000);
        expect(flare.logger.bufferLength()).toBeGreaterThan(0);

        // Spans find nothing left of the shared budget. Before the fix this was total silence:
        // packForKeepalive selected nothing, flush() returned early, and the whole span buffer was retained
        // behind a timer that never fires on an unloading page. Now it ships anyway, just without keepalive.
        expect(spansSent.keepalive).toBe(false);
        expect(spansSent.records).toBe(40);
    });

    it('reports the whole budget when nothing is in flight', () => {
        expect(new Api().keepaliveBudgetRemaining()).toBe(60_000);
    });

    it('ships the whole buffer without keepalive when the shared budget has nothing left', () => {
        const api = new RecordingApi();
        // Saturate the shared per-page in-flight request cap directly, independent of byte size: 15 granted
        // keepalive sends that never resolve hold pendingKeepaliveRequests at the cap, so
        // keepaliveBudgetRemaining() reports 0 for every flush after this.
        for (let i = 0; i < 15; i++) {
            api.logs({ resourceLogs: [] }, 'https://ingress.flareapp.io/v1/logs', 'k', false, true);
        }
        expect(api.keepaliveBudgetRemaining()).toBe(0);
        api.sent = [];

        const flare = new Flare(api, () => ({}));
        flare.configure({ key: 'k', enableLogs: true });
        fill(flare, 5, 0);

        flare.logger.flush({ keepalive: true });

        expect(api.sent).toHaveLength(1);
        expect(api.sent[0].keepalive).toBe(false);
        expect(api.sent[0].records).toBe(5);
        expect(flare.logger.bufferLength()).toBe(0);
    });

    it('a partial pack keeps the existing behaviour: keepalive true, remainder retained, timer re-armed', () => {
        vi.useFakeTimers();
        try {
            const api = new RecordingApi();
            const scheduler = new ManualScheduler();
            const flare = new Flare(api, () => ({}), undefined, undefined, scheduler);
            flare.configure({
                key: 'k',
                enableLogs: true,
                maxLogBufferSize: 1000,
                logFlushIntervalMs: 5000,
            });

            fill(flare, 40, 0); // alone big enough to overfill the 60,000-byte budget
            api.sent = [];
            scheduler.hide();

            expect(api.sent).toHaveLength(1);
            expect(api.sent[0].keepalive).toBe(true);
            expect(api.sent[0].bytes).toBeLessThanOrEqual(60_000);
            const retained = flare.logger.bufferLength();
            expect(retained).toBeGreaterThan(0);
            expect(api.sent[0].records).toBe(40 - retained);

            vi.advanceTimersByTime(5000);

            expect(api.sent).toHaveLength(2);
            expect(api.sent[1].keepalive).toBe(false);
            expect(api.sent[1].records).toBe(retained);
            expect(flare.logger.bufferLength()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not send an empty envelope when a keepalive flush finds nothing buffered', () => {
        const api = new RecordingApi();
        const flare = new Flare(api, () => ({}));
        flare.configure({ key: 'k', enableLogs: true });

        flare.logger.flush({ keepalive: true });

        expect(api.sent).toHaveLength(0);
    });
});
