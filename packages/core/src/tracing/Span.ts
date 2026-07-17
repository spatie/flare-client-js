import type { Attributes, AttributeValue, Span, SpanStatus } from '../types';

export type SpanInit = {
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    name: string;
    startTimeUnixNano: number;
    recording: boolean;
    epoch: number; // tracer generation at creation; stale after clear()
    scopeAttributes: Attributes;
};

export type SpanDeps = {
    maxAttributesPerSpan: number;
    maxEventsPerSpan: number;
    maxAttributesPerSpanEvent: number;
    now: () => number;
    onEnd: (span: SpanImpl) => void;
};

type RawEvent = { name: string; timeUnixNano: number; attributes: Attributes; droppedAttributesCount: number };

export class SpanImpl implements Span {
    readonly traceId: string;
    readonly spanId: string;
    readonly parentSpanId: string | null;
    name: string;
    readonly isRecording: boolean;
    readonly epoch: number;
    readonly startTimeUnixNano: number;
    readonly scopeAttributes: Attributes;
    endTimeUnixNano = 0;
    status: SpanStatus = { code: 0 };
    attributes: Attributes = {};
    droppedAttributesCount = 0;
    events: RawEvent[] = [];
    droppedEventsCount = 0;

    private ended = false;

    constructor(
        init: SpanInit,
        private deps: SpanDeps,
    ) {
        this.traceId = init.traceId;
        this.spanId = init.spanId;
        this.parentSpanId = init.parentSpanId;
        this.name = init.name;
        this.isRecording = init.recording;
        this.epoch = init.epoch;
        this.startTimeUnixNano = init.startTimeUnixNano;
        this.scopeAttributes = init.scopeAttributes;
    }

    setAttribute(key: string, value: AttributeValue): this {
        if (this.ended) return this;
        if (!(key in this.attributes) && Object.keys(this.attributes).length >= this.deps.maxAttributesPerSpan) {
            this.droppedAttributesCount++;
            return this;
        }
        this.attributes[key] = value;
        return this;
    }

    setStatus(status: SpanStatus): this {
        if (!this.ended) this.status = status;
        return this;
    }

    addEvent(name: string, attributes: Attributes = {}): this {
        if (this.ended) return this;
        if (this.events.length >= this.deps.maxEventsPerSpan) {
            this.droppedEventsCount++;
            return this;
        }
        const capped: Attributes = {};
        let dropped = 0;
        for (const [k, v] of Object.entries(attributes)) {
            if (Object.keys(capped).length >= this.deps.maxAttributesPerSpanEvent) {
                dropped++;
                continue;
            }
            capped[k] = v;
        }
        this.events.push({ name, timeUnixNano: this.deps.now(), attributes: capped, droppedAttributesCount: dropped });
        return this;
    }

    end(endTimeUnixNano?: number): void {
        if (this.ended) return;
        this.ended = true;
        this.endTimeUnixNano = endTimeUnixNano ?? this.deps.now();
        this.deps.onEnd(this);
    }
}
