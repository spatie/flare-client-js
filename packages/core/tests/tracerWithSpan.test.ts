import { describe, expect, it } from 'vitest';

import { NoopFlushScheduler } from '../src/logging';
import { Tracer } from '../src/tracing/Tracer';
import type { Config, SdkInfo, Span } from '../src/types';

const config = (): Config =>
    ({
        key: 'k',
        debug: false,
        enableTracing: true,
        tracesIngestUrl: 'https://x/v1/traces',
        tracesSampleRate: 1,
        maxSpanBufferSize: 1000,
        spanFlushIntervalMs: 5000,
        spanFlushMaxBytes: 800_000,
        keepaliveMaxBytes: 60_000,
        maxSpansPerTrace: 1024,
        maxAttributesPerSpan: 128,
        maxEventsPerSpan: 128,
        maxAttributesPerSpanEvent: 128,
    }) as Config;

const makeTracer = () =>
    new Tracer({
        api: {} as never,
        getConfig: config,
        getSdkInfo: (): SdkInfo => ({ name: '@flareapp/core', version: '1.0.0' }),
        getFramework: () => null,
        getScopeAttributes: () => ({}),
        getResourceAttributes: () => ({}),
        track: (p) => p,
        scheduler: new NoopFlushScheduler(),
        now: () => 100,
        rng: () => 0,
    });

describe('Tracer.withSpan', () => {
    it('sets the span active during the sync callback and restores after', () => {
        const tracer = makeTracer();
        expect(tracer.getActiveSpan()).toBeUndefined();
        let activeInside: Span | undefined;
        const result = tracer.withSpan('op', (span) => {
            activeInside = tracer.getActiveSpan();
            return span.spanId;
        });
        expect(activeInside).toBeDefined();
        expect(typeof result).toBe('string');
        expect(tracer.getActiveSpan()).toBeUndefined();
    });

    it('ends the span and leaves status Unset on clean return', () => {
        const tracer = makeTracer();
        let captured: Span | undefined;
        tracer.withSpan('op', (span) => {
            captured = span;
        });
        expect((captured as unknown as { status: { code: number } }).status.code).toBe(0);
    });

    it('sets Error status and rethrows on a thrown error', () => {
        const tracer = makeTracer();
        let captured: Span | undefined;
        expect(() =>
            tracer.withSpan('op', (span) => {
                captured = span;
                throw new Error('boom');
            }),
        ).toThrow('boom');
        const status = (captured as unknown as { status: { code: number; message?: string } }).status;
        expect(status.code).toBe(2);
        expect(status.message).toBe('boom');
        expect(tracer.getActiveSpan()).toBeUndefined();
    });

    it('sets Error status and re-rejects on a rejecting promise', async () => {
        const tracer = makeTracer();
        let captured: Span | undefined;
        await expect(
            tracer.withSpan('op', (span) => {
                captured = span;
                return Promise.reject(new Error('async-boom'));
            }),
        ).rejects.toThrow('async-boom');
        const status = (captured as unknown as { status: { code: number; message?: string } }).status;
        expect(status.code).toBe(2);
        expect(status.message).toBe('async-boom');
    });

    it('detects a thenable (not just instanceof Promise) and sets Error on rejection', async () => {
        const tracer = makeTracer();
        let captured: Span | undefined;
        // A thenable that is NOT a Promise instance; instanceof Promise would miss it,
        // take the sync path, and leave status Unset (code 0) — this test catches that.
        const rejecting = Promise.reject(new Error('thenable-boom'));
        // eslint-disable-next-line unicorn/no-thenable
        const thenable = { then: (res: unknown, rej: unknown) => rejecting.then(res as never, rej as never) }; // oxlint-disable-line unicorn/no-thenable
        await expect(
            tracer.withSpan('op', (span) => {
                captured = span;
                return thenable as unknown as Promise<void>;
            }),
        ).rejects.toThrow('thenable-boom');
        const status = (captured as unknown as { status: { code: number } }).status;
        expect(status.code).toBe(2);
    });
});
