import type { Api } from '../api';
import type { FlushScheduler } from '../logging';
import { attributesToOpenTelemetry } from '../logging/otel';
import { SpanStatusCode } from '../types';
import type {
    Attributes,
    BufferedSpan,
    Config,
    Framework,
    SamplingContext,
    SdkInfo,
    Span,
    SpanOptions,
} from '../types';
import { evictLruIfNew } from '../util';
import { ActiveSpanHolder, InMemoryActiveSpanHolder } from './context';
import { spanId as makeSpanId, traceId as makeTraceId } from './ids';
import { resolveSampling } from './sampler';
import { SpanImpl } from './Span';
import { SpanBuffer } from './SpanBuffer';
import { parseTraceparent } from './traceparent';

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        (typeof value === 'object' || typeof value === 'function') &&
        value !== null &&
        typeof (value as { then?: unknown }).then === 'function'
    );
}

type SpanParent = NonNullable<SpanOptions['parent']>;

// SpanOptions.parent is a structurally overlapping union; isRecording is what tells a real Span apart.
function isSpan(parent: SpanParent): parent is Span {
    return 'isRecording' in parent;
}

// A SpanImpl carries the epoch it was created under; a hand-stitched {traceId, spanId} parent does not.
function hasEpoch(parent: SpanParent): parent is SpanParent & { epoch: number } {
    return 'epoch' in parent && typeof (parent as { epoch?: unknown }).epoch === 'number';
}

export function defaultNowNano(): number {
    const performanceApi = (globalThis as { performance?: Performance }).performance;
    // timeOrigin is missing in some environments (older Safari, some Hermes builds/polyfills); undefined + now() would
    // yield NaN timestamps on every span. Fall back to Date.now().
    const ms =
        performanceApi && typeof performanceApi.now === 'function' && typeof performanceApi.timeOrigin === 'number'
            ? performanceApi.timeOrigin + performanceApi.now()
            : Date.now();
    return Math.round(ms * 1e6);
}

export type SpanPhase = 'start' | 'end';
export type SpanLifecycleEvent = { phase: SpanPhase; span: Span };
export type SpanLifecycleListener = (event: SpanLifecycleEvent) => void;

// A trace picked up from an inbound `traceparent`, pending its next root span.
export type TraceContinuation = { traceId: string; parentSpanId: string; sampled: boolean };

type TraceState = {
    traceId: string;
    recording: boolean;
    localRootSpanId: string;
    rootEnded: boolean;
    startedSpanCount: number;
    openSpanCount: number;
    generation: number;
    loggedCap: boolean;
};

// What survives a pruned trace: three primitives, no span reference, so an ended root is not held alive.
type ClosedTrace = { localRootSpanId: string; recording: boolean; startedSpanCount: number };

const MAX_CLOSED_TRACES = 100;

/** Bounded backstop for the live TraceState map: an app that never ends spans must not grow it forever. */
export const DEFAULT_MAX_LIVE_TRACES = 1000;

export type TracerDeps = {
    api: Api;
    getConfig: () => Config;
    getSdkInfo: () => SdkInfo;
    getFramework: () => Framework | null;
    getScopeAttributes: () => Attributes;
    getResourceAttributes: () => Attributes;
    track: <T>(p: Promise<T>) => Promise<T>;
    scheduler: FlushScheduler;
    activeSpanHolder?: ActiveSpanHolder;
    now?: () => number;
    rng?: () => number;
    maxLiveTraces?: number;
};

export class Tracer {
    private buffer: SpanBuffer;
    private holder: ActiveSpanHolder;
    private traceStates = new Map<string, TraceState>();
    private closedTraces = new Map<string, ClosedTrace>();
    private stateGeneration = 0;
    private now: () => number;
    private rng: () => number;
    private maxLiveTraces: number;
    private epoch = 0;
    private pendingContinuation: TraceContinuation | null = null;
    private spanListeners = new Set<SpanLifecycleListener>();

    constructor(private deps: TracerDeps) {
        this.buffer = new SpanBuffer({
            api: deps.api,
            getConfig: deps.getConfig,
            getSdkInfo: deps.getSdkInfo,
            getFramework: deps.getFramework,
            getResourceAttributes: deps.getResourceAttributes,
            track: deps.track,
            scheduler: deps.scheduler,
        });
        this.holder = deps.activeSpanHolder ?? new InMemoryActiveSpanHolder();
        this.now = deps.now ?? defaultNowNano;
        this.rng = deps.rng ?? Math.random;
        this.maxLiveTraces = deps.maxLiveTraces ?? DEFAULT_MAX_LIVE_TRACES;
    }

    getActiveSpan(): Span | undefined {
        return this.holder.getActive();
    }

    setActiveRoot(span?: Span): void {
        this.holder.setActiveRoot?.(span);
    }

    /**
     * Claims a span slot before the span exists, for a caller that publishes a span id early (the
     * component profilers do; their descendants record first). Returns false when the trace is full.
     * Paired with `startSpan({ claimed: true })`.
     */
    claimSpanSlot(traceId: string): boolean {
        const config = this.deps.getConfig();
        if (!config.enableTracing) {
            return false;
        }
        const state = this.traceStates.get(traceId);
        if (!state || !state.recording || state.startedSpanCount >= config.maxSpansPerTrace) {
            return false;
        }
        state.startedSpanCount++;
        return true;
    }

    addSpanListener(fn: SpanLifecycleListener): () => void {
        this.spanListeners.add(fn);
        return () => {
            this.spanListeners.delete(fn);
        };
    }

    private emitSpanEvent(phase: SpanPhase, span: Span): void {
        for (const fn of this.spanListeners) {
            try {
                fn({ phase, span });
            } catch {
                // A listener must never break tracing.
            }
        }
    }

    flush(opts?: { keepalive?: boolean }): void {
        this.buffer.flush(opts);
    }

    clear(): void {
        this.buffer.clear();
        this.traceStates.clear();
        this.closedTraces.clear();
        // The holder outlives clear(): without this it keeps the last root and its scopeAttributes snapshot
        // reachable until the browser layer happens to set a new one.
        this.setActiveRoot(undefined);
        this.pendingContinuation = null;
        this.epoch++; // spans created before this point become stale (won't buffer on end)
    }

    continueFromTraceparent(header: string): void {
        this.pendingContinuation = parseTraceparent(header);
    }

    /**
     * Runs `fn` with the span active, so spans started inside it auto-parent to it, then ends the span.
     * Records an error status first if `fn` throws or its returned promise rejects.
     */
    withSpan<T>(name: string, fn: (span: Span) => T, opts: SpanOptions = {}): T {
        const span = this.startSpan(name, opts);

        const finishError = (error: unknown): void => {
            span.setStatus({
                code: SpanStatusCode.Error,
                message: error instanceof Error ? error.message : String(error),
            });
            span.end();
        };

        return this.holder.withActive(span, () => {
            try {
                const result = fn(span);
                if (isPromiseLike(result)) {
                    return result.then(
                        (value) => {
                            span.end();
                            return value;
                        },
                        (error) => {
                            finishError(error);
                            throw error;
                        },
                    ) as T;
                }
                span.end();
                return result;
            } catch (error) {
                finishError(error);
                throw error;
            }
        });
    }

    /**
     * Starts a span the caller must end. Unlike `withSpan`, it does not become the active span, so spans
     * started after it do not auto-parent to it.
     */
    startSpan(name: string, opts: SpanOptions = {}): Span {
        const config = this.deps.getConfig();
        const spanId = opts.spanId ?? makeSpanId();

        // pendingContinuation (continueFromTraceparent) is a one-shot for the next startSpan: a parentless
        // root adopts it, anything else drops it.
        const continuation = this.pendingContinuation;
        this.pendingContinuation = null;

        // Deliberately below the consume above, not at the top of the method: hoisting it leaves a stale
        // continuation pending for a later, unrelated root. tests/tracerContinuation.test.ts:50-59 pins that.
        if (!config.enableTracing) {
            return this.startInertSpan(name, spanId, opts, config);
        }

        const { traceId, parentSpanId, state } = this.resolveTrace(spanId, name, opts, config, continuation);

        let recording = state.recording;
        // A claimed span already paid for its slot, so it skips both the check and the increment.
        if (opts.claimed) {
            // already counted
        } else if (state.startedSpanCount >= config.maxSpansPerTrace) {
            recording = false;
            // Once per trace: a root that never closes would otherwise log on every span for the page's lifetime.
            if (config.debug && !state.loggedCap) {
                state.loggedCap = true;
                console.error('Flare: maxSpansPerTrace reached, dropping span');
            }
        } else {
            state.startedSpanCount++;
        }
        // Unconditional, including for spans the cap just made non-recording: they still call end(), so the count
        // has to see both sides or the root's prune fires while they are open.
        state.openSpanCount++;

        // Local root: this span is the one its TraceState was seeded on, so it is the one that carries the
        // scope attributes (see makeSpan).
        const isLocalRoot = state.localRootSpanId === spanId;
        const span = this.makeSpan(
            { traceId, spanId, parentSpanId, name, recording, isLocalRoot, stateGeneration: state.generation },
            opts,
            config,
        );
        this.emitSpanEvent('start', span);
        return span;
    }

    // A real Span handle that records nothing, so callers never have to branch on whether tracing is on.
    private startInertSpan(name: string, spanId: string, opts: SpanOptions, config: Config): Span {
        const span = this.makeSpan(
            {
                traceId: makeTraceId(),
                spanId,
                parentSpanId: null,
                name,
                recording: false,
                isLocalRoot: true,
                stateGeneration: 0,
            },
            opts,
            config,
        );
        this.emitSpanEvent('start', span);
        return span;
    }

    private resolveTrace(
        spanId: string,
        name: string,
        opts: SpanOptions,
        config: Config,
        continuation: TraceContinuation | null,
    ): { traceId: string; parentSpanId: string | null; state: TraceState } {
        // forceRoot: never inherit the ambient active span. A navigation root started inside withSpan(...) must not
        // become a mid-trace child.
        let parent = opts.forceRoot ? opts.parent : (opts.parent ?? this.holder.getActive());

        // A span from before a clear() is stale and must not parent or re-seed live state. Plain
        // {traceId, spanId} parents have no epoch, so they are never stale. hasEpoch must stay a real type
        // refinement, or a shared discriminator like 'traceId' would break the narrowing here.
        if (parent && hasEpoch(parent) && parent.epoch !== this.epoch) {
            parent = undefined;
        }

        if (parent && 'spanId' in parent && 'traceId' in parent) {
            const traceId = parent.traceId;
            // A real Span carries its trace's recording decision; a hand-stitched {traceId, spanId} parent
            // does not, so run the sampler instead of assuming recording. Lazy, so the sampler's side
            // effects (rng use) only run when new state is actually seeded.
            const fallbackRecording = (): boolean =>
                isSpan(parent)
                    ? parent.isRecording
                    : resolveSampling(
                          { name, attributes: opts.attributes ?? {}, spanType: opts.spanType },
                          config,
                          this.rng,
                      );
            const state = this.getOrSeedState(traceId, spanId, fallbackRecording);
            return { traceId, parentSpanId: parent.spanId, state };
        }

        // Continued trace: continuation captured and cleared by startSpan (one-shot); a parentless span adopts it.
        if (continuation) {
            const ctx: SamplingContext = {
                name,
                parentSampled: continuation.sampled,
                attributes: opts.attributes ?? {},
                spanType: opts.spanType,
            };
            const recording = resolveSampling(ctx, config, this.rng);
            const state = this.createState(continuation.traceId, spanId, recording);
            return { traceId: continuation.traceId, parentSpanId: continuation.parentSpanId, state };
        }

        const traceId = makeTraceId();
        const ctx: SamplingContext = { name, attributes: opts.attributes ?? {}, spanType: opts.spanType };
        const recording = resolveSampling(ctx, config, this.rng);
        const state = this.createState(traceId, spanId, recording);
        return { traceId, parentSpanId: null, state };
    }

    private getOrSeedState(traceId: string, localRootSpanId: string, fallbackRecording: () => boolean): TraceState {
        const existing = this.traceStates.get(traceId);
        if (existing) {
            // Re-insert so the Map stays in recency order and eviction is true LRU.
            this.traceStates.delete(traceId);
            this.traceStates.set(traceId, existing);
            return existing;
        }
        // A trace that pruned is not a new trace. Re-seeding from its record keeps the original local root, so a
        // late child stays lean, and keeps the spent span count, so maxSpansPerTrace is a durable per-trace cap.
        const closed = this.closedTraces.get(traceId);
        if (closed) {
            this.closedTraces.delete(traceId);
            const state = this.createState(traceId, closed.localRootSpanId, closed.recording);
            state.startedSpanCount = closed.startedSpanCount;
            state.rootEnded = true; // the original local root already ended and will never end again
            return state;
        }
        return this.createState(traceId, localRootSpanId, fallbackRecording());
    }

    private createState(traceId: string, localRootSpanId: string, recording: boolean): TraceState {
        // An app that never ends spans must not grow the map forever. The Map is in recency order, so the first
        // key is the LRU.
        evictLruIfNew(this.traceStates, traceId, this.maxLiveTraces);
        const state: TraceState = {
            traceId,
            recording,
            localRootSpanId,
            rootEnded: false,
            startedSpanCount: 0,
            openSpanCount: 0,
            generation: ++this.stateGeneration,
            loggedCap: false,
        };
        this.traceStates.set(traceId, state);
        return state;
    }

    private makeSpan(
        init: {
            traceId: string;
            spanId: string;
            parentSpanId: string | null;
            name: string;
            recording: boolean;
            isLocalRoot: boolean;
            stateGeneration: number;
        },
        opts: SpanOptions,
        config: Config,
    ): SpanImpl {
        const scopeAttributes = init.recording && init.isLocalRoot ? this.deps.getScopeAttributes() : {};
        const span = new SpanImpl(
            {
                ...init,
                startTimeUnixNano: opts.startTimeUnixNano ?? this.now(),
                epoch: this.epoch,
                scopeAttributes,
            },
            {
                maxAttributesPerSpan: config.maxAttributesPerSpan,
                maxEventsPerSpan: config.maxEventsPerSpan,
                maxAttributesPerSpanEvent: config.maxAttributesPerSpanEvent,
                now: this.now,
                onEnd: (s) => this.onSpanEnd(s),
            },
        );
        if (opts.spanType) {
            span.setAttribute('flare.span_type', opts.spanType);
        }
        if (opts.attributes) {
            for (const [key, value] of Object.entries(opts.attributes)) {
                span.setAttribute(key, value);
            }
        }
        return span;
    }

    // Bounded, LRU by insertion order, like traceStates. Holds primitives only, never a span.
    private rememberClosed(state: TraceState): void {
        evictLruIfNew(this.closedTraces, state.traceId, MAX_CLOSED_TRACES);
        this.closedTraces.set(state.traceId, {
            localRootSpanId: state.localRootSpanId,
            recording: state.recording,
            startedSpanCount: state.startedSpanCount,
        });
    }

    private onSpanEnd(span: SpanImpl): void {
        this.emitSpanEvent('end', span);
        // stale: created before a clear(); never buffer
        if (span.epoch !== this.epoch) {
            return;
        }

        const state = this.traceStates.get(span.traceId);
        // Generation check, not just a trace id match: after an LRU eviction and re-seed the id is the same but
        // the state is not, and a stale decrement would prune a state with spans still open.
        if (state && state.generation === span.stateGeneration) {
            state.openSpanCount--;
            if (span.spanId === state.localRootSpanId) {
                state.rootEnded = true;
            }
            if (state.rootEnded && state.openSpanCount <= 0) {
                this.traceStates.delete(span.traceId);
                this.rememberClosed(state);
            }
        }

        if (!span.isRecording) {
            return;
        }
        // ended after disable/clear: no buffering
        if (!this.deps.getConfig().enableTracing) {
            return;
        }

        // Buffering runs inside the app's span.end() call (e.g. the fetch wrapper's success path). Serializing exotic
        // attribute values must never throw out of end() and reject a host request; a failed buffer just drops the span.
        try {
            const record: Attributes = { ...span.scopeAttributes, ...span.attributes };
            const buffered: BufferedSpan = {
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                startTimeUnixNano: span.startTimeUnixNano,
                endTimeUnixNano: span.endTimeUnixNano,
                status: span.status,
                recordAttributes: attributesToOpenTelemetry(record),
                droppedAttributesCount: span.droppedAttributesCount,
                droppedEventsCount: span.droppedEventsCount,
                events: span.events.map((event) => ({
                    name: event.name,
                    timeUnixNano: event.timeUnixNano,
                    attributes: attributesToOpenTelemetry(event.attributes),
                    droppedAttributesCount: event.droppedAttributesCount,
                })),
            };
            this.buffer.add(buffered);
        } catch (error) {
            if (this.deps.getConfig().debug) {
                console.error('Flare: failed to buffer span', error);
            }
        }
    }
}
