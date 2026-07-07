import type { Span } from '@flareapp/core';

export type IdleTimeouts = {
    idleTimeout: number;
    finalTimeout: number;
    childSpanTimeout: number;
};

export type IdleRootDeps = {
    root: Span;
    addSpanListener: (fn: (e: { phase: 'start' | 'end'; span: Span }) => void) => () => void;
    setActiveRoot: (span: Span | undefined) => void;
    now: () => number; // unix nanos
    setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
    rootStartTime: number; // unix nanos, base for finalTimeout
};

type Timer = ReturnType<typeof setTimeout> | null;

/**
 * Owns one root span's idle lifecycle. The root stays open while child spans in its trace are
 * active; it closes after `idleTimeout` of no open children (trimmed to the last child's end), a
 * `finalTimeout` hard cap, or a `childSpanTimeout` stuck-child cap. Deps are injected so it is
 * unit-testable without real timers or a real tracer.
 */
export class IdleRootController {
    private openChildren = 0;
    private lastChildEndTime: number | null = null;
    private idleTimer: Timer = null;
    private finalTimer: Timer = null;
    private childTimer: Timer = null;
    private ended = false;
    private unsubscribe: () => void;

    constructor(
        private deps: IdleRootDeps,
        private timeouts: IdleTimeouts,
    ) {
        deps.setActiveRoot(deps.root);
        this.unsubscribe = deps.addSpanListener((e) => this.onSpanEvent(e.phase, e.span));

        const elapsedMs = Math.max(0, (deps.now() - deps.rootStartTime) / 1e6);
        const remainingMs = Math.max(0, timeouts.finalTimeout - elapsedMs);
        this.finalTimer = deps.setTimeout(() => this.finish(deps.now()), remainingMs);

        this.armIdle();
    }

    get isEnded(): boolean {
        return this.ended;
    }

    endNow(): void {
        this.finish(this.deps.now());
    }

    private onSpanEvent(phase: 'start' | 'end', span: Span): void {
        if (this.ended) return;
        if (span === this.deps.root) return;
        if (span.traceId !== this.deps.root.traceId) return;

        if (phase === 'start') {
            this.openChildren++;
            this.clearIdle();
            // childSpanTimeout is anchored to the 0->1 transition, not each child; a continuously
            // busy root force-ends childSpanTimeout ms after the batch began.
            if (this.openChildren === 1) this.armChildTimeout();
        } else {
            this.openChildren = Math.max(0, this.openChildren - 1);
            // endTimeUnixNano is 0 (SpanImpl's unset sentinel) until end() runs, which sets it
            // before dispatching this event, so a real child is non-zero here. `||` treats the 0
            // sentinel as unset and falls back to now(), matching SpanImpl.
            this.lastChildEndTime = span.endTimeUnixNano || this.deps.now();
            if (this.openChildren === 0) {
                this.clearChildTimeout();
                this.armIdle();
            }
        }
    }

    private armIdle(): void {
        this.clearIdle();
        this.idleTimer = this.deps.setTimeout(() => {
            if (this.openChildren > 0) return;
            this.finish(this.lastChildEndTime ?? this.deps.now());
        }, this.timeouts.idleTimeout);
    }

    private clearIdle(): void {
        if (this.idleTimer !== null) {
            this.deps.clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private armChildTimeout(): void {
        this.childTimer = this.deps.setTimeout(() => this.finish(this.deps.now()), this.timeouts.childSpanTimeout);
    }

    private clearChildTimeout(): void {
        if (this.childTimer !== null) {
            this.deps.clearTimeout(this.childTimer);
            this.childTimer = null;
        }
    }

    private finish(atTimeNano: number): void {
        if (this.ended) return;
        this.ended = true;
        this.clearIdle();
        this.clearChildTimeout();
        if (this.finalTimer !== null) {
            this.deps.clearTimeout(this.finalTimer);
            this.finalTimer = null;
        }
        this.unsubscribe();
        this.deps.root.end(atTimeNano);
        this.deps.setActiveRoot(undefined);
    }
}
