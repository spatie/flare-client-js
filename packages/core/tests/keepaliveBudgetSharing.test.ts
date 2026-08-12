import { describe, expect, it } from 'vitest';

import { Api } from '../src/api';
import { Flare } from '../src/Flare';
import type { FlushFn, FlushScheduler } from '../src/logging';

/** Records what each POST was actually sent with, and holds every request open so the Api's in-flight
 *  keepalive budget stays occupied across both flushes, the way a real page hide does. */
class RecordingApi extends Api {
    sent: Array<{ url: string; keepalive: boolean; bytes: number }> = [];

    constructor() {
        super();
        globalThis.fetch = ((url: string, init: RequestInit) => {
            this.sent.push({
                url,
                keepalive: !!init.keepalive,
                bytes: new TextEncoder().encode(String(init.body)).length,
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
    it('the second signal to flush packs against what is left, so both go keepalive', () => {
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

        // Everything sent as keepalive fits the browser's ~64 KB in-flight allowance. Before, both signals
        // packed a full 60 KB and whichever went second was over the gate in Api.send().
        const keepaliveBytes = api.sent.filter((r) => r.keepalive).reduce((sum, r) => sum + r.bytes, 0);
        expect(keepaliveBytes).toBeGreaterThan(0);
        expect(keepaliveBytes).toBeLessThanOrEqual(60_000);
        expect(api.sent.every((r) => r.keepalive)).toBe(true);

        // The signal that found no room keeps its records for a later flush rather than dropping them.
        expect(flare.logger.bufferLength()).toBeGreaterThan(0);
    });

    it('reports the whole budget when nothing is in flight', () => {
        expect(new Api().keepaliveBudgetRemaining()).toBe(60_000);
    });
});
