import type { SamplingContext, TracesSampler } from '../types';

export type { SamplingContext, TracesSampler } from '../types';

export function resolveSampling(
    ctx: SamplingContext,
    config: { tracesSampler?: TracesSampler; tracesSampleRate: number },
    rng: () => number = Math.random,
): boolean {
    if (ctx.parentSampled !== undefined) return ctx.parentSampled;

    let rate: number;
    if (config.tracesSampler) {
        const result = config.tracesSampler(ctx);
        if (typeof result === 'boolean') return result;
        rate = result;
    } else {
        rate = config.tracesSampleRate;
    }

    rate = Math.max(0, Math.min(1, rate));
    if (rate <= 0) return false;
    if (rate >= 1) return true;
    return rng() < rate;
}
