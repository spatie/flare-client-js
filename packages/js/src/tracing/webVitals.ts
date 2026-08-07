import type { Attributes } from '@flareapp/core';

import type { RouteName } from './navigation';
import { onCLS } from './webvitals/onCLS';
import { onFCP } from './webvitals/onFCP';
import { onINP } from './webvitals/onINP';
import { onLCP } from './webvitals/onLCP';
import { onTTFB } from './webvitals/onTTFB';

export type VitalName = 'ttfb' | 'fcp' | 'lcp' | 'cls' | 'inp';

/**
 * Latest value per vital. A vital the browser never reported stays absent rather than 0: CLS is
 * Chromium-only, and a zero from Firefox would be indistinguishable from a page with no layout shift.
 */
export type CollectedVitals = Partial<Record<VitalName, number>>;

/**
 * Final the moment they first report, so they can ride the pageload span itself. The other three keep
 * changing until the page goes away, and stamping an early value on the root would leave the root and
 * the later span disagreeing about the same vital.
 */
const EARLY_VITALS: VitalName[] = ['ttfb', 'fcp'];

export type VitalsSpan = {
    name: string;
    startTimeUnixNano: number;
    endTimeUnixNano: number;
    attributes: Attributes;
};

export type BuildVitalsSpanInput = {
    vitals: CollectedVitals;
    rootStartTimeUnixNano: number;
    routeName: string;
    routeSource: RouteName['source'];
    contextAttributes: Attributes;
};

/** The one place a vital becomes a wire key. Both the pageload stamp and the late span go through it. */
export function vitalAttributes(vitals: CollectedVitals): Attributes {
    const attributes: Attributes = {};
    for (const [name, value] of Object.entries(vitals)) {
        if (typeof value === 'number') {
            attributes[`browser.web_vital.${name}`] = value;
        }
    }
    return attributes;
}

/**
 * Turns the leftover values into one zero-duration span. Pure on purpose: the shape is what the backend
 * groups on, and this way it is testable without a tracer or a clock.
 *
 * Both timestamps sit at the pageload root's start. `spans_2` buckets on `start_time_unix_nano`, so
 * stamping the report moment would drop a tab left open for forty minutes into a minute forty minutes
 * after the page actually loaded.
 *
 * Returns null when nothing is left to report, so the caller emits no span at all.
 */
export function buildVitalsSpan(input: BuildVitalsSpanInput): VitalsSpan | null {
    const vitals = vitalAttributes(input.vitals);
    if (Object.keys(vitals).length === 0) {
        return null;
    }

    return {
        name: input.routeName,
        startTimeUnixNano: input.rootStartTimeUnixNano,
        endTimeUnixNano: input.rootStartTimeUnixNano,
        attributes: {
            ...input.contextAttributes,
            'flare.entry_point.handler.identifier': input.routeName,
            'flare.route.source': input.routeSource,
            ...vitals,
        },
    };
}

/** The shape of an upstream metric, narrowed to what we read. Keeps the fork out of our signatures. */
export type MetricLike = { value: number };

export type VitalSubscribers = {
    onTTFB: (cb: (metric: MetricLike) => void) => void;
    onFCP: (cb: (metric: MetricLike) => void) => void;
    onLCP: (cb: (metric: MetricLike) => void) => void;
    onCLS: (cb: (metric: MetricLike) => void) => void;
    onINP: (cb: (metric: MetricLike) => void) => void;
};

// Unlike recordComponentSpan(), which drops spans whose root is no longer live, this deliberately
// survives the pageload root's close: LCP, CLS and INP are not final until the page goes away.
let collected: CollectedVitals = {};
let subscribed = false;
let recording = false;
let taken = false;

function defaultSubscribers(): VitalSubscribers {
    return {
        onTTFB: (cb) => onTTFB(cb),
        onFCP: (cb) => onFCP(cb),
        // Without reportAllChanges, upstream's bindReporter only calls back on a forced report
        // (bindReporter.ts:42). TTFB and FCP force their one and only report already. LCP, CLS and
        // INP do not: they only force-report from a bfcache restore or a soft-navigation entry, neither
        // of which we use. Without this, a SPA route change takes whatever these three last happened to
        // report, which for a page with no interaction and no page hide yet is nothing at all.
        onLCP: (cb) => onLCP(cb, { reportAllChanges: true }),
        onCLS: (cb) => onCLS(cb, { reportAllChanges: true }),
        onINP: (cb) => onINP(cb, { reportAllChanges: true }),
    };
}

/**
 * Subscribes at most once per document: upstream's on* functions return no unsubscribe handle, so a
 * second call would attach a second set of observers with no way to detach either.
 */
export function startWebVitals(subscribers: VitalSubscribers = defaultSubscribers()): void {
    recording = true;
    if (subscribed) {
        return;
    }
    subscribed = true;
    // One try per vital, not one around all five: a browser that throws on the first entry type must
    // still get the other four, and the latch above means there is no second chance to wire them.
    subscribe(subscribers.onTTFB, 'ttfb');
    subscribe(subscribers.onFCP, 'fcp');
    subscribe(subscribers.onLCP, 'lcp');
    subscribe(subscribers.onCLS, 'cls');
    subscribe(subscribers.onINP, 'inp');
}

function subscribe(on: (cb: (metric: MetricLike) => void) => void, name: VitalName): void {
    try {
        on((metric) => record(name, metric));
    } catch {
        // a browser without this entry type must not break tracing
    }
}

function record(name: VitalName, metric: MetricLike): void {
    if (!recording || typeof metric?.value !== 'number') {
        return;
    }
    collected[name] = metric.value;
}

/**
 * Stops recording and drops what was collected. The observers themselves cannot be detached, and both
 * the `subscribed` and `taken` latches deliberately survive: clearing `subscribed` would let a re-enable
 * attach a second set of observers that is just as undetachable as the first, and clearing `taken` would
 * let those surviving observers refill `collected` and ship a second `browser_web_vital` for the same
 * document once the page is re-enabled and later hidden.
 */
export function stopWebVitals(): void {
    recording = false;
    collected = {};
}

/**
 * Test seam. The only thing that clears the subscribe and taken latches, so a test file can wire fresh
 * fake subscribers and take again per test. Production never resubscribes or re-takes; see
 * `stopWebVitals`.
 */
export function resetWebVitalsForTests(): void {
    stopWebVitals();
    subscribed = false;
    taken = false;
}

/**
 * The vitals that are already final when the pageload root closes, removed from `collected` so the late
 * span cannot report them a second time. Naturally idempotent: a second call finds the keys gone.
 */
export function takeEarlyVitals(): CollectedVitals | null {
    if (!recording) {
        return null;
    }
    const taking: CollectedVitals = {};
    for (const name of EARLY_VITALS) {
        const value = collected[name];
        if (value !== undefined) {
            taking[name] = value;
            delete collected[name];
        }
    }
    return Object.keys(taking).length === 0 ? null : taking;
}

/** Everything still outstanding, once. Null afterwards, and null when nothing is left. */
export function takeWebVitals(): CollectedVitals | null {
    if (taken || !recording || Object.keys(collected).length === 0) {
        return null;
    }
    taken = true;
    const taking = collected;
    collected = {};
    return taking;
}

/**
 * Undoes a take after the emit failed partway through, so the values are not lost and a later trigger
 * can retry. Safe to assign outright rather than merge: the whole emit runs synchronously between the
 * take and a catch block calling this, so nothing else can have written to `collected` in between.
 */
export function restoreWebVitals(vitals: CollectedVitals): void {
    collected = vitals;
    taken = false;
}
