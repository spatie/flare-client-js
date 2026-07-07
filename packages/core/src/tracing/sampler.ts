import type { SamplingContext, TracesSampler } from '../types';

export type { SamplingContext, TracesSampler } from '../types';

export function resolveSampling(
    ctx: SamplingContext,
    config: { tracesSampler?: TracesSampler; tracesSampleRate: number; debug?: boolean },
    rng: () => number = Math.random,
): boolean {
    if (ctx.parentSampled !== undefined) return ctx.parentSampled;

    let rate: number;
    if (config.tracesSampler) {
        let result: number | boolean;
        try {
            result = config.tracesSampler(ctx);
        } catch (error) {
            // A throwing customer sampler must never propagate out of startSpan (it would break instrumented host calls
            // like fetch). Fail closed.
            if (config.debug) console.error('Flare: tracesSampler threw, treating span as not sampled', error);
            return false;
        }
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
