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
    // Where a childless close lands, instead of `now()`. A navigation passes its own start, so an
    // instant nav trims to ~0; a pageload passes the Navigation Timing load-event end, so it reports its
    // real load duration rather than the whole idleTimeout window.
    endFloor: () => number;
    // Suppresses idle-close until releaseHold(), for framework navigation roots that cannot be named
    // until the router settles, past the idle window. The finalTimeout/childSpanTimeout backstops still
    // apply.
    held?: boolean;
};

type Timer = ReturnType<typeof setTimeout> | null;

/**
 * Owns one root span's idle lifecycle: open while child spans in its trace are active, closing after
 * `idleTimeout` with no open children, or on the `finalTimeout` / `childSpanTimeout` backstops. Deps are
 * injected so this is testable without real timers or a real tracer.
 */
export class IdleRootController {
    private openChildren = 0;
    private lastChildEndTime: number | null = null;
    private settleTime: number | null = null;
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

    /** For a route change or pagehide. */
    endNow(): void {
        // With no child in flight, trim to the floor rather than padding out to the force-end moment. An
        // open child, or a hold (which means mid-loader-window), closes at now() instead, so the trace
        // records the work that ran rather than a ~0 trim back to the start floor.
        this.finish(this.openChildren > 0 || this.held ? this.deps.now() : this.trimmedEnd());
    }

    /**
     * Records the settle moment as a close floor and hands the root back to the normal idle lifecycle. It
     * deliberately does NOT close here: a router settles BEFORE the framework mounts the new route
     * component (vue-router runs `afterEach` in the route-update tick, Vue mounts on the next flush), so
     * closing at settle cleared the active root ahead of every post-navigation mount. Component spans
     * then read a null root and were dropped, and a trailing fetch opened a root of its own.
     */
    releaseHold(): void {
        if (this.ended || !this.held) {
            return;
        }
        this.held = false;
        if (this.openChildren === 0) {
            this.settleTime = this.deps.now();
        }
        this.armIdle();
    }

    private onSpanEvent(phase: 'start' | 'end', span: Span): void {
        if (this.ended) {
            return;
        }
        if (span === this.deps.root) {
            return;
        }
        if (span.traceId !== this.deps.root.traceId) {
            return;
        }

        if (phase === 'start') {
            this.onChildStarted();
            return;
        }
        this.onChildEnded(span);
    }

    private onChildStarted(): void {
        this.openChildren++;
        this.clearIdle();
        // childSpanTimeout is anchored to the 0->1 transition, not each child; a continuously
        // busy root force-ends childSpanTimeout ms after the batch began.
        if (this.openChildren === 1) {
            this.armChildTimeout();
        }
    }

    private onChildEnded(span: Span): void {
        this.openChildren = Math.max(0, this.openChildren - 1);
        // `||` not `??`: 0 is SpanImpl's unset sentinel, so it has to fall back to now() the way SpanImpl
        // itself does.
        this.lastChildEndTime = span.endTimeUnixNano || this.deps.now();
        if (this.openChildren > 0) {
            return;
        }
        this.clearChildTimeout();
        this.armIdle();
    }

    private armIdle(): void {
        this.clearIdle();
        // hold suppresses idle-close until releaseHold()
        if (this.held) {
            return;
        }
        this.idleTimer = this.deps.setTimeout(() => {
            if (this.openChildren > 0) {
                return;
            }
            this.finish(this.trimmedEnd());
        }, this.timeouts.idleTimeout);
    }

    /** The latest of the floor, a released hold's settle moment, and the last child's end, so a root
     *  covers its children without ever padding out to `now()`. */
    private trimmedEnd(): number {
        return Math.max(this.deps.endFloor(), this.settleTime ?? 0, this.lastChildEndTime ?? 0);
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
        if (this.ended) {
            return;
        }
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
