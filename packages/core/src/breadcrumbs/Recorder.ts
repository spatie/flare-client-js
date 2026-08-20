import type { Config, Span } from '../types';
import type { BreadcrumbBuffer } from './BreadcrumbBuffer';
import type { BreadcrumbLimits, RecorderType } from './types';

export type RecorderDeps = {
    /** Read live on every call. `Flare.configure` replaces the config object wholesale. */
    getConfig: () => Config;
    /** The active scope's buffer. A function, not a value: in Node the scope changes per request. */
    buffer: () => BreadcrumbBuffer;
    getActiveSpan: () => Span | undefined;
    nowNano: () => number;
};

/**
 * Mirrors PHP's `Recorder`. `withErrors` and `withTraces` are the per-recorder switches from the PHP
 * config; they are not exposed as options yet, so each recorder sets them in its own constructor.
 */
export abstract class Recorder {
    protected withErrors = true;
    protected withTraces = false;

    abstract readonly recorderType: RecorderType;

    constructor(protected deps: RecorderDeps) {}

    protected get limits(): BreadcrumbLimits {
        const config = this.deps.getConfig();
        return {
            maxBreadcrumbs: config.maxBreadcrumbs,
            maxBreadcrumbBytes: config.maxBreadcrumbBytes,
            maxBreadcrumbEntryBytes: config.maxBreadcrumbEntryBytes,
            maxGlowsPerReport: config.maxGlowsPerReport,
        };
    }
}
