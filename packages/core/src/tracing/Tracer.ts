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
    const ms = perf && perf.timeOrigin ? perf.timeOrigin + perf.now() : Date.now();
    return Math.round(ms * 1e6);
};

type TraceState = {
    traceId: string;
    recording: boolean;
    localRootSpanId: string;
    rootEnded: boolean;
    startedSpanCount: number;
    openSpanCount: number;
};

export type TracerDeps = {
    api: Api;
    getConfig: () => Config;
    getSdkInfo: () => SdkInfo;
    getFramework: () => Framework | null;
    buildSpanAttributes: (userAttributes: Attributes) => { record: Attributes; resource: Attributes };
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
    private now: () => number;
    private rng: () => number;
    private maxLiveTraces: number;
    private epoch = 0;
    private pendingContinuation: { traceId: string; parentSpanId: string; sampled: boolean } | null = null;

    constructor(private deps: TracerDeps) {
        this.buffer = new SpanBuffer({
            api: deps.api,
            getConfig: deps.getConfig,
            getSdkInfo: deps.getSdkInfo,
            getFramework: deps.getFramework,
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

    flush(opts?: { keepalive?: boolean }): void {
        this.buffer.flush(opts);
    }

    clear(): void {
        this.buffer.clear();
        this.traceStates.clear();
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
        const spanId = makeSpanId();

        if (!config.enableTracing) {
            return this.makeSpan(
                { traceId: makeTraceId(), spanId, parentSpanId: null, name, recording: false },
                opts,
                config,
            );
        }

        const { traceId, parentSpanId, state } = this.resolveTrace(spanId, name, opts, config);

        let recording = state.recording;
        if (state.startedSpanCount >= config.maxSpansPerTrace) {
            recording = false;
            if (config.debug) console.error('Flare: maxSpansPerTrace reached, dropping span');
        } else {
            state.startedSpanCount++;
        }
        state.openSpanCount++;

        return this.makeSpan({ traceId, spanId, parentSpanId, name, recording }, opts, config);
    }

    private resolveTrace(
        spanId: string,
        name: string,
        opts: SpanOptions,
        config: Config,
    ): { traceId: string; parentSpanId: string | null; state: TraceState } {
        let parent = opts.parent ?? this.holder.getActive();

        // A Span created before a clear() is stale: it must not parent or re-seed live
        // state. Plain {traceId, spanId} objects have no epoch and are never stale.
        if (parent && 'epoch' in parent && (parent as { epoch: number }).epoch !== this.epoch) {
            parent = undefined;
        }

        if (parent && 'spanId' in parent && 'traceId' in parent) {
            const traceId = parent.traceId;
            const isRecordingKnown = 'isRecording' in parent ? (parent as Span).isRecording : true;
            const state = this.getOrSeedState(traceId, spanId, isRecordingKnown);
            return { traceId, parentSpanId: parent.spanId, state };
        }

        // Continued trace (one-shot): consume the pending continuation.
        if (this.pendingContinuation) {
            const cont = this.pendingContinuation;
            this.pendingContinuation = null;
            const ctx: SamplingContext = {
                name,
                parentSampled: cont.sampled,
                attributes: opts.attributes ?? {},
                spanType: opts.spanType,
            };
            const recording = resolveSampling(ctx, config, this.rng);
            const state = this.createState(cont.traceId, spanId, recording);
            return { traceId: cont.traceId, parentSpanId: cont.parentSpanId, state };
        }

        // New root.
        const traceId = makeTraceId();
        const ctx: SamplingContext = { name, attributes: opts.attributes ?? {}, spanType: opts.spanType };
        const recording = resolveSampling(ctx, config, this.rng);
        const state = this.createState(traceId, spanId, recording);
        return { traceId, parentSpanId: null, state };
    }

    private getOrSeedState(traceId: string, localRootSpanId: string, fallbackRecording: boolean): TraceState {
        const existing = this.traceStates.get(traceId);
        if (existing) {
            // Refresh recency: delete + re-insert so it moves to the most-recent end
            // of the Map, making eviction true LRU rather than FIFO.
            this.traceStates.delete(traceId);
            this.traceStates.set(traceId, existing);
            return existing;
        }
        return this.createState(traceId, localRootSpanId, fallbackRecording);
    }

    private createState(traceId: string, localRootSpanId: string, recording: boolean): TraceState {
        // Bounded backstop: an app that never ends spans must not grow the map forever.
        // The Map is kept in recency order (getOrSeedState refreshes on access), so the
        // first key is the least-recently-used; evict it when at the cap.
        if (this.traceStates.size >= this.maxLiveTraces) {
            const lru = this.traceStates.keys().next().value;
            if (lru !== undefined) this.traceStates.delete(lru);
        }
        const state: TraceState = {
            traceId,
            recording,
            localRootSpanId,
            rootEnded: false,
            startedSpanCount: 0,
            openSpanCount: 0,
        };
        this.traceStates.set(traceId, state);
        return state;
    }

    private makeSpan(
        init: { traceId: string; spanId: string; parentSpanId: string | null; name: string; recording: boolean },
        opts: SpanOptions,
        config: Config,
    ): SpanImpl {
        const span = new SpanImpl(
            { ...init, startTimeUnixNano: opts.startTimeUnixNano ?? this.now(), epoch: this.epoch },
            {
                maxAttributesPerSpan: config.maxAttributesPerSpan,
                maxEventsPerSpan: config.maxEventsPerSpan,
                maxAttributesPerSpanEvent: config.maxAttributesPerSpanEvent,
                now: this.now,
                onEnd: (s) => this.onSpanEnd(s),
            },
        );
        if (opts.spanType) span.setAttribute('flare.span_type', opts.spanType);
        if (opts.attributes) {
            for (const [k, v] of Object.entries(opts.attributes)) span.setAttribute(k, v);
        }
        return span;
    }

    private onSpanEnd(span: SpanImpl): void {
        if (span.epoch !== this.epoch) return; // stale: created before a clear(); never buffer

        const state = this.traceStates.get(span.traceId);
        if (state) {
            state.openSpanCount--;
            if (span.spanId === state.localRootSpanId) state.rootEnded = true;
            if (state.rootEnded && state.openSpanCount <= 0) this.traceStates.delete(span.traceId);
        }

        if (!span.isRecording) return;
        if (!this.deps.getConfig().enableTracing) return; // ended after disable/clear: no buffering

        const { record, resource } = this.deps.buildSpanAttributes(span.attributes);
        const buffered: BufferedSpan = {
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId,
            name: span.name,
            startTimeUnixNano: span.startTimeUnixNano,
            endTimeUnixNano: span.endTimeUnixNano,
            status: span.status,
            recordAttributes: attributesToOpenTelemetry(record),
            resourceAttributes: resource,
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
    }
}
