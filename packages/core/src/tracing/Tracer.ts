import type { Api } from '../api';
import type { FlushScheduler } from '../logging';
import { attributesToOpenTelemetry } from '../logging/otel';
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
import { ActiveSpanHolder, InMemoryActiveSpanHolder } from './context';
import { spanId as makeSpanId, traceId as makeTraceId } from './ids';
import { resolveSampling } from './sampler';
import { SpanImpl } from './Span';
import { SpanBuffer } from './SpanBuffer';
import { parseTraceparent } from './traceparent';

export const defaultNowNano = (): number => {
    const perf = (globalThis as { performance?: Performance }).performance;
    // timeOrigin is missing in some environments (older Safari, some Hermes builds/polyfills); undefined + now() would
    // yield NaN timestamps on every span. Fall back to Date.now().
    const ms =
        perf && typeof perf.now === 'function' && typeof perf.timeOrigin === 'number'
            ? perf.timeOrigin + perf.now()
            : Date.now();
    return Math.round(ms * 1e6);
};

export type SpanLifecycleEvent = { phase: 'start' | 'end'; span: Span };
export type SpanLifecycleListener = (event: SpanLifecycleEvent) => void;

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

/** What survives a pruned trace: three primitives, no span reference, so an ended root is not held alive. */
type ClosedTrace = { localRootSpanId: string; recording: boolean; startedSpanCount: number };

/**
 * Both trace maps cap their size the same way: insertion order is LRU, so the first key is the one to drop.
 * Only evicts when `key` is not already in the map. A set() that overwrites an existing key does not grow the
 * map, so it must not evict an unrelated entry to make room for it.
 */
function evictLruIfNew<V>(map: Map<string, V>, key: string, cap: number): void {
    if (map.has(key) || map.size < cap) {
        return;
    }
    const lru = map.keys().next().value;
    if (lru !== undefined) {
        map.delete(lru);
    }
}

const MAX_CLOSED_TRACES = 100;

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
    maxLiveTraces?: number; // bounded backstop; default 1000
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
    private pendingContinuation: { traceId: string; parentSpanId: string; sampled: boolean } | null = null;
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
        this.maxLiveTraces = deps.maxLiveTraces ?? 1000;
    }

    getActiveSpan(): Span | undefined {
        return this.holder.getActive();
    }

    setActiveRoot(span?: Span): void {
        // setActiveRoot is optional on the holder interface; a holder without active-root support ignores it.
        this.holder.setActiveRoot?.(span);
    }

    addSpanListener(fn: SpanLifecycleListener): () => void {
        this.spanListeners.add(fn);
        return () => {
            this.spanListeners.delete(fn);
        };
    }

    private emitSpanEvent(phase: 'start' | 'end', span: Span): void {
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

    withSpan<T>(name: string, fn: (span: Span) => T, opts: SpanOptions = {}): T {
        const span = this.startSpan(name, opts);

        const finishError = (error: unknown): void => {
            span.setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
            span.end();
        };

        return this.holder.withActive(span, () => {
            try {
                const result = fn(span);
                if (result && typeof (result as { then?: unknown }).then === 'function') {
                    return (result as unknown as Promise<unknown>).then(
                        (value) => {
                            span.end();
                            return value;
                        },
                        (error) => {
                            finishError(error);
                            throw error;
                        },
                    ) as unknown as T;
                }
                span.end();
                return result;
            } catch (error) {
                finishError(error);
                throw error;
            }
        });
    }

    startSpan(name: string, opts: SpanOptions = {}): Span {
        const config = this.deps.getConfig();
        const spanId = opts.spanId ?? makeSpanId();

        // Pending continuation (continueFromTraceparent) is a strict one-shot for the NEXT startSpan: consumed by a
        // parentless root, dropped when the span has a parent or tracing is disabled. Never lingers, so it can't attach
        // a stale remote trace to an unrelated later root.
        const continuation = this.pendingContinuation;
        this.pendingContinuation = null;

        // Deliberately below the consume above, not at the top of the method: hoisting it leaves a stale
        // continuation pending for a later, unrelated root. tests/tracerContinuation.test.ts:50-59 pins that.
        if (!config.enableTracing) {
            return this.startInertSpan(name, spanId, opts, config);
        }

        const { traceId, parentSpanId, state } = this.resolveTrace(spanId, name, opts, config, continuation);

        let recording = state.recording;
        if (state.startedSpanCount >= config.maxSpansPerTrace) {
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

        // "Local root" test: this span seeded (or is) its TraceState's local root. True for new, continued, and
        // foreign-parent roots; false for a child of an already-seen trace.
        const isLocalRoot = state.localRootSpanId === spanId;
        const span = this.makeSpan(
            { traceId, spanId, parentSpanId, name, recording, isLocalRoot, stateGeneration: state.generation },
            opts,
            config,
        );
        this.emitSpanEvent('start', span);
        return span;
    }

    /** A real Span handle that records nothing, so callers never have to branch on whether tracing is on. */
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
        continuation: { traceId: string; parentSpanId: string; sampled: boolean } | null,
    ): { traceId: string; parentSpanId: string | null; state: TraceState } {
        // forceRoot: never inherit the ambient active span. A navigation root started inside withSpan(...) must not
        // become a mid-trace child.
        let parent = opts.forceRoot ? opts.parent : (opts.parent ?? this.holder.getActive());

        // A Span created before a clear() is stale: must not parent or re-seed live state. Plain {traceId, spanId}
        // objects have no epoch and are never stale.
        if (parent && 'epoch' in parent && (parent as { epoch: number }).epoch !== this.epoch) {
            parent = undefined;
        }

        if (parent && 'spanId' in parent && 'traceId' in parent) {
            const traceId = parent.traceId;
            // A real Span carries its trace's recording decision; a manually stitched {traceId, spanId} parent does
            // not. Run the sampler instead of assuming recording, so tracesSampleRate 0 does not still buffer and ship.
            // Lazy so the sampler (side effects, rng consumption) only runs when new state is actually seeded.
            const fallbackRecording = (): boolean =>
                'isRecording' in parent
                    ? (parent as Span).isRecording
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

        // New root.
        const traceId = makeTraceId();
        const ctx: SamplingContext = { name, attributes: opts.attributes ?? {}, spanType: opts.spanType };
        const recording = resolveSampling(ctx, config, this.rng);
        const state = this.createState(traceId, spanId, recording);
        return { traceId, parentSpanId: null, state };
    }

    private getOrSeedState(traceId: string, localRootSpanId: string, fallbackRecording: () => boolean): TraceState {
        const existing = this.traceStates.get(traceId);
        if (existing) {
            // Refresh recency: delete + re-insert moves it to the Map's most-recent end, making eviction true LRU.
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
        // Bounded backstop: an app that never ends spans must not grow the map forever. The Map is kept in recency
        // order (getOrSeedState refreshes on access), so the first key is the LRU; evict it at the cap.
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
            for (const [k, v] of Object.entries(opts.attributes)) {
                span.setAttribute(k, v);
            }
        }
        return span;
    }

    /** Bounded, LRU by insertion order, like traceStates. Holds primitives only, never a span. */
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
                events: span.events.map((e) => ({
                    name: e.name,
                    timeUnixNano: e.timeUnixNano,
                    attributes: attributesToOpenTelemetry(e.attributes),
                    droppedAttributesCount: e.droppedAttributesCount,
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
