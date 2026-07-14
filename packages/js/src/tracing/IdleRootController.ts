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
    // Floor for a trimmed close: when a root closes with no in-flight children its
    // end is this floor (read lazily), never `now()`. Navigation passes its start
    // time (an instant nav trims to ~0); pageload passes the Navigation Timing
    // load-event end so a childless pageload reports its real load duration instead
    // of being padded by the whole idleTimeout window.
    endFloor: () => number;
    // When true, the root opens with its idle-close suppressed until releaseHold() runs. The
    // finalTimeout / childSpanTimeout backstops still apply. Used by framework navigation roots
    // that cannot be named until the router settles, past the idle window.
    held?: boolean;
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
    private held = false;
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

        this.held = !!deps.held;
        this.armIdle();
    }

    get isEnded(): boolean {
        return this.ended;
    }

    endNow(): void {
        // Force-ended (route change / pagehide). With no child in flight, trim to the
        // floor instead of padding to the force-end moment; with an open child use
        // now() so in-flight work is not cut short before it even started.
        this.finish(this.openChildren > 0 ? this.deps.now() : this.trimmedEnd());
    }

    /**
     * Release a navigation hold. A childless root closes at `now()` (so its duration spans
     * start→settle, capturing the loader window); a root with children re-arms the normal idle
     * lifecycle so trailing work keeps it open. No-op when never held or already ended.
     */
    releaseHold(): void {
        if (this.ended || !this.held) return;
        this.held = false;
        if (this.openChildren > 0) {
            this.armIdle();
        } else {
            this.finish(this.deps.now());
        }
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
        if (this.held) return; // hold suppresses idle-close until releaseHold()
        this.idleTimer = this.deps.setTimeout(() => {
            if (this.openChildren > 0) return;
            this.finish(this.trimmedEnd());
        }, this.timeouts.idleTimeout);
    }

    /**
     * End time for a trimmed close: the later of the injected floor and the last
     * child's end, so a root never pads out to `now()`. With no children it is the
     * floor itself (navigation start, or the pageload load-event end); with children
     * it stretches to cover the last one.
     */
    private trimmedEnd(): number {
        return Math.max(this.deps.endFloor(), this.lastChildEndTime ?? 0);
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
