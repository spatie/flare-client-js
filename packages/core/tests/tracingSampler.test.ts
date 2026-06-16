import { describe, expect, it } from 'vitest';

import { resolveSampling } from '../src/tracing/sampler';
import type { SamplingContext } from '../src/types';

const ctx = (over: Partial<SamplingContext> = {}): SamplingContext => ({
    name: 'op',
    attributes: {},
    ...over,
});

describe('resolveSampling', () => {
    it('inherits an inbound parentSampled decision over everything else', () => {
        expect(resolveSampling(ctx({ parentSampled: true }), { tracesSampleRate: 0 })).toBe(true);
        expect(resolveSampling(ctx({ parentSampled: false }), { tracesSampleRate: 1 })).toBe(false);
    });

    it('uses tracesSampler boolean result when present', () => {
        expect(resolveSampling(ctx(), { tracesSampleRate: 0, tracesSampler: () => true })).toBe(true);
    });

    it('uses tracesSampler numeric result, clamped, with the injected rng', () => {
        const cfg = { tracesSampleRate: 1, tracesSampler: () => 0.5 };
        expect(resolveSampling(ctx(), cfg, () => 0.4)).toBe(true);
        expect(resolveSampling(ctx(), cfg, () => 0.6)).toBe(false);
    });

    it('falls back to tracesSampleRate; 0 never samples, 1 always samples', () => {
        expect(resolveSampling(ctx(), { tracesSampleRate: 0 }, () => 0)).toBe(false);
        expect(resolveSampling(ctx(), { tracesSampleRate: 1 }, () => 0.999)).toBe(true);
    });
});
