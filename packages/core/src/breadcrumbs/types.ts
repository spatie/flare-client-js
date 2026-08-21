import type { Glow, SpanEvent } from '../types';

/**
 * Which recorder produced an entry. Mirrors PHP's `RecorderType`. Only the glow reserve reads it today;
 * per-recorder caps, when they arrive, key off the same field.
 */
export const RecorderType = {
    Glow: 'glow',
    Click: 'click',
    Input: 'input',
    Fetch: 'fetch',
    Xhr: 'xhr',
    Navigation: 'navigation',
} as const;

export type RecorderType = (typeof RecorderType)[keyof typeof RecorderType];

export type BreadcrumbEntry = {
    /** Exactly what lands in `Report.events`. Built by the recorder, never rewritten by the buffer. */
    event: SpanEvent;
    recorder: RecorderType;
    /** Glow entries only, so `Flare.glows` can keep returning `Glow` objects after the migration. */
    glow?: Glow;
};

export type BreadcrumbLimits = {
    maxBreadcrumbs: number;
    maxBreadcrumbBytes: number;
    maxBreadcrumbEntryBytes: number;
    /** The glow reserve: eviction skips glows while the buffer holds this many or fewer. */
    maxGlowsPerReport: number;
};
